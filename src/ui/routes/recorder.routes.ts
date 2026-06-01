import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../framework/config';
import { logger } from '../../utils/logger';
import { requireAuth } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { readAll, upsert, findById, LOCATORS, SCRIPTS, FUNCTIONS } from '../../data/store';
import type { Locator, CommonFunction } from '../../data/types';
import { parseRecorderEvent, normalizeRecordedSteps, detectBoilerplate } from '../../utils/recorderParser';
import { requireFeature } from '../helpers/middleware';
import { recorderSessions, recorderSsePush } from '../helpers/sse';
import { upsertPageModel } from '../../utils/pageModelManager';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PORT = config.ui.port;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export function registerRecorderRoutes(app: express.Application): void {
  app.post('/api/recorder/start', requireAuth, requireFeature('recorder'), (req: Request, res: Response) => {
    const { projectId, autUrl } = req.body as { projectId?: string; autUrl?: string };
    if (!projectId) { res.status(400).json({ error: 'projectId is required' }); return; }
    if (!autUrl) { res.status(400).json({ error: 'autUrl is required' }); return; }
    for (const [, s] of recorderSessions) {
      if (s.projectId === projectId && s.active) {
        const sinceMin = Math.floor((Date.now() - s.createdAt) / 60000);
        res.status(409).json({ error: 'Already recording', recordedBy: s.createdBy, since: new Date(s.createdAt).toISOString(), sinceMin, message: `${s.createdBy} started a recording ${sinceMin}m ago. Stop that session first.` });
        return;
      }
    }
    const token: string = uuidv4();
    const session = { token, projectId, createdBy: req.session.username!, active: true, steps: [], stepCount: 0, lastActivity: Date.now(), createdAt: Date.now(), sseClients: new Set() as any };
    recorderSessions.set(token, session);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_STARTED', resourceType: 'recorder', resourceId: token.slice(0, 8), details: `project=${projectId} url=${autUrl}`, ip: req.ip ?? null });
    const separator = autUrl.includes('?') ? '&' : '?';
    const recorderUrl = `${autUrl}${separator}__qa_recorder=${token}`;
    logger.info(`[recorder] Session started: ${token.slice(0, 8)} project=${projectId} by=${req.session.username}`);
    res.json({ token, recorderUrl });
  });

  app.get('/api/recorder/stream/:token', requireAuth, (req: Request, res: Response) => {
    const { token } = req.params as { token: string };
    const session = recorderSessions.get(token);
    if (!session) { res.status(404).json({ error: 'session not found' }); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: recorder:connected\ndata: ${JSON.stringify({ token: token.slice(0, 8), stepCount: session.stepCount })}\n\n`);
    session.sseClients.add(res);
    logger.info(`[recorder] SSE client connected (token ${token.slice(0, 8)}) — ${session.sseClients.size} client(s)`);
    req.on('close', () => { session.sseClients.delete(res); logger.info(`[recorder] SSE client disconnected (token ${token.slice(0, 8)}) — ${session.sseClients.size} client(s)`); });
  });

  app.get('/api/recorder/active', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
    for (const [token, session] of recorderSessions) {
      if (session.projectId === projectId && session.active) { res.json({ token, stepCount: session.stepCount }); return; }
    }
    res.status(404).json({ error: 'no active session' });
  });

  app.get('/api/recorder/status/:token', requireAuth, (req: Request, res: Response) => {
    const { token } = req.params as { token: string };
    const session = recorderSessions.get(token);
    if (!session) { res.status(404).json({ error: 'session not found' }); return; }
    res.json({ active: session.active, stepCount: session.stepCount });
  });

  app.post('/api/recorder/stop', requireAuth, (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (!token) { res.status(400).json({ error: 'token is required' }); return; }
    const session = recorderSessions.get(token);
    if (!session) { res.status(404).json({ error: 'session not found' }); return; }
    session.active = false;
    recorderSsePush(token, 'recorder:stopped', { stepCount: session.stepCount });
    session.sseClients.forEach(res => { try { res.end(); } catch { } });
    session.sseClients.clear();
    const durationSecs = Math.floor((Date.now() - session.createdAt) / 1000);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_STOPPED', resourceType: 'recorder', resourceId: token.slice(0, 8), details: `steps=${session.stepCount} duration=${durationSecs}s project=${session.projectId}`, ip: req.ip ?? null });
    logger.info(`[recorder] Session stopped: ${token.slice(0, 8)} — ${session.stepCount} steps captured (pre-cleanup)`);
    // Post-recording cleanup: remove noise steps before returning to UI
    const rawCount = session.steps.length;
    session.steps = normalizeRecordedSteps(session.steps);
    session.stepCount = session.steps.length;
    logger.info(`[recorder] Cleanup: ${rawCount} → ${session.stepCount} steps (removed ${rawCount - session.stepCount} noise steps)`);
    setImmediate(() => {
      const locIdsByPage = new Map<string, Set<string>>();
      for (const step of session.steps) {
        if (!step.locatorId) continue;
        const loc = readAll<Locator>(LOCATORS).find(l => l.id === step.locatorId);
        const pk = loc?.pageKey;
        if (!pk) continue;
        if (!locIdsByPage.has(pk)) locIdsByPage.set(pk, new Set());
        locIdsByPage.get(pk)!.add(step.locatorId);
      }
      for (const [pk, ids] of locIdsByPage) {
        try { upsertPageModel({ projectId: session.projectId, pageKey: pk, locatorIds: [...ids], capturedFrom: 'recorder' }); logger.info(`[recorder] PageModel upserted: project=${session.projectId} pageKey=${pk} locators=${ids.size}`); } catch (e) { logger.warn(`[recorder] PageModel upsert failed: ${e}`); }
      }
    });
    const boilerplateSuggestions = detectBoilerplate(session.steps);
    res.json({ success: true, stepCount: session.stepCount, steps: session.steps, boilerplateSuggestions });
  });

  app.post('/api/recorder/heartbeat', (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    const session = token ? recorderSessions.get(token) : undefined;
    if (!session || !session.active) { res.status(404).json({ ok: false }); return; }
    session.lastActivity = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/recorder/analyse', requireAuth, (req: Request, res: Response) => {
    const { projectId, steps } = req.body as { projectId?: string; steps?: any[] };
    if (!projectId || !Array.isArray(steps) || steps.length < 2) { res.json({ patterns: [] }); return; }
    const MIN_LEN = 2;
    const allScripts = readAll(SCRIPTS).filter((s: any) => s.projectId === projectId);
    const allFunctions = readAll<CommonFunction>(FUNCTIONS).filter((f: any) => f.projectId === projectId);
    function normalizeLocKey(step: any): string {
      const raw = (step.locatorName || step.detail || step.locator || step.selector || '').trim();
      return raw.toLowerCase().replace(/^[#.]/, '');
    }
    function stepFp(step: any): string { return `${(step.keyword ?? '').toUpperCase()}|${normalizeLocKey(step)}`; }
    const scriptFpArrays = allScripts.map((s: any) => (s.steps || []).map(stepFp));
    const recFps = steps.map(stepFp);
    const n = recFps.length;
    const patterns: Array<{ startIndex: number; endIndex: number; steps: any[]; matchCount: number; suggestedName: string; duplicateFnId?: string }> = [];
    const used = new Set<number>();
    for (let len = n; len >= MIN_LEN; len--) {
      for (let start = 0; start <= n - len; start++) {
        let overlaps = false;
        for (let i = start; i < start + len; i++) { if (used.has(i)) { overlaps = true; break; } }
        if (overlaps) continue;
        const candidateFp = recFps.slice(start, start + len).join('::');
        let matchCount = 0;
        for (const fpArr of scriptFpArrays) { for (let si = 0; si <= fpArr.length - len; si++) { if (fpArr.slice(si, si + len).join('::') === candidateFp) { matchCount++; break; } } }
        if (matchCount === 0) continue;
        for (let i = start; i < start + len; i++) used.add(i);
        const candidateSteps = steps.slice(start, start + len);
        const candidateFpArr = recFps.slice(start, start + len);
        const dupFn = allFunctions.find((f: any) => {
          const fnFpArr: string[] = (f.steps || []).map((s: any) => stepFp(s));
          const fnFp = fnFpArr.join('::');
          if (fnFp === candidateFp) return true;
          if (fnFpArr.length >= len) { for (let fi = 0; fi <= fnFpArr.length - len; fi++) { if (fnFpArr.slice(fi, fi + len).join('::') === candidateFp) return true; } }
          const fLen = fnFpArr.length;
          if (fLen >= MIN_LEN && fLen <= len) { for (let ci = 0; ci <= len - fLen; ci++) { if (candidateFpArr.slice(ci, ci + fLen).join('::') === fnFp) return true; } } // fnFp already defined above
          return false;
        });
        const firstStep = candidateSteps[0]; const lastStep = candidateSteps[candidateSteps.length - 1];
        const firstName = firstStep.locatorName || firstStep.keyword || ''; const lastName = lastStep.locatorName || lastStep.keyword || '';
        const autoName = firstName === lastName ? firstName : `${firstName} to ${lastName}`;
        const suggestedName = dupFn ? (dupFn as any).name : autoName.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        patterns.push({ startIndex: start, endIndex: start + len - 1, steps: candidateSteps, matchCount, suggestedName, duplicateFnId: (dupFn as any)?.id });
      }
    }
    res.json({ patterns });
  });

  app.get('/recorder-loader', requireAuth, (req: Request, res: Response) => {
    const { token, url: autUrl } = req.query as { token?: string; url?: string };
    if (!token || !autUrl) { res.status(400).send('Missing token or url'); return; }
    const session = recorderSessions.get(token);
    if (!session || !session.active) { res.status(404).send('Recording session not found'); return; }
    const origin = `${req.protocol}://${req.get('host')}`;
    const bookmarkletHref = `javascript:(function(){window.__qa_recorder_origin=${JSON.stringify(origin)};window.__qa_recorder=${JSON.stringify(token)};var s=document.createElement('script');s.src=${JSON.stringify(origin + '/recorder.js?' + Date.now())};document.head.appendChild(s);})();`;
    const consoleLine = `window.__qa_recorder_origin=${JSON.stringify(origin)};window.__qa_recorder=${JSON.stringify(token)};var s=document.createElement('script');s.src='${origin}/recorder.js?t=${Date.now()}';document.head.appendChild(s);`;
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QA Recorder — Ready</title><style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:32px;display:flex;align-items:flex-start;justify-content:center}.card{background:#1e293b;border-radius:16px;padding:36px;max-width:640px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.4)}h2{margin:0 0 4px;font-size:20px;color:#a78bfa}.subtitle{color:#64748b;font-size:12px;margin-bottom:28px}.method{background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}.method-title{font-weight:700;font-size:14px;margin-bottom:4px;display:flex;align-items:center;gap:8px}.badge{background:#7c3aed;color:#fff;font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700}.method-desc{color:#94a3b8;font-size:13px;margin-bottom:14px;line-height:1.6}.bm-link{display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700;font-size:14px;cursor:grab;border:2px dashed #a78bfa;margin-bottom:8px}.drag-hint{color:#64748b;font-size:11px;margin-top:4px}.console-box{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 12px;font-family:monospace;font-size:11px;color:#7dd3fc;word-break:break-all;position:relative;margin-bottom:8px}.copy-btn{position:absolute;top:8px;right:8px;background:#0369a1;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer}.copy-btn:hover{background:#0284c7}.steps-bar{background:#0f172a;border:1px solid #22c55e33;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:10px;margin-top:20px;font-size:13px}.dot{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 1.5s infinite;flex-shrink:0}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}.steps-count{margin-left:auto;color:#22c55e;font-weight:700}ol{margin:10px 0 0 0;padding-left:18px;color:#94a3b8;font-size:13px;line-height:1.8}ol li strong{color:#e2e8f0}</style></head><body><div class="card"><h2>&#9679; QA Recorder — Active</h2><div class="subtitle">Token: ${escapeHtml(token.slice(0, 8))}… | App: ${escapeHtml(autUrl)}</div><div style="font-weight:600;font-size:13px;margin-bottom:10px;color:#94a3b8">STEP 1 — Open your app and log in</div><div style="margin-bottom:24px;font-size:13px;color:#94a3b8">Open <a href="${escapeHtml(autUrl)}" target="_blank" style="color:#38bdf8">${escapeHtml(autUrl)}</a> in a new tab. Log in and navigate to the starting page of your test flow.</div><div style="font-weight:600;font-size:13px;margin-bottom:10px;color:#94a3b8">STEP 2 — Activate the recorder (choose one method)</div><div class="method"><div class="method-title"><span class="badge">METHOD A</span> Drag to Bookmarks Bar <span style="font-size:11px;color:#64748b;font-weight:400">(recommended)</span></div><div class="method-desc">Drag the purple button below to your bookmarks bar. Then switch to your app tab and click the bookmark.</div><a class="bm-link" href="${escapeHtml(bookmarkletHref)}" title="Drag me to your bookmarks bar">&#9654; Activate QA Recorder</a><div class="drag-hint">&#8593; Drag this button to your bookmarks bar, then click it on your app tab</div></div><div class="method"><div class="method-title"><span class="method-title"><span style="background:#0369a1;color:#fff;font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700">METHOD B</span> Browser Console</div><div class="method-desc">Switch to your app tab. Press F12 &rarr; click Console &rarr; paste the line below and press Enter.</div><div class="console-box" id="console-code">${escapeHtml(consoleLine)}<button class="copy-btn" onclick="copyConsole()">Copy</button></div><div class="drag-hint">You will see <code style="color:#a78bfa">[QA Recorder] Listeners attached. Recording…</code> in the console when active.</div></div><div style="font-weight:600;font-size:13px;margin:20px 0 10px;color:#94a3b8">STEP 3 — Interact with your app</div><div style="font-size:13px;color:#94a3b8;margin-bottom:8px">Click, fill fields, select dropdowns — every action streams live into the Test Script editor.</div><div style="font-weight:600;font-size:13px;margin:20px 0 6px;color:#94a3b8">STEP 4 — Stop recording</div><div style="font-size:13px;color:#94a3b8">Click <strong style="color:#e2e8f0">&#9646;&#9646; Stop Recording</strong> in the Test Script editor when done.</div><div class="steps-bar"><div class="dot"></div><span style="color:#94a3b8">Recording active</span><span class="steps-count" id="step-count">0 steps captured</span></div></div><script>function copyConsole(){var t=${JSON.stringify(consoleLine)};navigator.clipboard.writeText(t).catch(function(){var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)}).then(function(){var b=document.querySelector('.copy-btn');if(b){b.textContent='Copied!';setTimeout(function(){b.textContent='Copy'},2000)}})}var lastCount=0;setInterval(function(){fetch('/api/recorder/status/${encodeURIComponent(token)}',{credentials:'include'}).then(function(r){if(!r.ok)return r.json()}).then(function(d){if(!d)return;if(d.stepCount!==lastCount){lastCount=d.stepCount;var el=document.getElementById('step-count');if(el)el.textContent=d.stepCount+' step'+(d.stepCount===1?'':'s')+' captured'}if(!d.active){var dot=document.querySelector('.dot');if(dot){dot.style.background='#ef4444';dot.style.animation='none'}}}).catch(function(){})},1500);<\/script></body></html>`);
  });
}