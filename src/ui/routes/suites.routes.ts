import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readAll, writeAll, findById, upsert, remove, SCRIPTS, SUITES, PROJECTS, FUNCTIONS } from '../../data/store';
import type { TestScript, TestSuite, CommonFunction, BrowserName, Project } from '../../data/types';
import type { RunRecord } from '../helpers/types';
import { requireAuth, requireAuthOrApiKey, requireEditor, sanitizeInput } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { logger } from '../../utils/logger';
import { config } from '../../framework/config';
import { generateCodegenSpec } from '../../utils/codegenGenerator';
import { runs } from '../helpers/state';
import { enqueueRun, MAX_CONCURRENT_RUNS, activeRunCount, runQueue } from '../helpers/run-queue';
import { spawnRunWithSpec, attachDefectInfo } from '../helpers/run-spawner';

export function registerSuitesRoutes(app: express.Application): void {
  app.get('/api/suites/all', requireAuth, (_req: Request, res: Response) => {
    res.json(readAll<TestSuite>(SUITES));
  });

  app.get('/api/suites', (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
    res.json(readAll<TestSuite>(SUITES).filter(s => s.projectId === projectId));
  });

  app.get('/api/suites/:id', (req: Request, res: Response) => {
    const suite = findById<TestSuite>(SUITES, req.params.id);
    if (!suite) { res.status(404).json({ error: 'Not found' }); return; }
    const scripts = readAll<TestScript>(SCRIPTS);
    const enriched = { ...suite, scripts: suite.scriptIds.map(sid => scripts.find(s => s.id === sid)).filter(Boolean) };
    res.json(enriched);
  });

  app.post('/api/suites', requireEditor, (req: Request, res: Response) => {
    const body = req.body as Partial<TestSuite>;
    if (!body.projectId || !body.name) { res.status(400).json({ error: 'projectId and name required' }); return; }
    const now = new Date().toISOString();
    const VALID_BROWSERS: BrowserName[] = ['chromium', 'firefox', 'webkit'];
    const suite: TestSuite = {
      id: uuidv4(), projectId: body.projectId, name: sanitizeInput(body.name),
      description: sanitizeInput(body.description ?? ''), scriptIds: body.scriptIds ?? [],
      environmentId: body.environmentId ?? null,
      retries: ([0, 1, 2].includes(body.retries as number) ? body.retries : 0) as 0 | 1 | 2,
      browsers: Array.isArray(body.browsers) ? body.browsers.filter((b): b is BrowserName => VALID_BROWSERS.includes(b as BrowserName)) : ['chromium'],
      beforeEachSteps: Array.isArray(body.beforeEachSteps) ? body.beforeEachSteps : [],
      afterEachSteps: Array.isArray(body.afterEachSteps) ? body.afterEachSteps : [],
      fastMode: !!body.fastMode,
      fastModeSteps: Array.isArray(body.fastModeSteps) ? body.fastModeSteps : [],
      overlayHandlers: Array.isArray(body.overlayHandlers) ? body.overlayHandlers : [],
      flakinessOverrides: body.flakinessOverrides || {},
      createdBy: req.session.username!, createdAt: now,
      modifiedBy: req.session.username!, modifiedAt: now,
    };
    upsert(SUITES, suite);
    res.json({ success: true, id: suite.id });
  });

  app.put('/api/suites/:id', requireEditor, (req: Request, res: Response) => {
    const suite = findById<TestSuite>(SUITES, req.params.id);
    if (!suite) { res.status(404).json({ error: 'Not found' }); return; }
    const body = req.body as Partial<TestSuite>;
    if (body.name) suite.name = sanitizeInput(body.name);
    if (body.description !== undefined) suite.description = sanitizeInput(body.description);
    if (body.scriptIds) suite.scriptIds = body.scriptIds;
    if (body.environmentId !== undefined) suite.environmentId = body.environmentId;
    if (body.retries !== undefined) suite.retries = ([0, 1, 2].includes(body.retries as number) ? body.retries : 0) as 0 | 1 | 2;
    if (Array.isArray(body.browsers)) { const VB: BrowserName[] = ['chromium', 'firefox', 'webkit']; suite.browsers = body.browsers.filter((b): b is BrowserName => VB.includes(b as BrowserName)); if (!suite.browsers.length) suite.browsers = ['chromium']; }
    if (Array.isArray(body.beforeEachSteps)) suite.beforeEachSteps = body.beforeEachSteps;
    if (Array.isArray(body.afterEachSteps)) suite.afterEachSteps = body.afterEachSteps;
    if (body.fastMode !== undefined) suite.fastMode = !!body.fastMode;
    if (Array.isArray(body.fastModeSteps)) suite.fastModeSteps = body.fastModeSteps;
    if (Array.isArray(body.overlayHandlers)) suite.overlayHandlers = body.overlayHandlers;
    if (body.flakinessOverrides) suite.flakinessOverrides = body.flakinessOverrides;
    suite.modifiedBy = req.session.username!;
    suite.modifiedAt = new Date().toISOString();
    upsert(SUITES, suite);
    res.json({ success: true });
  });

  app.delete('/api/suites/:id', requireEditor, (req: Request, res: Response) => {
    remove(SUITES, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/suites/:id/run', requireAuthOrApiKey, requireEditor, async (req: Request, res: Response) => {
    const suite = findById<TestSuite>(SUITES, req.params.id);
    if (!suite) { res.status(404).json({ error: 'Not found' }); return; }

    const project = findById<Project>(PROJECTS, suite.projectId);
    if (!project) { res.status(400).json({ error: 'Project not found' }); return; }

    const allScripts = readAll<TestScript>(SCRIPTS);
    const scripts = suite.scriptIds
      .map(id => allScripts.find(s => s.id === id))
      .filter(Boolean) as TestScript[];
    if (!scripts.length) { res.status(400).json({ error: 'No scripts in suite' }); return; }

    const allFunctions = readAll<CommonFunction>(FUNCTIONS)
      .filter(f => f.projectId === suite.projectId || f.projectId === null);

    const envId = req.body.environmentId || suite.environmentId || null;
    const environment = envId
      ? (project.environments || []).find(e => e.id === envId) || null
      : (project.environments?.[0] || null);

    const runId = uuidv4();
    const startedAt = new Date().toISOString();

    let specPath: string;
    try {
      specPath = generateCodegenSpec({
        suiteName: suite.name, suiteId: suite.id, runId, scripts, project, environment,
        allFunctions, port: config.ui.port,
        beforeEachSteps: suite.beforeEachSteps ?? [],
        afterEachSteps: suite.afterEachSteps ?? [],
        fastMode: suite.fastMode ?? false,
        fastModeSteps: suite.fastModeSteps ?? [],
        overlayHandlers: suite.overlayHandlers ?? [],
      });
      logger.info(`[suite run] Codegen spec → ${specPath}`);
    } catch (err) {
      logger.error(`[suite run] Codegen generation failed: ${(err as Error).message}`);
      res.status(500).json({ error: 'Failed to generate spec file' });
      return;
    }

    const planId = `suite-${suite.id.slice(0, 8)}`;
    const planFile = path.join(config.paths.testPlans, `${planId}-plan.json`);
    const planMeta = {
      planId, source: 'suite', sourceRef: suite.id,
      suiteName: suite.name, projectName: project.name,
      appBaseURL: project.appUrl, createdAt: new Date().toISOString(),
      testCases: scripts.map(s => ({ id: s.id, title: s.title, priority: s.priority })),
    };
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, JSON.stringify(planMeta, null, 2));

    const VB: BrowserName[] = ['chromium', 'firefox', 'webkit'];
    const reqBrowsers = Array.isArray(req.body.browsers)
      ? req.body.browsers.filter((b: string): b is BrowserName => VB.includes(b as BrowserName))
      : [];
    const runBrowsers: BrowserName[] = reqBrowsers.length > 0 ? reqBrowsers : (suite.browsers?.length ? suite.browsers : ['chromium']);

    if (runBrowsers.length > 1) {
      const hasTestData = scripts.some(s => s.steps.some(step => step.valueMode === 'testdata'));
      if (hasTestData) {
        res.status(400).json({ error: 'Multi-browser execution is not supported when "Value Source" is "Test Data (Static)". Please select only one browser.' });
        return;
      }
    }

    const queuePosition = runQueue.length;
    const traceArg = (['on', 'retain-on-failure', 'off'].includes(req.body.traceMode) ? req.body.traceMode : 'on') as 'on' | 'retain-on-failure' | 'off';
    const record: RunRecord = {
      runId, planPath: planFile, planId, startedAt, specPath,
      status: queuePosition > 0 ? 'queued' : 'running',
      exitCode: null, output: [], tests: [], passed: 0, failed: 0, total: 0,
      projectId: project.id, projectName: project.name,
      suiteId: suite.id, suiteName: suite.name,
      environmentId: environment?.id || '', environmentName: environment?.name || '',
      executedBy: req.session.username ?? 'unknown',
      browsers: runBrowsers,
      traceMode: traceArg,
    };
    runs.set(runId, record);

    const queuePos = activeRunCount >= MAX_CONCURRENT_RUNS ? runQueue.length + 1 : 0;

    enqueueRun(() => spawnRunWithSpec(record, specPath, req.body.headed !== false, suite.retries ?? 0, runBrowsers, traceArg));

    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SUITE_RUN', resourceType: 'suite', resourceId: suite.id, details: suite.name, ip: req.ip ?? null });
    res.json({ runId, startedAt, queued: queuePos > 0, queuePosition: queuePos });
  });
}