/**
 * server.ts
 * Express + WebSocket UI server — localhost:3000
 *
 * Route handlers have been extracted to src/ui/routes/*.routes.ts
 * Each module exports a `registerXxxRoutes(app)` function.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import session from 'express-session';
import SQLiteStore from 'connect-sqlite3';
import dotenv from 'dotenv';

import { config } from '../framework/config';
import { logger } from '../utils/logger';
import { seedDefaults } from '../data/seed';
import { readAll, writeAll, findById, upsert, USERS, SETTINGS, LOCATORS } from '../data/store';
import type { User, AppSettings, BrowserName, ScheduledRun, TestScript, Locator } from '../data/types';
import { inferNameSource } from '../utils/locatorIdentity';
import type { RunRecord, DebugSession } from './helpers/types';
import { requireAuth, requireAdmin, requireEditor, requireAuthOrApiKey, sanitizeInput } from '../auth/middleware';
import { validateLicenseKey, validateLicFile, storeLicense, loadStoredLicense, getLicensePayload, refreshLicenseCache, clearLicenseCache, isAutoTrial, trialDaysRemaining, AUTO_TRIAL_DAYS, isFeatureEnabled, checkMachineBinding, checkExpiryTick, getMachineId, getSeatsUsed, getSeatUsageRatio, recordLogin, recordLogout, isSeatAvailable, transferLicense, activateAutoTrial, checkStoredLicFile } from '../utils/licenseManager';
import { broadcast, subscribe, unsubscribe } from './helpers/ws-broadcast';

// Shared mutable state
import { runs, debugSessions, debugPollers, cronJobs } from './helpers/state';
import { loginRateLimiter, requireFeature } from './helpers/middleware';

// Route registrars
import { registerAuthRoutes } from './routes/auth.routes';
import { registerRunsRoutes } from './routes/runs.routes';
import { registerNlRoutes } from './routes/nl.routes';
import { registerAnalyticsRoutes } from './routes/analytics.routes';
import { registerVisualRoutes } from './routes/visual.routes';
import { registerHealingRoutes } from './routes/healing.routes';
import { registerFilesRoutes } from './routes/files.routes';
import { registerTraceRoutes } from './routes/trace.routes';
import { registerTcRoutes } from './routes/tc.routes';
import { registerAdminRoutes } from './routes/admin.routes';
import { registerJiraRoutes } from './routes/jira.routes';
import { registerProjectsRoutes } from './routes/projects.routes';
import { registerRecorderRoutes } from './routes/recorder.routes';
import { registerFunctionsRoutes } from './routes/functions.routes';
import { registerCommonDataRoutes } from './routes/common-data.routes';
import { registerScriptsRoutes } from './routes/scripts.routes';
import { registerSuitesRoutes } from './routes/suites.routes';
import { registerDebuggerRoutes } from './routes/debugger.routes';
import { registerFlakyRoutes } from './routes/flaky.routes';
import { registerSchedulesRoutes } from './routes/schedules.routes';
import { registerLicenseRoutes } from './routes/license.routes';
import { registerApiTestingRoutes } from './routes/api-testing.routes';
import { registerWorkflowGraphRoutes } from '../workflow-graph/routes/workflow-graph.routes';
import { registerFlakinessRoutes } from '../api-flakiness/routes/api-flakiness.routes';
import { registerApiDefectsRoutes } from '../api-defects/routes/api-defects.routes';
import { registerApiSuiteRoutes } from '../api-suite/routes/api-suites.routes';
import { registerObservabilityRoutes } from '../api-observability/routes/observability.routes';
import { registerWorkerHealthRoutes } from '../api-runtime/worker-health/routes/worker-health.routes';
import governanceRouter from '../api-governance/routes/governance.routes';
import { registerAiIntelligenceRoutes } from '../api-intelligence/routes/ai-intelligence.routes';
import { registerRemediationRoutes } from '../api-remediation/routes/remediation.routes';

dotenv.config();

// ── Constants ─────────────────────────────────────────────────────────────────
const PORT = config.ui.port;
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const TRACE_VIEWER_DIR = path.join(PUBLIC_DIR, 'trace-viewer');
const UPLOAD_DIR = path.resolve(config.paths.requirements, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const TEST_FILES_DIR = path.resolve('test-files');
if (!fs.existsSync(TEST_FILES_DIR)) fs.mkdirSync(TEST_FILES_DIR, { recursive: true });

// ── Multer setups ──────────────────────────────────────────────────────────────
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.match(/\.(xlsx|xls|csv|pdf|docx|doc|png|jpg|jpeg|gif|webp)$/i);
    cb(null, !!ok);
  },
});

const testFileStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const projectId = (req.query.projectId as string || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!projectId) { cb(new Error('projectId required'), ''); return; }
    const dir = path.join(TEST_FILES_DIR, projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => { const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'); cb(null, safe); },
});
const testFileUpload = multer({
  storage: testFileStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => { const ok = file.originalname.match(/\.(xlsx|xls|csv|pdf|docx|doc|txt|json|xml|zip)$/i); cb(null, !!ok); },
});

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// ── Trust proxy (IIS ARR reverse proxy) ──────────────────────────────────────
// The platform is accessed via IIS ARR (http://qa-launchpad.test → localhost:PORT).
// Without this, req.ip always resolves to 127.0.0.1 (IIS loopback) instead of
// the real remote client IP carried in the X-Forwarded-For header.
//
// `1`  = trust exactly ONE proxy hop (IIS on the same machine).
//        This is the safest setting: rejects spoofed X-Forwarded-For headers
//        sent directly by end-users bypassing IIS.
//
// Enterprise note: if the stack grows (e.g. load-balancer → IIS → Node),
// increment this count or set it to the specific upstream IP(s).
app.set('trust proxy', 1);

app.use(express.json());

// ── Session middleware ─────────────────────────────────────────────────────────
function getSessionTimeoutMs(): number {
  try {
    const s = readAll<AppSettings & { id: string }>(SETTINGS)[0];
    const mins = s?.sessionTimeoutMinutes ?? 60;
    return Math.max(5, mins) * 60 * 1000;
  } catch { return 60 * 60 * 1000; }
}

const SqliteSessionStore = SQLiteStore(session);
const SESSION_SECRET = process.env.SESSION_SECRET || 'qa-agent-platform-secret-key-2026';
const sessionStore = new SqliteSessionStore({ db: 'sessions.sqlite', dir: path.resolve('data'), table: 'sessions' }) as any;

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { httpOnly: true, secure: false, maxAge: getSessionTimeoutMs(), sameSite: 'lax' },
  name: config.ui.cookieName,
}));

// ── Inactivity timeout enforcement ────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId) { next(); return; }
  const now = Date.now();
  const last = (req.session as any).lastActivity as number | undefined;
  const timeout = getSessionTimeoutMs();
  if (last && now - last > timeout) {
    req.session.destroy(() => {});
    if (req.originalUrl.startsWith('/api/')) { res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' }); }
    else { res.redirect('/login?reason=expired'); }
    return;
  }
  (req.session as any).lastActivity = now;
  if (req.session.cookie) req.session.cookie.maxAge = timeout;
  next();
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ── Login page (no auth required) ────────────────────────────────────────────
app.get('/login', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/login.css', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.css')));
app.get('/login.js', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.js')));

// ── recorder.js — MUST be before express.static so origin injection fires ────
app.get('/recorder.js', (req: Request, res: Response) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  const scriptPath = path.join(PUBLIC_DIR, 'recorder.js');
  if (!fs.existsSync(scriptPath)) { res.status(404).send('// recorder.js not found'); return; }
  const src = fs.readFileSync(scriptPath, 'utf-8');
  const injected = `window.__qa_recorder_origin = ${JSON.stringify(origin)};\n${src}`;
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(injected);
});

// ── Main UI entry points (protected) ────────────────────────────────────────
app.get(['/', '/index.html'], requireAuth, (_req, res) => { res.sendFile(path.join(PUBLIC_DIR, 'index.html')); });
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/requirements', express.static(path.resolve('requirements')));

// ── Auth API routes (no session required) & CORS & recorder step ─────────────
registerAuthRoutes(app);

// ── Public API routes (no auth required) ──────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', appBaseURL: config.app.baseURL, port: config.ui.port });
});
app.get('/api/env', (_req: Request, res: Response) => {
  res.json({ label: config.ui.envLabel, port: config.ui.port });
});
registerTraceRoutes(app);

// ── All routes below require authentication ──────────────────────────────────
app.use('/api', (_req: Request, res: Response, next: NextFunction) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// OLD: app.use('/api', requireAuth) — blanket auth on all /api routes
// /api/heal exempted: Playwright spec process has no session cookie; T3/T4 would always 401
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/heal' && req.method === 'POST') { next(); return; }
  requireAuth(req, res, next);
});

// ── Register all route groups ────────────────────────────────────────────────
registerRunsRoutes(app);
registerNlRoutes(app);
registerAnalyticsRoutes(app);
registerVisualRoutes(app);
registerHealingRoutes(app);
registerFilesRoutes(app, testFileUpload);
registerTcRoutes(app);
registerAdminRoutes(app);
registerJiraRoutes(app);
registerProjectsRoutes(app);
registerRecorderRoutes(app);
registerFunctionsRoutes(app);
registerCommonDataRoutes(app);
registerScriptsRoutes(app);
registerSuitesRoutes(app);
registerDebuggerRoutes(app);
registerFlakyRoutes(app);
registerSchedulesRoutes(app);
registerLicenseRoutes(app, sessionStore);
registerApiTestingRoutes(app);
registerWorkflowGraphRoutes(app);
registerFlakinessRoutes(app);
registerApiDefectsRoutes(app);
registerApiSuiteRoutes(app);
registerObservabilityRoutes(app);
registerWorkerHealthRoutes(app);
app.use('/api/governance', governanceRouter);
registerAiIntelligenceRoutes(app);
registerRemediationRoutes(app);

// ── SPA fallback (requires auth) — MUST be after all API routes ──────────────
app.get('*', requireAuth, (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const subscribed = new Set<string>();
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; runId?: string };
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (msg.type === 'subscribe' && msg.runId) {
        subscribe(msg.runId, ws);
        subscribed.add(msg.runId);
        const dbgSession = debugSessions.get(msg.runId);
        if (dbgSession?.pendingStep) {
          const { stepIdx, keyword, locator, value, screenshotPath } = dbgSession.pendingStep;
          ws.send(JSON.stringify({ type: 'debug:step', sessionId: msg.runId, stepIdx, keyword, locator, value, screenshotPath }));
        } else if (dbgSession?.status === 'done' || dbgSession?.status === 'stopped' || dbgSession?.status === 'error') {
          ws.send(JSON.stringify({ type: 'debug:done', sessionId: msg.runId, status: dbgSession.status }));
        }
        const record = runs.get(msg.runId);
        if (record) {
          for (const line of record.output.slice(-50)) { ws.send(JSON.stringify({ type: 'run:output', runId: msg.runId, line, level: 'info' as const })); }
          ws.send(JSON.stringify({ type: 'run:stats', runId: msg.runId, passed: record.passed, failed: record.failed, total: record.total, completed: record.tests.length }));
          if (record.status !== 'running') { ws.send(JSON.stringify({ type: 'run:done', runId: msg.runId, passed: record.passed, failed: record.failed, total: record.total, exitCode: record.exitCode })); }
        }
        return;
      }
      if (msg.type === 'unsubscribe' && msg.runId) { unsubscribe(msg.runId, ws); subscribed.delete(msg.runId); }
    } catch { /* ignore malformed messages */ }
  });
  ws.on('close', () => { for (const runId of subscribed) unsubscribe(runId, ws); });
});

// ── One-time migration: infer nameSource for existing locators ────────────────
// Runs once at startup. Idempotent — skips locators that already have nameSource set.
// Conservative default: anything NOT matching recorder auto-pattern → 'user'
// This protects legacy manually-renamed business names in existing repositories.
function migrateNameSources(): void {
  const locs = readAll<Locator>(LOCATORS);
  const toMigrate = locs.filter(l => !l.nameSource);
  if (!toMigrate.length) return;
  const updated = locs.map(l => l.nameSource ? l : { ...l, nameSource: inferNameSource(l.name) });
  writeAll(LOCATORS, updated);
  const autoCount = toMigrate.filter(l => inferNameSource(l.name) === 'auto').length;
  const userCount = toMigrate.length - autoCount;
  logger.info(`[locatorIdentity] Migration: ${toMigrate.length} locators updated — ${userCount} marked 'user', ${autoCount} marked 'auto'`);
}

// ── Server startup ────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async () => {
  migrateNameSources();
  // License checks
  const licFileCheck = checkStoredLicFile();
  if (!licFileCheck.ok) {
    logger.error('══════════════════════════════════════════════════════');
    if (licFileCheck.reason === 'lic_file_missing') {
      logger.error('LICENSE ERROR: .lic file not found at expected path.');
      logger.error(`  Expected: ${licFileCheck.path}`);
      logger.error('Re-upload your .lic file via Admin → License or contact your vendor.');
    } else {
      logger.error('LICENSE ERROR: .lic file failed RSA verification.');
      logger.error(`  File: ${licFileCheck.path}`);
      logger.error('The .lic file may have been tampered with or belongs to a different machine.');
      logger.error('Contact your vendor for a replacement .lic file.');
    }
    logger.error('══════════════════════════════════════════════════════');
    process.exit(1);
  }

  const machineCheck = checkMachineBinding();
  if (!machineCheck.ok && machineCheck.reason === 'mismatch') {
    logger.error('═══════════════════════════════════════════════════════');
    logger.error('LICENSE ERROR: Machine fingerprint mismatch detected.');
    logger.error(`  Bound machine:   ${machineCheck.storedId}`);
    logger.error(`  Current machine: ${machineCheck.currentId}`);
    logger.error('This license is registered to a different machine.');
    logger.error('Options:');
    logger.error('  1. Use Admin → License → Transfer License to re-bind.');
    logger.error('  2. Set QA_SKIP_MACHINE_CHECK=1 for Docker/CI environments.');
    logger.error('═══════════════════════════════════════════════════════');
    process.exit(1);
  }

  if (process.env.QA_SKIP_MACHINE_CHECK === '1') {
    logger.warn('[license] Machine check bypassed (QA_SKIP_MACHINE_CHECK=1) — CI/Docker mode');
  }

  await seedDefaults();

  // Auto-Trial
  if (!getLicensePayload()) {
    const trial = activateAutoTrial();
    const days = AUTO_TRIAL_DAYS;
    logger.info('═══════════════════════════════════════════════════════');
    logger.info(`[license] No license found — auto-trial activated (${days} days).`);
    logger.info(`[license] Trial expires: ${trial.expiresAt.slice(0, 10)}`);
    logger.info('[license] Features: recorder, debugger, scheduler, apiAccess (3 seats, 3 projects)');
    logger.info('[license] Go to Admin → License to activate your license key.');
    logger.info('═══════════════════════════════════════════════════════');
  } else if (isAutoTrial()) {
    const days = trialDaysRemaining();
    logger.warn(`[license] Trial license active — ${days} day(s) remaining. Activate a license key via Admin → License.`);
  }

  // Rehydrate seat map from persisted sessions
  (sessionStore as any).all!((err: any, sessions: any) => {
    if (err || !sessions) return;
    const activeUserIds = Object.values(sessions).map((s: any) => s.userId as string | undefined).filter((uid): uid is string => !!uid);
    syncSeatsFromSessions(activeUserIds);
    if (activeUserIds.length > 0) { logger.info(`[license] Rehydrated ${new Set(activeUserIds).size} seat(s) from ${activeUserIds.length} persisted session(s)`); }
  });

  logger.info(`QA Agent Platform UI  →  http://localhost:${PORT}`);
  logger.info(`WebSocket             →  ws://localhost:${PORT}/ws`);
  logger.info(`Jira configured       :  ${config.jira.isConfigured}`);
  logger.info(`Login                 →  http://localhost:${PORT}/login`);
});

import { syncSeatsFromSessions } from '../utils/licenseManager';
import { generateCodegenSpec } from '../utils/codegenGenerator';
import { generateDebugSpec } from '../utils/codegenGenerator';
import { enqueueRun } from './helpers/run-queue';
import { spawnRunWithSpec } from './helpers/run-spawner';
import { sseSessionPush } from './helpers/sse';

export default app;
export { app, server, runs, debugSessions, debugPollers, cronJobs };