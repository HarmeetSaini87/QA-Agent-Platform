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
import express, { Request, Response, NextFunction } from 'express';
import multer       from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv  from 'dotenv';
import session      from 'express-session';
import SQLiteStore  from 'connect-sqlite3';
import cron         from 'node-cron';

import { generateCodegenSpec, generateDebugSpec } from '../utils/codegenGenerator';
import {
  validateLicenseKey, validateLicFile, storeLicense, loadStoredLicense,
  getLicensePayload, refreshLicenseCache, clearLicenseCache,
  activateAutoTrial, isAutoTrial, trialDaysRemaining, AUTO_TRIAL_DAYS,
  isFeatureEnabled, recordLogin, recordLogout, getSeatsUsed, isSeatAvailable,
  getMachineId, checkMachineBinding, transferLicense, checkExpiryTick,
  checkStoredLicFile, syncSeatsFromSessions, getSeatUsageRatio,
} from '../utils/licenseManager';
import { parseRecorderEvent, RecorderEvent }      from '../utils/recorderParser';
import { scoreCandidates, toLocatorAlternative, T3_AUTO_THRESHOLD, DomCandidate } from '../utils/healingEngine';
import { upsertPageModel, listPageModels } from '../utils/pageModelManager';
import { config }  from '../framework/config';
import { logger }  from '../utils/logger';

// ── Auth + Data imports ────────────────────────────────────────────────────────
import { seedDefaults }            from '../data/seed';
import { readAll, upsert, remove, findById, writeAll, USERS, PROJECTS, LOCATORS, FUNCTIONS, AUDIT, SETTINGS, SCRIPTS, SUITES, COMMON_DATA, SCHEDULES, APIKEYS } from '../data/store';
import { User, Project, ProjectEnvironment, Locator, CommonFunction, CommonData, AuditEntry, AppSettings, NotificationSettings, DEFAULT_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS, ProjectCredential, TestScript, ScriptStep, TestSuite, ScheduledRun, HealingProposal, LicensePayload, ApiKey, BrowserName } from '../data/types';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../auth/crypto';
import { requireAuth, requireAdmin, requireEditor, requireAuthOrApiKey, sanitizeInput } from '../auth/middleware';
import { logAudit }                                                from '../auth/audit';
import * as crypto from 'crypto';
import { sendRunNotification, sendTestNotification, formatDuration } from '../utils/notifier';

// ── Sensitive value encryption (AES-256-CBC) ──────────────────────────────────
// Key derived from QA_SECRET_KEY env var, falls back to hostname-derived key.
// Values stored as enc:<iv_hex>:<ciphertext_hex> in common_data.json.
const _secretKey = (() => {
  const raw = process.env.QA_SECRET_KEY || require('os').hostname() + '_qa_agent_v1';
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
})();

function encryptValue(plain: string): string {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', _secretKey, iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:${iv.toString('hex')}:${enc.toString('hex')}`;
}

function decryptValue(stored: string): string {
  if (!stored.startsWith('enc:')) return stored;
  const parts = stored.split(':');
  if (parts.length < 3) return stored;
  try {
    const iv      = Buffer.from(parts[1], 'hex');
    const enc     = Buffer.from(parts.slice(2).join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', _secretKey, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch { return '***'; }
}

function maskValue(stored: string): string {
  return '••••••••';
}

/** Prepare a CommonData record for API response — mask sensitive values */
function cdForResponse(d: CommonData): object {
  return { ...d, value: d.sensitive ? maskValue(d.value) : d.value };
}

dotenv.config();

// ── Constants ─────────────────────────────────────────────────────────────────

const PORT       = config.ui.port;
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const UPLOAD_DIR    = path.resolve(config.paths.requirements, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const TEST_FILES_DIR = path.resolve('test-files');
if (!fs.existsSync(TEST_FILES_DIR)) fs.mkdirSync(TEST_FILES_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'pass' | 'fail' | 'warn';

interface HealEvent {
  stepOrder:       number;
  keyword:         string;
  locatorId:       string;
  healed:          string;   // new selector that worked
  healedType:      string;
  confidence:      number;
  at:              string;   // ISO timestamp
}

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
  browsers?:       string[];   // browsers used for this run e.g. ['chromium', 'firefox']
  // Self-healing events recorded during this run
  healEvents?:     HealEvent[];
}

interface TestEvent {
  name:          string;
  status:        'running' | 'pass' | 'fail';
  durationMs:    number;
  browser?:      string;   // 'chromium' | 'firefox' | 'webkit' — set from list reporter output
  errorMessage?: string;
  errorDetail?:  string;
  screenshotPath?: string;
  screenshotBefore?: string;
  screenshotAfter?:  string;
  videoPath?:  string;
  tracePath?:  string;
  failureScreenshotPath?: string;
  consoleErrors?: string[];
  steps?: { name: string; status: 'pass' | 'fail' | 'skip'; durationMs: number }[];
}

// ── Debug session types ───────────────────────────────────────────────────────

interface DebugSession {
  sessionId:      string;
  scriptId:       string;
  scriptTitle:    string;
  projectId:      string;
  // Ownership — who started this session
  userId:         string;
  username:       string;
  environmentId:  string | null;
  environmentName: string | null;
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
  | { type: 'run:test';   runId: string; name: string; status: 'pass'|'fail'|'running'; durationMs?: number; browser?: string }
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

// ── SSE clients for debug sessions ───────────────────────────────────────────
// SSE works through ALL HTTP proxies (no WS upgrade needed).
// Each debug session can have multiple SSE subscriber connections (tab reloads etc.).
const debugSseClients = new Map<string, Set<import('http').ServerResponse>>();

function sseSessionPush(sessionId: string, event: string, payload: object): void {
  const clients = debugSseClients.get(sessionId);
  if (!clients?.size) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach(res => { try { res.write(data); } catch { /* client disconnected */ } });
}

// ── Recorder session state ────────────────────────────────────────────────────
// In-memory store for active recording sessions.
// Sessions auto-expire after 30 minutes of inactivity (2h hard cap).

interface RecorderSession {
  token:       string;
  projectId:   string;
  createdBy:   string;
  active:      boolean;
  steps:       import('../data/types').ScriptStep[];
  stepCount:   number;         // running counter for order assignment
  lastActivity: number;        // ms timestamp — used for inactivity expiry
  createdAt:   number;
  sseClients:  Set<import('http').ServerResponse>;
}

const recorderSessions = new Map<string, RecorderSession>();

function recorderSsePush(token: string, event: string, payload: object): void {
  const session = recorderSessions.get(token);
  if (!session?.sseClients.size) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  session.sseClients.forEach(res => { try { res.write(data); } catch {} });
}

// Expiry: 30 min inactivity, 2h hard cap
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of recorderSessions) {
    const inactive  = now - s.lastActivity > 30 * 60 * 1000;
    const hardCap   = now - s.createdAt    >  2 * 60 * 60 * 1000;
    if (inactive || hardCap) {
      s.sseClients.forEach(res => { try { res.end(); } catch {} });
      recorderSessions.delete(token);
      logger.info(`[recorder] Session expired (${inactive ? 'inactivity' : 'hard cap'}): ${token.slice(0,8)}`);
    }
  }
}, 60_000);

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
//                             or:  "  ok N [firefox] › ..."  (multi-browser)
// Unicode symbols (✓/✗) appear in some environments; "ok"/"x" in others.
const RE_TEST_PASS  = /\bok\s+\d+\s+\[|[✓✔√]|\d+\s+passed/u;
const RE_TEST_FAIL  = /\bx\s+\d+\s+\[|[✗✘×]/u;
// Matches any browser name in brackets — chromium, firefox, webkit
const RE_TEST_LINE  = /(?:ok|x|[✓✔✗✘×√])\s+\d+\s+\[(chromium|firefox|webkit)\][^(]*›\s*([^›(]+?)\s*\((\d+(?:\.\d+)?)(ms|s)\)/u;
const RE_TOTAL      = /Running (\d+) tests?/;
const RE_PASS_COUNT = /(\d+) passed/;
const RE_FAIL_COUNT = /(\d+) failed/;
// Phase A: console errors emitted by afterEach as structured log line
// Format: [QA_CONSOLE_ERRORS]:<testIdx>:<json-array>
const RE_CONSOLE_ERRORS = /\[QA_CONSOLE_ERRORS\]:(\d+):(.+)$/;

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
  const failHdr   = /^\s{2,4}\d+\)\s+\[(chromium|firefox|webkit)\]/;
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

        // Check for screenshot attachment.
        // Playwright list reporter outputs the header and file path on SEPARATE lines:
        //   attachment #1: screenshot (image/png) ─────────────────
        //      test-results\<runId>\<test-name>-chromium\test-failed-1.png
        // We find the header line, then scan the next 1-2 lines for the file path.
        const ssHeaderIdx = block.findIndex(l => /attachment.*screenshot.*image\/png/i.test(l));
        if (ssHeaderIdx >= 0) {
          for (let pi = ssHeaderIdx + 1; pi < Math.min(ssHeaderIdx + 3, block.length); pi++) {
            const pathLine = block[pi].trim();
            if (!pathLine) continue;
            const m = pathLine.match(/test-results[^\r\n]+\.(png|jpg|jpeg)/i);
            if (m) {
              ev.screenshotPath = m[0].replace(/\\/g, '/');
              break;
            }
          }
        }
      }
      continue;
    }
    i++;
  }
}

// ── Failure screenshot attachment (Phase A) ───────────────────────────────────
// afterEach hook writes FAILED-<testIdx>.png to test-results/<runId>/.
// Scan for these and attach as failureScreenshotPath on the matching TestEvent.

function attachFailureScreenshots(record: RunRecord): void {
  const ssDir = path.join(config.paths.testResults, record.runId);
  if (!fs.existsSync(ssDir)) return;

  const failRe = /^FAILED-(\d+)\.png$/;
  let files: string[];
  try { files = fs.readdirSync(ssDir); } catch { return; }

  for (const f of files) {
    const m = f.match(failRe);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const ev  = record.tests[idx];
    if (ev) ev.failureScreenshotPath = `test-results/${record.runId}/${f}`;
  }
}

// ── Phase B: attach test.step() data from Playwright JSON report ──────────────
// Playwright JSON reporter writes one suite per spec; each test has nested steps.
// We match tests positionally (record.tests[] order = Playwright run order, workers:1).

function attachStepsFromJson(record: RunRecord, jsonReportPath: string): void {
  try {
    if (!fs.existsSync(jsonReportPath)) return;
    const raw  = fs.readFileSync(jsonReportPath, 'utf8');
    const report = JSON.parse(raw);

    // Flatten all test results from the report (suites → specs → tests)
    const pwTests: any[] = [];
    function collectTests(suites: any[]): void {
      for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            pwTests.push({ title: spec.title, test });
          }
        }
        collectTests(suite.suites || []);
      }
    }
    collectTests(report.suites || []);

    // Match positionally — same order as record.tests[] since workers:1
    pwTests.forEach((entry, idx) => {
      const ev = record.tests[idx];
      if (!ev) return;
      const result = entry.test?.results?.[0];
      if (!result) return;

      // Flatten top-level steps only (test.step() wrapping)
      const steps = (result.steps || []).map((s: any) => ({
        name:       s.title || '',
        status:     s.error ? 'fail' : 'pass',
        durationMs: typeof s.duration === 'number' ? s.duration : 0,
      }));
      if (steps.length) ev.steps = steps;
    });
  } catch { /* JSON parse / file error — skip gracefully */ }
}

// ── Visual diff attachment ────────────────────────────────────────────────────
// Scans test-results/<runId>/ for before/after screenshot pairs and attaches
// them to the matching TestEvent by testIdx position in record.tests[].

function attachVisualDiff(record: RunRecord): void {
  const ssDir = path.join(config.paths.testResults, record.runId);
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
    const beforeSteps = beforeMap.get(idx);
    const afterSteps  = afterMap.get(idx);

    if (!beforeSteps && !afterSteps) return;

    if (ev.status === 'fail') {
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
    } else {
      // Passing test — attach the last before-screenshot as visual evidence
      if (beforeSteps && beforeSteps.size > 0) {
        const lastStep = Math.max(...beforeSteps.keys());
        ev.screenshotPath = `test-results/${record.runId}/${beforeSteps.get(lastStep)}`;
      }
    }
  });
}

// ── Video & Trace attachment ──────────────────────────────────────────────────
// After Playwright finishes, each test has its own output subdirectory:
//   test-results/<runId>/<sanitized-test-title>-chromium/
//     video.webm    (when video: 'on')
//     trace.zip     (when trace: 'on')
// Tests run sequentially (workers: 1), so we match directories to record.tests[]
// positionally after sorting alphabetically (Playwright names them from test title).
function attachVideoAndTrace(record: RunRecord): void {
  const runDir = path.join(config.paths.testResults, record.runId);
  if (!fs.existsSync(runDir)) return;

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(runDir, { withFileTypes: true }); }
  catch { return; }

  // Playwright creates one subdir per test named <title>-<browser> (or -<browser>-<retry>)
  const testDirs = entries
    .filter(e => e.isDirectory() && /(chromium|firefox|webkit)/i.test(e.name))
    .map(e => e.name)
    .sort();

  if (!testDirs.length) return;

  record.tests.forEach((ev, idx) => {
    const dir = testDirs[idx];
    if (!dir) return;

    const videoFile = path.join(runDir, dir, 'video.webm');
    const traceFile = path.join(runDir, dir, 'trace.zip');

    if (fs.existsSync(videoFile)) {
      ev.videoPath = `test-results/${record.runId}/${dir}/video.webm`;
    }
    if (fs.existsSync(traceFile)) {
      ev.tracePath = `test-results/${record.runId}/${dir}/trace.zip`;
    }
  });
}

// Reads the healed.ndjson written by the spec's __tryAlts helper and attaches
// heal events to the run record. Also persists each event to the global
// data/healing-log.json for the Locator Repo healing history view.
function attachHealEvents(record: RunRecord): void {
  const healFile = path.join(config.paths.testResults, record.runId, 'healed.ndjson');
  if (!fs.existsSync(healFile)) return;

  const lines = fs.readFileSync(healFile, 'utf-8').trim().split('\n').filter(Boolean);
  const events: HealEvent[] = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line) as HealEvent); } catch { /* malformed line */ }
  }
  if (!events.length) return;

  record.healEvents = events;

  // Append to global healing-log.json (NDJSON)
  const globalLog = path.resolve('data', 'healing-log.ndjson');
  const withRunId = events.map(e => ({ ...e, runId: record.runId, projectId: record.projectId ?? '' }));
  try {
    fs.mkdirSync(path.resolve('data'), { recursive: true });
    fs.appendFileSync(globalLog, withRunId.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  } catch { /* log write failure is non-fatal */ }
}

// ── Run spawner (pre-built spec path) ────────────────────────────────────────
// Used by suite execution — spec generated by codegenGenerator.ts

function spawnRunWithSpec(record: RunRecord, specPath: string, headed?: boolean, retries = 0, browsers: BrowserName[] = ['chromium']): void {
  const { runId } = record;

  broadcast(runId, {
    type:      'run:start',
    runId,
    planId:    record.planId,
    startedAt: record.startedAt,
  });

  const relPath   = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
  // Use config.paths.testResults so dev and prod write to their own isolated directories
  const outputDir = path.join(config.paths.testResults, runId).replace(/\\/g, '/');
  // Pre-create output dir so visual diff screenshots can be written by generated spec
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  // Phase B: JSON reporter runs alongside list reporter; output file via env var
  const jsonReportFile = 'pw-report.json'; // relative to cwd; PLAYWRIGHT_JSON_OUTPUT_NAME controls filename
  const jsonReportPath = path.join(path.resolve(outputDir), jsonReportFile);
  const args      = ['playwright', 'test', '--reporter=list,json', `--output=${outputDir}`];
  if (retries > 0) args.push(`--retries=${retries}`);
  // Add --project flag for each selected browser (defaults to chromium only)
  const selectedBrowsers = (browsers && browsers.length) ? browsers : ['chromium'];
  selectedBrowsers.forEach(b => args.push(`--project=${b}`));
  args.push(relPath);

  const runHeadless = headed === false;
  if (!runHeadless) args.push('--headed');
  logger.info(`[spawnRunWithSpec] Browser: ${runHeadless ? 'headless' : 'headed'} — ${relPath}`);

  record.status = 'running';

  const proc = cp.spawn('npx', args, {
    cwd:   path.resolve('.'),
    env:   { ...process.env, CI: '', HEADLESS: runHeadless ? 'true' : 'false', PW_OUTPUT_DIR: outputDir, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReportPath },
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
        // Groups: [1]=browser [2]=testName [3]=durationVal [4]=durationUnit
        const browser    = testMatch[1];
        const name       = testMatch[2].trim();
        const status     = RE_TEST_PASS.test(plain) ? 'pass' : 'fail';
        const durationMs = parseMs(testMatch[3], testMatch[4]);
        const ev: TestEvent = { name, status, durationMs, browser };
        record.tests.push(ev);
        broadcast(runId, { type: 'run:test',  runId, name, status, durationMs, browser });
        broadcast(runId, { type: 'run:stats', runId, passed: record.passed, failed: record.failed, total: record.total, completed: record.tests.length });
      }

      // Phase A: parse console errors emitted by afterEach structured log
      const ceMatch = plain.match(RE_CONSOLE_ERRORS);
      if (ceMatch) {
        const testIdx = parseInt(ceMatch[1], 10);
        try {
          const errors: string[] = JSON.parse(ceMatch[2]);
          // tests[] may not have this index yet if line arrives before test-line — defer via post-run
          (record as any).__pendingConsoleErrors = (record as any).__pendingConsoleErrors || {};
          (record as any).__pendingConsoleErrors[testIdx] = errors;
        } catch { /* malformed JSON — skip */ }
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

    // Phase A: flush pending console errors collected during the run
    const pending = (record as any).__pendingConsoleErrors as Record<number, string[]> | undefined;
    if (pending) {
      for (const [idxStr, errors] of Object.entries(pending)) {
        const ev = record.tests[parseInt(idxStr, 10)];
        if (ev && errors.length) ev.consoleErrors = errors;
      }
      delete (record as any).__pendingConsoleErrors;
    }

    // Phase A: attach afterEach full-page failure screenshots
    attachFailureScreenshots(record);

    // Attach before/after visual diff screenshots to failed test events
    attachVisualDiff(record);

    // Attach video recording and trace ZIP paths to every test event
    attachVideoAndTrace(record);

    // Phase B: attach test.step() names/status/duration from Playwright JSON report
    attachStepsFromJson(record, jsonReportPath);

    // Attach T2 self-healing events from healed.ndjson written by the spec
    attachHealEvents(record);

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

    // ── Notifications ─────────────────────────────────────────────────────────
    try {
      const settingsRow = readAll<AppSettings & { id: string }>(SETTINGS)[0];
      const notifCfg    = settingsRow?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
      const durationMs  = record.finishedAt && record.startedAt
        ? new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime()
        : 0;
      const platformUrl = `http://localhost:${PORT}`;
      const summary = {
        runId,
        suiteName:       record.suiteName       ?? 'Unknown Suite',
        projectName:     record.projectName      ?? 'Unknown Project',
        status:          record.status as 'done' | 'failed',
        passed:          record.passed,
        failed:          record.failed,
        total:           record.total,
        duration:        formatDuration(durationMs),
        startedAt:       record.startedAt,
        executedBy:      record.executedBy       ?? 'scheduler',
        environmentName: record.environmentName  ?? 'Default',
        platformUrl,
      };
      sendRunNotification(notifCfg, summary).then(errs => {
        if (errs.email) logger.warn(`[notify] Email error: ${errs.email}`);
        if (errs.slack) logger.warn(`[notify] Slack error: ${errs.slack}`);
        if (errs.teams) logger.warn(`[notify] Teams error: ${errs.teams}`);
      }).catch(e => logger.warn(`[notify] Unexpected error: ${e.message}`));
    } catch (e: any) {
      logger.warn(`[notify] Settings read error: ${e.message}`);
    }


    // Clean up the temporary spec file for this run
    if (record.specPath && fs.existsSync(record.specPath)) {
      try { fs.unlinkSync(record.specPath); } catch { /* ignore */ }
    }

    // Release slot and start next queued run
    onRunComplete();
  });
}

// ── P1-04: requireFeature middleware ──────────────────────────────────────────

// HTTP 402 = Payment Required — signals client to show upgrade CTA (P3-10)
const UPGRADE_TIER: Record<string, string> = {
  scheduler: 'team',
  sso:       'team',
  apiAccess: 'enterprise',
  whiteLabel:'enterprise',
};

function requireFeature(feature: keyof LicensePayload['features']) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!isFeatureEnabled(feature)) {
      const p       = getLicensePayload();
      const upgrade = UPGRADE_TIER[feature as string] ?? 'enterprise';
      res.status(402).json({
        error:   'Feature not available on your license tier',
        feature,
        tier:    p?.tier ?? 'none',
        upgrade,   // client shows "Upgrade to {upgrade}" CTA
      });
      return;
    }
    next();
  };
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Session middleware (must be before routes) ─────────────────────────────────
// Timeout is driven by AppSettings.sessionTimeoutMinutes (default 60).
// The helper below reads the live value from settings.json on every auth check —
// so an admin changing the value in the UI takes effect immediately for all new
// requests without requiring a server restart.

function getSessionTimeoutMs(): number {
  try {
    const s = readAll<AppSettings & { id: string }>(SETTINGS)[0];
    const mins = s?.sessionTimeoutMinutes ?? DEFAULT_SETTINGS.sessionTimeoutMinutes;
    return Math.max(5, mins) * 60 * 1000; // minimum 5 minutes safety floor
  } catch {
    return DEFAULT_SETTINGS.sessionTimeoutMinutes * 60 * 1000;
  }
}

// P2-01: SQLite-backed session store — sessions survive server restarts.
// connect-sqlite3 factory requires passing the session constructor.
const SqliteSessionStore = SQLiteStore(session);
const SESSION_SECRET = process.env.SESSION_SECRET || 'qa-agent-platform-secret-key-2026';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionStore = new SqliteSessionStore({
  db:  'sessions.sqlite',
  dir: path.resolve('data'),
  table: 'sessions',
}) as any;

app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  store:             sessionStore,
  cookie: {
    httpOnly: true,
    secure:   false,          // set true if serving over HTTPS
    maxAge:   getSessionTimeoutMs(),
    sameSite: 'lax',
  },
  name: config.ui.cookieName,   // 'qa.sid' prod | 'qa-dev.sid' dev — prevents cookie overlap
}));

// ── Inactivity timeout enforcement ────────────────────────────────────────────
// Checks every authenticated request. If the session has been idle longer than
// sessionTimeoutMinutes, it is destroyed and 401 is returned.
// Rolling: lastActivity is updated on every request so active users stay logged in.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId) { next(); return; }
  const now     = Date.now();
  const last    = (req.session as any).lastActivity as number | undefined;
  const timeout = getSessionTimeoutMs();
  if (last && now - last > timeout) {
    req.session.destroy(() => {});
    if (req.originalUrl.startsWith('/api/')) {
      res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
    } else {
      res.redirect('/login?reason=expired');
    }
    return;
  }
  (req.session as any).lastActivity = now;
  // Keep cookie maxAge in sync with current settings value
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

// ── Login page served without auth ───────────────────────────────────────────
app.get('/login', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/login.css', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.css')));
app.get('/login.js',  (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.js')));

// ── recorder.js — MUST be before express.static so origin injection fires ────
// express.static would serve the raw file directly, bypassing the origin inject.
// Access-Control-Allow-Origin: * required so the AUT page (cross-origin) can load
// this script via a bookmarklet or console injection.
app.get('/recorder.js', (req: Request, res: Response) => {
  const origin     = `${req.protocol}://${req.get('host')}`;
  const scriptPath = path.join(PUBLIC_DIR, 'recorder.js');
  if (!fs.existsSync(scriptPath)) { res.status(404).send('// recorder.js not found'); return; }
  const src      = fs.readFileSync(scriptPath, 'utf-8');
  const injected = `window.__qa_recorder_origin = ${JSON.stringify(origin)};\n${src}`;
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');   // allow cross-origin load from AUT
  res.send(injected);
});

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

// ── Test Files — per-project multer storage ───────────────────────────────────
const testFileStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const projectId = (req.query.projectId as string || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!projectId) { cb(new Error('projectId required'), ''); return; }
    const dir = path.join(TEST_FILES_DIR, projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Keep original filename — sanitise it
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const testFileUpload = multer({
  storage: testFileStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.match(/\.(xlsx|xls|csv|pdf|docx|doc|txt|json|xml|zip)$/i);
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

  // P1-05: seat enforcement
  // Skip when no license is activated yet — allows the first admin to log in
  // and activate a license key (Option A: no chicken-and-egg on fresh install).
  const licPayload = getLicensePayload();
  if (licPayload && !isSeatAvailable(user.id)) {
    res.status(403).json({ error: 'Seat limit reached. All licensed seats are in use.', seatsUsed: getSeatsUsed(), seatsTotal: licPayload.seats ?? 0 });
    return;
  }

  req.session.userId   = user.id;
  req.session.username = user.username;
  req.session.role     = user.role;
  req.session.loginAt  = new Date().toISOString();
  (req.session as unknown as Record<string, unknown>).ip = req.ip ?? null;
  recordLogin(user.id);
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
  const uid = req.session?.userId;
  if (uid) {
    logAudit({ userId: uid, username: req.session.username ?? null, action: 'LOGOUT', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null });
    recordLogout(uid);
  }
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  if (!req.session?.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  res.json({ userId: req.session.userId, username: req.session.username, role: req.session.role });
});

// ── CORS for Chrome Extension + AUT cross-origin requests ────────────────────
// Two cases:
//  1. Extension popup (chrome-extension:// origin) — needs credentials for session auth
//  2. Content script running inside AUT (e.g. https://ssoqa10.billcall.net) — POSTs
//     to /api/recorder/step; no credentials needed (token-protected); must allow any origin
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin || '';
  if (origin.startsWith('chrome-extension://')) {
    // Extension popup — allow with credentials for authenticated API calls
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  } else if (req.path === '/api/recorder/step' || req.path === '/api/recorder/heartbeat') {
    // recorder.js runs in the AUT tab (cross-origin) — token is the auth
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ── Recorder step endpoint — token-authenticated, no session cookie needed ────
// recorder.js runs in the AUT tab which has no platform session. The token
// (created by /api/recorder/start) is sufficient access control.
app.post('/api/recorder/step', (req: Request, res: Response) => {
  const event = req.body as RecorderEvent;
  const session = recorderSessions.get(event?.token);
  if (!session || !session.active) { res.status(404).json({ error: 'session not found or inactive' }); return; }

  session.lastActivity = Date.now();
  session.stepCount++;

  const { step, locatorCreated, locatorName } = parseRecorderEvent(
    event,
    session.projectId,
    session.createdBy,
    session.stepCount,
  );

  session.steps.push(step);
  recorderSsePush(event.token, 'recorder:step', { step, locatorCreated, locatorName, stepNum: session.stepCount });
  logger.info(`[recorder] Step ${session.stepCount}: ${step.keyword} ${step.locator || step.value || ''} (${event.token.slice(0,8)})`);
  res.json({ success: true, stepNum: session.stepCount });
});

// ── All routes below require authentication ───────────────────────────────────
// Prevent browser from caching API responses (eliminates stale-data UI lag)
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', requireAuth);

// ── Run endpoints ─────────────────────────────────────────────────────────────

app.get('/api/run/:runId', requireAuthOrApiKey, (req: Request, res: Response) => {
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
    healCount:       r.healEvents?.length ?? 0,
    browsers:        r.browsers ?? ['chromium'],
    tests:           r.tests   ?? [],
  })));
});

// ── NL Keyword Suggestion ─────────────────────────────────────────────────────
// POST /api/nl-suggest  { description, projectId }
// Returns { keyword, locatorName, value, confidence, provider, error? }
import { nlSuggest, NlProviderConfig } from '../utils/nlProvider';

app.post('/api/nl-suggest', requireAuth, async (req: Request, res: Response) => {
  const { description, projectId } = req.body as { description: string; projectId: string };
  if (!description?.trim()) { res.status(400).json({ error: 'description is required' }); return; }

  const settings = (readAll<AppSettings & { id: string }>(SETTINGS)[0] ?? DEFAULT_SETTINGS) as any;
  const provider  = (settings.nlProvider || '').trim();

  if (!provider) {
    res.status(503).json({ error: 'NL Suggestion not configured — go to Admin → Settings → AI Settings to choose a provider.' });
    return;
  }

  // Migrate legacy anthropicApiKey → nlApiKey
  const apiKey  = (settings.nlApiKey || settings.anthropicApiKey || '').trim();
  const baseUrl = (settings.nlBaseUrl || '').trim();
  const model   = (settings.nlModel  || '').trim();

  // Validate provider needs
  if (provider !== 'ollama' && !apiKey) {
    res.status(503).json({ error: `NL Suggestion: API key required for provider "${provider}". Configure in Admin → Settings.` });
    return;
  }
  if (provider === 'ollama' && !baseUrl && !settings.nlBaseUrl) {
    // default Ollama URL — allow fallback
  }

  // Build keyword + locator context
  const keywords = JSON.parse(require('fs').readFileSync(require('path').resolve('src/data/keywords.json'), 'utf-8')) as Array<{ key: string; label: string; helpLabel?: string }>;
  const kwList   = keywords.map(k => `${k.key}: ${k.helpLabel || k.label}`).join('\n');
  const locators = projectId
    ? readAll<import('../data/types').Locator>(LOCATORS).filter(l => !l.projectId || l.projectId === projectId)
    : [];
  const locList  = locators.map(l => l.name).join(', ') || '(none configured)';

  const cfg: NlProviderConfig = { provider: provider as any, apiKey, model, baseUrl };

  try {
    const result = await nlSuggest(cfg, description.trim(), kwList, locList);
    res.json(result);
  } catch (err: any) {
    const msg = (err?.message || String(err)).slice(0, 300);
    res.status(502).json({ error: `NL provider error: ${msg}` });
  }
});

// GET /api/nl-providers — returns provider metadata for Admin UI (no secrets)
app.get('/api/nl-providers', requireAdmin, (_req, res) => {
  const { NL_PROVIDERS } = require('../utils/nlProvider');
  res.json(NL_PROVIDERS);
});

// ── Analytics endpoint ────────────────────────────────────────────────────────
// GET /api/analytics?projectId=xxx&days=30
app.get('/api/analytics', requireAuth, (req: Request, res: Response) => {
  const filterProjectId = (req.query.projectId as string) || '';
  const days = Math.min(parseInt((req.query.days as string) || '30', 10), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Load all runs (in-memory + disk)
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

  let pool = allRuns.filter(r => (r.status === 'done' || r.status === 'failed') && r.startedAt >= since);
  if (filterProjectId) pool = pool.filter(r => r.projectId === filterProjectId);
  pool.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  // 1. Pass rate trend — group by day (UTC)
  const dayMap = new Map<string, { passed: number; failed: number; total: number }>();
  for (const r of pool) {
    const day = r.startedAt.slice(0, 10);
    const entry = dayMap.get(day) ?? { passed: 0, failed: 0, total: 0 };
    entry.passed += r.passed ?? 0;
    entry.failed += r.failed ?? 0;
    entry.total  += r.total  ?? 0;
    dayMap.set(day, entry);
  }
  const passRateTrend = [...dayMap.entries()].map(([day, e]) => ({
    day,
    passRate: e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0,
    passed: e.passed, failed: e.failed, total: e.total,
  }));

  // 2. Run duration trend — average ms per day
  const durMap = new Map<string, number[]>();
  for (const r of pool) {
    if (!r.startedAt || !r.finishedAt) continue;
    const day = r.startedAt.slice(0, 10);
    const ms  = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
    if (!durMap.has(day)) durMap.set(day, []);
    durMap.get(day)!.push(ms);
  }
  const durationTrend = [...durMap.entries()].map(([day, arr]) => ({
    day,
    avgMs: Math.round(arr.reduce((s, v) => s + v, 0) / arr.length),
  }));

  // 3. Top failing test cases
  const tcFail = new Map<string, { name: string; suiteName: string; failures: number; passes: number }>();
  for (const r of pool) {
    for (const t of r.tests ?? []) {
      const key = t.name;
      const entry = tcFail.get(key) ?? { name: t.name, suiteName: r.suiteName ?? '', failures: 0, passes: 0 };
      if (t.status === 'fail') entry.failures++;
      else if (t.status === 'pass') entry.passes++;
      tcFail.set(key, entry);
    }
  }
  const topFailures = [...tcFail.values()]
    .filter(t => t.failures > 0)
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 20)
    .map(t => ({ ...t, total: t.failures + t.passes, failRate: Math.round((t.failures / (t.failures + t.passes)) * 100) }));

  // 4. Flaky tests (pass AND fail in the window)
  const flaky = [...tcFail.values()]
    .filter(t => t.failures > 0 && t.passes > 0)
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 20)
    .map(t => ({ ...t, total: t.failures + t.passes, failRate: Math.round((t.failures / (t.failures + t.passes)) * 100) }));

  // 5. Suite comparison — totals per suite
  const suiteMap = new Map<string, { suiteId: string; suiteName: string; runs: number; passed: number; failed: number; total: number; totalMs: number }>();
  for (const r of pool) {
    const key = r.suiteId ?? 'unknown';
    const entry = suiteMap.get(key) ?? { suiteId: key, suiteName: r.suiteName ?? key, runs: 0, passed: 0, failed: 0, total: 0, totalMs: 0 };
    entry.runs++;
    entry.passed += r.passed ?? 0;
    entry.failed += r.failed ?? 0;
    entry.total  += r.total  ?? 0;
    if (r.startedAt && r.finishedAt) entry.totalMs += new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
    suiteMap.set(key, entry);
  }
  const suiteComparison = [...suiteMap.values()].sort((a, b) => b.runs - a.runs);

  // 6. Summary KPIs
  const totalRuns   = pool.length;
  const totalPassed = pool.reduce((s, r) => s + (r.passed ?? 0), 0);
  const totalFailed = pool.reduce((s, r) => s + (r.failed ?? 0), 0);
  const totalTests  = pool.reduce((s, r) => s + (r.total  ?? 0), 0);
  const overallPassRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

  res.json({
    days, totalRuns, totalPassed, totalFailed, totalTests, overallPassRate,
    passRateTrend, durationTrend, topFailures, flaky, suiteComparison,
  });
});

// ── Visual Regression endpoints ───────────────────────────────────────────────
import { getAllBaselines, getBaseline, approveBaseline, deleteBaseline, compareScreenshot, baselineImagePath } from '../utils/visualRegression';

// GET /api/visual-baselines?projectId=xxx
app.get('/api/visual-baselines', requireAuth, (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  res.json(getAllBaselines(projectId));
});

// GET /api/visual-baselines/:id/image?type=baseline|actual|diff
app.get('/api/visual-baselines/:id/image', requireAuth, (req: Request, res: Response) => {
  const entry = getBaseline(req.params.id);
  if (!entry) { res.status(404).json({ error: 'Baseline not found' }); return; }
  const type  = (req.query.type as 'baseline' | 'actual' | 'diff') || 'baseline';
  const imgPath = baselineImagePath(entry.projectId, entry.id, type);
  if (!fs.existsSync(imgPath)) { res.status(404).json({ error: 'Image not found' }); return; }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(imgPath).pipe(res);
});

// POST /api/visual-baselines/:id/approve
app.post('/api/visual-baselines/:id/approve', requireAuth, requireEditor, (req: Request, res: Response) => {
  const ok = approveBaseline(req.params.id, req.session.username ?? 'unknown');
  if (!ok) { res.status(404).json({ error: 'Baseline not found or no actual image' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'VISUAL_BASELINE_APPROVED', resourceType: 'visual-baseline', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// DELETE /api/visual-baselines/:id
app.delete('/api/visual-baselines/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
  const ok = deleteBaseline(req.params.id);
  if (!ok) { res.status(404).json({ error: 'Baseline not found' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'VISUAL_BASELINE_DELETED', resourceType: 'visual-baseline', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// POST /api/visual-baselines/compare  { projectId, testName, locatorName, imageBase64, threshold }
// Called by the generated spec during test execution
app.post('/api/visual-baselines/compare', requireAuthOrApiKey, (req: Request, res: Response) => {
  const { projectId, testName, locatorName, imageBase64, threshold } = req.body as {
    projectId: string; testName: string; locatorName: string; imageBase64: string; threshold?: number;
  };
  if (!projectId || !testName || !locatorName || !imageBase64) {
    res.status(400).json({ error: 'projectId, testName, locatorName and imageBase64 required' }); return;
  }
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const result = compareScreenshot(projectId, testName, locatorName, buffer, threshold ?? 0.1);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Returns the global heal-log (all T2 heal events across all runs for a project)
app.get('/api/heal-log', requireAuth, (req: Request, res: Response) => {
  const { projectId, limit: limitStr } = req.query as { projectId?: string; limit?: string };
  const limitN = Math.min(parseInt(limitStr || '200', 10), 500);
  const logFile = path.resolve('data', 'healing-log.ndjson');
  if (!fs.existsSync(logFile)) { res.json([]); return; }

  const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
  let events: any[] = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch { /* skip */ }
  }
  if (projectId) events = events.filter(e => e.projectId === projectId);
  // Return most recent first
  events.reverse();
  res.json(events.slice(0, limitN));
});

// ── P5: Pre-Scan endpoints ────────────────────────────────────────────────────

// P5-C: POST /api/prescan — called by generated spec beforeAll block
// Receives live DOM candidates, scores every locator on that page against them,
// persists the health report to data/prescan/<runId>.json, also upserts PageModel.
app.post('/api/prescan', requireAuth, (req: Request, res: Response) => {
  const { projectId, pageKey, candidates, runId } = req.body as {
    projectId:  string;
    pageKey:    string;
    candidates: DomCandidate[];
    runId:      string;
  };
  if (!projectId || !pageKey || !runId) {
    res.status(400).json({ error: 'projectId, pageKey, and runId are required' }); return;
  }

  // Find all locators for this project+page that have a healingProfile
  const locators = readAll<Locator>(LOCATORS).filter(
    l => l.projectId === projectId &&
         l.pageKey   === pageKey   &&
         l.healingProfile != null,
  );

  const results = locators.map(loc => {
    const scored = (candidates?.length)
      ? scoreCandidates(loc.healingProfile!, candidates)
      : [];
    const best   = scored[0];
    const score  = best?.score ?? 0;
    const status: 'healthy' | 'degraded' | 'broken' =
      score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'broken';
    return {
      id:            loc.id,
      name:          loc.name,
      selector:      loc.selector,
      score,
      status,
      bestCandidate: best?.bestSelector ?? null,
    };
  });

  // Upsert PageModel — associate these locator IDs with the page
  if (locators.length) {
    try {
      upsertPageModel({
        projectId, pageKey,
        locatorIds:   locators.map(l => l.id),
        capturedFrom: 'prescan',
      });
    } catch (e) { logger.warn(`[prescan] PageModel upsert failed: ${e}`); }
  }

  // Persist health report
  const prescanDir = path.resolve('data', 'prescan');
  try {
    fs.mkdirSync(prescanDir, { recursive: true });
    const report = { runId, projectId, pageKey, scannedAt: new Date().toISOString(), locators: results };
    fs.writeFileSync(path.join(prescanDir, `${runId}.json`), JSON.stringify(report, null, 2));
    logger.info(`[prescan] runId=${runId} pageKey=${pageKey} scored=${results.length} locators`);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/prescan — UI polls for prescan results (keyed by runId)
app.get('/api/prescan', requireAuth, (req: Request, res: Response) => {
  const { runId } = req.query as { runId?: string };
  if (!runId) { res.json(null); return; }
  const file = path.resolve('data', 'prescan', `${runId}.json`);
  if (!fs.existsSync(file)) { res.json(null); return; }
  try { res.json(JSON.parse(fs.readFileSync(file, 'utf-8'))); }
  catch { res.json(null); }
});

// GET /api/page-models — list PageModels for a project (used by Locator Repo health view)
app.get('/api/page-models', requireAuth, (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  if (!projectId) { res.json([]); return; }
  try { res.json(listPageModels(projectId)); }
  catch { res.json([]); }
});

// P5-F: POST /api/prescan-trigger — Locator Repo "Validate Locators" button
// Spawns a minimal Playwright prescan spec for a given URL, returns scanId.
// UI polls GET /api/prescan?runId=<scanId> for results.
app.post('/api/prescan-trigger', requireAuth, (req: Request, res: Response) => {
  const { projectId, url, pageKey } = req.body as { projectId: string; url: string; pageKey?: string };
  if (!projectId || !url) { res.status(400).json({ error: 'projectId and url required' }); return; }

  const scanId  = uuidv4();
  const pk      = pageKey || (() => {
    try { const u = new URL(url); return u.pathname.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/$/, '') || '/'; }
    catch { return '/'; }
  })();
  const port    = PORT;

  // Write a minimal prescan spec to tests/codegen/
  const specDir  = path.resolve('tests', 'codegen');
  const specPath = path.join(specDir, `prescan-${scanId.slice(0,8)}.spec.ts`);
  const esc      = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const specContent = [
    `/** Auto-generated Prescan Spec — QA Agent Platform */`,
    `import { test } from '@playwright/test';`,
    ``,
    `// DOM scanner (identical to suite-run preamble)`,
    `function __qaDomScan() {`,
    `  const els = document.querySelectorAll('button,a,input,select,textarea,[role],[data-testid],[aria-label]');`,
    `  const out: any[] = [];`,
    `  els.forEach((el: any) => {`,
    `    const st = window.getComputedStyle(el);`,
    `    if (st.display === 'none' || st.visibility === 'hidden') return;`,
    `    out.push({`,
    `      tag: el.tagName.toLowerCase(),`,
    `      id: el.id || null,`,
    `      classes: Array.from(el.classList),`,
    `      text: (el.innerText || el.value || '').slice(0, 80).trim() || null,`,
    `      ariaLabel: el.getAttribute('aria-label') || null,`,
    `      role: el.getAttribute('role') || null,`,
    `      placeholder: el.getAttribute('placeholder') || null,`,
    `      testId: el.getAttribute('data-testid') || null,`,
    `      parentTag: el.parentElement?.tagName?.toLowerCase() || null,`,
    `      parentId: el.parentElement?.id || null,`,
    `      parentClass: el.parentElement?.className?.split(' ')[0] || null,`,
    `      domDepth: (() => { let d=0,n=el; while(n.parentElement){d++;n=n.parentElement;} return d; })(),`,
    `      siblingIndex: Array.from(el.parentElement?.children||[]).indexOf(el),`,
    `    });`,
    `  });`,
    `  return out;`,
    `}`,
    ``,
    `test.describe('Prescan', () => {`,
    `  test.beforeAll(async ({ browser }) => {`,
    `    const ctx  = await browser.newContext({ ignoreHTTPSErrors: true });`,
    `    const page = await ctx.newPage();`,
    `    try {`,
    `      await page.goto('${esc(url)}', { waitUntil: 'domcontentloaded', timeout: 20000 });`,
    `      await page.waitForTimeout(1500);`,
    `      const candidates = await page.evaluate(__qaDomScan).catch(() => []);`,
    `      await fetch('http://localhost:${port}/api/prescan', {`,
    `        method: 'POST',`,
    `        headers: { 'Content-Type': 'application/json' },`,
    `        body: JSON.stringify({ projectId: '${projectId}', pageKey: '${pk}', candidates, runId: '${scanId}' }),`,
    `      }).catch(() => {});`,
    `    } catch {}`,
    `    await ctx.close().catch(() => {});`,
    `  });`,
    `  test('prescan-noop', async () => { /* results sent in beforeAll */ });`,
    `});`,
    ``,
  ].join('\n');

  try {
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(specPath, specContent, 'utf-8');
  } catch (err) {
    res.status(500).json({ error: `Failed to write prescan spec: ${(err as Error).message}` }); return;
  }

  // Spawn Playwright headlessly
  const cp = require('child_process');
  const relSpec = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
  cp.spawn('npx', ['playwright', 'test', relSpec, '--project=chromium', '--reporter=list'], {
    cwd:   path.resolve('.'),
    shell: true,
    env:   { ...process.env, HEADLESS: 'true', APP_BASE_URL: url },
    stdio: 'ignore',
  });

  logger.info(`[prescan-trigger] scanId=${scanId} url=${url} pageKey=${pk}`);
  res.json({ scanId, pageKey: pk });
});

// ── T3 Similarity heal endpoint ───────────────────────────────────────────────
// Called by generated spec when T2 alternatives are exhausted.
// Receives the live DOM candidates, scores them against the stored HealingProfile,
// writes a HealingProposal, optionally updates the Locator Repo, and returns the best match.
app.post('/api/heal', requireAuth, (req: Request, res: Response) => {
  const { locatorId, profile, candidates, stepOrder, keyword, runId } = req.body as {
    locatorId:  string;
    profile:    any;
    candidates: DomCandidate[];
    stepOrder:  number;
    keyword:    string;
    runId:      string;
  };

  if (!locatorId || !profile || !candidates?.length) {
    res.status(400).json({ error: 'locatorId, profile and candidates are required' });
    return;
  }

  // Score all candidates
  const ranked = scoreCandidates(profile, candidates);
  if (!ranked.length || ranked[0].score < 1) {
    res.status(404).json({ error: 'No suitable candidate found' });
    return;
  }

  const best = ranked[0];

  // Look up the locator entry for project context
  const locEntry = readAll<Locator>(LOCATORS).find(l => l.id === locatorId);

  // Build HealingProposal record
  const proposalId = uuidv4();
  const autoApply  = best.score >= T3_AUTO_THRESHOLD;
  const proposal: HealingProposal = {
    id:              proposalId,
    projectId:       locEntry?.projectId ?? '',
    locatorId,
    locatorName:     locEntry?.name ?? locatorId,
    scriptId:        '',      // not available at this point — filled by future enhancement
    scriptTitle:     '',
    stepOrder,
    oldSelector:     locEntry?.selector ?? '',
    oldSelectorType: locEntry?.selectorType ?? 'css',
    newSelector:     best.bestSelector,
    newSelectorType: best.bestType,
    confidence:      best.score,
    healedAt:        new Date().toISOString(),
    status:          autoApply ? 'auto-applied' : 'pending-review',
  };

  // Persist proposal to data/proposals/<id>.json
  const proposalsDir = path.resolve('data', 'proposals');
  try {
    fs.mkdirSync(proposalsDir, { recursive: true });
    fs.writeFileSync(
      path.join(proposalsDir, `${proposalId}.json`),
      JSON.stringify(proposal, null, 2),
    );
  } catch (err) {
    logger.warn(`[heal] Failed to write proposal: ${(err as Error).message}`);
  }

  // Auto-update Locator Repo alternatives if score ≥ threshold
  if (autoApply && locEntry) {
    const newAlt = toLocatorAlternative(best);
    const existingAlts = locEntry.alternatives ?? [];
    // Avoid duplicates — replace if same selectorType exists with lower confidence
    const deduped = existingAlts.filter(a => a.selectorType !== newAlt.selectorType || a.confidence >= newAlt.confidence);
    if (!deduped.find(a => a.selector === newAlt.selector)) {
      deduped.unshift(newAlt); // prepend — highest confidence first
    }
    upsert(LOCATORS, {
      ...locEntry,
      alternatives: deduped.slice(0, 10), // keep top 10
      healingStats: {
        healCount:      (locEntry.healingStats?.healCount ?? 0) + 1,
        lastHealedAt:   new Date().toISOString(),
        lastHealedFrom: locEntry.selector,
        lastHealedBy:   'auto',
      },
      updatedAt: new Date().toISOString(),
    });
  }

  logger.info(`[heal] T3 locator=${locatorId} score=${best.score} auto=${autoApply} selector=${best.bestSelector}`);

  res.json({
    selector:     best.bestSelector,
    selectorType: best.bestType,
    score:        best.score,
    autoApplied:  autoApply,
    proposalId,
    breakdown:    best.breakdown,
  });
});

// ── Healing Proposals API ─────────────────────────────────────────────────────
app.get('/api/proposals', requireAuth, (req: Request, res: Response) => {
  const { projectId, status } = req.query as { projectId?: string; status?: string };
  const proposalsDir = path.resolve('data', 'proposals');
  if (!fs.existsSync(proposalsDir)) { res.json([]); return; }

  const proposals: HealingProposal[] = [];
  for (const f of fs.readdirSync(proposalsDir)) {
    if (!f.endsWith('.json')) continue;
    try { proposals.push(JSON.parse(fs.readFileSync(path.join(proposalsDir, f), 'utf-8'))); } catch { /* skip */ }
  }

  let result = proposals;
  if (projectId) result = result.filter(p => p.projectId === projectId);
  if (status)    result = result.filter(p => p.status === status);
  result.sort((a, b) => b.healedAt.localeCompare(a.healedAt));
  res.json(result);
});

// Approve or reject a healing proposal
app.post('/api/proposals/:id/review', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { action } = req.body as { action: 'approved' | 'rejected' };
  const user = req.session as any;

  if (!['approved', 'rejected'].includes(action)) {
    res.status(400).json({ error: 'action must be approved or rejected' }); return;
  }

  const filePath = path.resolve('data', 'proposals', `${id}.json`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'Proposal not found' }); return; }

  try {
    const proposal: HealingProposal = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    proposal.status     = action;
    proposal.reviewedBy = user?.username ?? 'unknown';
    proposal.reviewedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2));

    // On approve — update Locator Repo
    if (action === 'approved') {
      const locEntry = readAll<Locator>(LOCATORS).find(l => l.id === proposal.locatorId);
      if (locEntry) {
        const newAlt = { selector: proposal.newSelector, selectorType: proposal.newSelectorType, confidence: proposal.confidence };
        const existingAlts = locEntry.alternatives ?? [];
        const deduped = existingAlts.filter(a => a.selector !== newAlt.selector);
        deduped.unshift(newAlt);
        upsert(LOCATORS, {
          ...locEntry,
          alternatives: deduped.slice(0, 10),
          healingStats: {
            healCount:      (locEntry.healingStats?.healCount ?? 0) + 1,
            lastHealedAt:   proposal.reviewedAt!,
            lastHealedFrom: proposal.oldSelector,
            lastHealedBy:   'approved',
          },
          updatedAt: new Date().toISOString(),
        });
      }
    }

    res.json({ ok: true, proposal });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── P4: T4 Human Review Queue — heal-pending / heal-respond ──────────────────
// P4-B: GET /api/debug/heal-pending — returns pending T4 heal proposal for a running suite
// The generated spec writes pending-heal.json to test-results/<runId>/ then polls for
// heal-response.json. The UI polls this endpoint and shows the Proposal Card.
app.get('/api/debug/heal-pending', requireAuth, (req: Request, res: Response) => {
  const { runId } = req.query as { runId?: string };
  if (!runId) { res.json(null); return; }
  const healFile = path.join(config.paths.testResults, runId, 'pending-heal.json');
  if (!fs.existsSync(healFile)) { res.json(null); return; }
  try {
    res.json(JSON.parse(fs.readFileSync(healFile, 'utf-8')));
  } catch { res.json(null); }
});

// P4-D + P4-E: POST /api/debug/heal-respond — receives Approve/Reject from UI
// Writes heal-response.json so the spec exits its poll loop.
// On Approve: creates a HealingProposal (status: 'approved') + updates Locator Repo.
app.post('/api/debug/heal-respond', requireAuth, (req: Request, res: Response) => {
  const {
    runId, action, selector, selectorType,
    locatorId, stepOrder, keyword,
    oldSelector, oldSelectorType,
    score, projectId,
  } = req.body as {
    runId: string; action: 'approve' | 'reject';
    selector?: string; selectorType?: string;
    locatorId?: string; stepOrder?: number; keyword?: string;
    oldSelector?: string; oldSelectorType?: string;
    score?: number; projectId?: string;
  };

  if (!runId || !action) { res.status(400).json({ error: 'runId and action required' }); return; }

  // Write heal-response.json — spec polling this file will unblock immediately
  const responseFile = path.join(config.paths.testResults, runId, 'heal-response.json');
  const payload = { action, selector: selector || null, selectorType: selectorType || 'css' };
  try {
    fs.writeFileSync(responseFile, JSON.stringify(payload));
  } catch (err) {
    res.status(500).json({ error: `Failed to write heal response: ${(err as Error).message}` }); return;
  }

  // P4-E: On Approve — write HealingProposal + update Locator Repo
  if (action === 'approve' && selector && locatorId) {
    const user = (req.session as any)?.username ?? 'unknown';
    const now  = new Date().toISOString();

    // Create and persist an 'approved' HealingProposal
    const proposalId = uuidv4();
    const locEntry   = readAll<Locator>(LOCATORS).find(l => l.id === locatorId);
    const proposal: HealingProposal = {
      id:              proposalId,
      projectId:       projectId ?? locEntry?.projectId ?? '',
      locatorId,
      locatorName:     locEntry?.name ?? locatorId,
      scriptId:        '',          // not known at T4 time
      scriptTitle:     '',
      stepOrder:       stepOrder ?? 0,
      oldSelector:     oldSelector ?? locEntry?.selector ?? '',
      oldSelectorType: oldSelectorType ?? locEntry?.selectorType ?? 'css',
      newSelector:     selector,
      newSelectorType: selectorType ?? 'css',
      confidence:      score ?? 0,
      healedAt:        now,
      status:          'approved',
      reviewedBy:      user,
      reviewedAt:      now,
    };

    const proposalsDir = path.resolve('data', 'proposals');
    try {
      fs.mkdirSync(proposalsDir, { recursive: true });
      fs.writeFileSync(path.join(proposalsDir, `${proposalId}.json`), JSON.stringify(proposal, null, 2));
    } catch (err) {
      logger.warn(`[heal-respond] Failed to write proposal: ${(err as Error).message}`);
    }

    // Update Locator Repo — add new selector to top of alternatives list
    if (locEntry) {
      const newAlt = { selector, selectorType: selectorType ?? 'css', confidence: score ?? 0 };
      const existing = locEntry.alternatives ?? [];
      const deduped  = existing.filter((a: { selector: string }) => a.selector !== selector);
      deduped.unshift(newAlt);
      upsert(LOCATORS, {
        ...locEntry,
        alternatives: deduped.slice(0, 10),
        healingStats: {
          healCount:      (locEntry.healingStats?.healCount ?? 0) + 1,
          lastHealedAt:   now,
          lastHealedFrom: oldSelector ?? locEntry.selector,
          lastHealedBy:   'approved',
        },
      });
      logger.info(`[heal-respond] T4 approved locator=${locatorId} newSelector=${selector}`);
    }
  }

  res.json({ ok: true });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', appBaseURL: config.app.baseURL, port: PORT });
});

// Returns the environment label so the UI can display the DEV / PROD badge.
// No auth required — called before login for the badge to appear on the login page too.
app.get('/api/env', (_req: Request, res: Response) => {
  res.json({ label: config.ui.envLabel, port: PORT });
});

// ── Standalone Execution Report page ─────────────────────────────────────────
app.get('/execution-report', requireAuth, (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'execution-report.html'));
});

// ── Recorder Loader page ──────────────────────────────────────────────────────
// Two activation methods shown clearly:
//  Method A — Drag the "Activate Recorder" link to the bookmarks bar, open AUT,
//             click the bookmark. Works because clicking a saved javascript: bookmark
//             is allowed by Chrome (only PASTING into the address bar is blocked).
//  Method B — F12 Console: paste a short one-liner. Always works.
app.get('/recorder-loader', requireAuth, (req: Request, res: Response) => {
  const { token, url: autUrl } = req.query as { token?: string; url?: string };
  if (!token || !autUrl) { res.status(400).send('Missing token or url'); return; }
  const session = recorderSessions.get(token);
  if (!session || !session.active) { res.status(404).send('Recording session not found'); return; }

  const origin = `${req.protocol}://${req.get('host')}`;

  // Bookmarklet href — user drags this link to bookmarks bar, then clicks while on AUT
  const bookmarkletHref = `javascript:(function(){`
    + `window.__qa_recorder_origin=${JSON.stringify(origin)};`
    + `window.__qa_recorder=${JSON.stringify(token)};`
    + `var s=document.createElement('script');`
    + `s.src=${JSON.stringify(origin + '/recorder.js?' + Date.now())};`
    + `document.head.appendChild(s);`
    + `})();`;

  // Console one-liner — shorter, always works via F12
  const consoleLine = `window.__qa_recorder_origin=${JSON.stringify(origin)};window.__qa_recorder=${JSON.stringify(token)};var s=document.createElement('script');s.src='${origin}/recorder.js?t=${Date.now()}';document.head.appendChild(s);`;

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>QA Recorder — Ready</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:32px;display:flex;align-items:flex-start;justify-content:center}
    .card{background:#1e293b;border-radius:16px;padding:36px;max-width:640px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.4)}
    h2{margin:0 0 4px;font-size:20px;color:#a78bfa}
    .subtitle{color:#64748b;font-size:12px;margin-bottom:28px}
    .method{background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}
    .method-title{font-weight:700;font-size:14px;margin-bottom:4px;display:flex;align-items:center;gap:8px}
    .badge{background:#7c3aed;color:#fff;font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700}
    .badge-alt{background:#0369a1;color:#fff;font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700}
    .method-desc{color:#94a3b8;font-size:13px;margin-bottom:14px;line-height:1.6}
    .bm-link{display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700;font-size:14px;cursor:grab;border:2px dashed #a78bfa;margin-bottom:8px}
    .bm-link:hover{background:#6d28d9}
    .drag-hint{color:#64748b;font-size:11px;margin-top:4px}
    .console-box{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 12px;font-family:monospace;font-size:11px;color:#7dd3fc;word-break:break-all;position:relative;margin-bottom:8px}
    .copy-btn{position:absolute;top:8px;right:8px;background:#0369a1;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer}
    .copy-btn:hover{background:#0284c7}
    .steps-bar{background:#0f172a;border:1px solid #22c55e33;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:10px;margin-top:20px;font-size:13px}
    .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 1.5s infinite;flex-shrink:0}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .steps-count{margin-left:auto;color:#22c55e;font-weight:700}
    ol{margin:10px 0 0 0;padding-left:18px;color:#94a3b8;font-size:13px;line-height:1.8}
    ol li strong{color:#e2e8f0}
  </style>
</head>
<body>
<div class="card">
  <h2>&#9679; QA Recorder — Active</h2>
  <div class="subtitle">Token: ${escapeHtml(token.slice(0,8))}… &nbsp;|&nbsp; App: ${escapeHtml(autUrl)}</div>

  <!-- Step 1 -->
  <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:#94a3b8">STEP 1 &mdash; Open your app and log in</div>
  <div style="margin-bottom:24px;font-size:13px;color:#94a3b8">
    Open <a href="${escapeHtml(autUrl)}" target="_blank" style="color:#38bdf8">${escapeHtml(autUrl)}</a> in a new tab.
    Log in and navigate to the <strong style="color:#e2e8f0">starting page</strong> of your test flow.
  </div>

  <!-- Step 2 — Method A -->
  <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:#94a3b8">STEP 2 &mdash; Activate the recorder (choose one method)</div>

  <div class="method">
    <div class="method-title"><span class="badge">METHOD A</span> Drag to Bookmarks Bar <span style="font-size:11px;color:#64748b;font-weight:400">(recommended)</span></div>
    <div class="method-desc">
      Drag the purple button below to your <strong>bookmarks bar</strong>. Then switch to your app tab and <strong>click the bookmark</strong>.
      The recorder will activate silently in your app.
    </div>
    <a class="bm-link" href="${escapeHtml(bookmarkletHref)}" title="Drag me to your bookmarks bar">&#9654; Activate QA Recorder</a>
    <div class="drag-hint">&#8593; Drag this button to your bookmarks bar, then click it on your app tab</div>
  </div>

  <div class="method">
    <div class="method-title"><span class="badge-alt">METHOD B</span> Browser Console</div>
    <div class="method-desc">
      Switch to your app tab. Press <strong>F12</strong> &rarr; click the <strong>Console</strong> tab &rarr; paste the line below and press <strong>Enter</strong>.
    </div>
    <div class="console-box" id="console-code">${escapeHtml(consoleLine)}<button class="copy-btn" onclick="copyConsole()">Copy</button></div>
    <div class="drag-hint">You will see <code style="color:#a78bfa">[QA Recorder] Listeners attached. Recording…</code> in the console when active.</div>
  </div>

  <!-- Step 3 -->
  <div style="font-weight:600;font-size:13px;margin:20px 0 10px;color:#94a3b8">STEP 3 &mdash; Interact with your app</div>
  <div style="font-size:13px;color:#94a3b8;margin-bottom:8px">
    Click, fill fields, select dropdowns — every action streams live into the Test Script editor.
    Watch the counter below update as steps are captured.
  </div>

  <!-- Step 4 -->
  <div style="font-weight:600;font-size:13px;margin:20px 0 6px;color:#94a3b8">STEP 4 &mdash; Stop recording</div>
  <div style="font-size:13px;color:#94a3b8">Click <strong style="color:#e2e8f0">&#9646;&#9646; Stop Recording</strong> in the Test Script editor when done.</div>

  <div class="steps-bar">
    <div class="dot"></div>
    <span style="color:#94a3b8">Recording active</span>
    <span class="steps-count" id="step-count">0 steps captured</span>
  </div>
</div>

<script>
  function copyConsole() {
    const text = ${JSON.stringify(consoleLine)};
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }).finally !== undefined
      ? navigator.clipboard.writeText(text).finally(() => flash())
      : flash();
    flash();
    function flash() {
      const btn = document.querySelector('.copy-btn');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); }
    }
  }

  let lastCount = 0;
  setInterval(async () => {
    try {
      const r = await fetch('/api/recorder/status/${encodeURIComponent(token)}', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      if (d.stepCount !== lastCount) {
        lastCount = d.stepCount;
        const el = document.getElementById('step-count');
        if (el) el.textContent = d.stepCount + ' step' + (d.stepCount === 1 ? '' : 's') + ' captured';
      }
      if (!d.active) {
        const dot = document.querySelector('.dot');
        if (dot) { dot.style.background = '#ef4444'; dot.style.animation = 'none'; }
      }
    } catch {}
  }, 1500);
<\/script>
</body>
</html>`);
});

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Screenshot file serving ───────────────────────────────────────────────────
// Serves test-results/**/*.png|jpg so the report page can embed screenshots
app.get('/screenshots/*', requireAuth, (req: Request, res: Response) => {
  const rel = (req.params as any)[0] as string;
  // Restrict to this instance's test-results directory only
  const base = config.paths.testResults;
  const abs  = path.resolve(base, rel);
  if (!abs.startsWith(path.resolve(base))) { res.status(403).end(); return; }
  if (fs.existsSync(abs)) { res.sendFile(abs); return; }
  res.status(404).end();
});

// ── Test artifact serving (video + trace) ─────────────────────────────────────
// Serves test-results/**/*.webm (video) and *.zip (trace) for the report page.
// Video:  opened in a new browser tab via target="_blank" — browser plays it natively.
// Trace:  downloaded as a ZIP via the Content-Disposition header.
app.get('/test-artifacts/*', requireAuth, (req: Request, res: Response) => {
  const rel  = (req.params as any)[0] as string;
  const base = config.paths.testResults;
  const abs  = path.resolve(base, rel);
  // Path traversal guard — must stay inside test-results
  if (!abs.startsWith(path.resolve(base))) { res.status(403).end(); return; }
  if (!fs.existsSync(abs)) { res.status(404).end(); return; }
  if (abs.endsWith('.zip')) {
    const filename = path.basename(abs);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/zip');
  } else if (abs.endsWith('.webm')) {
    res.setHeader('Content-Type', 'video/webm');
  }
  res.sendFile(abs);
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

// ── Admin: API Key Management ─────────────────────────────────────────────────

app.get('/api/admin/apikeys', requireAdmin, (_req: Request, res: Response) => {
  const keys = readAll<ApiKey>(APIKEYS).map(k => ({ ...k, keyHash: undefined }));
  res.json(keys);
});

app.post('/api/admin/apikeys', requireAdmin, (req: Request, res: Response) => {
  const { name, projectId, expiresAt } = req.body as any;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const key: ApiKey = {
    id:         uuidv4(),
    name:       sanitizeInput(name),
    keyHash,
    prefix:     rawKey.slice(0, 8),
    projectId:  projectId ?? null,
    createdBy:  req.session.username ?? 'admin',
    createdAt:  new Date().toISOString(),
    lastUsedAt: null,
    expiresAt:  expiresAt ?? null,
  };
  upsert(APIKEYS, key);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'APIKEY_CREATED', resourceType: 'apikey', resourceId: key.id, details: key.name, ip: req.ip ?? null });
  // Return raw key ONCE — never stored
  res.json({ success: true, key: rawKey, prefix: key.prefix, id: key.id });
});

app.delete('/api/admin/apikeys/:id', requireAdmin, (req: Request, res: Response) => {
  const removed = remove(APIKEYS, req.params.id);
  if (!removed) { res.status(404).json({ error: 'API key not found' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'APIKEY_DELETED', resourceType: 'apikey', resourceId: req.params.id, details: null, ip: req.ip ?? null });
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

// ── Test Files — upload / delete / list (project-scoped) ─────────────────────

// POST /api/test-files/upload?projectId=xxx  — upload file, return server path
app.post('/api/test-files/upload', testFileUpload.single('file'), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file received or file type not allowed' }); return; }
  const projectId = (req.query.projectId as string || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const serverPath = path.join('test-files', projectId, req.file.filename).replace(/\\/g, '/');
  res.json({ filename: req.file.filename, serverPath });
});

// GET /api/test-files?projectId=xxx  — list uploaded files for project
app.get('/api/test-files', (req: Request, res: Response) => {
  const projectId = ((req.query.projectId as string) || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!projectId) { res.json([]); return; }
  const dir = path.join(TEST_FILES_DIR, projectId);
  if (!fs.existsSync(dir)) { res.json([]); return; }
  const files = fs.readdirSync(dir).map(name => ({
    filename: name,
    serverPath: `test-files/${projectId}/${name}`,
    sizeBytes: fs.statSync(path.join(dir, name)).size,
  }));
  res.json(files);
});

// DELETE /api/test-files/:projectId/:filename  — remove a file from server
app.delete('/api/test-files/:projectId/:filename', (req: Request, res: Response) => {
  const projectId = req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename  = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath  = path.join(TEST_FILES_DIR, projectId, filename);
  if (!filePath.startsWith(TEST_FILES_DIR)) { res.status(403).json({ error: 'Forbidden' }); return; }
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// ── Admin: Settings ───────────────────────────────────────────────────────────

app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const rows = readAll<AppSettings & { id: string }>(SETTINGS);
  const s = rows[0] ?? { id: 'global', ...DEFAULT_SETTINGS };
  // Never expose the raw API key — just tell the UI whether one is set
  const { nlApiKey, anthropicApiKey, ...safe } = s as any;
  const keyIsSet = !!((nlApiKey || anthropicApiKey || '').trim());
  res.json({ ...safe, nlApiKeySet: keyIsSet });
});

app.put('/api/admin/settings', requireAdmin, (req: Request, res: Response) => {
  const current = readAll<AppSettings & { id: string }>(SETTINGS)[0] ?? { id: 'global', ...DEFAULT_SETTINGS };
  // Merge notifications sub-object carefully so partial updates don't wipe fields
  const notifications: NotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(current.notifications ?? {}),
    ...(req.body.notifications ?? {}),
  };
  // Preserve secrets — only overwrite if non-empty value sent
  const incomingKey = (req.body.nlApiKey || req.body.anthropicApiKey || '').trim();
  const nlApiKey    = incomingKey || (current as any).nlApiKey || (current as any).anthropicApiKey || '';
  const { nlApiKey: _d1, anthropicApiKey: _d2, ...restBody } = req.body as any;
  const updated = { ...current, ...restBody, notifications, nlApiKey, id: 'global' };
  writeAll(SETTINGS, [updated]);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SETTINGS_UPDATED', resourceType: 'settings', resourceId: 'global', details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// POST /api/admin/settings/test-notification — send a test notification to verify config
app.post('/api/admin/settings/test-notification', requireAdmin, async (req: Request, res: Response) => {
  try {
    const settingsRow = readAll<AppSettings & { id: string }>(SETTINGS)[0];
    const notifCfg   = settingsRow?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
    const platformUrl = `${req.protocol}://${req.get('host')}`;
    const errors = await sendTestNotification(notifCfg, platformUrl);
    const hasError = Object.values(errors).some(Boolean);
    if (hasError) {
      res.json({ success: false, errors });
    } else {
      res.json({ success: true });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
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
  const all = readAll<Locator>(LOCATORS).filter(l => !l.draft); // exclude unfinished drafts
  if (projectId) {
    res.json(all.filter(l => l.projectId === projectId));
  } else {
    res.json(all);
  }
});

app.post('/api/locators', requireEditor, (req: Request, res: Response) => {
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

app.put('/api/locators/:id', requireEditor, (req: Request, res: Response) => {
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

app.delete('/api/locators/:id', requireEditor, (req: Request, res: Response) => {
  const removed = remove(LOCATORS, req.params.id);
  if (!removed) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ success: true });
});

// ── UI Recorder endpoints ─────────────────────────────────────────────────────
//
// Flow:
//   1. Editor POSTs /api/recorder/start → gets token + recorder URL
//   2. Editor opens AUT tab at recorderUrl (includes ?__qa_recorder=<token>)
//   3. Server serves recorder.js (with __qa_recorder_origin injected) at /recorder.js
//   4. recorder.js POSTs actions to /api/recorder/step
//   5. Server resolves locator, parses step, pushes via SSE to /api/recorder/stream/:token
//   6. Editor appends live steps as user interacts with AUT
//   7. Editor POSTs /api/recorder/stop → session marked inactive

// POST /api/recorder/start — create a new recording session
app.post('/api/recorder/start', requireAuth, requireFeature('recorder'), (req: Request, res: Response) => {
  const { projectId, autUrl } = req.body as { projectId?: string; autUrl?: string };
  if (!projectId) { res.status(400).json({ error: 'projectId is required' }); return; }
  if (!autUrl)    { res.status(400).json({ error: 'autUrl is required' });    return; }

  // [Gap 2] One active recording per project — prevent concurrent sessions
  for (const [, s] of recorderSessions) {
    if (s.projectId === projectId && s.active) {
      const sinceMin = Math.floor((Date.now() - s.createdAt) / 60000);
      res.status(409).json({
        error:       'Already recording',
        recordedBy:  s.createdBy,
        since:       new Date(s.createdAt).toISOString(),
        sinceMin,
        message:     `${s.createdBy} started a recording ${sinceMin}m ago. Stop that session first.`,
      });
      return;
    }
  }

  const token: string = uuidv4();
  const session: RecorderSession = {
    token,
    projectId,
    createdBy:    req.session.username!,
    active:       true,
    steps:        [],
    stepCount:    0,
    lastActivity: Date.now(),
    createdAt:    Date.now(),
    sseClients:   new Set(),
  };
  recorderSessions.set(token, session);

  // [Gap 3] Audit: recorder started
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_STARTED', resourceType: 'recorder', resourceId: token.slice(0, 8), details: `project=${projectId} url=${autUrl}`, ip: req.ip ?? null });

  // Build the AUT URL with recorder token injected
  const separator   = autUrl.includes('?') ? '&' : '?';
  const recorderUrl = `${autUrl}${separator}__qa_recorder=${token}`;

  logger.info(`[recorder] Session started: ${token.slice(0,8)} project=${projectId} by=${req.session.username}`);
  res.json({ token, recorderUrl });
});

// GET /api/recorder/stream/:token — SSE push channel for live step delivery to editor
app.get('/api/recorder/stream/:token', requireAuth, (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const session = recorderSessions.get(token);
  if (!session) { res.status(404).json({ error: 'session not found' }); return; }

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',    // disable nginx buffering
  });
  res.write(`event: recorder:connected\ndata: ${JSON.stringify({ token: token.slice(0,8), stepCount: session.stepCount })}\n\n`);

  session.sseClients.add(res);
  logger.info(`[recorder] SSE client connected (token ${token.slice(0,8)}) — ${session.sseClients.size} client(s)`);

  req.on('close', () => {
    session.sseClients.delete(res);
    logger.info(`[recorder] SSE client disconnected (token ${token.slice(0,8)}) — ${session.sseClients.size} client(s)`);
  });
});

// GET /api/recorder/active?projectId=xxx — returns active session token for a project
// Used by the extension popup to find the session the editor already created,
// so both use the same token and steps appear in the editor.
app.get('/api/recorder/active', requireAuth, (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }
  for (const [token, session] of recorderSessions) {
    if (session.projectId === projectId && session.active) {
      res.json({ token, stepCount: session.stepCount });
      return;
    }
  }
  res.status(404).json({ error: 'no active session' });
});

// GET /api/recorder/status/:token — step count + active flag (polled by loader page)
app.get('/api/recorder/status/:token', requireAuth, (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const session = recorderSessions.get(token);
  if (!session) { res.status(404).json({ error: 'session not found' }); return; }
  res.json({ active: session.active, stepCount: session.stepCount });
});

// POST /api/recorder/stop — stop recording session
app.post('/api/recorder/stop', requireAuth, (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: 'token is required' }); return; }
  const session = recorderSessions.get(token);
  if (!session) { res.status(404).json({ error: 'session not found' }); return; }

  session.active = false;
  recorderSsePush(token, 'recorder:stopped', { stepCount: session.stepCount });
  session.sseClients.forEach(res => { try { res.end(); } catch {} });
  session.sseClients.clear();

  // [Gap 3] Audit: recorder stopped
  const durationSecs = Math.floor((Date.now() - session.createdAt) / 1000);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_STOPPED', resourceType: 'recorder', resourceId: token.slice(0, 8), details: `steps=${session.stepCount} duration=${durationSecs}s project=${session.projectId}`, ip: req.ip ?? null });

  logger.info(`[recorder] Session stopped: ${token.slice(0,8)} — ${session.stepCount} steps captured`);

  // P5-B: Upsert PageModel — group captured locatorIds by pageKey so pre-scan knows which
  // locators belong to each page. Runs asynchronously after response to avoid blocking.
  setImmediate(() => {
    const locIdsByPage = new Map<string, Set<string>>();
    for (const step of session.steps) {
      if (!step.locatorId) continue;
      const loc = readAll<Locator>(LOCATORS).find(l => l.id === step.locatorId);
      const pk  = loc?.pageKey;
      if (!pk) continue;
      if (!locIdsByPage.has(pk)) locIdsByPage.set(pk, new Set());
      locIdsByPage.get(pk)!.add(step.locatorId);
    }
    for (const [pk, ids] of locIdsByPage) {
      try {
        upsertPageModel({ projectId: session.projectId, pageKey: pk, locatorIds: [...ids], capturedFrom: 'recorder' });
        logger.info(`[recorder] PageModel upserted: project=${session.projectId} pageKey=${pk} locators=${ids.size}`);
      } catch (e) { logger.warn(`[recorder] PageModel upsert failed: ${e}`); }
    }
  });

  res.json({ success: true, stepCount: session.stepCount, steps: session.steps });
});

// POST /api/recorder/heartbeat — keeps session alive from recorder.js (every 5 min)
// Token-authenticated, cross-origin (called from AUT tab). Resets lastActivity.
app.post('/api/recorder/heartbeat', (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  const session = token ? recorderSessions.get(token) : undefined;
  if (!session || !session.active) { res.status(404).json({ ok: false }); return; }
  session.lastActivity = Date.now();
  res.json({ ok: true });
});

// POST /api/recorder/analyse — detect repeated step-sequence patterns in recorded steps
// Compares the newly-recorded steps against all existing scripts in the same project.
// Returns patterns (sequences of ≥2 steps) that appear in at least 1 existing script,
// suggesting them as candidates for extraction into a CommonFunction.
app.post('/api/recorder/analyse', requireAuth, (req: Request, res: Response) => {
  const { projectId, steps } = req.body as { projectId?: string; steps?: any[] };
  if (!projectId || !Array.isArray(steps) || steps.length < 2) {
    res.json({ patterns: [] });
    return;
  }

  // Minimum consecutive steps to qualify as a reusable pattern.
  // 2 is intentionally low — username+password fill is already a clear login pattern.
  const MIN_LEN = 2;

  // Load existing scripts + functions for this project
  const allScripts   = readAll<TestScript>(SCRIPTS).filter(s => s.projectId === projectId);
  const allFunctions = readAll<CommonFunction>(FUNCTIONS).filter(f => f.projectId === projectId);

  /**
   * Normalised locator key — prefers the human-assigned locatorName over the raw
   * CSS/XPath selector because scripts built manually often store the same element
   * under different selector strings but share a consistent locatorName.
   *
   * Normalisation rules:
   *   1. Use locatorName if non-empty, else fall back to locator / detail
   *   2. Lowercase everything
   *   3. Strip a leading `#` (CSS id) or `.` (CSS class) — `#username` → `username`
   *      so scripts that store the selector differently still fingerprint identically
   */
  function normalizeLocKey(step: any): string {
    // CommonFunction steps saved via the editor use `selector`; script steps use `locator`
    const raw = (step.locatorName || step.detail || step.locator || step.selector || '').trim();
    return raw.toLowerCase().replace(/^[#.]/, '');
  }

  function stepFp(step: any): string {
    return `${(step.keyword ?? '').toUpperCase()}|${normalizeLocKey(step)}`;
  }

  // Pre-compute normalised fingerprint arrays for all existing scripts
  const scriptFpArrays = allScripts.map(s => (s.steps || []).map(stepFp));

  // Normalised fingerprints for the newly-recorded steps
  const recFps = steps.map(stepFp);
  const n = recFps.length;

  const patterns: Array<{
    startIndex:    number;
    endIndex:      number;
    steps:         any[];
    matchCount:    number;
    suggestedName: string;
    duplicateFnId?: string;
  }> = [];

  const used = new Set<number>(); // indices already claimed by a longer pattern

  // Greedy longest-first scan — pick the longest matching subsequence at each position
  for (let len = n; len >= MIN_LEN; len--) {
    for (let start = 0; start <= n - len; start++) {
      // Skip if any step in this window already belongs to a detected pattern
      let overlaps = false;
      for (let i = start; i < start + len; i++) {
        if (used.has(i)) { overlaps = true; break; }
      }
      if (overlaps) continue;

      const candidateFp = recFps.slice(start, start + len).join('::');

      // Count how many existing scripts contain this normalised subsequence
      let matchCount = 0;
      for (const fpArr of scriptFpArrays) {
        for (let si = 0; si <= fpArr.length - len; si++) {
          if (fpArr.slice(si, si + len).join('::') === candidateFp) {
            matchCount++;
            break; // one match per script is enough
          }
        }
      }

      if (matchCount === 0) continue; // not reused elsewhere — skip

      // Claim these indices so shorter overlapping patterns are not double-reported
      for (let i = start; i < start + len; i++) used.add(i);

      const candidateSteps = steps.slice(start, start + len);

      // Check if an equivalent CommonFunction already exists.
      // Match cases (all use normalised fingerprints):
      //   1. Exact match — same steps in same order
      //   2. Candidate is contained within existing fn  (existing fn is a superset)
      //   3. Existing fn is contained within candidate  (candidate is a superset — new recording captured more context)
      const candidateFpArr = recFps.slice(start, start + len);
      const dupFn = allFunctions.find(f => {
        const fnFpArr: string[] = (f.steps || []).map((s: any) => stepFp(s));
        const fnFp = fnFpArr.join('::');
        if (fnFp === candidateFp) return true; // exact match

        // Candidate contained inside existing fn
        if (fnFpArr.length >= len) {
          for (let fi = 0; fi <= fnFpArr.length - len; fi++) {
            if (fnFpArr.slice(fi, fi + len).join('::') === candidateFp) return true;
          }
        }
        // Existing fn contained inside candidate
        const fLen = fnFpArr.length;
        if (fLen >= MIN_LEN && fLen <= len) {
          const fnFpJoined = fnFp; // already joined
          for (let ci = 0; ci <= len - fLen; ci++) {
            if (candidateFpArr.slice(ci, ci + fLen).join('::') === fnFpJoined) return true;
          }
        }
        return false;
      });

      // Build a human-readable suggested name from the first step's locatorName / keyword
      const firstStep = candidateSteps[0];
      const lastStep  = candidateSteps[candidateSteps.length - 1];
      const firstName = firstStep.locatorName || firstStep.keyword || '';
      const lastName  = lastStep.locatorName  || lastStep.keyword  || '';
      const autoName  = firstName === lastName
        ? firstName
        : `${firstName} to ${lastName}`;
      const suggestedName = dupFn
        ? dupFn.name
        : autoName.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

      patterns.push({
        startIndex:    start,
        endIndex:      start + len - 1,
        steps:         candidateSteps,
        matchCount,
        suggestedName,
        duplicateFnId: dupFn?.id,
      });
    }
  }

  res.json({ patterns });
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

app.post('/api/functions', requireEditor, (req: Request, res: Response) => {
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

app.put('/api/functions/:id', requireEditor, (req: Request, res: Response) => {
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

app.delete('/api/functions/:id', requireEditor, (req: Request, res: Response) => {
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
  // Mask sensitive values in list response — reveal endpoint used for actual value
  return res.json(all.map(cdForResponse));
});

app.post('/api/common-data', requireAuth, requireEditor, (req: Request, res: Response) => {
  const { projectId, dataName, value, environment, sensitive } = req.body as Partial<CommonData> & { sensitive?: boolean };
  if (!projectId || !dataName || !environment) {
    res.status(400).json({ error: 'projectId, dataName and environment are required' }); return;
  }
  const existing = readAll<CommonData>(COMMON_DATA);
  if (existing.find(d => d.projectId === projectId && d.dataName === dataName && d.environment === environment)) {
    res.status(409).json({ error: `"${dataName}" already exists for ${environment}` }); return;
  }
  const isSensitive = sensitive === true;
  const storedValue = isSensitive ? encryptValue(value ?? '') : (value ?? '');
  const now    = new Date().toISOString();
  const record: CommonData = {
    id: uuidv4(), projectId, dataName: sanitizeInput(dataName),
    value: storedValue, environment, sensitive: isSensitive,
    createdBy: req.session.username!, createdAt: now, updatedAt: now,
  };
  upsert(COMMON_DATA, record);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_CREATED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
  res.json({ success: true, id: record.id });
});

app.put('/api/common-data/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
  const record = findById<CommonData>(COMMON_DATA, req.params.id);
  if (!record) { res.status(404).json({ error: 'Not found' }); return; }
  const { dataName, value, environment, sensitive } = req.body as Partial<CommonData> & { sensitive?: boolean };
  if (dataName)    record.dataName    = sanitizeInput(dataName);
  if (environment) record.environment = environment;
  if (sensitive !== undefined) record.sensitive = sensitive;
  if (value !== undefined) {
    // Only re-encrypt if the user sent a real value (not the masked placeholder)
    if (value !== '••••••••') {
      record.value = record.sensitive ? encryptValue(value) : value;
    }
  }
  record.updatedAt = new Date().toISOString();
  upsert(COMMON_DATA, record);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_UPDATED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
  res.json({ success: true });
});

// GET /api/common-data/:id/reveal — returns decrypted value for editing (auth required)
app.get('/api/common-data/:id/reveal', requireAuth, (req: Request, res: Response) => {
  const record = findById<CommonData>(COMMON_DATA, req.params.id);
  if (!record) { res.status(404).json({ error: 'Not found' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'COMMON_DATA_REVEALED', resourceType: 'common_data', resourceId: record.id, details: record.dataName, ip: req.ip ?? null });
  res.json({ value: record.sensitive ? decryptValue(record.value) : record.value });
});

app.delete('/api/common-data/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
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
    // Decrypt sensitive values at resolve time (used by codegen)
    .forEach(d => { dataMap[d.dataName] = d.sensitive ? decryptValue(d.value) : d.value; });
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

// ── Dedup + finalise draft locators at Save Script time ──────────────────────
// For each step that references a draft locator:
//   1. Look for an existing FINALIZED locator with the same selector → use it
//   2. Look for an existing FINALIZED locator with the same name → use it
//   3. If no match → promote this draft to finalized (remove draft flag)
// Draft locators not referenced by any finalized script get cleaned up here.
function finaliseDraftLocators(steps: ScriptStep[], projectId: string): ScriptStep[] {
  const allLocs  = readAll<Locator>(LOCATORS);
  const finalized = allLocs.filter(l => l.projectId === projectId && !l.draft);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  return steps.map(step => {
    if (!step.locatorId) return step;
    const draft = allLocs.find(l => l.id === step.locatorId && l.draft);
    if (!draft) return step; // already finalized — leave as-is

    // 1. Match by selector
    const bySelector = finalized.find(l => norm(l.selector) === norm(draft.selector));
    if (bySelector) {
      // Delete the draft, point step to existing finalized locator
      writeAll(LOCATORS, allLocs.filter(l => l.id !== draft.id));
      return { ...step, locatorId: bySelector.id, locatorName: bySelector.name, locator: bySelector.selector, locatorType: bySelector.selectorType } as ScriptStep;
    }

    // 2. Match by name (case-insensitive)
    const byName = finalized.find(l => norm(l.name) === norm(draft.name));
    if (byName) {
      writeAll(LOCATORS, allLocs.filter(l => l.id !== draft.id));
      return { ...step, locatorId: byName.id, locatorName: byName.name, locator: byName.selector, locatorType: byName.selectorType } as ScriptStep;
    }

    // 3. Promote draft → finalized
    draft.draft = false;
    draft.updatedAt = new Date().toISOString();
    upsert(LOCATORS, draft);
    finalized.push(draft); // add to finalized set for subsequent steps in same save
    return step;
  });
}

app.post('/api/scripts', requireEditor, (req: Request, res: Response) => {
  const body = req.body as Partial<TestScript> & { recorderToken?: string };
  if (!body.projectId || !body.title) { res.status(400).json({ error: 'projectId and title required' }); return; }

  // Auto-generate TC ID from project prefix + counter
  const proj = findById<Project>(PROJECTS, body.projectId);
  if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!proj.tcIdCounter) proj.tcIdCounter = 1;
  const tcId = `${proj.tcIdPrefix || 'TC'}-${String(proj.tcIdCounter).padStart(2, '0')}`;
  proj.tcIdCounter += 1;
  upsert(PROJECTS, proj);

  // Dedup + finalise draft locators before persisting
  const resolvedSteps = finaliseDraftLocators(body.steps ?? [], body.projectId);

  const now = new Date().toISOString();
  const script: TestScript = {
    id: uuidv4(), projectId: body.projectId,
    tcId,
    component:   sanitizeInput(body.component ?? ''),
    title:       sanitizeInput(body.title),
    description: sanitizeInput(body.description ?? ''), tags: body.tags ?? [],
    priority: body.priority ?? 'medium', steps: resolvedSteps,
    createdBy: req.session.username!, createdAt: now,
    modifiedBy: req.session.username!, modifiedAt: now,
  };
  upsert(SCRIPTS, script);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_CREATED', resourceType: 'script', resourceId: script.id, details: `${tcId} ${script.title}`, ip: req.ip ?? null });
  // [Gap 3] If saved from recorder session, log RECORDER_SAVED
  if (body.recorderToken) {
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_SAVED', resourceType: 'script', resourceId: script.id, details: `${tcId} ${script.title} steps=${resolvedSteps.length} token=${String(body.recorderToken).slice(0,8)}`, ip: req.ip ?? null });
  }
  res.json({ success: true, id: script.id, tcId });
});

app.put('/api/scripts/:id', requireEditor, (req: Request, res: Response) => {
  const script = findById<TestScript>(SCRIPTS, req.params.id);
  if (!script) { res.status(404).json({ error: 'Not found' }); return; }
  const body = req.body as Partial<TestScript> & { recorderToken?: string };
  if (body.title)                      script.title       = sanitizeInput(body.title);
  if (body.description !== undefined)  script.description = sanitizeInput(body.description);
  if (body.component   !== undefined)  script.component   = sanitizeInput(body.component);
  if (body.tags)                       script.tags        = body.tags;
  if (body.priority)                   script.priority    = body.priority;
  if (body.steps)                      script.steps       = finaliseDraftLocators(body.steps, script.projectId ?? '');
  script.modifiedBy = req.session.username!;
  script.modifiedAt = new Date().toISOString();
  upsert(SCRIPTS, script);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_UPDATED', resourceType: 'script', resourceId: script.id, details: script.title, ip: req.ip ?? null });
  // [Gap 3] If saved from recorder session, log RECORDER_SAVED
  if (body.recorderToken) {
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RECORDER_SAVED', resourceType: 'script', resourceId: script.id, details: `${script.title} steps=${script.steps.length} token=${String(body.recorderToken).slice(0,8)}`, ip: req.ip ?? null });
  }
  res.json({ success: true });
});

app.delete('/api/scripts/:id', requireEditor, (req: Request, res: Response) => {
  remove(SCRIPTS, req.params.id);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DELETED', resourceType: 'script', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// ── Bulk Script Actions ───────────────────────────────────────────────────────

// DELETE /api/scripts/bulk  { ids: string[] }
app.delete('/api/scripts/bulk', requireAuth, requireEditor, (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids array required' }); return; }
  const deleted: string[] = [];
  for (const id of ids) {
    const existing = findById<TestScript>(SCRIPTS, id);
    if (!existing) continue;
    remove(SCRIPTS, id);
    deleted.push(id);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DELETED', resourceType: 'script', resourceId: id, details: `bulk delete`, ip: req.ip ?? null });
  }
  res.json({ deleted, count: deleted.length });
});

// PATCH /api/scripts/bulk  { ids: string[], patch: { priority?, tags?, component? } }
app.patch('/api/scripts/bulk', requireAuth, requireEditor, (req: Request, res: Response) => {
  const { ids, patch } = req.body as { ids?: string[]; patch?: Partial<Pick<TestScript, 'priority' | 'tags' | 'component'>> };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids array required' }); return; }
  if (!patch || Object.keys(patch).length === 0) { res.status(400).json({ error: 'patch object required' }); return; }
  const updated: string[] = [];
  const all = readAll<TestScript>(SCRIPTS);
  for (const script of all) {
    if (!ids.includes(script.id)) continue;
    if (patch.priority)  script.priority  = patch.priority;
    if (patch.tags)      script.tags      = patch.tags;
    if (patch.component !== undefined) script.component = patch.component;
    script.modifiedBy = req.session.username ?? 'unknown';
    script.modifiedAt = new Date().toISOString();
    updated.push(script.id);
  }
  writeAll(SCRIPTS, all);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPTS_BULK_UPDATED', resourceType: 'script', resourceId: null, details: `${updated.length} scripts patched`, ip: req.ip ?? null });
  res.json({ updated, count: updated.length });
});

// POST /api/scripts/bulk-suite  { ids: string[], suiteId: string }
app.post('/api/scripts/bulk-suite', requireAuth, requireEditor, (req: Request, res: Response) => {
  const { ids, suiteId } = req.body as { ids?: string[]; suiteId?: string };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids array required' }); return; }
  if (!suiteId) { res.status(400).json({ error: 'suiteId required' }); return; }
  const allSuites = readAll<TestSuite>(SUITES);
  const suite = allSuites.find(s => s.id === suiteId);
  if (!suite) { res.status(404).json({ error: 'Suite not found' }); return; }
  const existing = new Set(suite.scriptIds);
  const added: string[] = [];
  for (const id of ids) {
    if (!existing.has(id)) { suite.scriptIds.push(id); added.push(id); }
  }
  writeAll(SUITES, allSuites);
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPTS_BULK_ADDED_TO_SUITE', resourceType: 'suite', resourceId: suiteId, details: `${added.length} scripts added`, ip: req.ip ?? null });
  res.json({ added, count: added.length, suiteId });
});

// ── Test Suites (project-scoped) ──────────────────────────────────────────────

app.get('/api/suites/all', requireAdmin, (_req: Request, res: Response) => {
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
  // Embed full script objects
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
    retries:  ([0,1,2].includes(body.retries as number) ? body.retries : 0) as 0|1|2,
    browsers: Array.isArray(body.browsers) ? body.browsers.filter((b): b is BrowserName => VALID_BROWSERS.includes(b as BrowserName)) : ['chromium'],
    beforeEachSteps: Array.isArray(body.beforeEachSteps) ? body.beforeEachSteps : [],
    afterEachSteps:  Array.isArray(body.afterEachSteps)  ? body.afterEachSteps  : [],
    fastMode:        !!body.fastMode,
    fastModeSteps:   Array.isArray(body.fastModeSteps)   ? body.fastModeSteps   : [],
    overlayHandlers: Array.isArray(body.overlayHandlers) ? body.overlayHandlers : [],
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
  if (body.name)                    suite.name          = sanitizeInput(body.name);
  if (body.description !== undefined) suite.description = sanitizeInput(body.description);
  if (body.scriptIds)               suite.scriptIds     = body.scriptIds;
  if (body.environmentId !== undefined) suite.environmentId = body.environmentId;
  if (body.retries !== undefined) suite.retries = ([0,1,2].includes(body.retries as number) ? body.retries : 0) as 0|1|2;
  if (Array.isArray(body.browsers)) { const VB: BrowserName[] = ['chromium','firefox','webkit']; suite.browsers = body.browsers.filter((b): b is BrowserName => VB.includes(b as BrowserName)); if (!suite.browsers.length) suite.browsers = ['chromium']; }
  if (Array.isArray(body.beforeEachSteps)) suite.beforeEachSteps = body.beforeEachSteps;
  if (Array.isArray(body.afterEachSteps))  suite.afterEachSteps  = body.afterEachSteps;
  if (body.fastMode !== undefined)          suite.fastMode        = !!body.fastMode;
  if (Array.isArray(body.fastModeSteps))    suite.fastModeSteps   = body.fastModeSteps;
  if (Array.isArray(body.overlayHandlers)) suite.overlayHandlers = body.overlayHandlers;
  suite.modifiedBy = req.session.username!;
  suite.modifiedAt = new Date().toISOString();
  upsert(SUITES, suite);
  res.json({ success: true });
});

app.delete('/api/suites/:id', requireEditor, (req: Request, res: Response) => {
  remove(SUITES, req.params.id);
  res.json({ success: true });
});

// ── Test Suite Execution ──────────────────────────────────────────────────────

app.post('/api/suites/:id/run', requireAuthOrApiKey, requireEditor, async (req: Request, res: Response) => {
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
      port:          PORT,
      beforeEachSteps: suite.beforeEachSteps ?? [],
      afterEachSteps:  suite.afterEachSteps  ?? [],
      fastMode:        suite.fastMode        ?? false,
      fastModeSteps:   suite.fastModeSteps   ?? [],
      overlayHandlers: suite.overlayHandlers ?? [],
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
    browsers:        suite.browsers ?? ['chromium'],
  };
  runs.set(runId, record);

  const queuePos = activeRunCount >= MAX_CONCURRENT_RUNS ? runQueue.length + 1 : 0;

  // Enqueue — starts immediately if slot available, otherwise waits
  enqueueRun(() => spawnRunWithSpec(record, specPath, req.body.headed !== false, suite.retries ?? 0, suite.browsers ?? ['chromium']));

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

// GET /api/debug/stream/:sessionId — SSE push channel (replaces WS for screenshot delivery)
// Pushes step data + inline base64 screenshot as soon as pending.json is detected.
// Works through IIS/nginx/any HTTP proxy — no WS upgrade negotiation needed.
app.get('/api/debug/stream/:sessionId', requireAuth, (req: Request, res: Response) => {
  const { sessionId } = req.params as { sessionId: string };
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',  // disable nginx/IIS response buffering
  });
  res.write(': connected\n\n'); // initial comment to flush headers to browser

  // Register client
  if (!debugSseClients.has(sessionId)) debugSseClients.set(sessionId, new Set());
  debugSseClients.get(sessionId)!.add(res);
  logger.info(`[sse] client connected session=${sessionId.slice(0,8)} total=${debugSseClients.get(sessionId)!.size}`);

  // Reconnect case: push existing pending step immediately
  const existing = debugSessions.get(sessionId);
  if (existing?.pendingStep) {
    const d = existing.pendingStep;
    let screenshotBase64: string | null = null;
    try {
      const ssAbs = path.resolve(d.screenshotPath);
      if (fs.existsSync(ssAbs)) screenshotBase64 = fs.readFileSync(ssAbs).toString('base64');
    } catch {}
    sseSessionPush(sessionId, 'debug:step', { ...d, screenshotBase64 });
  }

  req.on('close', () => {
    debugSseClients.get(sessionId)?.delete(res);
    if (debugSseClients.get(sessionId)?.size === 0) debugSseClients.delete(sessionId);
    logger.info(`[sse] client disconnected session=${sessionId.slice(0,8)}`);
  });
});

// POST /api/debug/start
app.post('/api/debug/start', requireAuth, (req: Request, res: Response) => {
  const { scriptId, environmentId } = req.body as { scriptId: string; environmentId?: string };
  if (!scriptId) { res.status(400).json({ error: 'scriptId required' }); return; }

  const script = findById<TestScript>(SCRIPTS, scriptId);
  if (!script) { res.status(404).json({ error: 'Script not found' }); return; }

  const project = findById<Project>(PROJECTS, script.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  // ── Same-script conflict check ────────────────────────────────────────────
  // Allow different users to debug the same script (they use different environments
  // or are exploring independently) but warn so they are aware.
  // We use a soft-lock: first active session on the same script wins if the requester
  // is a DIFFERENT user; the same user gets a 409 only if they already have an active
  // session for this exact script (prevents duplicate windows from the same account).
  const activeForScript = [...debugSessions.values()].filter(
    s => s.scriptId === scriptId &&
         !['done', 'stopped', 'error'].includes(s.status)
  );

  // Block: same user already has this script open in another tab/window
  const ownDuplicate = activeForScript.find(s => s.userId === req.session.userId);
  if (ownDuplicate) {
    res.status(409).json({
      error:     'You already have an active debug session for this script',
      code:      'DUPLICATE_OWN_SESSION',
      sessionId: ownDuplicate.sessionId,
      since:     ownDuplicate.startedAt,
    });
    return;
  }

  // Warn (non-blocking): other users are already debugging the same script
  // Client receives this info so it can display a notice — it is NOT a 409.
  const otherDebuggers = activeForScript
    .filter(s => s.userId !== req.session.userId)
    .map(s => ({ username: s.username, since: s.startedAt, sessionId: s.sessionId }));

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
    scriptId:        script.id,
    scriptTitle:     script.title,
    projectId:       project.id,
    userId:          req.session.userId!,
    username:        req.session.username!,
    environmentId:   environment?.id ?? null,
    environmentName: environment?.name ?? null,
    status:          'starting',
    currentStep:     0,
    totalSteps:      script.steps.length,
    specPath,
    startedAt:       new Date().toISOString(),
    lastHeartbeat:   Date.now(),
  };
  debugSessions.set(sessionId, session);

  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_DEBUG', resourceType: 'script', resourceId: script.id, details: `${script.title} env=${environment?.name ?? 'default'}`, ip: req.ip ?? null });

  res.json({
    sessionId,
    scriptTitle:    script.title,
    totalSteps:     session.totalSteps,
    otherDebuggers, // [] when no one else is debugging this script; client shows a notice if non-empty
  });

  // Spawn Playwright — spec uses file-based IPC (pending.json / gate.json)
  const relSpec   = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
  const ssDir     = path.resolve('debug-runs', sessionId);
  const pendingFile = path.join(ssDir, 'pending.json');
  const gateFile    = path.join(ssDir, 'gate.json');
  const errorFile   = path.join(ssDir, 'error.json');

  const proc = cp.spawn('npx', ['playwright', 'test', '--headed', '--reporter=list', relSpec], {
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
      // ── Check for step error first — written by spec catch block ──────────
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
      logger.info(`[dbg:poller] Step ${data.stepIdx} detected → pushing to UI (${sessionId.slice(0,8)}) base64=${screenshotBase64 ? Math.round(screenshotBase64.length/1024)+'KB' : 'null'}`);
      // SSE push — primary fast path (works through all HTTP proxies)
      sseSessionPush(sessionId, 'debug:step', { ...data, screenshotBase64 });
      // WS broadcast — secondary (fails silently when WS upgrade is blocked by proxy)
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
    try { fs.unlinkSync(errorFile);   } catch { /* ignore */ }

    const s = debugSessions.get(sessionId);
    if (s) {
      s.status      = s.status === 'stopped' ? 'stopped' : (code === 0 ? 'done' : 'error');
      s.finishedAt  = new Date().toISOString();
      s.pendingStep = undefined;
    }
    sseSessionPush(sessionId, 'debug:done', { sessionId, status: s?.status || 'done' });
    broadcast(sessionId, { type: 'debug:done', sessionId, status: s?.status as any || 'done' });
    logger.info(`[debug] session ${sessionId} closed — exit ${code}`);
    if (fs.existsSync(specPath)) { try { fs.unlinkSync(specPath); } catch { /* ignore */ } }
  });
});

// POST /api/debug/continue  — UI sends continue / skip / stop / retry
// Writes gate.json which the spec is polling for
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
    const gatePayload: Record<string, unknown> = { action };
    if (action === 'retry') {
      if (locator !== undefined)     gatePayload.locator     = locator;
      if (locatorType !== undefined) gatePayload.locatorType = locatorType;
      if (value !== undefined)       gatePayload.value       = value;
    }
    fs.writeFileSync(gateFile, JSON.stringify(gatePayload));
    logger.info(`[debug:continue] Wrote gate.json for ${sessionId} with action '${action}' → ${gateFile}`);
  } catch (err) {
    logger.error(`[debug:continue] FAILED to write gate.json for ${sessionId}: ${err}`);
  }

  res.json({ ok: true });
});

// POST /api/debug/patch-step — persist corrected locator/value back to script + locator repo
// Called by UI after user edits in the failure panel and clicks "Apply & Retry"
app.post('/api/debug/patch-step', requireAuth, (req: Request, res: Response) => {
  const { sessionId, stepOrder, locator, locatorType, value } = req.body as {
    sessionId:   string;
    stepOrder:   number;
    locator?:    string;
    locatorType?: string;
    value?:      string;
  };

  const session = debugSessions.get(sessionId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  // Find and update the script
  const script = findById<TestScript>(SCRIPTS, session.scriptId);
  if (!script)  { res.status(404).json({ error: 'Script not found' }); return; }

  const step = script.steps.find(s => s.order === stepOrder);
  if (!step)    { res.status(404).json({ error: 'Step not found' }); return; }

  let locatorRepoUpdated = false;

  // Update locator in the repo if the step references one
  if (locator !== undefined && step.locatorId) {
    const repoEntry = findById<Locator>(LOCATORS, step.locatorId);
    if (repoEntry) {
      repoEntry.selector     = locator;
      if (locatorType) repoEntry.selectorType = locatorType as Locator['selectorType'];
      upsert(LOCATORS, repoEntry);
      locatorRepoUpdated = true;
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'LOCATOR_UPDATED', resourceType: 'locator', resourceId: repoEntry.id, details: `debugger patch: ${repoEntry.name}`, ip: req.ip ?? null });
    }
  }

  // Update the step itself
  if (locator     !== undefined) step.locator     = locator;
  if (locatorType !== undefined) step.locatorType = locatorType;
  if (value       !== undefined) step.value       = value;
  script.modifiedBy = req.session.username!;
  script.modifiedAt = new Date().toISOString();
  upsert(SCRIPTS, script);

  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCRIPT_UPDATED', resourceType: 'script', resourceId: script.id, details: `debugger patch step ${stepOrder}: ${script.title}`, ip: req.ip ?? null });

  logger.info(`[debug:patch] Patched step ${stepOrder} of script ${script.id} (session ${sessionId.slice(0,8)}) locatorRepoUpdated=${locatorRepoUpdated}`);
  res.json({ ok: true, locatorRepoUpdated });
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

// GET /api/debug/sessions?projectId=xxx — list active debug sessions for a project
// Used by the UI to show "being debugged by X" badges on script rows.
// Returns all sessions that are not yet done/stopped/error, scoped to the given project.
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
    specPath = generateCodegenSpec({ suiteName: suite.name, suiteId: suite.id, runId, scripts, project, environment, allFunctions, port: PORT, beforeEachSteps: suite.beforeEachSteps ?? [], afterEachSteps: suite.afterEachSteps ?? [], fastMode: suite.fastMode ?? false, fastModeSteps: suite.fastModeSteps ?? [], overlayHandlers: suite.overlayHandlers ?? [] });
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
    browsers:   suite.browsers ?? ['chromium'],
  };
  runs.set(runId, record);
  enqueueRun(() => spawnRunWithSpec(record, specPath, false, suite.retries ?? 0, suite.browsers ?? ['chromium']));

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
app.get('/api/schedules', requireAuth, requireFeature('scheduler'), (req: Request, res: Response) => {
  const { suiteId, projectId } = req.query as Record<string, string>;
  let all = readAll<ScheduledRun>(SCHEDULES);
  if (suiteId)   all = all.filter(s => s.suiteId   === suiteId);
  if (projectId) all = all.filter(s => s.projectId === projectId);
  res.json(all);
});

// POST /api/schedules
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

// PUT /api/schedules/:id  (update label, cron, enabled, environmentId)
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
app.delete('/api/schedules/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
  unregisterCronJob(req.params.id);
  const ok = remove(SCHEDULES, req.params.id);
  if (!ok) { res.status(404).json({ error: 'Schedule not found' }); return; }
  logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SCHEDULE_DELETE', resourceType: 'schedule', resourceId: req.params.id, details: null, ip: req.ip ?? null });
  res.json({ success: true });
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

// ── P1-08: License API endpoints ─────────────────────────────────────────────

// GET /api/admin/license — return sanitised license info for UI display
app.get('/api/admin/license', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const stored = loadStoredLicense();
  if (!stored) { res.json({ activated: false }); return; }
  const p = stored.payload;
  const now = new Date();
  const expires = new Date(p.expiresAt);
  const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / 86400000);
  res.json({
    activated:        true,
    tier:             p.tier,
    orgId:            p.orgId,
    orgName:          p.orgName,
    seats:            p.seats,
    seatsUsed:        getSeatsUsed(),
    seatRatio:        getSeatUsageRatio(),
    maxInstances:     p.maxInstances,
    expiresAt:        p.expiresAt,
    daysLeft,
    expired:          expires < now,
    features:         p.features,
    featureOverrides: p.featureOverrides ?? {},
    isAutoTrial:      isAutoTrial(),          // true = running on built-in 14-day trial
    trialDaysLeft:    isAutoTrial() ? trialDaysRemaining() : null,
  });
});

// POST /api/admin/license/activate — validate + store license key or .lic file
const licUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 } });
app.post('/api/admin/license/activate', requireAuth, requireAdmin, licUpload.single('licFile'), async (req: Request, res: Response) => {
  // Enterprise .lic file upload (P3-04: persist file path for startup re-verify)
  if (req.file) {
    // Save .lic to data/ for permanent storage and RSA re-verify on every startup
    const licDir      = require('path').resolve('data');
    const persistPath = require('path').join(licDir, 'license.lic');
    require('fs').mkdirSync(licDir, { recursive: true });
    require('fs').writeFileSync(persistPath, req.file.buffer);

    const payload = validateLicFile(persistPath);
    if (!payload) {
      require('fs').unlinkSync(persistPath);
      res.status(400).json({ error: 'Invalid, expired, or machine-mismatched .lic file' });
      return;
    }
    // P3-06: block HMAC activation for TEAM/ENT — enforced by .lic requirement
    storeLicense('lic-file', payload, persistPath);
    refreshLicenseCache(payload);
    logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_ACTIVATED', resourceType: 'license', resourceId: null, details: `tier=${payload.tier} org=${payload.orgId} lic=file`, ip: req.ip ?? null });
    res.json({ success: true, tier: payload.tier, orgName: payload.orgName, expiresAt: payload.expiresAt });
    return;
  }

  // HMAC key activation
  const { key } = req.body as { key?: string };
  if (!key) { res.status(400).json({ error: 'key is required' }); return; }
  const payload = await validateLicenseKey(key.trim());
  if (!payload) { res.status(400).json({ error: 'Invalid license key — check the key and try again' }); return; }
  if (new Date(payload.expiresAt) < new Date()) { res.status(400).json({ error: 'License key has expired' }); return; }

  // P3-06: TEAM/ENT require .lic file — HMAC keys no longer accepted for these tiers
  if (payload.tier === 'team' || payload.tier === 'enterprise') {
    res.status(400).json({
      error:   'Team and Enterprise licenses require a .lic file from your vendor — HMAC key activation is not supported for these tiers.',
      upgrade: 'lic_required',
    });
    return;
  }

  storeLicense(key.trim(), payload);
  refreshLicenseCache(payload);
  logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_ACTIVATED', resourceType: 'license', resourceId: null, details: `tier=${payload.tier} org=${payload.orgId}`, ip: req.ip ?? null });
  res.json({ success: true, tier: payload.tier, orgName: payload.orgName, expiresAt: payload.expiresAt });
});

// DELETE /api/admin/license — deactivate (admin only)
app.delete('/api/admin/license', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const licPath = require('path').resolve('data', 'license.json');
  try { require('fs').unlinkSync(licPath); } catch { /* ok */ }
  clearLicenseCache();
  logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_DEACTIVATED', resourceType: 'license', resourceId: null, details: null, ip: req.ip ?? null });
  res.json({ success: true });
});

// P1-EG-05: Transfer license endpoint (re-binds to current machine)
app.post('/api/admin/license/transfer', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const result = checkMachineBinding();
  if (result.ok) {
    res.status(400).json({ error: 'License is already bound to this machine — transfer not needed' });
    return;
  }
  const ok = transferLicense();
  if (!ok) { res.status(500).json({ error: 'Transfer failed — no active license found' }); return; }
  clearLicenseCache();
  logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_TRANSFERRED', resourceType: 'license', resourceId: null, details: `new machineId=${getMachineId().slice(0,8)}…`, ip: req.ip ?? null });
  res.json({ success: true, machineId: getMachineId() });
});

// P1-EG-06: Machine binding status endpoint
app.get('/api/admin/license/machine', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const current = getMachineId();
  const stored  = loadStoredLicense();
  const bound   = stored?.machineId ?? null;
  res.json({
    currentMachineId:     current,
    currentMachineIdHint: current.slice(0, 8) + '…',
    boundMachineId:       bound,
    boundMachineIdHint:   bound ? bound.slice(0, 8) + '…' : null,
    match:                bound ? bound === current : null,
  });
});

// P3-11: License audit log — last 100 license-specific events
app.get('/api/admin/license/audit', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const AUDIT_FILE = require('path').resolve('data', 'audit.json');
  try {
    const all: Array<Record<string, unknown>> = require('fs').existsSync(AUDIT_FILE)
      ? JSON.parse(require('fs').readFileSync(AUDIT_FILE, 'utf-8'))
      : [];
    const LICENSE_ACTIONS = new Set(['LICENSE_ACTIVATED','LICENSE_DEACTIVATED','LICENSE_TRANSFERRED','LICENSE_EXPIRED']);
    const events = all.filter(e => LICENSE_ACTIONS.has(e.action as string)).slice(-100).reverse();
    res.json(events);
  } catch { res.json([]); }
});

// P2-02: Active sessions — list + force-logout (seat dashboard)
app.get('/api/admin/license/sessions', requireAuth, requireAdmin, (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionStore.all!((err: any, sessions: any) => {
    if (err) { res.status(500).json({ error: 'Failed to read sessions' }); return; }
    const rows = Object.entries(sessions ?? {}).map(([sid, raw]) => {
      const s = raw as Record<string, unknown>;
      return {
        sessionId:    sid,
        userId:       s.userId   ?? null,
        username:     s.username ?? null,
        role:         s.role     ?? null,
        loginAt:      s.loginAt  ?? null,
        lastActivity: s.lastActivity ?? null,
        ip:           s.ip       ?? null,
        isCurrent:    sid === req.sessionID,
      };
    }).filter(s => s.userId);   // only authenticated sessions
    res.json({ sessions: rows, seatsUsed: getSeatsUsed(), seatRatio: getSeatUsageRatio() });
  });
});

// DELETE /api/admin/license/sessions/:sessionId — force-logout a user (frees a seat)
app.delete('/api/admin/license/sessions/:sessionId', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { sessionId } = req.params;
  if (sessionId === req.sessionID) { res.status(400).json({ error: 'Cannot revoke your own session' }); return; }
  sessionStore.destroy!(sessionId, (err: Error | undefined) => {
    if (err) { res.status(500).json({ error: 'Failed to destroy session' }); return; }
    // Seat map will self-correct: recordLogout was already called if user hit /logout,
    // or the seat will be freed on next syncSeatsFromSessions (startup) / next login check.
    res.json({ success: true });
  });
});

// P3-08: Branding endpoint — returns white-label config from Enterprise .lic (public, no auth)
app.get('/api/branding', (_req: Request, res: Response) => {
  const p = getLicensePayload();
  if (p?.whiteLabelConfig) {
    res.json({
      appName:      p.whiteLabelConfig.appName,
      logoUrl:      p.whiteLabelConfig.logoUrl      ?? null,
      primaryColor: p.whiteLabelConfig.primaryColor ?? null,
    });
  } else {
    res.json({ appName: 'QA Agent Platform', logoUrl: null, primaryColor: null });
  }
});

// P3-07: Seat audit report — CSV export (admin only)
app.get('/api/admin/license/seat-report', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const USERS_FILE = require('path').resolve('data', 'users.json');
  const AUDIT_FILE = require('path').resolve('data', 'audit.json');
  try {
    type UserRec = { id: string; username: string; email: string; role: string; isActive: boolean; lastLogin: string | null };
    const users: UserRec[] = require('fs').existsSync(USERS_FILE)
      ? JSON.parse(require('fs').readFileSync(USERS_FILE, 'utf-8'))
      : [];
    const auditEvents: Array<Record<string, unknown>> = require('fs').existsSync(AUDIT_FILE)
      ? JSON.parse(require('fs').readFileSync(AUDIT_FILE, 'utf-8'))
      : [];

    // Count logins per user from audit log
    const loginCounts: Record<string, number> = {};
    for (const e of auditEvents) {
      if (e.action === 'LOGIN' && typeof e.userId === 'string') {
        loginCounts[e.userId] = (loginCounts[e.userId] ?? 0) + 1;
      }
    }

    const p = getLicensePayload();
    const csvRows = [
      ['Username', 'Email', 'Role', 'Active', 'Last Login', 'Login Count', 'Seat Used'],
      ...users.map((u, i) => [
        u.username,
        u.email,
        u.role,
        u.isActive ? 'Yes' : 'No',
        u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never',
        String(loginCounts[u.id] ?? 0),
        p && p.seats !== -1 ? (i < p.seats ? 'Yes' : 'No') : 'Unlimited',
      ]),
    ];

    const csv = csvRows.map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const filename = `seat-report-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: 'Failed to generate report' }); }
});

// ── SPA fallback (requires auth) — MUST be after all API routes ──────────────

app.get('*', requireAuth, (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, '0.0.0.0', async () => {
  // P3-04: RSA .lic file re-verify — detect tampered or moved .lic files at startup
  const licFileCheck = checkStoredLicFile();
  if (!licFileCheck.ok) {
    logger.error('═══════════════════════════════════════════════════════');
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
    logger.error('═══════════════════════════════════════════════════════');
    process.exit(1);
  }

  // P1-EG-04: Machine fingerprint check — refuse to start if license bound to different machine
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

  // Auto-Trial: if no license exists, activate a 14-day trial automatically.
  // Allows the first admin to log in, explore all features, and activate a
  // real license key before the trial expires — no chicken-and-egg on fresh install.
  if (!getLicensePayload()) {
    const trial = activateAutoTrial();
    const days  = AUTO_TRIAL_DAYS;
    logger.info('═══════════════════════════════════════════════════════');
    logger.info(`[license] No license found — auto-trial activated (${days} days).`);
    logger.info(`[license] Trial expires: ${trial.expiresAt.slice(0, 10)}`);
    logger.info('[license] Features: recorder, debugger, scheduler, apiAccess (3 seats, 3 projects)');
    logger.info('[license] Go to Admin → License to activate your license key.');
    logger.info('═══════════════════════════════════════════════════════');
    logAudit({ userId: null, username: null, action: 'LICENSE_TRIAL_STARTED', resourceType: 'license', resourceId: null, details: `expires=${trial.expiresAt.slice(0,10)}`, ip: null });
  } else if (isAutoTrial()) {
    const days = trialDaysRemaining();
    logger.warn(`[license] Trial license active — ${days} day(s) remaining. Activate a license key via Admin → License.`);
  }

  // P2-03: Rehydrate in-memory seat map from persisted SQLite sessions on startup.
  // Prevents seat count resetting to 0 after server restart while users are still logged in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionStore.all!((err: any, sessions: any) => {
    if (err || !sessions) return;
    const activeUserIds = Object.values(sessions)
      .map((s: any) => s.userId as string | undefined)
      .filter((uid): uid is string => !!uid);
    syncSeatsFromSessions(activeUserIds);
    if (activeUserIds.length > 0) {
      logger.info(`[license] Rehydrated ${new Set(activeUserIds).size} seat(s) from ${activeUserIds.length} persisted session(s)`);
    }
  });

  // Register all enabled schedules
  const savedSchedules = readAll<ScheduledRun>(SCHEDULES).filter(s => s.enabled);
  for (const s of savedSchedules) registerCronJob(s);
  if (savedSchedules.length > 0) logger.info(`[scheduler] Loaded ${savedSchedules.length} active schedule(s)`);

  // License expiry tick — check every hour while server is running.
  // getLicensePayload() already re-checks on every request, but this catches
  // the edge case where no requests arrive around the exact expiry moment.
  setInterval(() => {
    const justExpired = checkExpiryTick();
    if (justExpired) {
      logger.warn('[license] License has expired. Platform entering read-only mode.');
      logAudit({ userId: null, username: null, action: 'LICENSE_EXPIRED', resourceType: 'license', resourceId: null, details: null, ip: null });
    }
  }, 60 * 60 * 1000); // every 1 hour

  // Heartbeat monitor — kill orphaned debug sessions if no heartbeat for 60s
  setInterval(() => {
    const now = Date.now();
    const HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds (user may pause 30-40s reviewing screenshot)
    debugSessions.forEach((session, sessionId) => {
      if (session.status !== 'done' && session.status !== 'stopped' && session.status !== 'error') {
        const timeSinceHeartbeat = now - session.lastHeartbeat;
        if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          logger.info(`[dbg:heartbeat] No heartbeat for ${timeSinceHeartbeat}ms — killing orphaned session ${sessionId.slice(0,8)} (user: ${session.username})`);
          if (session.proc?.pid) {
            try {
              // Kill entire process tree (Chrome children) — same as stop logic
              if (process.platform === 'win32') {
                require('child_process').execSync(`taskkill /F /T /PID ${session.proc.pid}`, { stdio: 'pipe' });
              } else {
                process.kill(-session.proc.pid, 'SIGTERM');
              }
            } catch { /* already dead */ }
          }
          session.status = 'stopped';
          sseSessionPush(sessionId, 'debug:done', { sessionId, status: 'stopped' });
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
