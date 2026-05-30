import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../framework/config';
import { logger } from '../../utils/logger';
import { readAll, upsert, writeAll, findById, LOCATORS, FUNCTIONS, SCRIPTS, SETTINGS, USERS } from '../../data/store';
import type { TestScript, ScriptStep, CommonFunction, ComponentDef, DefectRecord, BrowserName, Locator } from '../../data/types';
import type { RunRecord, LogLevel, HealEvent, TestEvent } from './types';
import { broadcast } from './ws-broadcast';
import { execHealthStart, execHealthUpdate, execHealthComplete } from '../../utils/exec-health-store';
import { onRunComplete } from './run-queue';
import { readQuarantine, upsertQuarantineEntry, restoreQuarantineEntry, emitFlakeNotification, getEffectiveFlakinessConfig, generateTestId, groupRunsByTestId } from './quarantine';
import { DEFAULT_FLAKINESS_CONFIG, analyzeFlakiness, CURRENT_ENGINE_VERSION } from '../../utils/flakinessEngine';
import { sendRunNotification, formatDuration } from '../../utils/notifier';
import { loadJiraConfig, loadDefectsRegistry, saveDefectsRegistry, findOpenDefectsForRun } from '../../utils/defectsStore';
import { JiraClient } from '../../utils/jiraClient';
import { buildAutoCloseCommentADF } from '../../utils/adfBuilder';
import { logAudit } from '../../auth/audit';
import { isAutoTrial, checkStoredLicFile } from '../../utils/licenseManager';
import { runs } from './state';
import { jiraDecryptToken } from './jira-helpers';
import type { AppSettings } from '../../data/types';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../data/types';

export const PORT = config.ui.port;

const RE_TEST_PASS = /\bok\s+\d+\s+\[|[✓✔√]|\d+\s+passed/u;
const RE_TEST_FAIL = /\bx\s+\d+\s+\[|[✗✘×]/u;
const RE_TEST_LINE = /(?:ok|x|[✓✔✗✘×√])\s+\d+\s+\[(chromium|firefox|webkit)\][^(]*›\s*([^›(]+?)\s*\((\d+(?:\.\d+)?)(ms|s)\)/u;
const RE_TOTAL = /Running (\d+) tests?/;
const RE_PASS_COUNT = /(\d+) passed/;
const RE_FAIL_COUNT = /(\d+) failed/;
const RE_CONSOLE_ERRORS = /\[QA_CONSOLE_ERRORS\]:(\d+):(.+)$/;
const RE_TEST_ID = /\[QA_TEST_ID\]:(\d+):(TID_[0-9a-f]{8})$/;

function classifyLine(line: string): LogLevel {
  if (RE_TEST_PASS.test(line)) return 'pass';
  if (RE_TEST_FAIL.test(line) || /Error/.test(line)) return 'fail';
  if (/warning|warn/i.test(line)) return 'warn';
  return 'info';
}

function parseMs(val: string, unit: string): number {
  const n = parseFloat(val);
  return unit === 's' ? Math.round(n * 1000) : Math.round(n);
}

function parseFailureDetails(record: RunRecord): void {
  const lines = record.output;
  const failHdr = /^\s{2,4}\d+\)\s+\[(chromium|firefox|webkit)\]/;
  const ANSI = /\x1b\[[0-9;]*m/g;
  const nameMap = new Map<string, TestEvent>();
  for (const ev of record.tests) {
    if (ev.status === 'fail') nameMap.set(ev.name.trim().toLowerCase(), ev);
  }
  if (!nameMap.size) return;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(ANSI, '');
    if (failHdr.test(line)) {
      const parts = line.split('›');
      // OLD: parts[parts.length - 1] captured the step name (e.g. "Step 7: CLICK"), not the test name
      // Failure header format: "  1) [browser] › spec.ts:line › SuiteName › TestName › StepName"
      // Test name is the last segment that matches a known test in nameMap
      let ev: TestEvent | undefined;
      for (let pi = parts.length - 1; pi >= 0; pi--) {
        const candidate = parts[pi].replace(/\(\d.*\)$/, '').trim().toLowerCase();
        if (nameMap.has(candidate)) { ev = nameMap.get(candidate); break; }
      }
      const rawName = parts[parts.length - 1].replace(/\(\d.*\)$/, '').trim();
      const block: string[] = [];
      i++;
      while (i < lines.length && !failHdr.test(lines[i].replace(ANSI, ''))) {
        const clean = lines[i].replace(ANSI, '').trimEnd();
        block.push(clean);
        i++;
      }
      if (ev) {
        const firstErr = block.find(l => l.trim() && !/^\s*$/.test(l));
        if (firstErr) ev.errorMessage = firstErr.trim();
        ev.errorDetail = block.join('\n');
        const ssHeaderIdx = block.findIndex(l => /attachment.*screenshot.*image\/png/i.test(l));
        if (ssHeaderIdx >= 0) {
          for (let pi = ssHeaderIdx + 1; pi < Math.min(ssHeaderIdx + 3, block.length); pi++) {
            const pathLine = block[pi].trim();
            if (!pathLine) continue;
            const m = pathLine.match(/test-results[^\r\n]+\.(png|jpg|jpeg)/i);
            if (m) { ev.screenshotPath = m[0].replace(/\\/g, '/').replace(/^test-results[\\/]/, ''); break; }
          }
        }
      }
      continue;
    }
    i++;
  }
}

function attachFailureScreenshots(record: RunRecord): void {
  const ssDir = path.join(config.paths.testResults, record.runId);
  if (!fs.existsSync(ssDir)) return;
  const failRe = /^FAILED-(\d+)-(chromium|firefox|webkit)\.png$/;
  const failReLegacy = /^FAILED-(\d+)\.png$/;
  let files: string[];
  try { files = fs.readdirSync(ssDir); } catch { return; }
  const browserTests = new Map<string, typeof record.tests>();
  for (const ev of record.tests) {
    const b = (ev.browser || 'chromium').toLowerCase();
    if (!browserTests.has(b)) browserTests.set(b, []);
    browserTests.get(b)!.push(ev);
  }
  for (const f of files) {
    const m = f.match(failRe);
    if (m) {
      const scriptIdx = parseInt(m[1], 10);
      const browser = m[2].toLowerCase();
      const ev = browserTests.get(browser)?.[scriptIdx];
      if (ev) ev.failureScreenshotPath = `test-results/${record.runId}/${f}`;
      continue;
    }
    const ml = f.match(failReLegacy);
    if (ml) {
      const idx = parseInt(ml[1], 10);
      const ev = record.tests[idx];
      if (ev) ev.failureScreenshotPath = `test-results/${record.runId}/${f}`;
    }
  }
}

function attachStepsFromJson(record: RunRecord, jsonReportPath: string): void {
  try {
    if (!fs.existsSync(jsonReportPath)) return;
    const raw = fs.readFileSync(jsonReportPath, 'utf8');
    const report = JSON.parse(raw);
    const pwTests: Array<{ title: string; browser: string; test: any }> = [];
    function collectTests(suites: any[]): void {
      for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            const browser = (test.projectName || 'chromium').toLowerCase();
            pwTests.push({ title: spec.title, browser, test });
          }
        }
        collectTests(suite.suites || []);
      }
    }
    collectTests(report.suites || []);
    const claimed = new Set<number>();
    record.tests.forEach((ev) => {
      const evBrowser = (ev.browser || 'chromium').toLowerCase();
      const evTitle = (ev.name || '').toLowerCase();
      let bestIdx = -1;
      let bestScore = -1;
      pwTests.forEach((entry, i) => {
        if (claimed.has(i)) return;
        if (entry.browser !== evBrowser) return;
        const pt = entry.title.toLowerCase();
        const score = pt === evTitle ? 3 : evTitle.includes(pt) || pt.includes(evTitle) ? 2 : 1;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      });
      if (bestIdx < 0) return;
      claimed.add(bestIdx);
      const result = pwTests[bestIdx].test?.results?.[0];
      if (!result) return;
      const steps = (result.steps || []).map((s: any) => ({
        name: s.title || '',
        status: s.error ? 'fail' : 'pass',
        durationMs: typeof s.duration === 'number' ? s.duration : 0,
      }));
      if (steps.length) ev.steps = steps;
    });
  } catch { /* skip */ }
}

function attachVisualDiff(record: RunRecord): void {
  const ssDir = path.join(config.paths.testResults, record.runId);
  if (!fs.existsSync(ssDir)) return;
  const files = fs.readdirSync(ssDir);
  const beforeRe = /^(\d+)-(chromium|firefox|webkit)-before-(\d+)\.png$/;
  const afterRe = /^(\d+)-(chromium|firefox|webkit)-after-(\d+)\.png$/;
  const beforeReLegacy = /^(\d+)-before-(\d+)\.png$/;
  const afterReLegacy = /^(\d+)-after-(\d+)\.png$/;
  type StepMap = Map<number, string>;
  const beforeMap = new Map<string, StepMap>();
  const afterMap = new Map<string, StepMap>();
  for (const f of files) {
    const bm = f.match(beforeRe) || (() => { const m = f.match(beforeReLegacy); return m ? [m[0], m[1], 'chromium', m[2]] : null; })();
    if (bm) { const key = `${bm[1]}-${bm[2]}`; const so = parseInt(bm[3], 10); if (!beforeMap.has(key)) beforeMap.set(key, new Map()); beforeMap.get(key)!.set(so, f); }
    const am = f.match(afterRe) || (() => { const m = f.match(afterReLegacy); return m ? [m[0], m[1], 'chromium', m[2]] : null; })();
    if (am) { const key = `${am[1]}-${am[2]}`; const so = parseInt(am[3], 10); if (!afterMap.has(key)) afterMap.set(key, new Map()); afterMap.get(key)!.set(so, f); }
  }
  const browserCounter = new Map<string, number>();
  record.tests.forEach((ev) => {
    const browser = (ev.browser || 'chromium').toLowerCase();
    const scriptIdx = browserCounter.get(browser) ?? 0;
    browserCounter.set(browser, scriptIdx + 1);
    const key = `${scriptIdx}-${browser}`;
    const beforeSteps = beforeMap.get(key);
    const afterSteps = afterMap.get(key);
    if (!beforeSteps && !afterSteps) return;
    if (ev.status === 'fail') {
      if (afterSteps && afterSteps.size > 0) { const lastFailStep = Math.max(...afterSteps.keys()); ev.screenshotAfter = `test-results/${record.runId}/${afterSteps.get(lastFailStep)}`; if (beforeSteps?.has(lastFailStep)) { ev.screenshotBefore = `test-results/${record.runId}/${beforeSteps.get(lastFailStep)}`; } }
      else if (beforeSteps && beforeSteps.size > 0) { const lastStep = Math.max(...beforeSteps.keys()); ev.screenshotBefore = `${record.runId}/${beforeSteps.get(lastStep)}`; }
    } else {
      if (beforeSteps && beforeSteps.size > 0) { const lastStep = Math.max(...beforeSteps.keys()); ev.screenshotPath = `${record.runId}/${beforeSteps.get(lastStep)}`; }
    }
  });
}

// Reorder record.tests[] to match the suite scriptIds order using the JSON report.
// With parallel workers tests complete out of order — JSON report has the authoritative
// Playwright execution order (all chromium tests in spec order, then firefox, then webkit).
function reorderTestsByJsonReport(record: RunRecord, jsonReportPath: string): void {
  try {
    if (!fs.existsSync(jsonReportPath)) return;
    const report = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
    // Collect ordered [browser, title] pairs from JSON report (spec order preserved)
    const ordered: Array<{ browser: string; title: string }> = [];
    function collect(suites: any[]): void {
      for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            ordered.push({ browser: (test.projectName || 'chromium').toLowerCase(), title: spec.title });
          }
        }
        collect(suite.suites || []);
      }
    }
    collect(report.suites || []);
    // Strip prescan noop — chromium-only internal test, never shown in report
    const filteredOrdered = ordered.filter(e => e.title !== '__prescan_noop__');
    if (!filteredOrdered.length) return;
    // Also strip prescan noop from record.tests (may have been parsed from stdout)
    record.tests = record.tests.filter(ev => ev.name !== '__prescan_noop__');
    // Match each ordered entry to a record.tests[] entry by browser+title
    const unmatched = [...record.tests];
    const sorted: typeof record.tests = [];
    for (const { browser, title } of filteredOrdered) {
      const idx = unmatched.findIndex(ev =>
        (ev.browser || 'chromium').toLowerCase() === browser &&
        (ev.name || '').toLowerCase() === title.toLowerCase()
      );
      if (idx >= 0) { sorted.push(unmatched[idx]); unmatched.splice(idx, 1); }
    }
    // Append any unmatched (retried/extra tests) at the end
    record.tests = [...sorted, ...unmatched];
  } catch { /* never block artifact attachment */ }
}

function attachVideoAndTrace(record: RunRecord): void {
  const runDir = path.join(config.paths.testResults, record.runId);
  if (!fs.existsSync(runDir)) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(runDir, { withFileTypes: true }); } catch { return; }

  // Group dirs by browser, sorted by creation time (record.tests[] reordered by reorderTestsByJsonReport before this runs)
  const browserDirs = new Map<string, string[]>();
  entries
    .filter(e => e.isDirectory() && /(chromium|firefox|webkit)/i.test(e.name))
    .map(e => ({ name: e.name, created: fs.statSync(path.join(runDir, e.name)).ctimeMs }))
    .sort((a, b) => a.created - b.created)
    .forEach(({ name }) => {
      const m = name.toLowerCase().match(/(chromium|firefox|webkit)/);
      if (!m) return;
      const b = m[1];
      if (!browserDirs.has(b)) browserDirs.set(b, []);
      browserDirs.get(b)!.push(name);
    });

  // Assign by positional index within each browser — mirrors attachVisualDiff() pattern
  const browserCounter = new Map<string, number>();
  record.tests.forEach((ev) => {
    const browser = (ev.browser || 'chromium').toLowerCase();
    const idx = browserCounter.get(browser) ?? 0;
    browserCounter.set(browser, idx + 1);
    const dirs = browserDirs.get(browser);
    if (!dirs || idx >= dirs.length) return;
    const dirName = dirs[idx];
    const dirPath = path.join(runDir, dirName);
    try {
      const dirFiles = fs.readdirSync(dirPath);
      const videoFile = dirFiles.find(f => f.endsWith('.webm'));
      if (videoFile) ev.videoPath = `${record.runId}/${dirName}/${videoFile}`;
      // Fast Mode: video saved to root run dir as <brIdx>-<browser>.webm (predictable name)
      if (!videoFile) {
        const fastVideo = `${idx}-${browser}.webm`;
        if (fs.existsSync(path.join(runDir, fastVideo))) ev.videoPath = `${record.runId}/${fastVideo}`;
      }
      const traceFile = dirFiles.find(f => f === 'trace.zip' || f.endsWith('-trace.zip'));
      if (traceFile) ev.tracePath = `${record.runId}/${dirName}/${traceFile}`;
    } catch { /* skip */ }
  });
}

export function backfillScriptsAndFunctions(
  locatorId: string,
  locatorName: string,
  newSelector: string,
  newSelectorType: string,
): void {
  try {
    const scripts = readAll<TestScript>(SCRIPTS);
    let scriptsDirty = false;
    for (const script of scripts) {
      let changed = false;
      for (const step of script.steps) {
        if (step.locatorId === locatorId && (step.locator !== newSelector || step.locatorType !== newSelectorType)) {
          step.locator = newSelector;
          step.locatorType = newSelectorType;
          changed = true;
        }
      }
      if (changed) scriptsDirty = true;
    }
    if (scriptsDirty) writeAll(SCRIPTS, scripts);
    const functions = readAll<CommonFunction>(FUNCTIONS);
    let fnsDirty = false;
    for (const fn of functions) {
      let changed = false;
      for (const step of fn.steps) {
        if (step.locatorName === locatorName && (step.selector !== newSelector || step.locatorType !== newSelectorType)) {
          step.selector = newSelector;
          step.locatorType = newSelectorType;
          changed = true;
        }
      }
      if (changed) fnsDirty = true;
    }
    if (fnsDirty) writeAll(FUNCTIONS, functions);
    logger.info(`[backfill] locator=${locatorId} name="${locatorName}" → ${newSelectorType}:${newSelector} | scripts=${scriptsDirty} fns=${fnsDirty}`);
  } catch (err) {
    logger.warn(`[backfill] Failed: ${(err as Error).message}`);
  }
}

function attachHealEvents(record: RunRecord): void {
  const healFile = path.join(config.paths.testResults, record.runId, 'healed.ndjson');
  if (!fs.existsSync(healFile)) return;
  const rawLines = fs.readFileSync(healFile, 'utf-8').trim().split('\n').filter(Boolean);
  const rawEvents: HealEvent[] = [];
  for (const line of rawLines) { try { rawEvents.push(JSON.parse(line) as HealEvent); } catch { /* malformed line */ } }
  if (!rawEvents.length) return;
  const allLocs = readAll(LOCATORS);
  const locById = new Map(allLocs.map((l: any) => [l.id, l]));
  const tcPattern = /^\[([A-Z]{1,8}[-_]\d+)\]\s*/;
  // Build locatorId → { tcId, scriptTitle } map by scanning scripts in this run
  const locatorToScript = new Map<string, { tcId: string; scriptTitle: string }>();
  if (record.scriptIds?.length) {
    const allScripts = readAll<any>(SCRIPTS);
    for (const sc of allScripts) {
      if (!record.scriptIds.includes(sc.id)) continue;
      const tcId = sc.tcId ?? '';
      for (const step of (sc.steps ?? [])) {
        if (step.locatorId) locatorToScript.set(step.locatorId, { tcId, scriptTitle: sc.title });
      }
    }
  }
  function resolveTcAndTitle(locatorId: string): { tcId: string; scriptTitle: string } {
    return locatorToScript.get(locatorId) ?? { tcId: '', scriptTitle: record.suiteName ?? '' };
  }
  const enriched: HealEvent[] = rawEvents.map(e => {
    const loc = locById.get(e.locatorId);
    const { tcId, scriptTitle } = resolveTcAndTitle(e.locatorId);
    const full: HealEvent = { ...e, tier: e.tier ?? 'T2', runId: record.runId, projectId: record.projectId ?? '', suiteName: record.suiteName ?? '', scriptTitle, tcId, locatorName: loc?.name ?? e.locatorId, oldSelector: loc?.selector ?? '', oldSelectorType: loc?.selectorType ?? 'css' };
    if ((full.tier === 'T2') && loc) {
      const winnerSelector = full.healed;
      const winnerSelectorType = full.healedType ?? 'css';
      const demoted = { selector: loc.selector, selectorType: loc.selectorType, confidence: 50 };
      const existingAlts = (loc.alternatives ?? []).filter((a: any) => a.selector !== winnerSelector && a.selector !== loc.selector);
      const updated = { ...loc, selector: winnerSelector, selectorType: winnerSelectorType, alternatives: [demoted, ...existingAlts].slice(0, 10), healingStats: { healCount: (loc.healingStats?.healCount ?? 0) + 1, lastHealedAt: full.at, lastHealedFrom: loc.selector, lastHealedBy: 'auto' as const }, updatedAt: new Date().toISOString() };
      upsert(LOCATORS, updated);
      backfillScriptsAndFunctions(loc.id, loc.name, winnerSelector, winnerSelectorType);
    }
    return full;
  });
  record.healEvents = enriched;
  const logFile = path.resolve('data', 'healing-log.ndjson');
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, enriched.map(e => JSON.stringify(e)).join('\n') + '\n'); } catch { /* skip */ }
  logger.info(`[heal] Run ${record.runId}: ${enriched.length} heal event(s) attached`);
}

function getJiraClientForRun(): JiraClient | null {
  const cfg = loadJiraConfig();
  let baseUrl = cfg?.baseUrl || config.jira.baseUrl;
  let email = cfg?.email || config.jira.email;
  let apiToken = config.jira.apiToken;
  if (cfg?.apiTokenEnc) { try { apiToken = jiraDecryptToken(cfg.apiTokenEnc); } catch { /* ignore */ } }
  if (!baseUrl || !email || !apiToken) return null;
  baseUrl = baseUrl.replace(/\/$/, '');
  return new JiraClient({ baseUrl, email, apiToken });
}

async function closeDefectAsync(defect: DefectRecord, runId: string, transitionName: string, client: JiraClient): Promise<void> {
  await client.transitionIssue(defect.defectKey, transitionName);
  await client.addComment(defect.defectKey, buildAutoCloseCommentADF(runId, new Date().toISOString()));
  const reg = loadDefectsRegistry();
  const d = reg.defects.find(x => x.defectKey === defect.defectKey);
  if (d) { d.status = 'closed'; d.closedAt = new Date().toISOString(); d.closedByRunId = runId; saveDefectsRegistry(reg); }
  logAudit({ userId: 'system', username: 'system', action: 'DEFECT_AUTO_CLOSED', resourceType: 'defect', resourceId: defect.defectKey, details: runId, ip: null });
  broadcast(runId, { type: 'defect_auto_closed', defectKey: defect.defectKey } as any);
}

async function autoCloseHookOnRunComplete(record: RunRecord): Promise<void> {
  const cfg = loadJiraConfig();
  const client = getJiraClientForRun();
  if (!cfg || !client) return;
  const passedTestIds = new Set(record.tests.filter(t => t.status === 'pass' && t.testId).map(t => t.testId!));
  if (!passedTestIds.size) return;
  const candidates = findOpenDefectsForRun(record.suiteId || '', record.environmentId || '').filter(d => passedTestIds.has(d.testId));
  for (const d of candidates) {
    closeDefectAsync(d, record.runId, cfg.closeTransitionName, client).catch(err => logger.warn('[autoClose] failed', { defectKey: d.defectKey, err: err?.message }));
  }
}

export function attachDefectInfo<T extends RunRecord>(record: T): T {
  const reg = loadDefectsRegistry();
  for (const t of record.tests) {
    if (!t.testId) continue;
    const d = reg.defects.find(x => x.testId === t.testId && x.suiteId === (record.suiteId || ''));
    if (d) { t.defectKey = d.defectKey; t.defectStatus = d.status; }
  }
  return record;
}

export function spawnRunWithSpec(record: RunRecord, specPath: string, headed?: boolean, retries = 0, browsers: BrowserName[] = ['chromium'], traceMode: 'on' | 'retain-on-failure' | 'off' = 'on'): void {
  const { runId } = record;
  broadcast(runId, { type: 'run:start', runId, planId: record.planId, startedAt: record.startedAt });
  execHealthStart({ runId, type: 'ui-test', name: record.suiteName ?? 'UI Test', startedAt: record.startedAt });
  const relPath = path.relative(path.resolve('.'), specPath).replace(/\\/g, '/');
  const outputDir = path.join(config.paths.testResults, runId).replace(/\\/g, '/');
  const relOutputDir = path.relative(path.resolve('.'), path.resolve(outputDir)).replace(/\\/g, '/');
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  const jsonReportFile = 'pw-report.json';
  const jsonReportPath = path.join(path.resolve(outputDir), jsonReportFile);
  const args = ['playwright', 'test', '--reporter=list,json', `--output=${relOutputDir}`];
  if (retries > 0) args.push(`--retries=${retries}`);
  const selectedBrowsers = (browsers && browsers.length) ? browsers : ['chromium'];
  selectedBrowsers.forEach(b => args.push(`--project=${b}`));
  args.push(relPath);
  const runHeadless = headed === false;
  if (!runHeadless) args.push('--headed');
  logger.info(`[spawnRunWithSpec] Browser: ${runHeadless ? 'headless' : 'headed'} — ${relPath}`);
  record.status = 'running';
  const proc = cp.spawn('npx', args, {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      CI: '',
      HEADLESS: runHeadless ? 'true' : 'false',
      PW_OUTPUT_DIR: relOutputDir,
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReportPath,
      PLAYWRIGHT_TRACE: traceMode,
      // Resolve browser path in priority order — disk check avoids relying on env vars
      // which may be stripped when server runs under a service/admin monitor process.
      // 1. Explicit env var (set by admin or .env)
      // 2. Project-local .playwright-browsers (installed via `npx playwright install` in project dir)
      // 3. Machine-wide ProgramData install (installer fallback for service accounts)
      PLAYWRIGHT_BROWSERS_PATH: (
        process.env.PLAYWRIGHT_BROWSERS_PATH ||
        (fs.existsSync(path.resolve('.playwright-browsers')) ? path.resolve('.playwright-browsers') : undefined) ||
        (fs.existsSync('C:\\ProgramData\\ms-playwright') ? 'C:\\ProgramData\\ms-playwright' : undefined) ||
        undefined
      ),
    },
    shell: true,
  });
  const ANSI_RE = /\x1b\[[0-9;]*m/g;
  const handleData = (data: Buffer): void => {
    const lines = data.toString().split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const plain = line.replace(ANSI_RE, '');
      record.output.push(line);
      if (record.output.length > 500) record.output.shift();
      const level = classifyLine(plain);
      broadcast(runId, { type: 'run:output', runId, line: plain, level });
      const totalMatch = plain.match(RE_TOTAL);
      if (totalMatch) { record.total = parseInt(totalMatch[1]); broadcast(runId, { type: 'run:stats', runId, passed: record.passed, failed: record.failed, total: record.total, completed: record.passed + record.failed }); }
      const passMatch = plain.match(RE_PASS_COUNT);
      if (passMatch) record.passed = parseInt(passMatch[1]);
      const failMatch = plain.match(RE_FAIL_COUNT);
      if (failMatch) record.failed = parseInt(failMatch[1]);
      const testMatch = plain.match(RE_TEST_LINE);
      if (testMatch) {
        const browser = testMatch[1]; const name = testMatch[2].trim(); const status = RE_TEST_PASS.test(plain) ? 'pass' : 'fail'; const durationMs = parseMs(testMatch[3], testMatch[4]);
        const ev: TestEvent = { name, status, durationMs, browser };
        record.tests.push(ev);
        const pendingTids = (record as any).__pendingTestIds as Record<number, string> | undefined;
        if (pendingTids) { const idx = record.tests.length - 1; if (pendingTids[idx]) { ev.testId = pendingTids[idx]; delete pendingTids[idx]; } }
        broadcast(runId, { type: 'run:test', runId, name, status, durationMs, browser });
        broadcast(runId, { type: 'run:stats', runId, passed: record.passed, failed: record.failed, total: record.total, completed: record.tests.length });
        execHealthUpdate(runId, record.passed, record.failed, record.total);
      }
      const ceMatch = plain.match(RE_CONSOLE_ERRORS);
      if (ceMatch) { const testIdx = parseInt(ceMatch[1], 10); try { const errors: string[] = JSON.parse(ceMatch[2]); (record as any).__pendingConsoleErrors = (record as any).__pendingConsoleErrors || {}; (record as any).__pendingConsoleErrors[testIdx] = errors; } catch { /* malformed JSON */ } }
      const tidMatch = plain.match(RE_TEST_ID);
      if (tidMatch) { const testIdx = parseInt(tidMatch[1], 10); const testId = tidMatch[2]; const ev = record.tests[testIdx]; if (ev && !ev.testId) ev.testId = testId; if (!ev) { (record as any).__pendingTestIds = (record as any).__pendingTestIds || {}; (record as any).__pendingTestIds[testIdx] = testId; } }
    }
  };
  proc.stdout?.on('data', handleData);
  proc.stderr?.on('data', handleData);
  proc.on('close', (code) => {
    record.exitCode = code;
    record.status = code === 0 ? 'done' : 'failed';
    record.total = record.total || record.passed + record.failed;
    record.finishedAt = new Date().toISOString();
    record.output = record.output.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));
    parseFailureDetails(record);
    const pending = (record as any).__pendingConsoleErrors as Record<number, string[]> | undefined;
    if (pending) { for (const [idxStr, errors] of Object.entries(pending)) { const ev = record.tests[parseInt(idxStr, 10)]; if (ev && errors.length) ev.consoleErrors = errors; } delete (record as any).__pendingConsoleErrors; }
    reorderTestsByJsonReport(record, jsonReportPath);  // sort before artifact attachment
    attachFailureScreenshots(record);
    attachVisualDiff(record);
    attachVideoAndTrace(record);
    attachStepsFromJson(record, jsonReportPath);
    attachHealEvents(record);
    broadcast(runId, { type: 'run:done', runId, passed: record.passed, failed: record.failed, total: record.total, exitCode: code });
    execHealthComplete(runId, code === 0 ? 'passed' : 'failed', record.passed, record.failed, record.total);
    logger.info(`[suite run] ${runId} done — exit ${code} (${record.passed}✔ ${record.failed}✘)`);
    const runFile = path.join(config.paths.results, `run-${runId}.json`);
    fs.mkdirSync(config.paths.results, { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify(record, null, 2));
    autoCloseHookOnRunComplete(record).catch(err => logger.warn('[autoClose] hook crashed', { runId: record.runId, err: err?.message }));
    if (record.suiteId && record.projectId) {
      try {
        const fConfig = getEffectiveFlakinessConfig(record.suiteId, record.projectId);
        const resultsPath = config.paths.results;
        const allRunFiles: RunRecord[] = fs.existsSync(resultsPath)
          ? fs.readdirSync(resultsPath).filter((f: string) => f.startsWith('run-') && f.endsWith('.json')).map((f: string) => { try { return JSON.parse(fs.readFileSync(path.join(resultsPath, f), 'utf-8')) as RunRecord; } catch { return null; } }).filter((r: RunRecord | null): r is RunRecord => !!r && r.suiteId === record.suiteId) : [];
        const byTestId = groupRunsByTestId(allRunFiles, record.suiteId, fConfig.windowDays);
        const quarantine = readQuarantine();
        const justQuarantinedThisRun = new Set<string>();
        for (const [testId, testRuns] of byTestId.entries()) {
          const qKey = `${record.suiteId}::${testId}`;
          const entry = quarantine[qKey] ?? null;
          const isQuarantined = entry?.status === 'active';
          if (isQuarantined && entry) { const runsSince = allRunFiles.filter((r: RunRecord) => new Date(r.startedAt).getTime() > new Date(entry.quarantinedAt).getTime()).length; if (runsSince < fConfig.minRunsSinceQuarantine) continue; }
          const analysis = analyzeFlakiness(testRuns, fConfig, isQuarantined);
          if (!analysis) continue;
          const testName = record.tests?.find((t: any) => t.testId === testId)?.name ?? testId;
          if (analysis.shouldQuarantine && !isQuarantined) { upsertQuarantineEntry(record.suiteId, testId, testName, analysis, record.runId); justQuarantinedThisRun.add(testId); emitFlakeNotification('test_quarantined', record.suiteId, testId, record.runId, { testName, flakeScore: analysis.flakeScore }); }
          if (analysis.shouldAutoPromote && isQuarantined && entry?.autoQuarantined && !justQuarantinedThisRun.has(testId)) { restoreQuarantineEntry(record.suiteId, testId, record.runId); emitFlakeNotification('test_restored', record.suiteId, testId, record.runId, { testName }); }
        }
        const freshQuarantine = readQuarantine();
        for (const t of (record.tests ?? [])) { if (!t.testId) { t.testId = generateTestId(record.suiteId, t.name); } const qKey = `${record.suiteId}::${t.testId}`; if (freshQuarantine[qKey]?.status === 'active') { t.quarantined = true; } }
        const quarantinedFailCount = (record?.tests ?? []).filter((t: any) => t.quarantined === true && t.status === 'fail').length;
        if (quarantinedFailCount > 0) { console.log(`[budget] Quarantined failures this run: ${quarantinedFailCount}`); }
        fs.writeFileSync(runFile, JSON.stringify(record, null, 2));
      } catch (fErr) { logger.warn(`[flakiness] Post-run evaluation failed: ${(fErr as Error).message}`); }
    }
    try {
      const settingsRow = readAll<AppSettings & { id: string }>(SETTINGS)[0];
      const notifCfg = settingsRow?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
      const durationMs = record.finishedAt && record.startedAt ? new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime() : 0;
      const platformUrl = config.ui.baseUrl;
      const summary = { runId, suiteName: record.suiteName ?? 'Unknown Suite', projectName: record.projectName ?? 'Unknown Project', status: record.status as 'done' | 'failed', passed: record.passed, failed: record.failed, total: record.total, duration: formatDuration(durationMs), startedAt: record.startedAt, executedBy: record.executedBy ?? 'scheduler', environmentName: record.environmentName ?? 'Default', platformUrl };
      sendRunNotification(notifCfg, summary).then(errs => { if (errs.email) logger.warn(`[notify] Email error: ${errs.email}`); if (errs.slack) logger.warn(`[notify] Slack error: ${errs.slack}`); if (errs.teams) logger.warn(`[notify] Teams error: ${errs.teams}`); }).catch(e => logger.warn(`[notify] Unexpected error: ${e.message}`));
    } catch (e: any) { logger.warn(`[notify] Settings read error: ${e.message}`); }
    if (record.specPath && fs.existsSync(record.specPath)) { try { fs.unlinkSync(record.specPath); } catch { /* ignore */ } }
    onRunComplete();
  });
}