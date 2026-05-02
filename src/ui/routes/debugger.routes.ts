import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { readAll, findById, upsert, SCRIPTS, FUNCTIONS, PROJECTS, LOCATORS } from '../../data/store';
import type { TestScript, CommonFunction, Locator, Project } from '../../data/types';
import type { DebugSession } from '../helpers/types';
import { requireAuth } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { logger } from '../../utils/logger';
import { generateDebugSpec } from '../../utils/codegenGenerator';
import { config } from '../../framework/config';
import { runs, debugSessions, debugPollers } from '../helpers/state';
import { sseSessionPush, debugSseClients } from '../helpers/sse';
import { broadcast } from '../helpers/ws-broadcast';

export function registerDebuggerRoutes(app: express.Application): void {
  app.get('/api/debug/stream/:sessionId', requireAuth, (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    if (!debugSseClients.has(sessionId)) debugSseClients.set(sessionId, new Set());
    debugSseClients.get(sessionId)!.add(res);
    logger.info(`[sse] client connected session=${sessionId.slice(0, 8)} total=${debugSseClients.get(sessionId)!.size}`);

    const existing = debugSessions.get(sessionId);
    if (existing?.pendingStep) {
      const d = existing.pendingStep;
      let screenshotBase64: string | null = null;
      try {
        const ssAbs = path.resolve(d.screenshotPath);
        if (fs.existsSync(ssAbs)) screenshotBase64 = fs.readFileSync(ssAbs).toString('base64');
      } catch { /* skip */ }
      sseSessionPush(sessionId, 'debug:step', { ...d, screenshotBase64 });
    }

    req.on('close', () => {
      debugSseClients.get(sessionId)?.delete(res);
      if (debugSseClients.get(sessionId)?.size === 0) debugSseClients.delete(sessionId);
      logger.info(`[sse] client disconnected session=${sessionId.slice(0, 8)}`);
    });
  });

  app.post('/api/debug/start', requireAuth, (req: Request, res: Response) => {
    const { scriptId, environmentId } = req.body as { scriptId: string; environmentId?: string };
    if (!scriptId) { res.status(400).json({ error: 'scriptId required' }); return; }

    const script = findById<TestScript>(SCRIPTS, scriptId);
    if (!script) { res.status(404).json({ error: 'Script not found' }); return; }

    const project = findById<Project>(PROJECTS, script.projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const activeForScript = [...debugSessions.values()].filter(
      s => s.scriptId === scriptId &&
        !['done', 'stopped', 'error'].includes(s.status)
    );

    const ownDuplicate = activeForScript.find(s => s.userId === req.session.userId);
    if (ownDuplicate) {
      res.status(409).json({
        error: 'You already have an active debug session for this script',
        code: 'DUPLICATE_OWN_SESSION',
        sessionId: ownDuplicate.sessionId,
        since: ownDuplicate.startedAt,
      });
      return;
    }

    const otherDebuggers = activeForScript
      .filter(s => s.userId !== req.session.userId)
      .map(s => ({ username: s.username, since: s.startedAt, sessionId: s.sessionId }));

    const allFunctions = readAll<CommonFunction>(FUNCTIONS).filter(f => f.projectId === project.id);

    const envId = environmentId || '';
    const environment = envId
      ? (project.environments || []).find(e => e.id === envId) ?? null
      : (project.environments || [])[0] ?? null;

    const sessionId = uuidv4();

    let specPath: string;
    try {
      specPath = generateDebugSpec({ sessionId, script, project, environment: environment ?? null, allFunctions, port: config.ui.port });
    } catch (err: any) {
      logger.error(`[debug] spec generation failed: ${err.message}`);
      res.status(500).json({ error: 'Spec generation failed', detail: err.message });
      return;
    }

    const session: DebugSession = {
      sessionId,
      scriptId: script.id,
      scriptTitle: script.title,
      projectId: project.id,
      userId: req.session.userId!,
      username: req.session.username!,
      environmentId: environment?.id ?? null,
      environmentName: environment?.name ?? null,
      status: 'starting',
      currentStep: 0,
      totalSteps: script.steps.length,
      specPath,
      startedAt: new Date().toISOString(),
      lastHeartbeat: Date.now(),
    };
    debugSessions.set(sessionId, session);

    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DEBUG', resourceType: 'script', resourceId: script.id, details: `${script.title} env=${environment?.name ?? 'default'}`, ip: req.ip ?? null });

    res.json({
      sessionId,
      scriptTitle: script.title,
      totalSteps: session.totalSteps,
      otherDebuggers,
    });

    const relSpec = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
    const ssDir = path.resolve('debug-runs', sessionId);
    const pendingFile = path.join(ssDir, 'pending.json');
    const gateFile = path.join(ssDir, 'gate.json');
    const errorFile = path.join(ssDir, 'error.json');

    const proc = cp.spawn('npx', ['playwright', 'test', '--headed', '--reporter=list', '--project=chromium', relSpec], {
      cwd: path.resolve('.'),
      env: { ...process.env },
      shell: true,
    });

    session.proc = proc;
    session.status = 'starting';

    proc.stdout?.on('data', (c: Buffer) => { const l = c.toString().trim(); if (l) logger.info(`[dbg:${sessionId.slice(0, 8)}] ${l}`); });
    proc.stderr?.on('data', (c: Buffer) => { const l = c.toString().trim(); if (l) logger.info(`[dbg:${sessionId.slice(0, 8)}] ${l}`); });

    let _lastStepIdx = -1;
    const poller = setInterval(() => {
      try {
        if (fs.existsSync(errorFile)) {
          try {
            const errData = JSON.parse(fs.readFileSync(errorFile, 'utf-8'));
            fs.unlinkSync(errorFile);
            logger.info(`[dbg:poller] Step error detected for step ${errData.stepIdx} — pushing debug:error to UI`);
            sseSessionPush(sessionId, 'debug:error', errData);
            broadcast(sessionId, { type: 'debug:error', sessionId, ...errData });
          } catch { /* file mid-write — skip this tick */ }
        }
        if (!fs.existsSync(pendingFile)) return;
        const data = JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
        if (data.stepIdx === _lastStepIdx) return;
        _lastStepIdx = data.stepIdx;
        session.currentStep = data.stepIdx;
        session.status = 'paused';
        session.pendingStep = data;
        let screenshotBase64: string | null = null;
        try {
          const ssAbs = path.resolve(data.screenshotPath);
          if (fs.existsSync(ssAbs)) screenshotBase64 = fs.readFileSync(ssAbs).toString('base64');
        } catch { /* skip */ }
        logger.info(`[dbg:poller] Step ${data.stepIdx} detected → pushing to UI (${sessionId.slice(0, 8)}) base64=${screenshotBase64 ? Math.round(screenshotBase64.length / 1024) + 'KB' : 'null'}`);
        sseSessionPush(sessionId, 'debug:step', { ...data, screenshotBase64 });
        broadcast(sessionId, { type: 'debug:step', sessionId, ...data, screenshotBase64 });
      } catch (e) {
        if (_lastStepIdx >= 0) logger.debug(`[dbg:poller] Poll tick skipped for ${sessionId.slice(0, 8)}: ${e}`);
      }
    }, 100);
    debugPollers.set(sessionId, poller);

    proc.on('close', (code) => {
      clearInterval(poller);
      debugPollers.delete(sessionId);
      try { fs.unlinkSync(pendingFile); } catch { /* ignore */ }
      try { fs.unlinkSync(gateFile); } catch { /* ignore */ }
      try { fs.unlinkSync(errorFile); } catch { /* ignore */ }

      const s = debugSessions.get(sessionId);
      if (s) {
        s.status = s.status === 'stopped' ? 'stopped' : (code === 0 ? 'done' : 'error');
        s.finishedAt = new Date().toISOString();
        s.pendingStep = undefined;
      }
      sseSessionPush(sessionId, 'debug:done', { sessionId, status: s?.status || 'done' });
      broadcast(sessionId, { type: 'debug:done', sessionId, status: s?.status as any || 'done' });
      logger.info(`[debug] session ${sessionId} closed — exit ${code}`);
      if (fs.existsSync(specPath)) { try { fs.unlinkSync(specPath); } catch { /* ignore */ } }
    });
  });

  app.post('/api/debug/continue', requireAuth, (req: Request, res: Response) => {
    const { sessionId, action, locator, locatorType, value } = req.body as {
      sessionId: string;
      action: 'continue' | 'skip' | 'stop' | 'retry';
      locator?: string;
      locatorType?: string;
      value?: string;
    };
    const session = debugSessions.get(sessionId);

    if (session) {
      session.pendingStep = undefined;
      session.lastHeartbeat = Date.now();
      if (action === 'stop') {
        session.status = 'stopped';
        if (session.proc && session.proc.pid) {
          try {
            if (process.platform === 'win32') {
              require('child_process').execSync(`taskkill /F /T /PID ${session.proc.pid}`, { stdio: 'pipe' });
              logger.info(`[debug:stop] Killed process tree for session ${sessionId.slice(0, 8)} (PID: ${session.proc.pid})`);
            } else {
              process.kill(-session.proc.pid, 'SIGTERM');
              logger.info(`[debug:stop] Killed process group for session ${sessionId.slice(0, 8)} (PID: ${session.proc.pid})`);
            }
          } catch (e) {
            logger.error(`[debug:stop] FAILED to kill process for ${sessionId.slice(0, 8)}: ${e}`);
          }
        } else {
          logger.warn(`[debug:stop] No process to kill for session ${sessionId.slice(0, 8)} (already dead?)`);
        }
        clearInterval(debugPollers.get(sessionId)!);
        debugPollers.delete(sessionId);
        logger.info(`[debug:stop] Stopped session ${sessionId.slice(0, 8)}`);
      } else {
        session.status = 'running';
      }
    }

    const gateFile = path.resolve('debug-runs', sessionId, 'gate.json');
    try {
      const gatePayload: Record<string, unknown> = { action };
      if (action === 'retry') {
        if (locator !== undefined) gatePayload.locator = locator;
        if (locatorType !== undefined) gatePayload.locatorType = locatorType;
        if (value !== undefined) gatePayload.value = value;
      }
      fs.writeFileSync(gateFile, JSON.stringify(gatePayload));
      logger.info(`[debug:continue] Wrote gate.json for ${sessionId} with action '${action}' → ${gateFile}`);
    } catch (err) {
      logger.error(`[debug:continue] FAILED to write gate.json for ${sessionId}: ${err}`);
    }

    res.json({ ok: true });
  });

  app.post('/api/debug/patch-step', requireAuth, (req: Request, res: Response) => {
    const { sessionId, stepOrder, locator, locatorType, value } = req.body as {
      sessionId: string;
      stepOrder: number;
      locator?: string;
      locatorType?: string;
      value?: string;
    };

    const session = debugSessions.get(sessionId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const script = findById<TestScript>(SCRIPTS, session.scriptId);
    if (!script) { res.status(404).json({ error: 'Script not found' }); return; }

    const step = script.steps.find(s => s.order === stepOrder);
    if (!step) { res.status(404).json({ error: 'Step not found' }); return; }

    let locatorRepoUpdated = false;

    if (locator !== undefined && step.locatorId) {
      const repoEntry = findById<Locator>(LOCATORS, step.locatorId);
      if (repoEntry) {
        repoEntry.selector = locator;
        if (locatorType) repoEntry.selectorType = locatorType as Locator['selectorType'];
        upsert(LOCATORS, repoEntry);
        locatorRepoUpdated = true;
        logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'LOCATOR_UPDATED', resourceType: 'locator', resourceId: repoEntry.id, details: `debugger patch: ${repoEntry.name}`, ip: req.ip ?? null });
      }
    }

    if (locator !== undefined) step.locator = locator;
    if (locatorType !== undefined) step.locatorType = locatorType;
    if (value !== undefined) step.value = value;
    script.modifiedBy = req.session.username!;
    script.modifiedAt = new Date().toISOString();
    upsert(SCRIPTS, script);

    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_UPDATED', resourceType: 'script', resourceId: script.id, details: `debugger patch step ${stepOrder}: ${script.title}`, ip: req.ip ?? null });

    logger.info(`[debug:patch] Patched step ${stepOrder} of script ${script.id} (session ${sessionId.slice(0, 8)}) locatorRepoUpdated=${locatorRepoUpdated}`);
    res.json({ ok: true, locatorRepoUpdated });
  });

  app.get('/api/debug/session/:id', requireAuth, (req: Request, res: Response) => {
    const session = debugSessions.get(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.status !== 'done' && session.status !== 'stopped' && session.status !== 'error') {
      session.lastHeartbeat = Date.now();
    }
    const { proc: _proc, ...safe } = session;
    res.json(safe);
  });

  app.post('/api/debug/heartbeat/:id', requireAuth, (req: Request, res: Response) => {
    const session = debugSessions.get(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    session.lastHeartbeat = Date.now();
    res.json({ ok: true });
  });

  app.get('/api/debug/sessions', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    const active = [...debugSessions.values()]
      .filter(s =>
        !['done', 'stopped', 'error'].includes(s.status) &&
        (!projectId || s.projectId === projectId)
      )
      .map(({ proc: _proc, specPath: _spec, pendingStep: _ps, ...safe }) => safe);
    res.json(active);
  });
}