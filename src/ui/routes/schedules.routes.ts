import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import cron from 'node-cron';
import { readAll, writeAll, upsert, findById, remove, SCRIPTS, SUITES, PROJECTS, FUNCTIONS, SCHEDULES } from '../../data/store';
import type { TestScript, TestSuite, CommonFunction, Project, ScheduledRun } from '../../data/types';
import type { RunRecord } from '../helpers/types';
import { requireAuth, requireEditor } from '../../auth/middleware';
import { requireFeature } from '../helpers/middleware';
import { logAudit } from '../../auth/audit';
import { logger } from '../../utils/logger';
import { config } from '../../framework/config';
import { generateCodegenSpec } from '../../utils/codegenGenerator';
import { runs, cronJobs } from '../helpers/state';
import { enqueueRun } from '../helpers/run-queue';
import { spawnRunWithSpec } from '../helpers/run-spawner';

function triggerScheduledRun(schedule: ScheduledRun): void {
  const suite = findById<TestSuite>(SUITES, schedule.suiteId);
  const project = suite ? findById<Project>(PROJECTS, suite.projectId) : undefined;
  if (!suite || !project) {
    logger.warn(`[scheduler] Suite ${schedule.suiteId} or project not found — skipping`);
    return;
  }

  const environment = (project.environments || []).find(e => e.id === schedule.environmentId) || project.environments?.[0] || null;
  const scripts = readAll<TestScript>(SCRIPTS).filter(s => suite.scriptIds.includes(s.id));
  const allFunctions = readAll<CommonFunction>(FUNCTIONS).filter(f => f.projectId === project.id || f.projectId === null);

  if (scripts.length === 0) {
    logger.warn(`[scheduler] No scripts in suite ${suite.name} — skipping`);
    return;
  }

  const runId = uuidv4();
  const startedAt = new Date().toISOString();

  let specPath: string;
  try {
    specPath = generateCodegenSpec({
      suiteName: suite.name, suiteId: suite.id, runId, scripts, project, environment, allFunctions,
      port: config.ui.port, beforeEachSteps: suite.beforeEachSteps ?? [],
      afterEachSteps: suite.afterEachSteps ?? [], fastMode: suite.fastMode ?? false,
      fastModeSteps: suite.fastModeSteps ?? [], overlayHandlers: suite.overlayHandlers ?? [],
    });
  } catch (err) {
    logger.error(`[scheduler] Spec generation failed for schedule ${schedule.id}: ${(err as Error).message}`);
    return;
  }

  const planId = `suite-${suite.id.slice(0, 8)}`;
  const planFile = path.join(config.paths.testPlans, `${planId}-plan.json`);
  if (!fs.existsSync(planFile)) {
    const planMeta = {
      planId, source: 'suite', sourceRef: suite.id, suiteName: suite.name,
      projectName: project.name, appBaseURL: project.appUrl, createdAt: startedAt,
      testCases: scripts.map(s => ({ id: s.id, title: s.title, priority: s.priority })),
    };
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, JSON.stringify(planMeta, null, 2));
  }

  const record: RunRecord = {
    runId, planPath: planFile, planId, startedAt, specPath,
    status: 'queued', exitCode: null, output: [], tests: [], passed: 0, failed: 0, total: 0,
    projectId: project.id, projectName: project.name,
    suiteId: suite.id, suiteName: suite.name,
    environmentId: environment?.id || '', environmentName: environment?.name || '',
    executedBy: `scheduler:${schedule.label}`,
    browsers: suite.browsers ?? ['chromium'],
    traceMode: 'on-first-retry',
  };
  runs.set(runId, record);
  enqueueRun(() => spawnRunWithSpec(record, specPath, false, suite.retries ?? 0, suite.browsers ?? ['chromium']));

  const all = readAll<ScheduledRun>(SCHEDULES);
  const idx = all.findIndex(s => s.id === schedule.id);
  if (idx >= 0) { all[idx].lastRunId = runId; all[idx].lastRunAt = startedAt; writeAll(SCHEDULES, all); }

  logger.info(`[scheduler] Triggered run ${runId} for schedule "${schedule.label}" (suite: ${suite.name})`);
}

export function registerCronJob(schedule: ScheduledRun): void {
  if (cronJobs.has(schedule.id)) {
    cronJobs.get(schedule.id)!.stop();
    cronJobs.delete(schedule.id);
  }
  if (!schedule.enabled) return;
  if (!cron.validate(schedule.cronExpression)) {
    logger.warn(`[scheduler] Invalid cron expression for schedule ${schedule.id}: "${schedule.cronExpression}"`);
    return;
  }
  const task = cron.schedule(schedule.cronExpression, () => triggerScheduledRun(schedule), { timezone: 'UTC' });
  cronJobs.set(schedule.id, task);
  logger.info(`[scheduler] Registered schedule "${schedule.label}" → ${schedule.cronExpression}`);
}

export function unregisterCronJob(scheduleId: string): void {
  const task = cronJobs.get(scheduleId);
  if (task) { task.stop(); cronJobs.delete(scheduleId); }
}

export function registerSchedulesRoutes(app: express.Application): void {
  app.get('/api/schedules', requireAuth, requireFeature('scheduler'), (req: Request, res: Response) => {
    const { suiteId, projectId } = req.query as Record<string, string>;
    let all = readAll<ScheduledRun>(SCHEDULES);
    if (suiteId) all = all.filter(s => s.suiteId === suiteId);
    if (projectId) all = all.filter(s => s.projectId === projectId);
    res.json(all);
  });

  app.post('/api/schedules', requireAuth, requireEditor, requireFeature('scheduler'), (req: Request, res: Response) => {
    const { suiteId, environmentId, cronExpression, label } = req.body as Partial<ScheduledRun>;
    if (!suiteId || !environmentId || !cronExpression || !label) {
      res.status(400).json({ error: 'suiteId, environmentId, cronExpression and label are required' }); return;
    }
    if (!cron.validate(cronExpression)) {
      res.status(400).json({ error: `Invalid cron expression: "${cronExpression}"` }); return;
    }
    const suite = findById<TestSuite>(SUITES, suiteId);
    if (!suite) { res.status(404).json({ error: 'Suite not found' }); return; }

    const schedule: ScheduledRun = {
      id: uuidv4(), projectId: suite.projectId, suiteId, environmentId,
      cronExpression, label, enabled: true,
      createdBy: req.session.username ?? 'unknown',
      createdAt: new Date().toISOString(),
    };
    upsert(SCHEDULES, schedule);
    registerCronJob(schedule);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCHEDULE_CREATE', resourceType: 'schedule', resourceId: schedule.id, details: label, ip: req.ip ?? null });
    res.json(schedule);
  });

  app.put('/api/schedules/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    const all = readAll<ScheduledRun>(SCHEDULES);
    const idx = all.findIndex(s => s.id === req.params.id);
    if (idx < 0) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const { label, cronExpression, enabled, environmentId } = req.body as Partial<ScheduledRun>;
    if (cronExpression && !cron.validate(cronExpression)) {
      res.status(400).json({ error: `Invalid cron expression: "${cronExpression}"` }); return;
    }

    const updated: ScheduledRun = {
      ...all[idx],
      ...(label !== undefined && { label }),
      ...(cronExpression !== undefined && { cronExpression }),
      ...(enabled !== undefined && { enabled }),
      ...(environmentId !== undefined && { environmentId }),
    };
    all[idx] = updated;
    writeAll(SCHEDULES, all);
    registerCronJob(updated);
    res.json(updated);
  });

  app.delete('/api/schedules/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    unregisterCronJob(req.params.id);
    remove(SCHEDULES, req.params.id);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCHEDULE_DELETE', resourceType: 'schedule', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });
}