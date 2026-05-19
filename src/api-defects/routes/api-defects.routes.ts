import type { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { requireAuth, requireEditor } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { logger } from '../../utils/logger';
import { getJiraClient } from '../../ui/helpers/jira-helpers';
import { loadJiraConfig } from '../../utils/defectsStore';
import { buildEnrichedApiDefectAdf } from '../../utils/adfBuilder';
import { enrichDefectPayload } from '../api-defect-enricher';
import { findOpenApiDefect, appendApiDefectRecord, loadApiDefectsRegistry } from '../api-defect-store';
import { getReport } from '../../api-flakiness/flakiness-service';
import { readAll, API_COLLECTIONS, API_ENVS } from '../../data/store';
import type { ApiCollection, ApiEnvironment, ApiCollectionRunResult } from '../../data/types';
import type { ApiDefectRecord } from '../contracts/api-defect.contracts';

const RUNS_DIR = path.resolve(process.env.DATA_DIR || 'data', 'api-runs');

function loadRun(runId: string): ApiCollectionRunResult | null {
  const file = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as ApiCollectionRunResult; }
  catch { return null; }
}

export function registerApiDefectsRoutes(app: Express): void {
  app.post('/api/api-defects/draft', requireAuth, async (req: Request, res: Response) => {
    const { runId, stepId } = req.body || {};
    if (!runId || !stepId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'runId and stepId required' } });
    }

    const run = loadRun(runId);
    if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });

    const step = run.stepResults.find(s => s.stepId === stepId);
    if (!step) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Step not found in run' } });

    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === run.collectionId);
    if (!collection) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Collection not found' } });

    const environments = readAll<ApiEnvironment>(API_ENVS);
    const environment = environments.find(e => e.id === collection.environmentId);
    if (!environment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Environment not found' } });

    let flakinessReport;
    try { flakinessReport = getReport(run.collectionId); } catch { /* non-fatal */ }

    const payload = enrichDefectPayload({ step, run, collection, environment, flakinessReport });

    const cfg = loadJiraConfig();
    const existingDefect = findOpenApiDefect(stepId, run.collectionId);

    const projects = readAll<any>('projects');
    const project = projects.find((p: any) => p.id === (collection as any).projectId);
    const jiraProjectKey = project?.jiraProjectKey || null;

    const summary = `[API] ${payload.stepName} failed — ${payload.method} ${payload.url}`.slice(0, 255);

    return res.json({
      payload,
      summary,
      descriptionADF: buildEnrichedApiDefectAdf(payload),
      suggestedPriority: cfg?.defaultPriority || 'Medium',
      existingDefect,
      jiraProjectKey,
      isJiraConfigured: !!cfg && !!getJiraClient(),
    });
  });

  app.post('/api/api-defects/file', requireEditor, async (req: Request, res: Response) => {
    const { runId, stepId, summary, descriptionADF, priority, parentStoryKey } = req.body || {};
    if (!runId || !stepId || !summary || !descriptionADF || !priority || !parentStoryKey) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required field' } });
    }
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(String(parentStoryKey))) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'parentStoryKey must look like ABC-123' } });
    }

    const cfg = loadJiraConfig();
    if (!cfg) return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Configure Jira in Admin' } });
    const client = getJiraClient();
    if (!client) return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set Jira credentials in .env' } });

    const run = loadRun(runId);
    if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });

    const step = run.stepResults.find(s => s.stepId === stepId);
    if (!step) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Step not found in run' } });

    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === run.collectionId);
    if (!collection) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Collection not found' } });

    const environments = readAll<ApiEnvironment>(API_ENVS);
    const environment = environments.find(e => e.id === collection.environmentId);
    if (!environment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Environment not found' } });

    const existingLocal = findOpenApiDefect(stepId, run.collectionId);
    if (existingLocal) {
      return res.status(409).json({
        error: { code: 'ALREADY_FILED', message: 'Open defect already exists', details: { defectKey: existingLocal.defectKey, jiraUrl: existingLocal.jiraUrl } }
      });
    }

    const projects = readAll<any>('projects');
    const project = projects.find((p: any) => p.id === (collection as any).projectId);
    const jiraProjectKey = project?.jiraProjectKey;
    if (!jiraProjectKey) {
      return res.status(400).json({ error: { code: 'JIRA_PROJECT_KEY_MISSING', message: 'Jira Project Key not configured for this project' } });
    }

    let created: { key: string; id: string; self: string };
    try {
      created = await client.createIssue({
        projectKey: jiraProjectKey,
        issueType: cfg.issueType,
        summary: String(summary).slice(0, 255),
        descriptionADF,
        priority,
        parentStoryKey: String(parentStoryKey),
      });
    } catch (e: any) {
      logger.error('[api-defect.file] createIssue failed', { code: e?.code, httpStatus: e?.httpStatus });
      const httpStatus = e?.httpStatus && e.httpStatus >= 400 && e.httpStatus < 500 ? 400 : 502;
      return res.status(httpStatus).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Issue creation failed' } });
    }

    const baseUrl = (cfg as any).baseUrl || '';
    const jiraUrl = `${baseUrl.replace(/\/$/, '')}/browse/${created.key}`;
    const record: ApiDefectRecord = {
      defectKey: created.key,
      jiraId: created.id,
      stepId,
      stepName: step.stepName,
      collectionId: run.collectionId,
      collectionName: collection.name,
      runId,
      environmentId: collection.environmentId,
      environmentName: environment.name,
      projectId: (collection as any).projectId,
      status: 'open',
      createdAt: new Date().toISOString(),
      createdBy: (req.session as any)?.username || 'unknown',
      jiraUrl,
    };
    appendApiDefectRecord(record);

    logAudit({
      userId: req.session.userId!,
      username: req.session.username!,
      action: 'API_DEFECT_FILED',
      resourceType: 'api-defect',
      resourceId: created.key,
      details: `${step.stepName} (${runId})`,
      ip: req.ip ?? null,
    });

    return res.json({ defectKey: created.key, jiraUrl });
  });

  app.get('/api/api-defects/by-step/:stepId', requireAuth, (req: Request, res: Response) => {
    const reg = loadApiDefectsRegistry();
    return res.json({ defects: reg.defects.filter(d => d.stepId === req.params.stepId) });
  });
}
