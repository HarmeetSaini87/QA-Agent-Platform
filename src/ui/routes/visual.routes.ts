import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../framework/config';
import { logger } from '../../utils/logger';
import { readAll, upsert, findById, LOCATORS } from '../../data/store';
import type { Locator, HealingProposal } from '../../data/types';
import { scoreCandidates, T3_AUTO_THRESHOLD } from '../../utils/healingEngine';
import type { DomCandidate } from '../../utils/healingEngine';
import { upsertPageModel, listPageModels } from '../../utils/pageModelManager';
import { getAllBaselines, getBaseline, approveBaseline, deleteBaseline, compareScreenshot, baselineImagePath } from '../../utils/visualRegression';
import { logAudit } from '../../auth/audit';
import { requireAuth, requireEditor, requireAuthOrApiKey } from '../../auth/middleware';
import { backfillScriptsAndFunctions } from '../helpers/run-spawner';

export function registerVisualRoutes(app: express.Application): void {
  // Visual baselines
  app.get('/api/visual-baselines', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    res.json(getAllBaselines(projectId));
  });

  app.get('/api/visual-baselines/:id/image', requireAuth, (req: Request, res: Response) => {
    const entry = getBaseline(req.params.id);
    if (!entry) { res.status(404).json({ error: 'Baseline not found' }); return; }
    const type = (req.query.type as 'baseline' | 'actual' | 'diff') || 'baseline';
    const imgPath = baselineImagePath(entry.projectId, entry.id, type);
    if (!fs.existsSync(imgPath)) { res.status(404).json({ error: 'Image not found' }); return; }
    res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(imgPath).pipe(res);
  });

  app.post('/api/visual-baselines/:id/approve', requireAuth, requireEditor, (req: Request, res: Response) => {
    const ok = approveBaseline(req.params.id, req.session.username ?? 'unknown');
    if (!ok) { res.status(404).json({ error: 'Baseline not found or no actual image' }); return; }
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'VISUAL_BASELINE_APPROVED', resourceType: 'visual-baseline', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.delete('/api/visual-baselines/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    const ok = deleteBaseline(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Baseline not found' }); return; }
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'VISUAL_BASELINE_DELETED', resourceType: 'visual-baseline', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.post('/api/visual-baselines/compare', requireAuthOrApiKey, (req: Request, res: Response) => {
    const { projectId, testName, locatorName, imageBase64, threshold } = req.body as { projectId: string; testName: string; locatorName: string; imageBase64: string; threshold?: number };
    if (!projectId || !testName || !locatorName || !imageBase64) { res.status(400).json({ error: 'projectId, testName, locatorName and imageBase64 required' }); return; }
    try { const buffer = Buffer.from(imageBase64, 'base64'); const result = compareScreenshot(projectId, testName, locatorName, buffer, threshold ?? 0.1); res.json(result); } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  // Heal log
  app.get('/api/heal-log', requireAuth, (req: Request, res: Response) => {
    const { projectId, limit: limitStr } = req.query as { projectId?: string; limit?: string };
    const limitN = Math.min(parseInt(limitStr || '200', 10), 500);
    const logFile = path.resolve('data', 'healing-log.ndjson');
    if (!fs.existsSync(logFile)) { res.json([]); return; }
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
    let events: any[] = [];
    for (const line of lines) { try { events.push(JSON.parse(line)); } catch { /* skip */ } }
    if (projectId) events = events.filter(e => e.projectId === projectId);
    events.reverse(); res.json(events.slice(0, limitN));
  });

  // Locator health
  app.get('/api/locator-health', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
    const locators = readAll<Locator>(LOCATORS).filter(l => l.projectId === projectId);
    const logFile = path.resolve('data', 'healing-log.ndjson');
    const events: any[] = [];
    if (fs.existsSync(logFile)) { const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean); for (const line of lines) { try { const e = JSON.parse(line); if (e.projectId === projectId) events.push(e); } catch { /* skip */ } } }
    const eventsByLocator: Record<string, any[]> = {};
    for (const e of events) { if (!e.locatorId) continue; (eventsByLocator[e.locatorId] = eventsByLocator[e.locatorId] || []).push(e); }
    const report = locators.filter(l => (l.healingStats?.healCount ?? 0) > 0 || eventsByLocator[l.id]).map(l => {
      const stats = l.healingStats; const locEvents = (eventsByLocator[l.id] || []).sort((a: any, b: any) => new Date(b.healedAt || b.timestamp || 0).getTime() - new Date(a.healedAt || a.timestamp || 0).getTime());
      const latestEvent = locEvents[0];
      return { id: l.id, name: l.name, selector: l.selector, healCount: stats?.healCount ?? locEvents.length, lastHealedAt: stats?.lastHealedAt ?? latestEvent?.healedAt ?? latestEvent?.timestamp ?? null, lastHealedFrom: stats?.lastHealedFrom ?? latestEvent?.oldSelector ?? null, lastHealedBy: stats?.lastHealedBy ?? latestEvent?.method ?? null, avgConfidence: locEvents.length ? Math.round(locEvents.reduce((s: number, e: any) => s + (e.confidence ?? e.score ?? 0), 0) / locEvents.length) : null, recentEvents: locEvents.slice(0, 5).map((e: any) => ({ healedAt: e.healedAt ?? e.timestamp, oldSelector: e.oldSelector ?? e.originalSel, newSelector: e.newSelector ?? e.healedSel, confidence: e.confidence ?? e.score, method: e.method ?? (e.auto ? 'auto' : 'approved') })) };
    }).sort((a, b) => b.healCount - a.healCount);
    res.json(report);
  });

  // Pre-scan endpoints
  app.post('/api/prescan', requireAuth, (req: Request, res: Response) => {
    const { projectId, pageKey, candidates, runId } = req.body as { projectId: string; pageKey: string; candidates: DomCandidate[]; runId: string };
    if (!projectId || !pageKey || !runId) { res.status(400).json({ error: 'projectId, pageKey, and runId are required' }); return; }
    const locators = readAll<Locator>(LOCATORS).filter(l => l.projectId === projectId && l.pageKey === pageKey && l.healingProfile != null);
    const results = locators.map(loc => { const scored = (candidates?.length) ? scoreCandidates(loc.healingProfile!, candidates) : []; const best = scored[0]; const score = best?.score ?? 0; const status: 'healthy' | 'degraded' | 'broken' = score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'broken'; return { id: loc.id, name: loc.name, selector: loc.selector, score, status, bestCandidate: best?.bestSelector ?? null }; });
    if (locators.length) { try { upsertPageModel({ projectId, pageKey, locatorIds: locators.map(l => l.id), capturedFrom: 'prescan' }); } catch (e) { logger.warn(`[prescan] PageModel upsert failed: ${e}`); } }
    const prescanDir = path.resolve('data', 'prescan');
    try { fs.mkdirSync(prescanDir, { recursive: true }); const report = { runId, projectId, pageKey, scannedAt: new Date().toISOString(), locators: results }; fs.writeFileSync(path.join(prescanDir, `${runId}.json`), JSON.stringify(report, null, 2)); logger.info(`[prescan] runId=${runId} pageKey=${pageKey} scored=${results.length} locators`); res.json(report); } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.get('/api/prescan', requireAuth, (req: Request, res: Response) => {
    const { runId } = req.query as { runId?: string };
    if (!runId) { res.json(null); return; }
    const file = path.resolve('data', 'prescan', `${runId}.json`);
    if (!fs.existsSync(file)) { res.json(null); return; }
    try { res.json(JSON.parse(fs.readFileSync(file, 'utf-8'))); } catch { res.json(null); }
  });

  app.get('/api/page-models', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) { res.json([]); return; }
    try { res.json(listPageModels(projectId)); } catch { res.json([]); }
  });

  // Prescan trigger
  const PORT = config.ui.port;
  app.post('/api/prescan-trigger', requireAuth, (req: Request, res: Response) => {
    const { projectId, url, pageKey } = req.body as { projectId: string; url: string; pageKey?: string };
    if (!projectId || !url) { res.status(400).json({ error: 'projectId and url required' }); return; }
    const scanId = uuidv4();
    const pk = pageKey || (() => { try { const u = new URL(url); return u.pathname.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/$/, '') || '/'; } catch { return '/'; } })();
    const specDir = path.resolve('tests', 'codegen');
    const specPath = path.join(specDir, `prescan-${scanId.slice(0, 8)}.spec.ts`);
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const specContent = [`/** Auto-generated Prescan Spec — QA Agent Platform */`, `import { test } from '@playwright/test';`, ``, `function __qaDomScan() {`, `  const els = document.querySelectorAll('button,a,input,select,textarea,[role],[data-testid],[aria-label]');`, `  const out: any[] = [];`, `  els.forEach((el: any) => {`, `    const st = window.getComputedStyle(el);`, `    if (st.display === 'none' || st.visibility === 'hidden') return;`, `    out.push({`, `      tag: el.tagName.toLowerCase(),`, `      id: el.id || null,`, `      classes: Array.from(el.classList),`, `      text: (el.innerText || el.value || '').slice(0, 80).trim() || null,`, `      ariaLabel: el.getAttribute('aria-label') || null,`, `      role: el.getAttribute('role') || null,`, `      placeholder: el.getAttribute('placeholder') || null,`, `      testId: el.getAttribute('data-testid') || null,`, `      parentTag: el.parentElement?.tagName?.toLowerCase() || null,`, `      parentId: el.parentElement?.id || null,`, `      parentClass: el.parentElement?.className?.split(' ')[0] || null,`, `      domDepth: (() => { let d=0,n=el; while(n.parentElement){d++;n=n.parentElement;} return d; })(),`, `      siblingIndex: Array.from(el.parentElement?.children||[]).indexOf(el),`, `    });`, `  });`, `  return out;`, `}`, ``, `test.describe('Prescan', () => {`, `  test.beforeAll(async ({ browser }) => {`, `    const ctx  = await browser.newContext({ ignoreHTTPSErrors: true });`, `    const page = await ctx.newPage();`, `    try {`, `      await page.goto('${esc(url)}', { waitUntil: 'domcontentloaded', timeout: 20000 });`, `      await page.waitForTimeout(1500);`, `      const candidates = await page.evaluate(__qaDomScan).catch(() => []);`, `      await fetch('http://localhost:${PORT}/api/prescan', {`, `        method: 'POST',`, `        headers: { 'Content-Type': 'application/json' },`, `        body: JSON.stringify({ projectId: '${projectId}', pageKey: '${pk}', candidates, runId: '${scanId}' }),`, `      }).catch(() => {});`, `    } catch {}`, `    await ctx.close().catch(() => {});`, `  });`, `  test('prescan-noop', async () => { /* results sent in beforeAll */ });`, `});`, ``].join('\n');
    try { fs.mkdirSync(specDir, { recursive: true }); fs.writeFileSync(specPath, specContent, 'utf-8'); } catch (err) { res.status(500).json({ error: `Failed to write prescan spec: ${(err as Error).message}` }); return; }
    const cp = require('child_process');
    const relSpec = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
    cp.spawn('npx', ['playwright', 'test', relSpec, '--project=chromium', '--reporter=list'], { cwd: path.resolve('.'), shell: true, env: { ...process.env, HEADLESS: 'true', APP_BASE_URL: url }, stdio: 'ignore' });
    logger.info(`[prescan-trigger] scanId=${scanId} url=${url} pageKey=${pk}`);
    res.json({ scanId, pageKey: pk });
  });
}