/**
 * codegenGenerator.ts
 *
 * Generates a Playwright Codegen-style .spec.ts file directly from
 * TestScript steps + Project config. No NLP, no plan JSON intermediary.
 *
 * URL and credentials are always sourced from project.credentials[].
 * Each keyword maps 1-to-1 to a Playwright call using the stored
 * locatorType to pick the right Playwright locator API.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { TestScript, ScriptStep, Project, ProjectEnvironment, CommonFunction, CommonData } from '../data/types';
import { readAll, COMMON_DATA } from '../data/store';
import { logger } from './logger';

// ── Locator builder ────────────────────────────────────────────────────────────
// Maps locatorType + value to Playwright locator expression string

function buildLocatorExpr(locatorType: string | null | undefined, locator: string): string {
  const t = (locatorType || 'css').toLowerCase();
  // Use double-quoted JS strings for all locators — avoids single-quote
  // conflicts with XPath predicates like normalize-space()='...'
  const dq = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  switch (t) {
    case 'text':    return `page.getByText("${dq(locator)}")`;
    case 'testid':  return `page.getByTestId("${dq(locator)}")`;
    case 'role': {
      const [role, ...nameParts] = locator.split(':');
      const name = nameParts.join(':').trim();
      return name
        ? `page.getByRole("${dq(role.trim())}", { name: "${dq(name)}" })`
        : `page.getByRole("${dq(role.trim())}")`;
    }
    case 'xpath':   return `page.locator("xpath=${dq(locator)}")`;
    case 'id':      return `page.locator("#${dq(locator.replace(/^#/, ''))}")`;
    case 'name':    return `page.locator("[name=\\"${dq(locator)}\\"]")`;
    case 'label':   return `page.getByLabel("${dq(locator)}")`;
    case 'placeholder': return `page.getByPlaceholder("${dq(locator)}")`;
    default:        return `page.locator("${dq(locator)}")`;   // css
  }
}

// ── Dynamic token resolver ─────────────────────────────────────────────────────
// Converts {{random.text(8)}} etc. to inline JS expression in the spec

function resolveToken(token: string): string {
  const t = token.trim();
  const m = t.match(/^\{\{(.+?)\}\}$/);
  if (!m) return `'${t.replace(/'/g, "\\'")}'`;

  const inner = m[1].trim();
  if (/^random\.text\((\d+)\)$/.test(inner)) {
    const len = inner.match(/\d+/)![0];
    return `Math.random().toString(36).substring(2, 2 + ${len})`;
  }
  if (/^random\.number\((\d+),(\d+)\)$/.test(inner)) {
    const [, min, max] = inner.match(/(\d+),(\d+)/)!;
    return `(Math.floor(Math.random() * (${max} - ${min} + 1)) + ${min}).toString()`;
  }
  if (/^random\.email$/.test(inner)) {
    return '`test_${Math.random().toString(36).substring(2, 10)}@qa.local`';
  }
  if (/^date\.today$/.test(inner)) {
    return 'new Date().toISOString().split("T")[0]';
  }
  // Unknown token — emit as literal string
  return `'${t.replace(/'/g, "\\'")}'`;
}

// ── Common Data resolver ───────────────────────────────────────────────────────
// Replaces ${varName} tokens with values from Common Data for the given project+env

function buildDataMap(projectId: string, environment: string | null | undefined): Record<string, string> {
  const env = environment || '';
  return readAll<CommonData>(COMMON_DATA)
    .filter(d => d.projectId === projectId && (!env || d.environment === env))
    .reduce((map, d) => { map[d.dataName] = d.value; return map; }, {} as Record<string, string>);
}

function resolveDataTokens(raw: string, dataMap: Record<string, string>): string {
  return raw.replace(/\$\{([^}]+)\}/g, (_, name) => dataMap[name] ?? `\${${name}}`);
}

// ── Value expression ───────────────────────────────────────────────────────────

function valueExpr(step: ScriptStep, dataMap: Record<string, string> = {}, runIdx: number = 0): string {
  if (step.valueMode === 'testdata') {
    const rows = step.testData || [];
    if (!rows.length) return "''";
    const row = rows[runIdx] ?? rows[rows.length - 1];
    const raw = row?.value || '';
    return `'${raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  if (!step.value) return "''";
  const resolved = resolveDataTokens(step.value, dataMap);
  if (step.valueMode === 'dynamic') return resolveToken(resolved);
  return `'${resolved.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ── Auto navigation — injected at the top of every test() block ──────────────
// URL is always sourced from the environment selected on the suite (never from steps)

function generateNavBlock(
  environment: ProjectEnvironment | null | undefined,
  project: Project,
  indent: string,
): string {
  const url = environment?.url || project.appUrl || '';
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const envLabel = environment ? `"${environment.name}" environment` : 'project default';
  return [
    `${indent}// Auto-navigate — URL from ${envLabel} (SSO redirects are followed automatically)`,
    `${indent}await page.goto('${esc(url)}', { waitUntil: 'domcontentloaded' });`,
    `${indent}await page.waitForLoadState('domcontentloaded');`,
  ].join('\n');
}

// ── Single step → Playwright code line(s) ─────────────────────────────────────

function generateStepCode(
  step: ScriptStep,
  project: Project,
  environment: ProjectEnvironment | null | undefined,
  allFunctions: CommonFunction[],
  dataMap: Record<string, string>,
  indent: string,
  runIdx: number = 0,
): string {
  const kw  = (step.keyword || '').toUpperCase().trim();
  const loc = step.locator || '';
  const lt  = step.locatorType || 'css';
  const val = valueExpr(step, dataMap, runIdx);
  const comment = step.description ? `${indent}// ${step.description}` : '';

  const locExpr = loc ? buildLocatorExpr(lt, loc) : null;

  const line = (code: string) =>
    (comment ? comment + '\n' : '') + `${indent}${code}`;

  switch (kw) {
    // ── Navigation ──────────────────────────────────────────────────────────
    case 'GOTO':
      // URL navigation is auto-injected at the top of every test() by generateNavBlock.
      // Any GOTO step in a script is intentionally skipped here.
      return '';

    case 'NAVIGATE':
    case 'GOTO URL':
      if (loc) return line(`await page.goto(${val});`);
      return line(`await page.goto(${val});`);

    case 'RELOAD':
      return line(`await page.reload();`);

    case 'BACK':
      return line(`await page.goBack();`);

    case 'FORWARD':
      return line(`await page.goForward();`);

    // ── Actions ──────────────────────────────────────────────────────────────
    case 'CLICK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.click();`)
        : line(`// CLICK: missing locator`);

    case 'DBLCLICK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.dblclick();`)
        : line(`// DBLCLICK: missing locator`);

    case 'FILL':
    case 'TYPE': {
      const fillVal = val === "''" ? `''` : val;
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.fill(${fillVal});`)
        : line(`// FILL: missing locator`);
    }

    case 'CLEAR':
      return locExpr ? line(`await ${locExpr}.clear();`) : line(`// CLEAR: missing locator`);

    case 'SELECT':
      return locExpr ? line(`await ${locExpr}.selectOption(${val});`) : line(`// SELECT: missing locator`);

    case 'CHECK':
      return locExpr ? line(`await ${locExpr}.check();`) : line(`// CHECK: missing locator`);

    case 'UNCHECK':
      return locExpr ? line(`await ${locExpr}.uncheck();`) : line(`// UNCHECK: missing locator`);

    case 'HOVER':
      return locExpr ? line(`await ${locExpr}.hover();`) : line(`// HOVER: missing locator`);

    case 'FOCUS':
      return locExpr ? line(`await ${locExpr}.focus();`) : line(`// FOCUS: missing locator`);

    case 'PRESS KEY':
      return line(`await page.keyboard.press(${val});`);

    case 'UPLOAD FILE':
      return locExpr ? line(`await ${locExpr}.setInputFiles(${val});`) : line(`// UPLOAD: missing locator`);

    case 'SCROLL TO':
      return locExpr ? line(`await ${locExpr}.scrollIntoViewIfNeeded();`) : line(`await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`);

    case 'DRAG DROP': {
      const [src, tgt] = (step.locator || '').split('>>').map(s => s.trim());
      if (src && tgt) {
        return line(`await page.dragAndDrop('${src.replace(/'/g, "\\'")}', '${tgt.replace(/'/g, "\\'")}');`);
      }
      return line(`// DRAG DROP: set locator as "source >> target"`);
    }

    // ── Assertions ────────────────────────────────────────────────────────────
    case 'ASSERT VISIBLE':
      return locExpr ? line(`await expect(${locExpr}).toBeVisible();`) : line(`// ASSERT VISIBLE: missing locator`);

    case 'ASSERT HIDDEN':
    case 'ASSERTHIDDEN':
    case 'ASSERT NOT VISIBLE':
    case 'ASSERTNOTVISIBLE':
      return locExpr ? line(`await expect(${locExpr}).toBeHidden();`) : line(`// ASSERT HIDDEN: missing locator`);

    case 'ASSERT TEXT':
      return locExpr ? line(`await expect(${locExpr}).toContainText(${val});`) : line(`// ASSERT TEXT: missing locator`);

    case 'ASSERT VALUE':
      return locExpr ? line(`await expect(${locExpr}).toHaveValue(${val});`) : line(`// ASSERT VALUE: missing locator`);

    case 'ASSERT ATTRIBUTE':
      // value format: "attributeName=expectedValue"
      if (locExpr && step.value) {
        const [attr, ...rest] = step.value.split('=');
        const attrVal = rest.join('=');
        return line(`await expect(${locExpr}).toHaveAttribute('${attr.trim()}', '${attrVal.trim().replace(/'/g, "\\'")}');`);
      }
      return line(`// ASSERT ATTRIBUTE: set value as "attr=expected"`);

    case 'ASSERT COUNT':
      return locExpr ? line(`await expect(${locExpr}).toHaveCount(${val});`) : line(`// ASSERT COUNT: missing locator`);

    case 'ASSERT URL':
      return line(`await expect(page).toHaveURL(${val});`);

    case 'ASSERT TITLE':
      return line(`await expect(page).toHaveTitle(${val});`);

    case 'ASSERT CHECKED':
      return locExpr ? line(`await expect(${locExpr}).toBeChecked();`) : line(`// ASSERT CHECKED: missing locator`);

    case 'ASSERT ENABLED':
      return locExpr ? line(`await expect(${locExpr}).toBeEnabled();`) : line(`// ASSERT ENABLED: missing locator`);

    case 'ASSERT DISABLED':
      return locExpr ? line(`await expect(${locExpr}).toBeDisabled();`) : line(`// ASSERT DISABLED: missing locator`);

    case 'ASSERT CONTAINS':
      return locExpr ? line(`await expect(${locExpr}).toContainText(${val});`) : line(`// ASSERT CONTAINS: missing locator`);

    // ── Wait ──────────────────────────────────────────────────────────────────
    case 'WAIT SELECTOR':
    case 'WAITFORSELECTOR':
      return locExpr ? line(`await ${locExpr}.waitFor({ state: 'visible' });`) : line(`// WAITFORSELECTOR: missing locator`);

    case 'WAIT VISIBLE':
      return locExpr ? line(`await ${locExpr}.waitFor({ state: 'visible' });`) : line(`// WAIT VISIBLE: missing locator`);

    case 'WAIT HIDDEN':
      return locExpr ? line(`await ${locExpr}.waitFor({ state: 'hidden' });`) : line(`// WAIT HIDDEN: missing locator`);

    case 'WAIT PAGE LOAD':
    case 'WAIT NAVIGATION':
      return line(`await page.waitForLoadState('networkidle');`);

    case 'WAIT RESPONSE':
      return line(`await page.waitForResponse(${val});`);

    // ── Frame / Tab ───────────────────────────────────────────────────────────
    case 'SWITCH FRAME':
      return locExpr
        ? line(`const frame = page.frameLocator(${val || `'iframe'`});\n${indent}// Use frame.locator('...') for elements inside the frame`)
        : line(`// SWITCH FRAME: set locator to the iframe selector`);

    case 'SWITCH MAIN':
      return line(`// Back to main frame — frame variable goes out of scope`);

    case 'CLOSE TAB':
      return line(`await page.close();`);

    // ── Misc ──────────────────────────────────────────────────────────────────
    case 'SCREENSHOT':
    case 'SCREENSHOT ELEM':
      if (step.screenshot || kw === 'SCREENSHOT') {
        const ssPath = `screenshots/step-${step.order}.png`;
        return locExpr
          ? line(`await ${locExpr}.screenshot({ path: '${ssPath}' });`)
          : line(`await page.screenshot({ path: '${ssPath}' });`);
      }
      return '';

    case 'LOG':
      return line(`console.log(${val});`);

    case 'EVALUATE':
      return line(`await page.evaluate(${val || `() => {}`});`);

    // ── Call Common Function (inline expansion) ────────────────────────────────
    case 'CALL FUNCTION': {
      const fnName = step.value || '';
      const fn = allFunctions.find(f => f.name === fnName);
      if (!fn) {
        return line(`// CALL FUNCTION: '${fnName}' not found in Common Functions`);
      }
      const fnStepValues = (step as any).fnStepValues || [];
      const header = `${indent}// ── Inline: ${fn.name} ──`;
      const fnLines = (fn.steps || []).map((fs, fi) => {
        // Look up the value provided by the calling script step
        const saved = fnStepValues.find((v: any) => v.fnStepIdx === fi);
        const pseudoStep: ScriptStep = {
          id:          `fn-${fs.order}`,
          order:       fs.order,
          keyword:     fs.keyword,
          // Prefer stored locatorName (new builder), fall back to selector, then detail
          locator:     fs.selector || (fs as any).locatorName || fs.detail || null,
          locatorId:   null,
          locatorType: (fs as any).locatorType || 'css',
          valueMode:   saved?.valueMode || 'static',
          value:       saved?.value ?? null,
          testData:    saved?.testData || [],
          fnStepValues: [],
          description: (fs as any).description || fs.detail || '',
          screenshot:  false,
        };
        return generateStepCode(pseudoStep, project, environment, allFunctions, dataMap, indent, runIdx);
      });
      return [header, ...fnLines].join('\n');
    }

    default:
      return comment
        ? `${comment}\n${indent}// ⚠ Unknown keyword: ${kw}`
        : `${indent}// ⚠ Unknown keyword: ${kw}`;
  }
}

// ── Screenshot after step (if step.screenshot = true) ─────────────────────────

function maybeScreenshot(step: ScriptStep, indent: string, runIdx: number = 0): string {
  if (!step.screenshot) return '';
  const suffix = runIdx > 0 ? `-r${runIdx + 1}` : '';
  return `${indent}await page.screenshot({ path: 'screenshots/step-${step.order}-${step.keyword.toLowerCase()}${suffix}.png' });`;
}

// ── Build full .spec.ts for a suite ───────────────────────────────────────────

export interface CodegenInput {
  suiteName:     string;
  suiteId:       string;
  runId:         string;  // unique per run — prevents spec file collisions
  scripts:       TestScript[];
  project:       Project;
  environment:   ProjectEnvironment | null;  // selected env for this run
  allFunctions:  CommonFunction[];
}

export function generateCodegenSpec(input: CodegenInput): string {
  const { suiteName, runId, scripts, project, environment, allFunctions } = input;
  // Build Common Data map once for this run (project + environment)
  const dataMap = buildDataMap(project.id, environment?.name);
  const outputDir = path.resolve('tests', 'codegen');
  fs.mkdirSync(outputDir, { recursive: true });

  // Sanitise suite name → safe filename; suffix with short runId to avoid collisions
  const safeName = suiteName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
  const specPath = path.join(outputDir, `${safeName}-${runId.slice(0, 8)}.spec.ts`);

  const lines: string[] = [];

  // ── File header ──────────────────────────────────────────────────────────────
  lines.push(`/**`);
  lines.push(` * Auto-generated by QA Agent Platform — Playwright Codegen Engine`);
  lines.push(` * Suite  : ${suiteName}`);
  lines.push(` * Project: ${project.name}`);
  lines.push(` * URL    : ${environment?.url || project.appUrl || ''}`);
  lines.push(` * Generated: ${new Date().toISOString()}`);
  lines.push(` * DO NOT EDIT manually — re-run the suite to regenerate.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push(`import * as _fs from 'fs';`);
  lines.push(``);
  lines.push(`// Visual diff screenshot directory (unique per run)`);
  lines.push(`const __SS_DIR = 'test-results/${runId}';`);
  lines.push(`_fs.mkdirSync(__SS_DIR, { recursive: true });`);
  lines.push(``);

  // ── One test.describe per suite, one test() per script (or per data row) ─────
  lines.push(`test.describe('${suiteName.replace(/'/g, "\\'")}', () => {`);
  lines.push(``);

  for (const script of scripts) {
    const sortedSteps = script.steps.slice().sort((a, b) => a.order - b.order);
    const testName    = script.title.replace(/'/g, "\\'");

    // Determine number of parameterized runs from testdata steps
    // Each step with valueMode='testdata' contributes rows — use max row count
    // Steps are row-aligned: run 0 → row[0] of each testdata step, run 1 → row[1], etc.
    const tdRowCounts = sortedSteps
      .filter(s => s.valueMode === 'testdata' && (s.testData || []).length > 0)
      .map(s => s.testData.length);

    // Also account for testdata inside CALL FUNCTION child steps
    const fnTdCounts: number[] = [];
    for (const step of sortedSteps) {
      if ((step.keyword || '').toUpperCase() === 'CALL FUNCTION') {
        const fnStepValues = (step as any).fnStepValues || [];
        for (const fv of fnStepValues) {
          if (fv.valueMode === 'testdata' && (fv.testData || []).length > 0) {
            fnTdCounts.push(fv.testData.length);
          }
        }
      }
    }

    const allCounts = [...tdRowCounts, ...fnTdCounts];
    const numRuns   = allCounts.length > 0 ? Math.max(...allCounts) : 1;

    // testIdx tracks position across all scripts+rows — matches record.tests[] order
    for (let runIdx = 0; runIdx < numRuns; runIdx++) {
      const testIdx  = scripts.indexOf(script) * numRuns + runIdx;
      const runLabel = numRuns > 1 ? ` [row ${runIdx + 1}]` : '';
      lines.push(`  test('${testName}${runLabel.replace(/'/g, "\\'")}', async ({ page }) => {`);

      // Auto-inject navigation — URL from suite environment, never from steps
      lines.push(generateNavBlock(environment, project, '    '));
      lines.push('');

      // Keywords that don't need visual diff wrapping
      const NO_DIFF_KW = new Set(['SCREENSHOT', 'WAIT', 'GOTO', 'VERIFY', 'ASSERT TEXT', 'ASSERT VISIBLE', 'ASSERT HIDDEN', 'ASSERT VALUE']);

      for (const step of sortedSteps) {
        const kw       = (step.keyword || '').toUpperCase().trim();
        const needsDiff = !NO_DIFF_KW.has(kw);

        if (needsDiff) {
          // Before screenshot — captures page state just before this step
          lines.push(`    await page.screenshot({ path: \`\${__SS_DIR}/${testIdx}-before-${step.order}.png\`, fullPage: false }).catch(() => {});`);
          lines.push(`    try {`);
          const innerCode = generateStepCode(step, project, environment, allFunctions, dataMap, '      ', runIdx);
          if (innerCode) lines.push(innerCode);
          lines.push(`    } catch (__e_${step.order}) {`);
          // After screenshot — captures page state at the moment of failure
          lines.push(`      await page.screenshot({ path: \`\${__SS_DIR}/${testIdx}-after-${step.order}.png\`, fullPage: false }).catch(() => {});`);
          lines.push(`      throw __e_${step.order};`);
          lines.push(`    }`);
        } else {
          const code = generateStepCode(step, project, environment, allFunctions, dataMap, '    ', runIdx);
          if (code) lines.push(code);
        }

        const ss = maybeScreenshot(step, '    ', runIdx);
        if (ss) lines.push(ss);
      }

      lines.push(`  });`);
      lines.push(``);
    }
  }

  lines.push(`});`);
  lines.push(``);

  const content = lines.join('\n');
  fs.writeFileSync(specPath, content, 'utf-8');
  logger.info(`[codegenGenerator] Wrote spec → ${specPath}`);
  return specPath;
}

// ── Debug spec generator ───────────────────────────────────────────────────────
// Generates a Playwright spec that pauses before each step, captures a
// highlighted screenshot, and long-polls the server until the UI sends
// continue / skip / stop.

export interface DebugCodegenInput {
  sessionId:    string;
  script:       TestScript;
  project:      Project;
  environment:  ProjectEnvironment | null;
  allFunctions: CommonFunction[];
  port:         number;  // kept for interface compat; no longer used in spec
}

// Returns a plain string for display in the debugger step panel (not executed code)
function debugValueDisplay(step: ScriptStep): string {
  const mode = step.valueMode || 'static';
  if (mode === 'dynamic')    return `[dynamic: ${step.value || ''}]`;
  if (mode === 'commondata') return `[commondata: ${step.value || ''}]`;
  if (mode === 'testdata')   return '[testdata: row 1]';
  return step.value || '';
}

export function generateDebugSpec(input: DebugCodegenInput): string {
  const { sessionId, script, project, environment, allFunctions, port } = input;
  const dataMap    = buildDataMap(project.id, environment?.name);
  const outputDir  = path.resolve('tests', 'codegen');
  fs.mkdirSync(outputDir, { recursive: true });

  const ssDir    = `debug-runs/${sessionId}`;
  const specPath = path.join(outputDir, `debug-${sessionId.slice(0, 8)}.spec.ts`);
  const sortedSteps = script.steps.slice().sort((a, b) => a.order - b.order);
  const testName    = script.title.replace(/'/g, "\\'");
  const lines: string[] = [];

  // ── File header ────────────────────────────────────────────────────────────
  lines.push(`/** Auto-generated Debug Spec — QA Agent Platform */`);
  lines.push(`import { test } from '@playwright/test';`);
  lines.push(`import * as _fs from 'fs';`);
  lines.push(``);
  lines.push(`const __SS_DIR     = '${ssDir}';`);
  lines.push(`const __PENDING    = \`\${__SS_DIR}/pending.json\`;`);
  lines.push(`const __GATE       = \`\${__SS_DIR}/gate.json\`;`);
  lines.push(`_fs.mkdirSync(__SS_DIR, { recursive: true });`);
  lines.push(``);

  // ── __debugPause helper — file-based IPC ───────────────────────────────────
  // Writes step info to pending.json, then polls for gate.json written by server.
  // Zero network dependency — works regardless of proxy/firewall.
  lines.push(`async function __debugPause(`);
  lines.push(`  stepIdx: number, keyword: string, locator: string, value: string, ssPath: string`);
  lines.push(`): Promise<'continue' | 'skip' | 'stop'> {`);
  lines.push(`  // Signal the server: write step info`);
  lines.push(`  try { _fs.unlinkSync(__GATE); } catch {}`);
  lines.push(`  // Ensure screenshot file exists on disk before signaling server`);
  lines.push(`  await new Promise<void>(r => { const iv = setInterval(() => { if (_fs.existsSync(ssPath)) { clearInterval(iv); r(); } }, 50); setTimeout(() => { clearInterval(iv); r(); }, 5000); });`);
  lines.push(`  _fs.writeFileSync(__PENDING, JSON.stringify({ stepIdx, keyword, locator, value, screenshotPath: ssPath }));`);
  lines.push(`  // Wait for server to write gate.json (UI clicked Step/Skip/Stop)`);
  lines.push(`  return new Promise((resolve) => {`);
  lines.push(`    const iv = setInterval(() => {`);
  lines.push(`      try {`);
  lines.push(`        if (_fs.existsSync(__GATE)) {`);
  lines.push(`          const d = JSON.parse(_fs.readFileSync(__GATE, 'utf-8'));`);
  lines.push(`          clearInterval(iv);`);
  lines.push(`          try { _fs.unlinkSync(__GATE); } catch {}`);
  lines.push(`          try { _fs.unlinkSync(__PENDING); } catch {}`);
  lines.push(`          resolve(d.action || 'continue');`);
  lines.push(`        }`);
  lines.push(`      } catch {}`);
  lines.push(`    }, 300);`);
  lines.push(`    // Safety timeout: 30 minutes`);
  lines.push(`    setTimeout(() => { clearInterval(iv); resolve('stop'); }, 30 * 60 * 1000);`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push(``);

  // ── __waitForPageSettle — waits for DOM to fully settle, spinner-aware ───────────
  // Prevents capturing spinner/loading states in screenshots.
  // Algorithm:
  //   1. MutationObserver watches the DOM — resets 500ms quiet timer on every change.
  //   2. After 500ms of no mutations, checks for visible spinners/loaders.
  //   3. If spinner visible → re-arm 500ms timer (handles two-phase load: brief quiet
  //      between navigation settling and data-API call starting the spinner).
  //   4. If no spinner → resolve immediately.
  //   5. Safety cap: 8s max — never blocks the session.
  //   Zero static waits — all timing driven by DOM state.
  lines.push(`async function __waitForPageSettle(page: any): Promise<void> {`);
  lines.push(`  await page.evaluate(() => new Promise<void>(resolve => {`);
  lines.push(`    // Tiered timing: 200ms initial → 300ms after mutations → 500ms when spinner found`);
  lines.push(`    const INIT_MS    = 200;  // initial check — already-stable pages resolve fast`);
  lines.push(`    const QUIET_MS   = 300;  // re-arm after any DOM mutation`);
  lines.push(`    const SPINNER_MS = 500;  // extra wait when spinner is still visible`);
  lines.push(`    const MAX_MS     = 8000; // safety cap`);
  lines.push(`    const hasVisibleSpinner = (): boolean => {`);
  lines.push(`      // Semantic roles + specific spinner patterns.`);
  lines.push(`      // [class*="spin"] and [class*="loader"] included for custom spinners (e.g. BillCall).`);
  lines.push(`      // Size guard (offsetWidth/Height < 4) prevents false positives from zero-size hidden elements.`);
  lines.push(`      // Avoids [class*="loading"] and [class*="progress"] — too broad, match normal Angular form elements.`);
  lines.push(`      const sel = '[role="progressbar"],[aria-busy="true"],.fa-spin,' +`);
  lines.push(`        'mat-spinner,mat-progress-spinner,mat-progress-bar,' +`);
  lines.push(`        '[class*="spinner"],[class*="skeleton"],[class*="shimmer"],' +`);
  lines.push(`        '[class*="spin"],[class*="loader"]';`);
  lines.push(`      const nodes = document.querySelectorAll(sel);`);
  lines.push(`      for (let i = 0; i < nodes.length; i++) {`);
  lines.push(`        const el = nodes[i] as HTMLElement;`);
  lines.push(`        if (el.offsetWidth < 4 && el.offsetHeight < 4) continue; // skip zero-size hidden elements`);
  lines.push(`        const st = window.getComputedStyle(el);`);
  lines.push(`        if (st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0') return true;`);
  lines.push(`      }`);
  lines.push(`      return false;`);
  lines.push(`    };`);
  lines.push(`    let t: ReturnType<typeof setTimeout> | null = null;`);
  lines.push(`    const tryResolve = () => {`);
  lines.push(`      if (hasVisibleSpinner()) {`);
  lines.push(`        // Spinner still visible — keep waiting with longer re-arm`);
  lines.push(`        t = setTimeout(tryResolve, SPINNER_MS);`);
  lines.push(`      } else {`);
  lines.push(`        obs.disconnect();`);
  lines.push(`        clearTimeout(safetyTimer);`);
  lines.push(`        resolve();`);
  lines.push(`      }`);
  lines.push(`    };`);
  lines.push(`    const obs = new MutationObserver(() => {`);
  lines.push(`      if (t !== null) clearTimeout(t);`);
  lines.push(`      t = setTimeout(tryResolve, QUIET_MS);`);
  lines.push(`    });`);
  lines.push(`    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });`);
  lines.push(`    // Initial arm — short window for already-stable pages`);
  lines.push(`    t = setTimeout(tryResolve, INIT_MS);`);
  lines.push(`    // Safety cap — always resolve eventually`);
  lines.push(`    const safetyTimer = setTimeout(() => { obs.disconnect(); if (t) clearTimeout(t); resolve(); }, MAX_MS);`);
  lines.push(`  })).catch(async () => {`);
  lines.push(`    // evaluate threw — full-page navigation occurred (e.g. login → dashboard)`);
  lines.push(`    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});`);
  lines.push(`    await page.waitForSelector('input:not([type="hidden"]), button', { timeout: 5000 }).catch(() => {});`);
  lines.push(`    // After navigation: also wait for data-loading spinners to clear.`);
  lines.push(`    // domcontentloaded + waitForSelector resolve before API-driven spinners disappear.`);
  lines.push(`    await page.waitForFunction(() => {`);
  lines.push(`      const sel = '[role="progressbar"],[aria-busy="true"],.fa-spin,' +`);
  lines.push(`        'mat-spinner,mat-progress-spinner,mat-progress-bar,' +`);
  lines.push(`        '[class*="spinner"],[class*="skeleton"],[class*="shimmer"],' +`);
  lines.push(`        '[class*="spin"],[class*="loader"]';`);
  lines.push(`      const nodes = document.querySelectorAll(sel);`);
  lines.push(`      for (let i = 0; i < nodes.length; i++) {`);
  lines.push(`        const el = nodes[i] as HTMLElement;`);
  lines.push(`        if ((el as any).offsetWidth < 4 && (el as any).offsetHeight < 4) continue;`);
  lines.push(`        const st = window.getComputedStyle(el);`);
  lines.push(`        if (st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0') return false;`);
  lines.push(`      }`);
  lines.push(`      return true; // no visible spinner — page is settled`);
  lines.push(`    }, { timeout: 8000 }).catch(() => {});`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push(``);

  // ── __debugHighlight — highlights target element in screenshot ─────────────────
  // Uses Playwright's native locator API so ALL locator types work
  // (text, testid, role, label, placeholder, xpath, id, name, css).
  // Color is keyed to action type for instant visual context.
  lines.push(`async function __debugHighlight(page: any, locType: string, locVal: string, keyword: string): Promise<void> {`);
  lines.push(`  // Clear any previous highlight`);
  lines.push(`  await page.evaluate(() => {`);
  lines.push(`    document.querySelectorAll('[data-dbg-hl]').forEach((e: any) => {`);
  lines.push(`      e.style.outline = ''; e.style.outlineOffset = ''; e.style.backgroundColor = '';`);
  lines.push(`      e.removeAttribute('data-dbg-hl');`);
  lines.push(`    });`);
  lines.push(`  }).catch(() => {});`);
  lines.push(`  if (!locVal) return;`);
  lines.push(`  const kw = keyword.toUpperCase();`);
  lines.push(`  const color = ['CLICK', 'DBLCLICK'].includes(kw) ? '#ef4444'`);
  lines.push(`    : ['FILL', 'TYPE', 'CLEAR'].includes(kw)        ? '#3b82f6'`);
  lines.push(`    : ['SELECT', 'CHECK', 'UNCHECK'].includes(kw)   ? '#f97316'`);
  lines.push(`    : ['HOVER', 'FOCUS'].includes(kw)               ? '#eab308'`);
  lines.push(`    : kw.startsWith('ASSERT')                       ? '#22c55e'`);
  lines.push(`    : '#8b5cf6';`);
  lines.push(`  try {`);
  lines.push(`    let loc: any;`);
  lines.push(`    switch (locType) {`);
  lines.push(`      case 'text':        loc = page.getByText(locVal, { exact: false }); break;`);
  lines.push(`      case 'testid':      loc = page.getByTestId(locVal); break;`);
  lines.push(`      case 'label':       loc = page.getByLabel(locVal); break;`);
  lines.push(`      case 'placeholder': loc = page.getByPlaceholder(locVal); break;`);
  lines.push(`      case 'xpath':       loc = page.locator('xpath=' + locVal); break;`);
  lines.push(`      case 'id':          loc = page.locator('#' + locVal.replace(/^#/, '')); break;`);
  lines.push(`      case 'name':        loc = page.locator('[name="' + locVal.replace(/"/g, '\\\\"') + '"]'); break;`);
  lines.push(`      case 'role': {`);
  lines.push(`        const [r, ...np] = locVal.split(':'); const n = np.join(':').trim();`);
  lines.push(`        loc = n ? page.getByRole(r.trim() as any, { name: n }) : page.getByRole(r.trim() as any); break;`);
  lines.push(`      }`);
  lines.push(`      default: loc = page.locator(locVal); break;`);
  lines.push(`    }`);
  lines.push(`    await loc.first().evaluate((el: any, c: string) => {`);
  lines.push(`      el.style.outline = '3px solid ' + c;`);
  lines.push(`      el.style.outlineOffset = '2px';`);
  lines.push(`      el.style.backgroundColor = c + '20';`);
  lines.push(`      el.setAttribute('data-dbg-hl', '1');`);
  lines.push(`      el.scrollIntoView({ block: 'center', behavior: 'instant' });`);
  lines.push(`    }, color, { timeout: 2000 });`);
  lines.push(`  } catch {}`);
  lines.push(`}`);
  lines.push(``);

  // ── Test block ──────────────────────────────────────────────────────────────
  lines.push(`test.use({ viewport: { width: 1440, height: 900 } });`);
  lines.push(``);
  lines.push(`test.describe('Debug: ${testName}', () => {`);
  lines.push(`  test.setTimeout(30 * 60 * 1000); // 30-min timeout for interactive debug`);
  lines.push(`  test('${testName}', async ({ page }) => {`);
  lines.push(``);

  // Auto-navigate first
  lines.push(generateNavBlock(environment, project, '    '));
  // DOM-state wait — polls until the page has actually rendered content.
  // This works for SPAs (React/Angular/Vue) where load event fires before JS renders the DOM,
  // and for server-rendered pages equally. No hardcoded selectors, no blind timeouts.
  lines.push(`    // DOM-state wait: poll until page has interactive elements (input or button)`);
  lines.push(`    // Works for any app/framework — Angular, React, Vue, SSR, SSO.`);
  lines.push(`    // Resolves the moment the SPA finishes rendering its UI — no blind timeouts.`);
  lines.push(`    await page.waitForSelector('input:not([type="hidden"]), button', { timeout: 15000 }).catch(() => {});`);
  lines.push(`    await page.waitForTimeout(200); // brief CSS/paint buffer`);
  lines.push(`    await page.screenshot({ path: \`\${__SS_DIR}/0-NAV.jpg\`, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);
  lines.push(`    // Ensure screenshot file exists on disk before signaling server`);
  lines.push(`    await new Promise<void>(r => { const iv = setInterval(() => { if (_fs.existsSync(\`\${__SS_DIR}/0-NAV.jpg\`)) { clearInterval(iv); r(); } }, 50); setTimeout(() => { clearInterval(iv); r(); }, 5000); });`);
  lines.push(`    _fs.writeFileSync(__PENDING, JSON.stringify({ stepIdx: 0, keyword: 'NAVIGATE', locator: '', value: '', screenshotPath: \`\${__SS_DIR}/0-NAV.jpg\` }));`);
  lines.push(`    await (async () => { try { _fs.unlinkSync(__GATE); } catch {} })();`);
  lines.push(`    await new Promise<void>(r => { const iv = setInterval(() => { try { if (_fs.existsSync(__GATE)) { clearInterval(iv); try { _fs.unlinkSync(__GATE); } catch {} try { _fs.unlinkSync(__PENDING); } catch {} r(); } } catch {} }, 300); setTimeout(() => { clearInterval(iv); r(); }, 30*60*1000); });`);
  lines.push('');

  for (const step of sortedSteps) {
    const kw      = (step.keyword || '').toUpperCase().trim();
    const loc     = step.locator || '';
    const lt      = step.locatorType || 'css';
    const dispVal = debugValueDisplay(step).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const dispLoc = loc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const kwSlug  = kw.replace(/\s+/g, '_');

    // ── CALL FUNCTION: expand sub-steps into individual debug blocks ─────────
    // Each sub-step gets its own highlight + screenshot + pause + execute cycle
    // so the debugger can trace inside a Common Function step-by-step.
    if (kw === 'CALL FUNCTION') {
      const fnName      = step.value || '';
      const fn          = allFunctions.find(f => f.name === fnName);
      const fnStepValues = (step as any).fnStepValues || [];
      const fnSortedSteps = (fn?.steps || []).slice().sort((a: any, b: any) => a.order - b.order);

      // ── Parent pause: screenshot of current page state, label shows function name ──
      // Skip at this level = skip the entire function (all sub-steps are wrapped inside)
      const parentSsVar = `__ss_${step.order}_fn`;
      lines.push(`    // Step ${step.order}: CALL FUNCTION — ${fnName || '(unknown)'}${fn ? ` (${fnSortedSteps.length} sub-steps)` : ' — not found'}`);
      lines.push(`    {`);
      lines.push(`      const ${parentSsVar} = \`\${__SS_DIR}/${step.order}-CALL_FUNCTION.jpg\`;`);
      lines.push(`      await page.screenshot({ path: ${parentSsVar}, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);
      lines.push(`      const __act_${step.order}_fn = await __debugPause(${step.order}, 'CALL FUNCTION', '', '${fnName.replace(/'/g, "\\'")}', ${parentSsVar});`);
      lines.push(`      if (__act_${step.order}_fn === 'stop') { await page.close().catch(() => {}); return; }`);
      lines.push(`      if (__act_${step.order}_fn !== 'skip') {`);

      if (fn && fnSortedSteps.length > 0) {
        // ── Sub-step blocks ────────────────────────────────────────────────────
        fnSortedSteps.forEach((fs: any, fi: number) => {
          const saved      = fnStepValues.find((v: any) => v.fnStepIdx === fi);
          const pseudoStep: ScriptStep = {
            id:           `fn-${fs.order}`,
            order:        fs.order,
            keyword:      fs.keyword,
            locator:      fs.selector || (fs as any).locatorName || fs.detail || null,
            locatorId:    null,
            locatorType:  (fs as any).locatorType || 'css',
            valueMode:    saved?.valueMode || 'static',
            value:        saved?.value ?? null,
            testData:     saved?.testData || [],
            fnStepValues: [],
            description:  (fs as any).description || fs.detail || '',
            screenshot:   false,
          };

          const subKw      = (pseudoStep.keyword || '').toUpperCase().trim();
          const subLoc     = pseudoStep.locator || '';
          const subLt      = pseudoStep.locatorType || 'css';
          const subDispVal = debugValueDisplay(pseudoStep).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const subDispLoc = subLoc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const subKwSlug  = subKw.replace(/\s+/g, '_');
          const subNum     = fi + 1;                         // 1-based sub-step index
          const subStepIdx = parseFloat(`${step.order}.${subNum}`); // 1.1, 1.2, 1.3 …
          const subSsVar   = `__ss_${step.order}_${subNum}`;
          const subActVar  = `__act_${step.order}_${subNum}`;
          const subDesc    = pseudoStep.description ? ` — ${pseudoStep.description}` : '';

          lines.push(`        // Sub-step ${step.order}.${subNum}: ${subKw}${subDesc} [fn: ${fnName}]`);
          lines.push(`        {`);

          if (subLoc) {
            lines.push(`          await __debugHighlight(page, '${subLt}', '${subLoc.replace(/'/g, "\\'")}', '${subKw}');`);
          }

          lines.push(`          const ${subSsVar} = \`\${__SS_DIR}/${step.order}.${subNum}-${subKwSlug}.jpg\`;`);
          lines.push(`          await page.screenshot({ path: ${subSsVar}, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);
          lines.push(`          const ${subActVar} = await __debugPause(${subStepIdx}, '${subKw}', '${subDispLoc}', '${subDispVal}', ${subSsVar});`);
          lines.push(`          if (${subActVar} === 'stop') { await page.close().catch(() => {}); return; }`);
          lines.push(`          if (${subActVar} !== 'skip') {`);

          // Note: nested CALL FUNCTION inside a function runs without sub-pause (one level deep only)
          const subCode = generateStepCode(pseudoStep, project, environment, allFunctions, dataMap, '            ', 0);
          if (subCode) lines.push(subCode);
          lines.push(`            await __waitForPageSettle(page);`);

          lines.push(`          }`);
          lines.push(`        }`);
          lines.push(``);
        });
      } else {
        // Function not found or empty — emit a comment so spec still compiles
        lines.push(`        // CALL FUNCTION '${fnName}' — not found in Common Functions or has no steps`);
      }

      lines.push(`      }`); // close: if not skip
      lines.push(`    }`);   // close parent block
      lines.push(``);
      continue; // ← skip the regular block below for this step
    }

    // ── Regular step (non CALL FUNCTION) — unchanged behaviour ───────────────
    const ssVar = `__ss_${step.order}`;

    lines.push(`    // Step ${step.order}: ${kw}${step.description ? ' — ' + step.description : ''}`);
    lines.push(`    {`);

    // Highlight target element (color-coded by keyword type)
    if (loc) {
      lines.push(`      await __debugHighlight(page, '${lt}', '${loc.replace(/'/g, "\\'")}', '${kw}');`);
    }

    // Capture step screenshot — JPEG for 5× smaller file vs PNG
    lines.push(`      const ${ssVar} = \`\${__SS_DIR}/${step.order}-${kwSlug}.jpg\`;`);
    lines.push(`      await page.screenshot({ path: ${ssVar}, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);

    // Pause — long-poll until UI acts
    lines.push(`      const __act_${step.order} = await __debugPause(${step.order}, '${kw}', '${dispLoc}', '${dispVal}', ${ssVar});`);
    lines.push(`      if (__act_${step.order} === 'stop') { await page.close().catch(() => {}); return; }`);
    lines.push(`      if (__act_${step.order} !== 'skip') {`);

    // Actual step execution
    const code = generateStepCode(step, project, environment, allFunctions, dataMap, '        ', 0);
    if (code) lines.push(code);
    // Wait for DOM/network to settle
    lines.push(`        await __waitForPageSettle(page);`);

    lines.push(`      }`);
    lines.push(`    }`);
    lines.push(``);
  }

  // ── Final pause — keeps browser open so user can inspect result before close ──
  // Takes a final screenshot then waits for Stop/Continue from UI.
  // The test only ends (browser closes) after the user explicitly acts.
  const finalSsVar = `__ss_final`;
  lines.push(`    // ── Final step: all steps complete — wait for user to close ──`);
  lines.push(`    {`);
  lines.push(`      const ${finalSsVar} = \`\${__SS_DIR}/final-done.jpg\`;`);
  lines.push(`      await page.screenshot({ path: ${finalSsVar}, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);
  lines.push(`      await __debugPause(9999, 'DONE', '', 'All steps complete', ${finalSsVar});`);
  lines.push(`    }`);
  lines.push(``);

  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);

  const content = lines.join('\n');
  fs.writeFileSync(specPath, content, 'utf-8');
  logger.info(`[generateDebugSpec] Wrote debug spec → ${specPath}`);
  return specPath;
}
