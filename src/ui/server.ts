/**
 * server.ts
 * Express + WebSocket UI server — localhost:3000
 *
 * REST endpoints:
 *   POST /api/suites/:id/run
 *   GET  /api/run/:runId   (polling fallback)
 *   GET  /api/runs | /api/report/:runId | /api/health
 *
 * WebSocket  ws://localhost:3000/ws
 *   Client → Server:  { type:'subscribe'|'unsubscribe'|'ping', runId? }
 *   Server → Client:  run:start | run:output | run:test | run:stats | run:done | pong
 */

import * as http    from 'http';
import * as path    from 'path';
import * as fs      from 'fs';
import * as cp      from 'child_process';
import express, { Request, Response } from 'express';
import multer       from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv  from 'dotenv';
import session      from 'express-session';
import cron         from 'node-cron';

import { generateCodegenSpec, generateDebugSpec } from '../utils/codegenGenerator';
import { config }  from '../framework/config';
import { logger }  from '../utils/logger';

// ── Auth + Data imports ────────────────────────────────────────────────────────
import { seedDefaults }            from '../data/seed';
import { readAll, upsert, remove, findById, writeAll, USERS, PROJECTS, LOCATORS, FUNCTIONS, AUDIT, SETTINGS, SCRIPTS, SUITES, COMMON_DATA, SCHEDULES } from '../data/store';
import { User, Project, ProjectEnvironment, Locator, CommonFunction, CommonData, AuditEntry, AppSettings, DEFAULT_SETTINGS, ProjectCredential, TestScript, TestSuite, ScheduledRun } from '../data/types';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../auth/crypto';
import { requireAuth, requireAdmin, sanitizeInput }               from '../auth/middleware';
import { logAudit }                                                from '../auth/audit';

dotenv.config();

// ── Constants ─────────────────────────────────────────────────────────────────

const PORT       = config.ui.port;
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const UPLOAD_DIR = path.resolve(config.paths.requirements, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'pass' | 'fail' | 'warn';

interface RunRecord {
  runId:           string;
  planPath:        string;
  planId:          string;
  startedAt:       string;
  finishedAt?:     string;
  status:          'queued' | 'running' | 'done' | 'failed';
  exitCode:        number | null;
  output:          string[];
  tests:           TestEvent[];
  passed:          number;
  failed:          number;
  total:           number;
  specPath?:       string;   // path to generated spec file — deleted after run
  // Execution metadata
  projectId?:      string;
  projectName?:    string;
  suiteId?:        string;
  suiteName?:      string;
  environmentId?:  string;
  environmentName?: string;
  executedBy?:     string;
}

interface TestEvent {
  name:          string;
  status:        'running' | 'pass' | 'fail';
  durationMs:    number;
  errorMessage?: string;   // first error line for failed tests
  errorDetail?:  string;   // full failure block (stack + call log)
  screenshotPath?: string; // relative path to screenshot if captured (Playwright attachment)
  screenshotBefore?: string; // before-action screenshot (visual diff)
  screenshotAfter?:  string; // after-failure screenshot (visual diff)
}

// ── Debug session types ───────────────────────────────────────────────────────

interface DebugSession {
  sessionId:      string;
  scriptId:       string;
  scriptTitle:    string;
  projectId:      string;
  status:         'starting' | 'paused' | 'running' | 'done' | 'stopped' | 'error';
  currentStep:    number;   // stepOrder currently paused at
  totalSteps:     number;
  specPath:       string;
  proc?:          cp.ChildProcess;
  startedAt:      string;
  finishedAt?:    string;
  lastHeartbeat:  number;   // timestamp of last client heartbeat (ms) — used for orphan cleanup
  // Last step info — stored so late-joining WS clients can catch up
  pendingStep?: {
    stepIdx:        number;
    keyword:        string;
    locator:        string;
    value:          string;
    screenshotPath: string;
  };
}

type WsOut =
  | { type: 'run:start';  runId: string; planId: string; startedAt: string }
  | { type: 'run:output'; runId: string; line: string; level: LogLevel }
  | { type: 'run:test';   runId: string; name: string; status: 'pass'|'fail'|'running'; durationMs?: number }
  | { type: 'run:stats';  runId: string; passed: number; failed: number; total: number; completed: number }
  | { type: 'run:done';   runId: string; passed: number; failed: number; total: number; exitCode: number|null }
  | { type: 'debug:step'; sessionId: string; stepIdx: number; keyword: string; locator: string; value: string; screenshotPath: string }
  | { type: 'debug:done'; sessionId: string; status: 'done' | 'stopped' | 'error' }
  | { type: 'pong' };

// ── In-memory stores ──────────────────────────────────────────────────────────

const runs = new Map<string, RunRecord>();

// ── Debugger session state ────────────────────────────────────────────────────
// File-based IPC: spec writes pending.json, polls for gate.json.
// Server polls pending.json to update session state for UI to poll.
const debugSessions = new Map<string, DebugSession>();
const debugPollers  = new Map<string, NodeJS.Timeout>();  // sessionId → poll interval

// ── Parallel run queue ────────────────────────────────────────────────────────
// Limits concurrent Playwright processes; excess runs wait in queue.
const MAX_CONCURRENT_RUNS = 3;
let activeRunCount = 0;
const runQueue: Array<() => void> = [];

function enqueueRun(fn: () => void): void {
  if (activeRunCount < MAX_CONCURRENT_RUNS) {
    activeRunCount++;
    fn();
  } else {
    runQueue.push(fn);
  }
}

function onRunComplete(): void {
  activeRunCount--;
  if (runQueue.length > 0) {
    activeRunCount++;
    const next = runQueue.shift()!;
    next();
  }
}

// Map<runId, Set<WebSocket>>
const subscribers = new Map<string, Set<WebSocket>>();

// ── WebSocket broadcaster ─────────────────────────────────────────────────────

function broadcast(runId: string, msg: WsOut): void {
  const subs = subscribers.get(runId);
  if (!subs?.size) return;
  const json = JSON.stringify(msg);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

function subscribe(runId: string, ws: WebSocket): void {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId)!.add(ws);
}

function unsubscribe(runId: string, ws: WebSocket): void {
  subscribers.get(runId)?.delete(ws);
}

// ── Playwright output parser ──────────────────────────────────────────────────

// Playwright list reporter uses:  "  ok N [chromium] › file › Suite › Test (Xs)"
//                             or:  "  x  N [chromium] › ..."  (failed)
// Unicode symbols (✓/✗) appear in some environments; "ok"/"x" in others.
const RE_TEST_PASS  = /\bok\s+\d+\s+\[|[✓✔√]|\d+\s+passed/u;
const RE_TEST_FAIL  = /\bx\s+\d+\s+\[|[✗✘×]/u;
// Capture last › segment as test name, then duration — works for both "ok" and unicode variants
const RE_TEST_LINE  = /(?:ok|x|[✓✔✗✘×√])\s+\d+\s+\[chromium\][^(]*›\s*([^›(]+?)\s*\((\d+(?:\.\d+)?)(ms|s)\)/u;
const RE_TOTAL      = /Running (\d+) tests?/;
const RE_PASS_COUNT = /(\d+) passed/;
const RE_FAIL_COUNT = /(\d+) failed/;

function classifyLine(line: string): LogLevel {
  if (RE_TEST_PASS.test(line))                  return 'pass';
  if (RE_TEST_FAIL.test(line) || /Error/.test(line)) return 'fail';
  if (/warning|warn/i.test(line))               return 'warn';
  return 'info';
}

function parseMs(val: string, unit: string): number {
  const n = parseFloat(val);
  return unit === 's' ? Math.round(n * 1000) : Math.round(n);
}

// ── Post-run failure parser ───────────────────────────────────────────────────
// Playwright list reporter prints failure details AFTER the summary line.
// Format:  "  N) [chromium] › spec › Suite › TestName (Xs)"
//          "     ErrorType: message"  (indented block until next failure or end)
// We scan the full output buffer and attach error details to matching TestEvents.

function parseFailureDetails(record: RunRecord): void {
  const lines     = record.output;
  const failHdr   = /^\s{2,4}\d+\)\s+\[chromium\]/;
  const screenshotLine = /attachment.*screenshot.*\.png/i;
  const ANSI      = /\x1b\[[0-9;]*m/g;

  // Build map: normalized test name → TestEvent
  const nameMap = new Map<string, TestEvent>();
  for (const ev of record.tests) {
    if (ev.status === 'fail') nameMap.set(ev.name.trim().toLowerCase(), ev);
  }
  if (!nameMap.size) return;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(ANSI, '');
    if (failHdr.test(line)) {
      // Extract test name from header line — text after last "›"
      const parts = line.split('›');
      const rawName = parts[parts.length - 1].replace(/\(\d.*\)$/, '').trim();
      const key     = rawName.toLowerCase();
      const ev      = nameMap.get(key);

      // Collect the failure block
      const block: string[] = [];
      i++;
      while (i < lines.length && !failHdr.test(lines[i].replace(ANSI, ''))) {
        const clean = lines[i].replace(ANSI, '').trimEnd();
        block.push(clean);
        i++;
      }

      if (ev) {
        // First non-empty line = error message
        const firstErr = block.find(l => l.trim() && !/^\s*$/.test(l));
        if (firstErr) ev.errorMessage = firstErr.trim();
        ev.errorDetail  = block.join('\n');

        // Check for screenshot attachment
        const ssLine = block.find(l => screenshotLine.test(l));
        if (ssLine) {
          const m = ssLine.match(/test-results[^\s]+\.png/i);
          if (m) ev.screenshotPath = m[0].replace(/\\/g, '/');
        }
      }
      continue;
    }
    i++;
  }
}

// ── Visual diff attachment ────────────────────────────────────────────────────
// Scans test-results/<runId>/ for before/after screenshot pairs and attaches
// them to the matching TestEvent by testIdx position in record.tests[].

function attachVisualDiff(record: RunRecord): void {
  const ssDir = path.resolve('test-results', record.runId);
  if (!fs.existsSync(ssDir)) return;

  const files = fs.readdirSync(ssDir);
  // before files: "<testIdx>-before-<stepOrder>.png"
  const beforeRe = /^(\d+)-before-(\d+)\.png$/;
  const afterRe  = /^(\d+)-after-(\d+)\.png$/;

  // Build maps: testIdx → { stepOrder → filename }
  const beforeMap = new Map<number, Map<number, string>>();
  const afterMap  = new Map<number, Map<number, string>>();

  for (const f of files) {
    const bm = f.match(beforeRe);
    if (bm) {
      const ti = parseInt(bm[1], 10);
      const so = parseInt(bm[2], 10);
      if (!beforeMap.has(ti)) beforeMap.set(ti, new Map());
      beforeMap.get(ti)!.set(so, f);
    }
    const am = f.match(afterRe);
    if (am) {
      const ti = parseInt(am[1], 10);
      const so = parseInt(am[2], 10);
      if (!afterMap.has(ti)) afterMap.set(ti, new Map());
      afterMap.get(ti)!.set(so, f);
    }
  }

  record.tests.forEach((ev, idx) => {
    if (ev.status !== 'fail') return;

    const beforeSteps = beforeMap.get(idx);
    const afterSteps  = afterMap.get(idx);

    if (!beforeSteps && !afterSteps) return;

    // Find the last step that has an after screenshot (= the failing step)
    if (afterSteps && afterSteps.size > 0) {
      const lastFailStep = Math.max(...afterSteps.keys());
      ev.screenshotAfter  = `test-results/${record.runId}/${afterSteps.get(lastFailStep)}`;
      // Matching before screenshot for the same step
      if (beforeSteps?.has(lastFailStep)) {
        ev.screenshotBefore = `test-results/${record.runId}/${beforeSteps.get(lastFailStep)}`;
      }
    } else if (beforeSteps && beforeSteps.size > 0) {
      // No after shot captured — use last before shot as context
      const lastStep = Math.max(...beforeSteps.keys());
      ev.screenshotBefore = `test-results/${record.runId}/${beforeSteps.get(lastStep)}`;
    }
  });
}

// ── Run spawner (pre-built spec path) ────────────────────────────────────────
// Used by suite execution — spec generated by codegenGenerator.ts

function spawnRunWithSpec(record: RunRecord, specPath: string, headed?: boolean, retries = 0): void {
  const { runId } = record;

  broadcast(runId, {
    type:      'run:start',
    runId,
    planId:    record.planId,
    startedAt: record.startedAt,
  });

  const relPath   = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
  const outputDir = `test-results/${runId}`;
  // Pre-create output dir so visual diff screenshots can be written by generated spec
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  const args      = ['playwright', 'test', '--reporter=list', `--output=${outputDir}`];
  if (retries > 0) args.push(`--retries=${retries}`);
  args.push(relPath);

  const runHeadless = headed === false;
  if (!runHeadless) args.push('--headed');
  logger.info(`[spawnRunWithSpec] Browser: ${runHeadless ? 'headless' : 'headed'} — ${relPath}`);

  record.status = 'running';

  const proc = cp.spawn('npx', args, {
    cwd:   path.resolve('.'),
    env:   { ...process.env, CI: '', HEADLESS: runHeadless ? 'true' : 'false' },
    shell: true,
  });

  const ANSI_RE = /\x1b\[[0-9;]*m/g;

  const handleData = (data: Buffer): void => {
    const lines = data.toString().split('\n');
    for (const rawLine of lines) {
      const line      = rawLine.trimEnd();
      if (!line) continue;

      // Keep original (with ANSI) for display; strip ANSI for regex matching
      const plain     = line.replace(ANSI_RE, '');

      record.output.push(line);
      if (record.output.length > 500) record.output.shift();

      const level = classifyLine(plain);
      broadcast(runId, { type: 'run:output', runId, line: plain, level });

      const totalMatch = plain.match(RE_TOTAL);
      if (totalMatch) {
        record.total = parseInt(totalMatch[1]);
        broadcast(runId, { type: 'run:stats', runId, passed: record.passed, failed: record.failed, total: record.total, completed: record.passed + record.failed });
      }

      const passMatch = plain.match(RE_PASS_COUNT);
      if (passMatch) record.passed = parseInt(passMatch[1]);

      const failMatch = plain.match(RE_FAIL_COUNT);
      if (failMatch) record.failed = parseInt(failMatch[1]);

      const testMatch = plain.match(RE_TEST_LINE);
      if (testMatch) {
        const name       = testMatch[1].trim();
        const status     = RE_TEST_PASS.test(plain) ? 'pass' : 'fail';
        const durationMs = parseMs(testMatch[2], testMatch[3]);
        const ev: TestEvent = { name, status, durationMs };
        record.tests.push(ev);
        broadcast(runId, { type: 'run:test',  runId, name, status, durationMs });
        broadcast(runId, { type: 'run:stats', runId, passed: record.passed, failed: record.failed, total: record.total, completed: record.tests.length });
      }
    }
  };

  proc.stdout?.on('data', handleData);
  proc.stderr?.on('data', handleData);

  proc.on('close', (code) => {
    record.exitCode    = code;
    record.status      = code === 0 ? 'done' : 'failed';
    record.total       = record.total || record.passed + record.failed;
    record.finishedAt  = new Date().toISOString();

    // Strip ANSI from saved output before failure parsing (output was stored with ANSI)
    record.output = record.output.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));

    // Attach error messages + screenshots to failed test events
    parseFailureDetails(record);

    // Attach before/after visual diff screenshots to failed test events
    attachVisualDiff(record);

    broadcast(runId, {
      type: 'run:done',
      runId,
      passed:   record.passed,
      failed:   record.failed,
      total:    record.total,
      exitCode: code,
    });

    logger.info(`[suite run] ${runId} done — exit ${code} (${record.passed}✔ ${record.failed}✘)`);

    // Persist run record
    const runFile = path.join(config.paths.results, `run-${runId}.json`);
    fs.mkdirSync(config.paths.results, { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify(record, null, 2));


    // Clean up the temporary spec file for this run
    if (record.specPath && fs.existsSync(record.specPath)) {
      try { fs.unlinkSync(record.specPath); } catch { /* ignore */ }
    }

    // Release slot and start next queued run
    onRunComplete();
  });
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Session middleware (must be before routes) ─────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || 'qa-agent-platform-secret-key-2026';
app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   false,          // set true if serving over HTTPS
    maxAge:   60 * 60 * 1000, // 1 hour default — overridden by settings
    sameSite: 'lax',
  },
  name: 'qa.sid',
}));

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ── Login page served without auth ───────────────────────────────────────────
app.get('/login', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/login.css', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.css')));
app.get('/login.js',  (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.js')));

// Public static (CSS/JS/fonts for main app, served after auth check via SPA redirect)
app.use(express.static(PUBLIC_DIR));
app.use('/requirements', express.static(path.resolve('requirements')));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.match(/\.(xlsx|xls|csv|pdf|docx|doc|png|jpg|jpeg|gif|webp)$/i);
    cb(null, !!ok);
  },
});

// ── Auth API routes (public — no session required) ────────────────────────────

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) { res.status(400).json({ error: 'Username and password are required' }); return; }

  const users  = readAll<User>(USERS);
  const user   = users.find(u => (u.username === username.trim() || u.email === username.trim()) && u.isActive);
  if (!user) {
    logAudit({ userId: null, username: username, action: 'LOGIN_FAILED', resourceType: null, resourceId: null, details: 'Unknown user', ip: req.ip ?? null });
    res.status(401).json({ error: 'Invalid username or password' }); return;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    logAudit({ userId: user.id, username: user.username, action: 'LOGIN_FAILED', resourceType: null, resourceId: null, details: 'Wrong password', ip: req.ip ?? null });
    res.status(401).json({ error: 'Invalid username or password' }); return;
  }

  // Update last login
  user.lastLogin = new Date().toISOString();
  upsert(USERS, user);
  logAudit({ userId: user.id, username: user.username, action: 'LOGIN_SUCCESS', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null });

  if (user.forcePasswordChange) {
    res.json({ forcePasswordChange: true, userId: user.id });
    return;
  }

  req.session.userId   = user.id;
  req.session.username = user.username;
  req.session.role     = user.role;
  req.session.loginAt  = new Date().toISOString();
  res.json({ success: true, role: user.role, username: user.username });
});

app.post('/api/auth/change-password', async (req: Request, res: Response) => {
  const { userId, newPassword } = req.body as { userId?: string; newPassword?: string };
  if (!userId || !newPassword) { res.status(400).json({ error: 'userId and newPassword are required' }); return; }

  const err = validatePasswordStrength(newPassword);
  if (err) { res.status(400).json({ error: err }); return; }

  const user = findById<User>(USERS, userId);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  user.passwordHash        = await hashPassword(newPassword);
  user.forcePasswordChange = false;
  upsert(USERS, user);
  logAudit({ userId: user.id, username: user.username, action: 'PASSWORD_CHANGED', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null });

  req.session.userId   = user.id;
  req.session.username = user.username;
  req.session.role     = user.role;
  req.session.loginAt  = new Date().toISOString();
  res.json({ success: true });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  if (req.session?.userId) {
    logAudit({ userId: req.session.userId, username: req.session.username ?? null, action: 'LOGOUT', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null });
  }
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  if (!req.session?.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  res.json({ userId: req.session.userId, username: req.session.username, role: req.session.role });
});

// ── All routes below require authentication ───────────────────────────────────
app.use('/api', requireAuth);

// ── Run endpoints ─────────────────────────────────────────────────────────────

app.get('/api/run/:runId', (req: Request, res: Response) => {
  const record = runs.get(req.params.runId);
  if (!record) {
    const runFile = path.join(config.paths.results, `run-${req.params.runId}.json`);
    if (fs.existsSync(runFile)) { res.json(JSON.parse(fs.readFileSync(runFile, 'utf-8'))); return; }
    res.status(404).json({ error: 'Run not found' }); return;
  }
  res.json({ ...record, output: record.output.slice(-100) });
});

app.get('/api/runs', (req: Request, res: Response) => {
  const filterProjectId = (req.query.projectId as string) || '';
  const allRuns: RunRecord[] = [...runs.values()];
  const dir = config.paths.results;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('run-') || !f.endsWith('.json')) continue;
      const id = f.slice(4, -5);
      if (!runs.has(id)) {
        try { allRuns.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))); } catch { /* skip */ }
      }
    }
  }
  let result = allRuns;
  if (filterProjectId) result = result.filter(r => r.projectId === filterProjectId);
  result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json(result.slice(0, 100).map(r => ({
    runId:           r.runId,
    planId:          r.planId,
    startedAt:       r.startedAt,
    finishedAt:      r.finishedAt ?? null,
    status:          r.status,
    passed:          r.passed,
    failed:          r.failed,
    total:           r.total,
    projectId:       r.projectId       ?? null,
    projectName:     r.projectName     ?? null,
    suiteId:         r.suiteId         ?? null,
    suiteName:       r.suiteName       ?? null,
    environmentId:   r.environmentId   ?? null,
    environmentName: r.environmentName ?? null,
    executedBy:      r.executedBy      ?? null,
  })));
});



app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', appBaseURL: config.app.baseURL, port: PORT });
});

// ── Standalone Execution Report page ─────────────────────────────────────────
app.get('/execution-report', requireAuth, (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'execution-report.html'));
});

// ── Screenshot file serving ───────────────────────────────────────────────────
// Serves test-results/**/*.png so the report page can embed screenshots
app.get('/screenshots/*', requireAuth, (req: Request, res: Response) => {
  const rel = (req.params as any)[0] as string;
  // Restrict to test-results directory only
  const abs = path.resolve('test-results', rel);
  if (!abs.startsWith(path.resolve('test-results'))) { res.status(403).end(); return; }
  if (fs.existsSync(abs)) { res.sendFile(abs); return; }
  res.status(404).end();
});

// Serves debug-runs/**/*.png for the step-by-step debugger panel
// Path format: /debug-screenshot/<encoded-path>
// where path is the full relative path stored in screenshotPath (e.g. debug-runs/<id>/1-FILL.png)
app.get('/debug-screenshot/:path(*)', requireAuth, (req: Request, res: Response) => {
  const rel = decodeURIComponent(req.params.path as string);
  const abs = path.resolve(rel);
  // Restrict to debug-runs directory only
  if (!abs.startsWith(path.resolve('debug-runs'))) { res.status(403).end(); return; }
  if (fs.existsSync(abs)) { res.sendFile(abs); return; }
  res.status(404).end();
});

// ── TC Builder: keyword registry ──────────────────────────────────────────────

const KEYWORD_REGISTRY: Record<string, string[]> = {
  'Navigation':       ['LOGIN', 'NAVIGATE', 'OPEN FORM', 'BACK'],
  'Form Interaction': ['FILL', 'SELECT', 'CHECK', 'UNCHECK', 'CLICK RADIO', 'ADD ROW'],
  'Flow Control':     ['SAVE', 'SEARCH', 'DELETE', 'CONFIRM DELETE', 'VERIFY DELETED', 'VERIFY'],
  'Session':          ['LOGOUT', 'SCREENSHOT'],
};

const FIELDMAP_DIR = path.resolve('test-plans/fieldmaps');
if (!fs.existsSync(FIELDMAP_DIR)) fs.mkdirSync(FIELDMAP_DIR, { recursive: true });

app.get('/api/keywords', (_req: Request, res: Response) => {
  res.json(KEYWORD_REGISTRY);
});

// ── TC Builder: CRUD ──────────────────────────────────────────────────────────

app.get('/api/tc/list', (_req: Request, res: Response) => {
  const dir = config.paths.testPlans;
  if (!fs.existsSync(dir)) { res.json([]); return; }
  const list = fs.readdirSync(dir)
    .filter(f => f.endsWith('-builder-plan.json'))
    .map(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        return {
          planId:    raw.planId,
          planPath:  path.join(dir, f),
          fieldMap:  raw.fieldMap ?? [],
          testCases: (raw.testCases ?? []).map((tc: any) => ({
            id: tc.id, title: tc.title, module: tc.module, priority: tc.priority,
          })),
        };
      } catch { return null; }
    })
    .filter(Boolean);
  res.json(list);
});

app.get('/api/tc/:planId', (req: Request, res: Response) => {
  const f = path.join(config.paths.testPlans, `${req.params.planId}-builder-plan.json`);
  if (!fs.existsSync(f)) { res.status(404).json({ error: 'Not found' }); return; }
  try { res.json(JSON.parse(fs.readFileSync(f, 'utf-8'))); }
  catch { res.status(500).json({ error: 'Could not read plan' }); }
});

app.post('/api/tc/save', (req: Request, res: Response) => {
  const { tc, fieldMap } = req.body as { tc?: any; fieldMap?: any[] };
  if (!tc?.id) { res.status(400).json({ error: 'tc.id is required' }); return; }

  const crypto = require('crypto') as typeof import('crypto');
  const planId  = `plan-${crypto.createHash('md5').update(tc.id + (tc.module ?? '') + Date.now()).digest('hex').slice(0, 8)}`;

  const steps = (tc.steps as any[] ?? []).map((s: any, i: number) => {
    const kw    = (s.keyword  ?? '').trim();
    const det   = (s.detail   ?? s.label ?? '').trim();
    const mod   = (s.modifier ?? '').trim();
    const desc  = [mod, kw, det ? ': ' + det : ''].filter(Boolean).join(' ').trim();
    // Inline field data takes precedence over separate fieldMap lookup
    const inlineSelector  = (s.selector  ?? '').trim() || null;
    const inlineFieldType = (s.fieldType ?? '').trim() || null;
    const inlineLabel     = (s.label     ?? '').trim() || null;
    const fm   = inlineSelector ? null : (fieldMap ?? []).find((f: any) => f.uiLabel === det);
    return {
      stepNumber: i + 1, action: kw.toLowerCase().replace(/\s+/g, '_'),
      description: desc,
      selector:   inlineSelector  ?? fm?.selector  ?? null,
      fieldType:  inlineFieldType ?? fm?.fieldType ?? null,
      fieldLabel: inlineLabel     ?? fm?.uiLabel   ?? null,
      value: (s.value ?? '').trim() || null,
      fallbackSelectors: [],
    };
  });

  const testData: Record<string, string> = {
    Username: tc.username ?? '', Password: tc.password ?? '', 'Record Name': tc.recordName ?? '',
    ...(tc.testData ?? {}),
  };

  const plan = {
    planId, createdAt: new Date().toISOString(), source: 'builder', sourceRef: tc.id,
    appBaseURL: (tc.appURL ?? '').trim() || process.env.APP_BASE_URL || config.app.baseURL || '',
    fieldMap: fieldMap ?? [],
    testCases: [{
      id: tc.id, title: tc.title ?? '', module: tc.module ?? '',
      priority: (tc.priority ?? 'medium').toLowerCase(),
      preconditions: tc.preconditions ?? '', steps,
      expectedResult: tc.expectedResult ?? '', testData,
      tags: (tc.tags ?? '').split(',').map((t: string) => t.trim()).filter(Boolean),
    }],
  };

  const planFile = path.join(config.paths.testPlans, `${planId}-builder-plan.json`);
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));

  if ((fieldMap ?? []).length && tc.module) {
    const safe = (tc.module as string).replace(/[^a-zA-Z0-9\-]/g, '_');
    fs.writeFileSync(path.join(FIELDMAP_DIR, `${safe}.json`), JSON.stringify(fieldMap, null, 2));
  }

  logger.info(`TC Builder: saved ${tc.id} → ${planFile}`);
  res.json({ success: true, planId, planPath: planFile, testCases: [{ id: tc.id, title: tc.title, module: tc.module }] });
});

app.delete('/api/tc/:planId', (req: Request, res: Response) => {
  const f = path.join(config.paths.testPlans, `${req.params.planId}-builder-plan.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ success: true });
});

// ── TC Builder: field maps ────────────────────────────────────────────────────

app.get('/api/fieldmap/:module', (req: Request, res: Response) => {
  const safe = req.params.module.replace(/[^a-zA-Z0-9\-]/g, '_');
  const f    = path.join(FIELDMAP_DIR, `${safe}.json`);
  res.json(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : []);
});

app.post('/api/fieldmap/:module', (req: Request, res: Response) => {
  const safe = req.params.module.replace(/[^a-zA-Z0-9\-]/g, '_');
  fs.writeFileSync(path.join(FIELDMAP_DIR, `${safe}.json`), JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// ── Admin: User Management ────────────────────────────────────────────────────

app.get('/api/admin/users', requireAdmin, (_req, res) => {
  const users = readAll<User>(USERS).map(u => ({ ...u, passwordHash: undefined }));
  res.json(users);
});

app.post('/api/admin/users', requireAdmin, async (req: Request, res: Response) => {
  const { username, email, password, role } = req.body as any;
  if (!username || !password || !role) { res.status(400).json({ error: 'username, password and role are required' }); return; }
  const err = validatePasswordStrength(password);
  if (err) { res.status(400).json({ error: err }); return; }
  const existing = readAll<User>(USERS);
  if (existing.find(u => u.username === username)) { res.status(409).json({ error: 'Username already exists' }); return; }
  const user: User = {
    id: uuidv4(), username: sanitizeInput(username), email: sanitizeInput(email ?? ''),
    passwordHash: await hashPassword(password), role: role === 'admin' ? 'admin' : 'tester',
    isActive: true, forcePasswordChange: true,
    createdAt: new Date().toISOString(), createdBy: req.session.username ?? null, lastLogin: null,
  };
  upsert(USERS, user);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'USER_CREATED', resourceType: 'user', resourceId: user.id, details: user.username, ip: req.ip ?? null });
  res.json({ success: true, id: user.id });
});

app.put('/api/admin/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const user = findById<User>(USERS, req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const { email, role, isActive, forcePasswordChange, password } = req.body as any;
  if (email !== undefined)               user.email               = sanitizeInput(email);
  if (role !== undefined)                user.role                = role === 'admin' ? 'admin' : 'tester';
  if (isActive !== undefined)            user.isActive            = !!isActive;
  if (forcePasswordChange !== undefined) user.forcePasswordChange = !!forcePasswordChange;
  if (password) {
    const err = validatePasswordStrength(password);
    if (err) { res.status(400).json({ error: err }); return; }
    user.passwordHash = await hashPassword(password);
  }
  upsert(USERS, user);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'USER_UPDATED', resourceType: 'user', resourceId: user.id, details: user.username, ip: req.ip ?? null });
  res.json({ success: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req: Request, res: Response) => {
  if (req.params.id === req.session.userId) { res.status(400).json({ error: 'Cannot delete your own account' }); return; }
  const removed = remove(USERS, req.params.id);
  if (!removed) { res.status(404).json({ error: 'User not found' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'USER_DELETED', resourceType: 'user', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// ── Admin: Audit Log ──────────────────────────────────────────────────────────

app.get('/api/admin/audit', requireAdmin, (req: Request, res: Response) => {
  const all = readAll<AuditEntry>(AUDIT);
  const page = parseInt((req.query.page as string) ?? '1') || 1;
  const size = parseInt((req.query.size as string) ?? '50') || 50;
  const start = (page - 1) * size;
  res.json({ total: all.length, page, size, entries: all.slice().reverse().slice(start, start + size) });
});

// ── Admin: Settings ───────────────────────────────────────────────────────────

app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const rows = readAll<AppSettings & { id: string }>(SETTINGS);
  res.json(rows[0] ?? { id: 'global', ...DEFAULT_SETTINGS });
});

app.put('/api/admin/settings', requireAdmin, (req: Request, res: Response) => {
  const current = readAll<AppSettings & { id: string }>(SETTINGS)[0] ?? { id: 'global', ...DEFAULT_SETTINGS };
  const updated = { ...current, ...req.body, id: 'global' };
  writeAll(SETTINGS, [updated]);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SETTINGS_UPDATED', resourceType: 'settings', resourceId: 'global', details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', (req: Request, res: Response) => {
  res.json(readAll<Project>(PROJECTS).filter(p => p.isActive));
});

app.get('/api/projects/all', requireAdmin, (_req, res) => {
  res.json(readAll<Project>(PROJECTS));
});

app.post('/api/projects', requireAdmin, (req: Request, res: Response) => {
  const { name, description, tcIdPrefix, environments } = req.body as any;
  if (!name) { res.status(400).json({ error: 'Project name is required' }); return; }
  const existing = readAll<Project>(PROJECTS);
  if (existing.find(p => p.name === name.trim())) { res.status(409).json({ error: 'Project name already exists' }); return; }
  const project: Project = {
    id: uuidv4(), name: sanitizeInput(name),
    description: sanitizeInput(description ?? ''),
    tcIdPrefix:  sanitizeInput(tcIdPrefix || 'TC'),
    tcIdCounter: 1,
    environments: (environments ?? []) as ProjectEnvironment[],
    isActive: true, createdAt: new Date().toISOString(), createdBy: req.session.username!,
  };
  upsert(PROJECTS, project);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'PROJECT_CREATED', resourceType: 'project', resourceId: project.id, details: project.name, ip: req.ip ?? null });
  res.json({ success: true, id: project.id });
});

app.put('/api/projects/:id', requireAdmin, (req: Request, res: Response) => {
  const project = findById<Project>(PROJECTS, req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  const { name, description, tcIdPrefix, environments, isActive } = req.body as any;
  if (name)                      project.name         = sanitizeInput(name);
  if (description !== undefined) project.description  = sanitizeInput(description);
  if (tcIdPrefix)                project.tcIdPrefix   = sanitizeInput(tcIdPrefix);
  if (environments)              project.environments = environments;
  if (isActive !== undefined)    project.isActive     = !!isActive;
  upsert(PROJECTS, project);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'PROJECT_UPDATED', resourceType: 'project', resourceId: project.id, details: project.name, ip: req.ip ?? null });
  res.json({ success: true });
});

// Next TC ID for a project
app.post('/api/projects/:id/next-tc-id', requireAuth, (req: Request, res: Response) => {
  const project = findById<Project>(PROJECTS, req.params.id);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  if (!project.tcIdCounter) project.tcIdCounter = 1;
  const num    = String(project.tcIdCounter).padStart(2, '0');
  const nextId = `${project.tcIdPrefix || 'TC'}-${num}`;
  project.tcIdCounter += 1;
  upsert(PROJECTS, project);
  res.json({ tcId: nextId });
});

app.delete('/api/projects/:id', requireAdmin, (req: Request, res: Response) => {
  const removed = remove(PROJECTS, req.params.id);
  if (!removed) { res.status(404).json({ error: 'Not found' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'PROJECT_DELETED', resourceType: 'project', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// ── Locator Repository ────────────────────────────────────────────────────────

app.get('/api/locators', (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  const all = readAll<Locator>(LOCATORS);
  if (projectId) {
    res.json(all.filter(l => l.projectId === projectId));
  } else {
    res.json(all);
  }
});

app.post('/api/locators', (req: Request, res: Response) => {
  const { name, selector, selectorType, pageModule, projectId, description } = req.body as any;
  if (!name || !selector) { res.status(400).json({ error: 'name and selector are required' }); return; }
  const loc: Locator = {
    id: uuidv4(), name: sanitizeInput(name), selector: sanitizeInput(selector),
    selectorType: selectorType ?? 'css', pageModule: sanitizeInput(pageModule ?? ''),
    projectId: projectId ?? null, description: sanitizeInput(description ?? ''),
    createdBy: req.session.username!, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  upsert(LOCATORS, loc);
  res.json({ success: true, id: loc.id });
});

app.put('/api/locators/:id', (req: Request, res: Response) => {
  const loc = findById<Locator>(LOCATORS, req.params.id);
  if (!loc) { res.status(404).json({ error: 'Not found' }); return; }
  const { name, selector, selectorType, pageModule, projectId, description } = req.body as any;
  if (name)        loc.name        = sanitizeInput(name);
  if (selector)    loc.selector    = sanitizeInput(selector);
  if (selectorType) loc.selectorType = selectorType;
  if (pageModule !== undefined) loc.pageModule = sanitizeInput(pageModule);
  if (projectId !== undefined)  loc.projectId  = projectId;
  if (description !== undefined) loc.description = sanitizeInput(description);
  loc.updatedAt = new Date().toISOString();
  upsert(LOCATORS, loc);
  res.json({ success: true });
});

app.delete('/api/locators/:id', (req: Request, res: Response) => {
  const removed = remove(LOCATORS, req.params.id);
  if (!removed) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ success: true });
});

// ── Common Functions ──────────────────────────────────────────────────────────

app.get('/api/functions', (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  const all = readAll<CommonFunction>(FUNCTIONS);
  if (projectId) {
    res.json(all.filter(f => f.projectId === projectId));
  } else {
    res.json(all);
  }
});

app.post('/api/functions', (req: Request, res: Response) => {
  const { name, identifier, description, steps, projectId } = req.body as any;
  if (!name)       { res.status(400).json({ error: 'Function name is required' }); return; }
  if (!identifier) { res.status(400).json({ error: 'Identifier is required' }); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) { res.status(400).json({ error: 'Identifier must be alphanumeric and underscores only' }); return; }
  if (!steps?.length) { res.status(400).json({ error: 'At least one step is required' }); return; }
  const existing = readAll<CommonFunction>(FUNCTIONS);
  if (existing.find(f => f.identifier === identifier.trim() && f.projectId === (projectId ?? null))) {
    res.status(409).json({ error: `Identifier "${identifier}" already exists in this project` }); return;
  }
  const fn: CommonFunction = {
    id: uuidv4(), projectId: projectId ?? null,
    name: sanitizeInput(name), identifier: identifier.trim(),
    description: sanitizeInput(description ?? ''),
    steps, createdBy: req.session.username!,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  upsert(FUNCTIONS, fn);
  res.json({ success: true, id: fn.id });
});

app.put('/api/functions/:id', (req: Request, res: Response) => {
  const fn = findById<CommonFunction>(FUNCTIONS, req.params.id);
  if (!fn) { res.status(404).json({ error: 'Not found' }); return; }
  const { name, identifier, description, steps, projectId } = req.body as any;
  if (identifier) {
    if (!/^[a-zA-Z0-9_]+$/.test(identifier)) { res.status(400).json({ error: 'Identifier must be alphanumeric and underscores only' }); return; }
    const existing = readAll<CommonFunction>(FUNCTIONS);
    const conflict = existing.find(f => f.identifier === identifier.trim() && f.projectId === fn.projectId && f.id !== fn.id);
    if (conflict) { res.status(409).json({ error: `Identifier "${identifier}" already exists in this project` }); return; }
    fn.identifier = identifier.trim();
  }
  if (name)                    fn.name        = sanitizeInput(name);
  if (description !== undefined) fn.description = sanitizeInput(description);
  if (projectId !== undefined) fn.projectId   = projectId;
  if (steps)                   fn.steps       = steps;
  fn.updatedAt = new Date().toISOString();
  upsert(FUNCTIONS, fn);
  res.json({ success: true });
});

app.delete('/api/functions/:id', (req: Request, res: Response) => {
  const removed = remove(FUNCTIONS, req.params.id);
  if (!removed) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ success: true });
});

// ── User profile: change own password ────────────────────────────────────────

app.post('/api/user/change-password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as any;
  if (!currentPassword || !newPassword) { res.status(400).json({ error: 'Both passwords are required' }); return; }
  const user = findById<User>(USERS, req.session.userId!);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) { res.status(400).json({ error: 'Current password is incorrect' }); return; }
  const err = validatePasswordStrength(newPassword);
  if (err) { res.status(400).json({ error: err }); return; }
  user.passwordHash = await hashPassword(newPassword);
  upsert(USERS, user);
  logAudit({ userId: user.id, username: user.username, action: 'PASSWORD_CHANGED', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// ── Keyword Registry ──────────────────────────────────────────────────────────

app.get('/api/keywords/playwright', (_req, res) => {
  const f = path.resolve(__dirname, '../data/keywords.json');
  try { res.json(JSON.parse(fs.readFileSync(f, 'utf-8'))); }
  catch { res.json({ categories: [], dynamicTokens: [] }); }
});

// ── Common Data ───────────────────────────────────────────────────────────────

app.get('/api/common-data', requireAuth, (req: Request, res: Response) => {
  const { projectId, environment } = req.query as Record<string, string>;
  let all = readAll<CommonData>(COMMON_DATA);
  if (projectId)   all = all.filter(d => d.projectId   === projectId);
  if (environment) all = all.filter(d => d.environment === environment);
  res.json(all);
});

app.post('/api/common-data', requireAuth, (req: Request, res: Response) => {
  const { projectId, dataName, value, environment } = req.body as Partial<CommonData>;
  if (!projectId || !dataName || !environment) {
    res.status(400).json({ error: 'projectId, dataName and environment are required' }); return;
  }
  const existing = readAll<CommonData>(COMMON_DATA);
  if (existing.find(d => d.projectId === projectId && d.dataName === dataName && d.environment === environment)) {
    res.status(409).json({ error: `"${dataName}" already exists for ${environment}` }); return;
  }
  const now    = new Date().toISOString();
  const record: CommonData = {
    id: uuidv4(), projectId, dataName: sanitizeInput(dataName),
    value: value ?? '', environment,
    createdBy: req.session.username!, createdAt: now, updatedAt: now,
  };
  upsert(COMMON_DATA, record);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_CREATED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
  res.json({ success: true, id: record.id });
});

app.put('/api/common-data/:id', requireAuth, (req: Request, res: Response) => {
  const record = findById<CommonData>(COMMON_DATA, req.params.id);
  if (!record) { res.status(404).json({ error: 'Not found' }); return; }
  const { dataName, value, environment } = req.body as Partial<CommonData>;
  if (dataName)    record.dataName    = sanitizeInput(dataName);
  if (value !== undefined) record.value = value;
  if (environment) record.environment = environment;
  record.updatedAt = new Date().toISOString();
  upsert(COMMON_DATA, record);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_UPDATED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
  res.json({ success: true });
});

app.delete('/api/common-data/:id', requireAuth, (req: Request, res: Response) => {
  remove(COMMON_DATA, req.params.id);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_DELETED', resourceType: 'common_data', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// Resolve ${variable} tokens from Common Data for a project+environment
app.post('/api/common-data/resolve', requireAuth, (req: Request, res: Response) => {
  const { projectId, environment, text } = req.body as { projectId: string; environment: string; text: string };
  if (!projectId || !environment || !text) { res.status(400).json({ error: 'projectId, environment and text required' }); return; }
  const dataMap: Record<string, string> = {};
  readAll<CommonData>(COMMON_DATA)
    .filter(d => d.projectId === projectId && d.environment === environment)
    .forEach(d => { dataMap[d.dataName] = d.value; });
  const resolved = text.replace(/\$\{([^}]+)\}/g, (_, name) => dataMap[name] ?? `\${${name}}`);
  res.json({ resolved, dataMap });
});

// ── Test Scripts (project-scoped) ─────────────────────────────────────────────

// (TestScript, TestSuite already imported above)

function scriptsForProject(projectId: string): TestScript[] {
  return readAll<TestScript>(SCRIPTS).filter(s => s.projectId === projectId);
}

app.get('/api/scripts', (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
  res.json(scriptsForProject(projectId));
});

app.get('/api/scripts/:id', (req: Request, res: Response) => {
  const s = findById<TestScript>(SCRIPTS, req.params.id);
  if (!s) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(s);
});

app.post('/api/scripts', (req: Request, res: Response) => {
  const body = req.body as Partial<TestScript>;
  if (!body.projectId || !body.title) { res.status(400).json({ error: 'projectId and title required' }); return; }

  // Auto-generate TC ID from project prefix + counter
  const proj = findById<Project>(PROJECTS, body.projectId);
  if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!proj.tcIdCounter) proj.tcIdCounter = 1;
  const tcId = `${proj.tcIdPrefix || 'TC'}-${String(proj.tcIdCounter).padStart(2, '0')}`;
  proj.tcIdCounter += 1;
  upsert(PROJECTS, proj);

  const now = new Date().toISOString();
  const script: TestScript = {
    id: uuidv4(), projectId: body.projectId,
    tcId,
    component:   sanitizeInput(body.component ?? ''),
    title:       sanitizeInput(body.title),
    description: sanitizeInput(body.description ?? ''), tags: body.tags ?? [],
    priority: body.priority ?? 'medium', steps: body.steps ?? [],
    createdBy: req.session.username!, createdAt: now,
    modifiedBy: req.session.username!, modifiedAt: now,
  };
  upsert(SCRIPTS, script);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_CREATED', resourceType: 'script', resourceId: script.id, details: `${tcId} ${script.title}`, ip: req.ip ?? null });
  res.json({ success: true, id: script.id, tcId });
});

app.put('/api/scripts/:id', (req: Request, res: Response) => {
  const script = findById<TestScript>(SCRIPTS, req.params.id);
  if (!script) { res.status(404).json({ error: 'Not found' }); return; }
  const body = req.body as Partial<TestScript>;
  if (body.title)                      script.title       = sanitizeInput(body.title);
  if (body.description !== undefined)  script.description = sanitizeInput(body.description);
  if (body.component   !== undefined)  script.component   = sanitizeInput(body.component);
  if (body.tags)                       script.tags        = body.tags;
  if (body.priority)                   script.priority    = body.priority;
  if (body.steps)                      script.steps       = body.steps;
  script.modifiedBy = req.session.username!;
  script.modifiedAt = new Date().toISOString();
  upsert(SCRIPTS, script);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_UPDATED', resourceType: 'script', resourceId: script.id, details: script.title, ip: req.ip ?? null });
  res.json({ success: true });
});

app.delete('/api/scripts/:id', (req: Request, res: Response) => {
  remove(SCRIPTS, req.params.id);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DELETED', resourceType: 'script', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// ── Test Suites (project-scoped) ──────────────────────────────────────────────

app.get('/api/suites', (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
  res.json(readAll<TestSuite>(SUITES).filter(s => s.projectId === projectId));
});

app.get('/api/suites/:id', (req: Request, res: Response) => {
  const suite = findById<TestSuite>(SUITES, req.params.id);
  if (!suite) { res.status(404).json({ error: 'Not found' }); return; }
  // Embed full script objects
  const scripts = readAll<TestScript>(SCRIPTS);
  const enriched = { ...suite, scripts: suite.scriptIds.map(sid => scripts.find(s => s.id === sid)).filter(Boolean) };
  res.json(enriched);
});

app.post('/api/suites', (req: Request, res: Response) => {
  const body = req.body as Partial<TestSuite>;
  if (!body.projectId || !body.name) { res.status(400).json({ error: 'projectId and name required' }); return; }
  const now = new Date().toISOString();
  const suite: TestSuite = {
    id: uuidv4(), projectId: body.projectId, name: sanitizeInput(body.name),
    description: sanitizeInput(body.description ?? ''), scriptIds: body.scriptIds ?? [],
    environmentId: body.environmentId ?? null,
    retries: ([0,1,2].includes(body.retries as number) ? body.retries : 0) as 0|1|2,
    createdBy: req.session.username!, createdAt: now,
    modifiedBy: req.session.username!, modifiedAt: now,
  };
  upsert(SUITES, suite);
  res.json({ success: true, id: suite.id });
});

app.put('/api/suites/:id', (req: Request, res: Response) => {
  const suite = findById<TestSuite>(SUITES, req.params.id);
  if (!suite) { res.status(404).json({ error: 'Not found' }); return; }
  const body = req.body as Partial<TestSuite>;
  if (body.name)                    suite.name          = sanitizeInput(body.name);
  if (body.description !== undefined) suite.description = sanitizeInput(body.description);
  if (body.scriptIds)               suite.scriptIds     = body.scriptIds;
  if (body.environmentId !== undefined) suite.environmentId = body.environmentId;
  if (body.retries !== undefined) suite.retries = ([0,1,2].includes(body.retries as number) ? body.retries : 0) as 0|1|2;
  suite.modifiedBy = req.session.username!;
  suite.modifiedAt = new Date().toISOString();
  upsert(SUITES, suite);
  res.json({ success: true });
});

app.delete('/api/suites/:id', (req: Request, res: Response) => {
  remove(SUITES, req.params.id);
  res.json({ success: true });
});

// ── Test Suite Execution ──────────────────────────────────────────────────────

app.post('/api/suites/:id/run', async (req: Request, res: Response) => {
  const suite = findById<TestSuite>(SUITES, req.params.id);
  if (!suite) { res.status(404).json({ error: 'Not found' }); return; }

  const project = findById<Project>(PROJECTS, suite.projectId);
  if (!project) { res.status(400).json({ error: 'Project not found' }); return; }

  // Scripts in suite order
  const allScripts = readAll<TestScript>(SCRIPTS);
  const scripts    = suite.scriptIds
    .map(id => allScripts.find(s => s.id === id))
    .filter(Boolean) as TestScript[];
  if (!scripts.length) { res.status(400).json({ error: 'No scripts in suite' }); return; }

  // Common functions (project-scoped + global) for CALL FUNCTION inline expansion
  const allFunctions = readAll<CommonFunction>(FUNCTIONS)
    .filter(f => f.projectId === suite.projectId || f.projectId === null);

  // Resolve environment — body.environmentId overrides suite default
  const envId       = req.body.environmentId || suite.environmentId || null;
  const environment = envId
    ? (project.environments || []).find(e => e.id === envId) || null
    : (project.environments?.[0] || null);

  const runId     = uuidv4();
  const startedAt = new Date().toISOString();

  // Generate Playwright Codegen-style spec directly from steps
  let specPath: string;
  try {
    specPath = generateCodegenSpec({
      suiteName:    suite.name,
      suiteId:      suite.id,
      runId,
      scripts,
      project,
      environment,
      allFunctions,
    });
    logger.info(`[suite run] Codegen spec → ${specPath}`);
  } catch (err) {
    logger.error(`[suite run] Codegen generation failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to generate spec file' });
    return;
  }

  // Dummy plan path (spawnRun still expects one; keep plan infra for report metadata)
  const planId   = `suite-${suite.id.slice(0, 8)}`;
  const planFile = path.join(config.paths.testPlans, `${planId}-plan.json`);
  const planMeta = {
    planId, source: 'suite', sourceRef: suite.id,
    suiteName: suite.name, projectName: project.name,
    appBaseURL: project.appUrl, createdAt: new Date().toISOString(),
    testCases: scripts.map(s => ({ id: s.id, title: s.title, priority: s.priority })),
  };
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, JSON.stringify(planMeta, null, 2));

  const queuePosition = runQueue.length;
  const record: RunRecord = {
    runId, planPath: planFile, planId, startedAt, specPath,
    status:          queuePosition > 0 ? 'queued' : 'running',
    exitCode:        null, output: [], tests: [], passed: 0, failed: 0, total: 0,
    projectId:       project.id,
    projectName:     project.name,
    suiteId:         suite.id,
    suiteName:       suite.name,
    environmentId:   environment?.id   || '',
    environmentName: environment?.name || '',
    executedBy:      req.session.username ?? 'unknown',
  };
  runs.set(runId, record);

  const queuePos = activeRunCount >= MAX_CONCURRENT_RUNS ? runQueue.length + 1 : 0;

  // Enqueue — starts immediately if slot available, otherwise waits
  enqueueRun(() => spawnRunWithSpec(record, specPath, req.body.headed !== false, suite.retries ?? 0));

  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SUITE_RUN', resourceType: 'suite', resourceId: suite.id, details: suite.name, ip: req.ip ?? null });
  res.json({ runId, startedAt, queued: queuePos > 0, queuePosition: queuePos });
});

// ── Debugger API ─────────────────────────────────────────────────────────────
//
// Flow:
//   1. POST /api/debug/start   → generate spec, spawn Playwright (headed), return { sessionId }
//   2. Spec POSTs /api/debug/step for every step (long-poll — waits here until UI acts)
//   3. UI POSTs /api/debug/continue { sessionId, action: 'continue'|'skip'|'stop' }
//   4. Server resolves the long-poll → spec proceeds (or stops)
//   5. debug:step WS event keeps the UI screenshot panel in sync
//   6. On process close → debug:done WS event, session cleaned up

// POST /api/debug/start
app.post('/api/debug/start', requireAuth, (req: Request, res: Response) => {
  const { scriptId, environmentId } = req.body as { scriptId: string; environmentId?: string };
  if (!scriptId) { res.status(400).json({ error: 'scriptId required' }); return; }

  const script = findById<TestScript>(SCRIPTS, scriptId);
  if (!script) { res.status(404).json({ error: 'Script not found' }); return; }

  const project = findById<Project>(PROJECTS, script.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const allFunctions = readAll<CommonFunction>(FUNCTIONS).filter(f => f.projectId === project.id);

  // Resolve environment
  const envId = environmentId || '';
  const environment = envId
    ? (project.environments || []).find(e => e.id === envId) ?? null
    : (project.environments || [])[0] ?? null;

  const sessionId = uuidv4();

  // Generate debug spec
  let specPath: string;
  try {
    specPath = generateDebugSpec({ sessionId, script, project, environment: environment ?? null, allFunctions, port: PORT });
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
    status: 'starting',
    currentStep: 0,
    totalSteps: script.steps.length,
    specPath,
    startedAt: new Date().toISOString(),
    lastHeartbeat: Date.now(),
  };
  debugSessions.set(sessionId, session);

  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DEBUG', resourceType: 'script', resourceId: script.id, details: script.title, ip: req.ip ?? null });

  res.json({ sessionId, scriptTitle: script.title, totalSteps: session.totalSteps });

  // Spawn Playwright — spec uses file-based IPC (pending.json / gate.json)
  const relSpec   = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
  const ssDir     = path.resolve('debug-runs', sessionId);
  const pendingFile = path.join(ssDir, 'pending.json');
  const gateFile    = path.join(ssDir, 'gate.json');

  const proc = cp.spawn('npx', ['playwright', 'test', '--reporter=list', relSpec], {
    cwd:   path.resolve('.'),
    env:   { ...process.env },
    shell: true,
  });

  session.proc   = proc;
  session.status = 'starting';

  proc.stdout?.on('data', (c: Buffer) => { const l = c.toString().trim(); if (l) logger.info(`[dbg:${sessionId.slice(0,8)}] ${l}`); });
  proc.stderr?.on('data', (c: Buffer) => { const l = c.toString().trim(); if (l) logger.info(`[dbg:${sessionId.slice(0,8)}] ${l}`); });

  // Poll pending.json every 100ms — fast detection, reduces random delay from 0-400ms to 0-100ms
  let _lastStepIdx = -1;
  const poller = setInterval(() => {
    try {
      if (!fs.existsSync(pendingFile)) return;
      const data = JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
      if (data.stepIdx === _lastStepIdx) return;  // same step, already broadcast
      _lastStepIdx             = data.stepIdx;
      session.currentStep      = data.stepIdx;
      session.status           = 'paused';
      session.pendingStep      = data;
      // Inline screenshot as base64 — UI uses it directly, zero extra HTTP request
      let screenshotBase64: string | null = null;
      try {
        const ssAbs = path.resolve(data.screenshotPath);
        if (fs.existsSync(ssAbs)) screenshotBase64 = fs.readFileSync(ssAbs).toString('base64');
      } catch { /* skip — UI will fall back to HTTP fetch */ }
      logger.info(`[dbg:poller] Step ${data.stepIdx} detected → broadcasting to UI (${sessionId.slice(0,8)}) base64=${screenshotBase64 ? Math.round(screenshotBase64.length/1024)+'KB' : 'null'}`);
      broadcast(sessionId, { type: 'debug:step', sessionId, ...data, screenshotBase64 });
    } catch (e) {
      /* file may be mid-write — skip this tick */
      if (_lastStepIdx >= 0) logger.debug(`[dbg:poller] Poll tick skipped for ${sessionId.slice(0,8)}: ${e}`);
    }
  }, 100);
  debugPollers.set(sessionId, poller);

  proc.on('close', (code) => {
    clearInterval(poller);
    debugPollers.delete(sessionId);
    // Clean up any leftover IPC files
    try { fs.unlinkSync(pendingFile); } catch { /* ignore */ }
    try { fs.unlinkSync(gateFile);    } catch { /* ignore */ }

    const s = debugSessions.get(sessionId);
    if (s) {
      s.status      = s.status === 'stopped' ? 'stopped' : (code === 0 ? 'done' : 'error');
      s.finishedAt  = new Date().toISOString();
      s.pendingStep = undefined;
    }
    broadcast(sessionId, { type: 'debug:done', sessionId, status: s?.status as any || 'done' });
    logger.info(`[debug] session ${sessionId} closed — exit ${code}`);
    if (fs.existsSync(specPath)) { try { fs.unlinkSync(specPath); } catch { /* ignore */ } }
  });
});

// POST /api/debug/continue  — UI sends continue / skip / stop
// Writes gate.json which the spec is polling for
app.post('/api/debug/continue', requireAuth, (req: Request, res: Response) => {
  const { sessionId, action } = req.body as { sessionId: string; action: 'continue' | 'skip' | 'stop' };
  const session = debugSessions.get(sessionId);

  if (session) {
    session.pendingStep = undefined;
    session.lastHeartbeat = Date.now(); // Any user action resets orphan timer
    if (action === 'stop') {
      session.status = 'stopped';
      // Kill the process immediately — no need to wait for gate pick-up
      if (session.proc && session.proc.pid) {
        try {
          // Kill entire process tree (includes child browser process)
          // /T flag kills process tree, /F forces kill
          if (process.platform === 'win32') {
            require('child_process').execSync(`taskkill /F /T /PID ${session.proc.pid}`, { stdio: 'pipe' });
            logger.info(`[debug:stop] Killed process tree for session ${sessionId.slice(0,8)} (PID: ${session.proc.pid})`);
          } else {
            process.kill(-session.proc.pid, 'SIGTERM');
            logger.info(`[debug:stop] Killed process group for session ${sessionId.slice(0,8)} (PID: ${session.proc.pid})`);
          }
        } catch (e) {
          logger.error(`[debug:stop] FAILED to kill process for ${sessionId.slice(0,8)}: ${e}`);
        }
      } else {
        logger.warn(`[debug:stop] No process to kill for session ${sessionId.slice(0,8)} (already dead?)`);
      }
      clearInterval(debugPollers.get(sessionId)!);
      debugPollers.delete(sessionId);
      logger.info(`[debug:stop] Stopped session ${sessionId.slice(0,8)}`);
    } else {
      session.status = 'running';
    }
  }

  // Write gate file so the spec exits its poll loop
  const gateFile = path.resolve('debug-runs', sessionId, 'gate.json');
  try {
    fs.writeFileSync(gateFile, JSON.stringify({ action }));
    logger.info(`[debug:continue] Wrote gate.json for ${sessionId} with action '${action}' → ${gateFile}`);
  } catch (err) {
    logger.error(`[debug:continue] FAILED to write gate.json for ${sessionId}: ${err}`);
  }

  res.json({ ok: true });
});

// GET /api/debug/session/:id  — UI polls this every 800ms
// Also updates lastHeartbeat — double coverage alongside dedicated heartbeat endpoint
app.get('/api/debug/session/:id', requireAuth, (req: Request, res: Response) => {
  const session = debugSessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  // Every poll proves the client is alive — reset orphan timer
  if (session.status !== 'done' && session.status !== 'stopped' && session.status !== 'error') {
    session.lastHeartbeat = Date.now();
  }
  const { proc: _proc, ...safe } = session;
  res.json(safe);
});

// POST /api/debug/heartbeat/:id  — UI sends heartbeat every 10s to prevent orphan cleanup
// If no heartbeat for 30s, server kills the process (orphan detection)
app.post('/api/debug/heartbeat/:id', requireAuth, (req: Request, res: Response) => {
  const session = debugSessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  session.lastHeartbeat = Date.now();
  res.json({ ok: true });
});

// ── Flaky Test Detection ──────────────────────────────────────────────────────

app.get('/api/flaky', requireAuth, (req: Request, res: Response) => {
  const { projectId, suiteId } = req.query as Record<string, string>;
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

  // Load completed runs for this project
  const resultsDir = config.paths.results;
  if (!fs.existsSync(resultsDir)) { res.json({ runs: 0, tests: [] }); return; }

  const runs = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf-8')); } catch { return null; } })
    .filter((r): r is RunRecord => r && r.projectId === projectId && (r.status === 'done' || r.status === 'failed'))
    .filter(r => !suiteId || r.suiteId === suiteId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);

  // Aggregate pass/fail counts per (suiteId + testName)
  type Entry = { name: string; suiteId: string; suiteName: string; passes: number; failures: number; durations: number[]; lastSeen: string };
  const map = new Map<string, Entry>();

  for (const run of runs) {
    for (const t of (run.tests || [])) {
      const key = `${run.suiteId}::${t.name}`;
      if (!map.has(key)) map.set(key, { name: t.name, suiteId: run.suiteId || '', suiteName: run.suiteName || '', passes: 0, failures: 0, durations: [], lastSeen: run.startedAt });
      const e = map.get(key)!;
      if (t.status === 'pass') e.passes++;
      else if (t.status === 'fail') e.failures++;
      if (t.durationMs) e.durations.push(t.durationMs);
      if (run.startedAt > e.lastSeen) e.lastSeen = run.startedAt;
    }
  }

  // Only include tests that have BOTH passes and failures (genuinely flaky)
  const tests = [...map.values()]
    .filter(e => e.passes > 0 && e.failures > 0)
    .map(e => {
      const total    = e.passes + e.failures;
      const failRate = Math.round((e.failures / total) * 100);
      const risk     = failRate >= 50 ? 'high' : failRate >= 20 ? 'medium' : 'low';
      const avgMs    = e.durations.length ? Math.round(e.durations.reduce((a, b) => a + b, 0) / e.durations.length) : 0;
      return { name: e.name, suiteId: e.suiteId, suiteName: e.suiteName, passes: e.passes, failures: e.failures, total, failRate, risk, avgMs, lastSeen: e.lastSeen };
    })
    .sort((a, b) => b.failRate - a.failRate);

  res.json({ runs: runs.length, tests });
});

// ── Scheduled Runs ────────────────────────────────────────────────────────────

// Active cron jobs: scheduleId → scheduled task
const cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();

function triggerScheduledRun(schedule: ScheduledRun): void {
  const suite   = findById<TestSuite>(SUITES, schedule.suiteId);
  const project = suite ? findById<Project>(PROJECTS, suite.projectId) : undefined;
  if (!suite || !project) {
    logger.warn(`[scheduler] Suite ${schedule.suiteId} or project not found — skipping`);
    return;
  }

  const environment = (project.environments || []).find(e => e.id === schedule.environmentId) || project.environments?.[0] || null;
  const scripts     = readAll<TestScript>(SCRIPTS).filter(s => suite.scriptIds.includes(s.id));
  const allFunctions = readAll<CommonFunction>(FUNCTIONS).filter(f => f.projectId === project.id || f.projectId === null);

  if (scripts.length === 0) {
    logger.warn(`[scheduler] No scripts in suite ${suite.name} — skipping`);
    return;
  }

  const runId     = uuidv4();
  const startedAt = new Date().toISOString();

  let specPath: string;
  try {
    specPath = generateCodegenSpec({ suiteName: suite.name, suiteId: suite.id, runId, scripts, project, environment, allFunctions });
  } catch (err) {
    logger.error(`[scheduler] Spec generation failed for schedule ${schedule.id}: ${(err as Error).message}`);
    return;
  }

  const planId   = `suite-${suite.id.slice(0, 8)}`;
  const planFile = path.join(config.paths.testPlans, `${planId}-plan.json`);
  if (!fs.existsSync(planFile)) {
    const planMeta = { planId, source: 'suite', sourceRef: suite.id, suiteName: suite.name, projectName: project.name, appBaseURL: project.appUrl, createdAt: startedAt, testCases: scripts.map(s => ({ id: s.id, title: s.title, priority: s.priority })) };
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
  };
  runs.set(runId, record);
  enqueueRun(() => spawnRunWithSpec(record, specPath, false, suite.retries ?? 0));

  // Update lastRunId + lastRunAt on schedule
  const all = readAll<ScheduledRun>(SCHEDULES);
  const idx = all.findIndex(s => s.id === schedule.id);
  if (idx >= 0) { all[idx].lastRunId = runId; all[idx].lastRunAt = startedAt; writeAll(SCHEDULES, all); }

  logger.info(`[scheduler] Triggered run ${runId} for schedule "${schedule.label}" (suite: ${suite.name})`);
}

function registerCronJob(schedule: ScheduledRun): void {
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

function unregisterCronJob(scheduleId: string): void {
  const task = cronJobs.get(scheduleId);
  if (task) { task.stop(); cronJobs.delete(scheduleId); }
}

// GET /api/schedules?suiteId=xxx
app.get('/api/schedules', requireAuth, (req: Request, res: Response) => {
  const { suiteId, projectId } = req.query as Record<string, string>;
  let all = readAll<ScheduledRun>(SCHEDULES);
  if (suiteId)   all = all.filter(s => s.suiteId   === suiteId);
  if (projectId) all = all.filter(s => s.projectId === projectId);
  res.json(all);
});

// POST /api/schedules
app.post('/api/schedules', requireAuth, (req: Request, res: Response) => {
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

// PUT /api/schedules/:id  (update label, cron, enabled, environmentId)
app.put('/api/schedules/:id', requireAuth, (req: Request, res: Response) => {
  const all = readAll<ScheduledRun>(SCHEDULES);
  const idx = all.findIndex(s => s.id === req.params.id);
  if (idx < 0) { res.status(404).json({ error: 'Schedule not found' }); return; }

  const { label, cronExpression, enabled, environmentId } = req.body as Partial<ScheduledRun>;
  if (cronExpression && !cron.validate(cronExpression)) {
    res.status(400).json({ error: `Invalid cron expression: "${cronExpression}"` }); return;
  }

  const updated: ScheduledRun = {
    ...all[idx],
    ...(label          !== undefined && { label }),
    ...(cronExpression !== undefined && { cronExpression }),
    ...(enabled        !== undefined && { enabled }),
    ...(environmentId  !== undefined && { environmentId }),
  };
  all[idx] = updated;
  writeAll(SCHEDULES, all);
  registerCronJob(updated);
  res.json(updated);
});

// DELETE /api/schedules/:id
app.delete('/api/schedules/:id', requireAuth, (req: Request, res: Response) => {
  unregisterCronJob(req.params.id);
  const ok = remove(SCHEDULES, req.params.id);
  if (!ok) { res.status(404).json({ error: 'Schedule not found' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCHEDULE_DELETE', resourceType: 'schedule', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// ── SPA fallback (requires auth) ─────────────────────────────────────────────

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

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (msg.type === 'subscribe' && msg.runId) {
        subscribe(msg.runId, ws);
        subscribed.add(msg.runId);

        // Catch-up: if this is a debug session with a pending paused step, replay it
        const dbgSession = debugSessions.get(msg.runId);
        if (dbgSession?.pendingStep) {
          const { stepIdx, keyword, locator, value, screenshotPath } = dbgSession.pendingStep;
          ws.send(JSON.stringify({ type: 'debug:step', sessionId: msg.runId, stepIdx, keyword, locator, value, screenshotPath }));
        } else if (dbgSession?.status === 'done' || dbgSession?.status === 'stopped' || dbgSession?.status === 'error') {
          ws.send(JSON.stringify({ type: 'debug:done', sessionId: msg.runId, status: dbgSession.status }));
        }

        // Replay recent state so late-joiners catch up
        const record = runs.get(msg.runId);
        if (record) {
          // Send last 50 output lines
          for (const line of record.output.slice(-50)) {
            ws.send(JSON.stringify({ type: 'run:output', runId: msg.runId, line, level: classifyLine(line) }));
          }
          // Send current stats
          ws.send(JSON.stringify({
            type: 'run:stats', runId: msg.runId,
            passed: record.passed, failed: record.failed,
            total: record.total, completed: record.tests.length,
          }));
          // If already done, send done event
          if (record.status !== 'running') {
            ws.send(JSON.stringify({ type: 'run:done', runId: msg.runId, passed: record.passed, failed: record.failed, total: record.total, exitCode: record.exitCode }));
          }
        }
        return;
      }

      if (msg.type === 'unsubscribe' && msg.runId) {
        unsubscribe(msg.runId, ws);
        subscribed.delete(msg.runId);
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    for (const runId of subscribed) unsubscribe(runId, ws);
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  await seedDefaults();

  // Register all enabled schedules
  const savedSchedules = readAll<ScheduledRun>(SCHEDULES).filter(s => s.enabled);
  for (const s of savedSchedules) registerCronJob(s);
  if (savedSchedules.length > 0) logger.info(`[scheduler] Loaded ${savedSchedules.length} active schedule(s)`);

  // Heartbeat monitor — kill orphaned debug sessions if no heartbeat for 60s
  setInterval(() => {
    const now = Date.now();
    const HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds (user may pause 30-40s reviewing screenshot)
    debugSessions.forEach((session, sessionId) => {
      if (session.status !== 'done' && session.status !== 'stopped' && session.status !== 'error') {
        const timeSinceHeartbeat = now - session.lastHeartbeat;
        if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          logger.info(`[dbg:heartbeat] No heartbeat for ${timeSinceHeartbeat}ms — killing orphaned session ${sessionId.slice(0,8)}`);
          if (session.proc) { try { session.proc.kill('SIGTERM'); } catch { /* ignore */ } }
          session.status = 'stopped';
          clearInterval(debugPollers.get(sessionId)!);
          debugPollers.delete(sessionId);
        }
      }
    });
  }, 10000); // Check every 10 seconds

  logger.info(`QA Agent Platform UI  →  http://localhost:${PORT}`);
  logger.info(`WebSocket             →  ws://localhost:${PORT}/ws`);
  logger.info(`Jira configured       :  ${config.jira.isConfigured}`);
  logger.info(`Login                 →  http://localhost:${PORT}/login`);
});

export default app;
