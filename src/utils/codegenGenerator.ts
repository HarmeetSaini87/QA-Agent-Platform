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
  scripts:       TestScript[];
  project:       Project;
  environment:   ProjectEnvironment | null;  // selected env for this run
  allFunctions:  CommonFunction[];
}

export function generateCodegenSpec(input: CodegenInput): string {
  const { suiteName, scripts, project, environment, allFunctions } = input;
  // Build Common Data map once for this run (project + environment)
  const dataMap = buildDataMap(project.id, environment?.name);
  const outputDir = path.resolve('tests', 'codegen');
  fs.mkdirSync(outputDir, { recursive: true });

  // Sanitise suite name → safe filename
  const safeName = suiteName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
  const specPath = path.join(outputDir, `${safeName}.spec.ts`);

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

    for (let runIdx = 0; runIdx < numRuns; runIdx++) {
      const runLabel = numRuns > 1 ? ` [row ${runIdx + 1}]` : '';
      lines.push(`  test('${testName}${runLabel.replace(/'/g, "\\'")}', async ({ page }) => {`);

      // Auto-inject navigation — URL from suite environment, never from steps
      lines.push(generateNavBlock(environment, project, '    '));
      lines.push('');

      for (const step of sortedSteps) {
        const code = generateStepCode(step, project, environment, allFunctions, dataMap, '    ', runIdx);
        if (code) lines.push(code);
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
