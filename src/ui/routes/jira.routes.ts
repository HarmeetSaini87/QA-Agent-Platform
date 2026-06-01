import express, { Request, Response } from 'express';
import * as path from 'path';
import { config } from '../../framework/config';
import { requireAuth, requireAdmin, requireEditor } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { logger } from '../../utils/logger';
import { jiraEncryptToken, getJiraClient, readArtifactBuffer, firstNLines } from '../helpers/jira-helpers';
import { loadJiraConfig, saveJiraConfig, loadDefectsRegistry, saveDefectsRegistry, findOpenDefect, appendDismissEntry } from '../../utils/defectsStore';
import { buildDefectDescription, buildFailureCommentADF } from '../../utils/adfBuilder';
import { runs, getRun } from '../helpers/state';
import { sanitizeInput } from '../../auth/middleware';
import { readAll, findById, SCRIPTS } from '../../data/store';
import type { TestScript, Project } from '../../data/types';

function resolveProjectKey(projectId: string, globalCfg: any): string | null {
  const project = findById<Project>('projects', projectId);
  return (project?.jiraProjectKey) || null;
}

export function registerJiraRoutes(app: express.Application): void {
  app.get('/api/jira/config', requireAuth, (_req: Request, res: Response) => {
    const cfg = loadJiraConfig();
    if (!cfg) { res.json(null); return; }
    const { apiTokenEnc, ...rest } = cfg as any;
    res.json({ ...rest, hasTokenSet: !!apiTokenEnc });
  });

  app.put('/api/jira/config', requireAdmin, (req: Request, res: Response) => {
    const b = req.body || {};
    // OLD: const required = ['projectKey', 'issueType', 'defaultPriority', 'closeTransitionName'];
    // projectKey moved to per-project field — no longer required in global config
    const required = ['issueType', 'defaultPriority', 'closeTransitionName'];
    for (const k of required) {
      if (!b[k] || typeof b[k] !== 'string') {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Missing field: ${k}` } });
        return;
      }
    }
    const existing = loadJiraConfig();
    const cfg: any = {
      // OLD: projectKey: String(b.projectKey),  — moved to per-project jiraProjectKey field
      issueType: String(b.issueType),
      defaultPriority: String(b.defaultPriority),
      parentLinkFieldId: String(b.parentLinkFieldId || ''),
      referSSFieldId: String(b.referSSFieldId || ''),
      closeTransitionName: String(b.closeTransitionName),
      maxAttachmentMB: Number.isFinite(b.maxAttachmentMB) ? Number(b.maxAttachmentMB) : 50,
      baseUrl: b.baseUrl ? String(b.baseUrl).trim().replace(/\/$/, '') : (existing?.baseUrl || ''),
      email: b.email ? String(b.email).trim() : (existing?.email || ''),
      updatedAt: new Date().toISOString(),
      updatedBy: req.session.username || 'unknown',
    };
    if (b.apiToken && typeof b.apiToken === 'string' && b.apiToken.trim()) {
      cfg.apiTokenEnc = jiraEncryptToken(b.apiToken.trim());
    } else if (existing?.apiTokenEnc) {
      cfg.apiTokenEnc = existing.apiTokenEnc;
    }
    saveJiraConfig(cfg);
    logAudit({
      userId: req.session.userId!, username: req.session.username!,
      action: 'JIRA_CONFIG_SAVE', resourceType: 'jira-config', resourceId: 'global',
      details: cfg.projectKey, ip: req.ip ?? null
    });
    res.json({ ok: true });
  });

  app.post('/api/jira/test', requireAdmin, async (_req: Request, res: Response) => {
    const client = getJiraClient();
    if (!client) {
      res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env' } });
      return;
    }
    const result = await client.testConnection();
    res.json(result);
  });

  app.get('/api/jira/fields', requireAdmin, async (_req: Request, res: Response) => {
    const client = getJiraClient();
    if (!client) {
      res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env' } });
      return;
    }
    try {
      const fields = await client.discoverFields();
      res.json({ fields });
    } catch (e: any) {
      res.status(502).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Field discovery failed' } });
    }
  });

  app.post('/api/defects/draft', requireEditor, async (req: Request, res: Response) => {
    const { runId, testId } = req.body || {};
    if (!runId || !testId) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'runId and testId required' } });
      return;
    }
    const run = getRun(runId);
    if (!run) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }); return; }
    const t = run.tests.find(x => x.testId === testId);
    if (!t) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Test not found in run' } }); return; }

    const cfg = loadJiraConfig();
    const existing = findOpenDefect(testId, run.suiteId || '');

    // Load keyword steps from the script definition (Test Script Builder steps),
    // not from t.steps which are Playwright runtime steps {name, status, durationMs}
    const allScripts = readAll<TestScript>(SCRIPTS);
    const browser = t.browser || (run.browsers?.[0] || 'chromium');
    const matchedScript = allScripts.find(s => {
      const generatedName = (s.tcId ? `[${s.tcId}] ` : '') + s.title;
      return generatedName === t.name || s.title === t.name;
    });
    const scriptSteps = matchedScript
      ? matchedScript.steps
          .slice().sort((a, b) => a.order - b.order)
          .map(s => `${s.keyword}${s.locator ? ' ' + s.locator : ''}${s.value ? ' → ' + s.value : ''}${s.description ? ' (' + s.description + ')' : ''}`.trim())
          .filter(Boolean)
      // OLD: (t.steps || []).map((s: any) => `${s.keyword || ''} ${s.locator || s.value || ''}`.trim()).filter(Boolean)
      // — t.steps are Playwright internal steps {name,status,durationMs}, not keyword steps
      : [];

    const descriptionADF = buildDefectDescription({
      testName: t.name,
      testId,
      suiteName: run.suiteName || '',
      projectName: run.projectName || '',
      runTimestamp: run.startedAt,
      runId,
      envName: run.environmentName || '',
      envUrl: '',
      browser,
      os: process.platform,
      steps: scriptSteps,
      errorMessage: t.errorMessage || '',
      errorDetailFirst5: firstNLines(t.errorDetail || '', 5),
    });

    // OLD: const summary = `${t.name} failed in ${run.suiteName}`.slice(0, 255);
    const envPart = run.environmentName ? `[${run.environmentName}] ` : '';
    const browserPart = ` (${browser})`;
    const summary = `${envPart}${t.name} failed in ${run.suiteName}${browserPart}`.slice(0, 255);
    const attachments: Array<{ kind: 'screenshot' | 'video' | 'trace'; path: string; sizeBytes: number; name: string; tooLarge: boolean }> = [];
    const max = (cfg?.maxAttachmentMB ?? 50) * 1024 * 1024;
    for (const [kind, p] of [['screenshot', t.screenshotPath], ['video', t.videoPath], ['trace', t.tracePath]] as const) {
      if (!p) continue;
      const head = readArtifactBuffer(p, max);
      if (!head) continue;
      attachments.push({
        kind, path: p, sizeBytes: head.size,
        name: path.basename(p),
        tooLarge: head.tooLarge,
      });
    }

    const jiraProjectKey = resolveProjectKey(run.projectId || '', cfg);
    res.json({
      summary,
      descriptionADF,
      suggestedPriority: cfg?.defaultPriority || 'Medium',
      attachments,
      existingDefect: existing,
      config: cfg,
      jiraProjectKey,  // project-scoped key for display + filing
    });
  });

  app.post('/api/defects/file', requireEditor, async (req: Request, res: Response) => {
    const { runId, testId, summary, descriptionADF, priority, parentStoryKey, attachKinds } = req.body || {};
    if (!runId || !testId || !summary || !descriptionADF || !priority || !parentStoryKey) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required field' } }); return;
    }
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(String(parentStoryKey))) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'parentStoryKey must look like ABC-123' } }); return;
    }
    const cfg = loadJiraConfig();
    if (!cfg) { res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Configure Jira mapping in Admin' } }); return; }
    const client = getJiraClient();
    if (!client) { res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set Jira credentials in .env' } }); return; }

    const run = getRun(runId);
    if (!run) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }); return; }
    const t = run.tests.find(x => x.testId === testId);
    if (!t) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Test not found in run' } }); return; }

    // Resolve Jira project key from project record (per-project hybrid model)
    const jiraProjectKey = resolveProjectKey(run.projectId || '', cfg);
    if (!jiraProjectKey) {
      res.status(400).json({ error: { code: 'JIRA_PROJECT_KEY_MISSING', message: 'Jira Project Key is not configured for this project. Set it in Admin → Project Management.' } });
      return;
    }

    try {
      // OLD: cfg.projectKey — now per-project
      const existingKey = await client.searchOpenDefectByTestId(testId, run.suiteId || '', jiraProjectKey);
      if (existingKey) {
        res.status(409).json({
          error: { code: 'ALREADY_FILED', message: 'Open defect already exists', details: { defectKey: existingKey, jiraUrl: `${config.jira.baseUrl}/browse/${existingKey}` } },
        });
        return;
      }
    } catch (e: any) {
      res.status(502).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Dedup check failed' } });
      return;
    }

    let created: { key: string; id: string; self: string };
    try {
      created = await client.createIssue({
        // OLD: projectKey: cfg.projectKey — now per-project
        projectKey: jiraProjectKey,
        issueType: cfg.issueType,
        summary: String(summary).slice(0, 255),
        descriptionADF,
        priority,
        parentStoryKey: String(parentStoryKey),
      });
    } catch (e: any) {
      logger.error('[defect.file] createIssue failed', { code: e?.code, httpStatus: e?.httpStatus, details: e?.details });
      const status = e?.httpStatus && e.httpStatus >= 400 && e.httpStatus < 500 ? 400 : 502;
      res.status(status).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Issue creation failed', details: e?.details } });
      return;
    }

    const attachStatus: { screenshot?: 'ok' | 'failed' | 'skipped'; video?: 'ok' | 'failed' | 'skipped'; trace?: 'ok' | 'failed' | 'skipped' } = {};
    const attachMax = cfg.maxAttachmentMB * 1024 * 1024;
    const kinds: Array<'screenshot' | 'video' | 'trace'> = Array.isArray(attachKinds) ? attachKinds : [];
    const mimeFor = (k: string) => k === 'screenshot' ? 'image/png' : k === 'video' ? 'video/webm' : 'application/zip';
    for (const k of kinds) {
      const relPath = k === 'screenshot' ? t.screenshotPath : k === 'video' ? t.videoPath : t.tracePath;
      if (!relPath) { attachStatus[k] = 'skipped'; continue; }
      const data = readArtifactBuffer(relPath, attachMax);
      if (!data || data.tooLarge) { attachStatus[k] = 'skipped'; continue; }
      try {
        await client.addAttachment(created.key, { name: path.basename(relPath), buffer: data.buffer, mime: mimeFor(k) });
        attachStatus[k] = 'ok';
      } catch (e: any) {
        logger.warn(`[defect.file] attachment failed`, { key: created.key, kind: k, err: e?.message });
        attachStatus[k] = 'failed';
      }
    }

    const reg = loadDefectsRegistry();
    const jiraUrl = `${config.jira.baseUrl.replace(/\/$/, '')}/browse/${created.key}`;
    const record = {
      defectKey: created.key, jiraId: created.id, testId, testName: t.name,
      suiteId: run.suiteId || '', suiteName: run.suiteName || '',
      environmentId: run.environmentId || '', environmentName: run.environmentName || '',
      projectId: run.projectId || '',
      parentStoryKey: String(parentStoryKey),
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      createdBy: req.session.username || 'unknown',
      filedFromRunId: runId, jiraUrl,
      attachments: attachStatus,
      comments: [],
    };
    reg.defects.push(record);
    saveDefectsRegistry(reg);

    t.defectKey = created.key;
    t.defectStatus = 'open';

    logAudit({
      userId: req.session.userId!, username: req.session.username!,
      action: 'DEFECT_FILED', resourceType: 'defect', resourceId: created.key,
      details: `${t.name} (${runId})`, ip: req.ip ?? null
    });

    res.json({ defectKey: created.key, jiraUrl, attachments: attachStatus });
  });

  app.post('/api/defects/comment', requireEditor, async (req: Request, res: Response) => {
    const { defectKey, runId, testId, attachKinds } = req.body || {};
    if (!defectKey || !runId || !testId) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'defectKey, runId, testId required' } }); return;
    }
    const cfg = loadJiraConfig();
    const client = getJiraClient();
    if (!cfg || !client) { res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Jira not configured' } }); return; }

    const run = getRun(runId);
    const t = run?.tests.find(x => x.testId === testId);
    if (!run || !t) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run/test not found' } }); return; }

    const body = buildFailureCommentADF({
      runId,
      timestamp: run.startedAt,
      errorMessage: t.errorMessage || '',
      errorDetailFirst5: firstNLines(t.errorDetail || '', 5),
    });
    try {
      const out = await client.addComment(defectKey, body);
      const max = cfg.maxAttachmentMB * 1024 * 1024;
      const kinds: Array<'screenshot' | 'video' | 'trace'> = Array.isArray(attachKinds) ? attachKinds : [];
      const mimeFor = (k: string) => k === 'screenshot' ? 'image/png' : k === 'video' ? 'video/webm' : 'application/zip';
      for (const k of kinds) {
        const relPath = k === 'screenshot' ? t.screenshotPath : k === 'video' ? t.videoPath : t.tracePath;
        if (!relPath) continue;
        const data = readArtifactBuffer(relPath, max);
        if (!data || data.tooLarge) continue;
        try { await client.addAttachment(defectKey, { name: path.basename(relPath), buffer: data.buffer, mime: mimeFor(k) }); }
        catch (e: any) { logger.warn('[defect.comment] attachment failed', { defectKey, kind: k, err: e?.message }); }
      }
      const reg = loadDefectsRegistry();
      const d = reg.defects.find(x => x.defectKey === defectKey);
      if (d) {
        d.comments.push({ runId, addedAt: new Date().toISOString(), addedBy: req.session.username || 'unknown' });
        saveDefectsRegistry(reg);
      }
      logAudit({
        userId: req.session.userId!, username: req.session.username!,
        action: 'DEFECT_COMMENT', resourceType: 'defect', resourceId: defectKey, details: runId, ip: req.ip ?? null
      });
      res.json({ commentId: out.id });
    } catch (e: any) {
      res.status(502).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Comment failed' } });
    }
  });

  app.post('/api/defects/dismiss', requireEditor, (req: Request, res: Response) => {
    const { runId, testId, category } = req.body || {};
    const validCategories = ['script-issue', 'locator-issue', 'flaky', 'data-issue', 'env-issue'];
    if (!runId || !testId || !validCategories.includes(category)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } }); return;
    }
    const run = getRun(runId);
    const t = run?.tests.find(x => x.testId === testId);
    if (!run || !t) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run/test not found' } }); return; }

    appendDismissEntry({
      timestamp: new Date().toISOString(),
      runId, testId, testName: t.name, suiteId: run.suiteId || '',
      category,
      dismissedBy: req.session.username || 'unknown',
      errorMessage: t.errorMessage || '',
    });
    logAudit({
      userId: req.session.userId!, username: req.session.username!,
      action: 'DEFECT_DISMISSED', resourceType: 'test', resourceId: testId, details: category, ip: req.ip ?? null
    });
    res.json({ ok: true });
  });

  app.get('/api/defects/by-test/:testId', requireAuth, (req: Request, res: Response) => {
    const reg = loadDefectsRegistry();
    res.json({ defects: reg.defects.filter(d => d.testId === req.params.testId) });
  });

  app.get('/api/defects/open/:defectKey', requireAuth, (req: Request, res: Response) => {
    const reg = loadDefectsRegistry();
    const d = reg.defects.find(x => x.defectKey === req.params.defectKey);
    if (!d) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Defect not found' } }); return; }
    res.redirect(d.jiraUrl);
  });
}