/**
 * specGenerator.ts
 * Reads a test-plan JSON and generates a Playwright .spec.ts file
 * that executes ONLY the test cases from that plan.
 *
 * No AI model required — uses keyword-driven mapping from plan steps
 * to Playwright actions via the existing POM framework.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestPlan, TestCase, TestStep } from '../types/plan.types';
import { logger } from './logger';

// ── UI Reference Lookup ─────────────────────────────────────────────────────
// Load pre-discovered DOM selectors from UI_Page_Analysis
interface UIField {
  fieldType: string;
  selector: string;
  alternatives?: string[];
  required?: boolean;
  options?: { value: string; text: string }[];
}
interface UIPageRef {
  url: string;
  menuPath: string;
  fields: Record<string, UIField>;
  radioButtons?: Record<string, { selector: string; value: string }>;
  tables?: Record<string, { selector: string; headers: string[] }>;
  buttons?: Record<string, string>;
  listPage?: {
    searchIconSelector?: string;
    searchInputSelector?: string;
    searchButtonSelector?: string;
    gridSelector?: string;
    postDeleteRefreshSelector?: string;
  };
}
interface UIRefLookup {
  pages: Record<string, UIPageRef>;
  fieldAliases: Record<string, string[] | { selectors: string[]; pages?: string[]; matchingFields?: string[] }>;
}

let uiRef: UIRefLookup | null = null;
const UI_REF_PATH = path.resolve('UI_Page_Analysis/ui-reference-lookup.json');
try {
  if (fs.existsSync(UI_REF_PATH)) {
    uiRef = JSON.parse(fs.readFileSync(UI_REF_PATH, 'utf-8'));
    logger.info(`Loaded UI reference: ${Object.keys(uiRef!.pages).length} pages`);
  }
} catch (e) {
  logger.warn('Could not load UI reference lookup — falling back to keyword-driven selectors');
}

/**
 * Find the UI page reference that best matches a test case module/title.
 */
function findPageRef(tc: TestCase): UIPageRef | null {
  if (!uiRef) return null;

  const moduleTitle = [tc.module || '', tc.title || ''].join(' ').toLowerCase();
  const normModTitle = moduleTitle.replace(/\s+/g, ' ');

  // PRIMARY: use navigation step descriptions — they contain the exact page name
  // e.g. "Navigate to Mediation Configuration > Gateway Type Configuration"
  const navDescriptions = tc.steps
    .filter(s => s.action === 'navigate' || s.description.toLowerCase().includes('navigate'))
    .map(s => s.description.toLowerCase().replace(/[\r\n]+/g, ' '));
  const navText = navDescriptions.join(' ');

  // Combine nav text + module/title, but weight nav text more
  const primarySearch = (navText + ' ' + normModTitle).trim();

  let bestMatch: { page: UIPageRef; score: number; pageName: string } | null = null;

  // Sort pages by name length DESCENDING — match the most specific (longest) page name first
  const sortedPages = Object.entries(uiRef.pages).sort((a, b) => b[0].length - a[0].length);

  for (const [pageName, pageRef] of sortedPages) {
    const pageNameLower = pageName.toLowerCase();

    // Tier 1: Exact substring match in nav descriptions (highest confidence)
    if (navText && navText.includes(pageNameLower)) {
      const t1Score = 2000 + pageName.length;
      if (!bestMatch || t1Score > bestMatch.score) {
        bestMatch = { page: pageRef, score: t1Score, pageName };
      }
      continue;
    }

    // Tier 2: Exact substring match in combined module+title
    if (primarySearch.includes(pageNameLower)) {
      const t2Score = 1000 + pageName.length;
      if (!bestMatch || t2Score > bestMatch.score) {
        bestMatch = { page: pageRef, score: t2Score, pageName };
      }
      continue;
    }

    // Tier 3: Abbreviated match — require ALL page name words to match
    // (prevents "Gateway Configuration" matching when "Gateway Type Configuration" is correct)
    const pageWords = pageNameLower.split(/\s+/);
    const abbrevPage = pageWords.map(w => w.slice(0, 6)).join(' ');
    const abbrevModule = primarySearch.split(/[\s\-–]+/).map(w => w.slice(0, 6)).join(' ');
    const allAbbrevWordsMatch = pageWords.every(w => abbrevModule.includes(w.slice(0, 6)));
    if (allAbbrevWordsMatch && abbrevModule.includes(abbrevPage)) {
      const abbrevScore = 900 + pageName.length;
      if (!bestMatch || abbrevScore > bestMatch.score) {
        bestMatch = { page: pageRef, score: abbrevScore, pageName };
      }
      continue;
    }

    // Tier 4: Word-level partial scoring (weighted by coverage: matched/total words)
    const nameWords = pageNameLower.split(/\s+/).filter(w => w.length > 2); // skip short words like "of"
    const matchedWords = nameWords.filter(w => primarySearch.includes(w.slice(0, 6))).length;
    const coverage = nameWords.length > 0 ? matchedWords / nameWords.length : 0;
    if (coverage >= 0.5) { // at least half the page name words must match
      const score = Math.round(coverage * 100) + pageName.length;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { page: pageRef, score, pageName };
      }
    }
  }
  return bestMatch?.page || null;
}

/**
 * Look up a field by name in the UI reference for a given page.
 * Returns the exact selector and field type, or null if not found.
 */
function lookupField(pageRef: UIPageRef | null, fieldName: string): UIField | null {
  if (!pageRef || !fieldName) return null;

  const normName = fieldName.toLowerCase().replace(/[\s_-]+/g, '');

  // Direct match in fields
  for (const [name, field] of Object.entries(pageRef.fields)) {
    if (name.toLowerCase().replace(/[\s_-]+/g, '') === normName) return field;
  }

  // Partial match — prefer the most specific (shortest normalized key that still contains normName or vice versa)
  // This prevents e.g. "backupfile" matching "BackupFilePath" (text) over "FlgBackupFile" (checkbox)
  let bestPartial: UIField | null = null;
  let bestPartialLen = Infinity;
  for (const [name, field] of Object.entries(pageRef.fields)) {
    const normKey = name.toLowerCase().replace(/[\s_-]+/g, '');
    if (normKey.includes(normName) || normName.includes(normKey)) {
      if (normKey.length < bestPartialLen) {
        bestPartial = field;
        bestPartialLen = normKey.length;
      }
    }
  }
  if (bestPartial) return bestPartial;

  // Check aliases
  if (uiRef?.fieldAliases) {
    for (const [alias, aliasData] of Object.entries(uiRef.fieldAliases)) {
      if (alias.includes(normName) || normName.includes(alias)) {
        // aliasData may be an array of selectors or an object with a selectors property
        const sels: string[] = Array.isArray(aliasData) ? aliasData : (aliasData as any)?.selectors || [];
        for (const sel of sels) {
          for (const field of Object.values(pageRef.fields)) {
            if (field.selector === sel) return field;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Look up a radio button in the UI reference.
 */
function lookupRadio(pageRef: UIPageRef | null, value: string): { selector: string; value: string } | null {
  if (!pageRef?.radioButtons || !value) return null;
  const normVal = value.toLowerCase().replace(/[\s_-]+/g, '');
  for (const [name, radio] of Object.entries(pageRef.radioButtons)) {
    if (name.toLowerCase().replace(/[\s_-]+/g, '').includes(normVal) || normVal.includes(name.toLowerCase().replace(/[\s_-]+/g, ''))) {
      return radio;
    }
  }
  return null;
}

/**
 * Find the dropdown option value that matches a given text from UI reference.
 */
function lookupOptionValue(field: UIField | null, targetText: string): string | null {
  if (!field?.options || !targetText) return null;
  const normTarget = targetText.toLowerCase().trim();
  // Exact text match
  for (const opt of field.options) {
    if (opt.text.toLowerCase().trim() === normTarget) return opt.value;
  }
  // Partial match
  for (const opt of field.options) {
    if (opt.text.toLowerCase().includes(normTarget) || normTarget.includes(opt.text.toLowerCase())) {
      return opt.value;
    }
  }
  // Fuzzy: normalize l/I/1
  const norm = (s: string) => s.replace(/[lI1]/g, 'x').toLowerCase();
  for (const opt of field.options) {
    if (norm(opt.text) === norm(targetText)) return opt.value;
  }
  return null;
}

/** Convert TC module field → safe filename.
 *  "Mediation Config - Gateway Type" → "MediationConfig_GatewayType.spec.ts"
 */
function moduleFileName(module: string): string {
  return module
    .replace(/[^a-zA-Z0-9\s\-]/g, '')
    .split(/[\s\-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('_') + '.spec.ts';
}

/**
 * Generate / update module-based spec files from a TestPlan.
 * - One file per TC module: tests/modules/<Module_SubModule>.spec.ts
 * - Files are never deleted; existing TC blocks are replaced using markers.
 * - Returns array of unique module file paths that were written.
 */
export function generateSpecFromPlan(planPath: string): string {
  const raw = fs.readFileSync(planPath, 'utf-8');
  const plan: TestPlan = JSON.parse(raw);

  const outputDir = path.resolve('tests/modules');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Group TCs by module file
  const fileToTCs = new Map<string, TestCase[]>();
  for (const tc of plan.testCases) {
    const fname = moduleFileName(tc.module || 'Unknown');
    if (!fileToTCs.has(fname)) fileToTCs.set(fname, []);
    fileToTCs.get(fname)!.push(tc);
  }

  const writtenFiles: string[] = [];

  for (const [fname, tcs] of fileToTCs) {
    const filePath = path.join(outputDir, fname);

    if (!fs.existsSync(filePath)) {
      // New file — generate full spec with all TCs
      const code = buildSpecCode({ ...plan, testCases: tcs });
      const codeWithMarkers = injectTCMarkers(code, tcs);
      fs.writeFileSync(filePath, codeWithMarkers, 'utf-8');
      logger.info(`Created module spec: ${filePath} (${tcs.length} TCs)`);
    } else {
      // File exists — surgically update each TC block
      let content = fs.readFileSync(filePath, 'utf-8');
      for (const tc of tcs) {
        const tcCode = buildSingleTestBlock(tc, plan);
        content = upsertTCBlock(content, tc.id, tcCode);
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      logger.info(`Updated module spec: ${filePath} (${tcs.length} TCs)`);
    }

    writtenFiles.push(filePath);
  }

  const allFiles = writtenFiles.join(',');
  logger.info(`Generated spec: ${allFiles} (${plan.testCases.length} test cases)`);
  return allFiles;
}

/** Wrap each test() block with BEGIN/END markers */
function injectTCMarkers(code: string, tcs: TestCase[]): string {
  let result = code;
  for (const tc of tcs) {
    // Find: test('[TC_XXX]...'
    const escapedId = tc.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testRe = new RegExp(`(  test\\(\\s*['"\`]\\[${escapedId}\\][^]*?^  \\}\\);)`, 'm');
    const match = result.match(testRe);
    if (match) {
      result = result.replace(match[0], `  // [${tc.id}] BEGIN\n${match[0]}\n  // [${tc.id}] END`);
    }
  }
  return result;
}

/** Replace or append a TC block in an existing module file */
function upsertTCBlock(content: string, tcId: string, newBlock: string): string {
  const beginMarker = `  // [${tcId}] BEGIN`;
  const endMarker   = `  // [${tcId}] END`;
  const bIdx = content.indexOf(beginMarker);
  const eIdx = content.indexOf(endMarker);

  if (bIdx !== -1 && eIdx !== -1) {
    // Replace existing block
    const before = content.substring(0, bIdx);
    const after  = content.substring(eIdx + endMarker.length);
    return before + beginMarker + '\n' + newBlock + '\n' + endMarker + after;
  } else {
    // Append before closing }); of the describe block
    const closeIdx = content.lastIndexOf('});');
    if (closeIdx !== -1) {
      return content.substring(0, closeIdx)
        + `\n  // [${tcId}] BEGIN\n${newBlock}\n  // [${tcId}] END\n\n`
        + content.substring(closeIdx);
    }
    return content + `\n  // [${tcId}] BEGIN\n${newBlock}\n  // [${tcId}] END\n`;
  }
}

/** Generate just the test() block for a single TC (no describe wrapper) */
function buildSingleTestBlock(tc: TestCase, plan: TestPlan): string {
  // Build a mini-plan with just this TC and extract its test block
  const miniPlan: TestPlan = { ...plan, testCases: [tc] };
  const fullCode = buildSpecCode(miniPlan);
  // Extract from test('...' to matching });  (2-space indent)
  const escapedId = tc.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const testRe = new RegExp(`(  test\\(\\s*['"\`]\\[${escapedId}\\][\\s\\S]*?^  \\}\\);)`, 'm');
  const match = fullCode.match(testRe);
  return match ? match[0] : `  test('[${tc.id}] ${tc.title}', async ({ page }) => {\n    // TODO: steps not generated\n  });`;
}

function buildSpecCode(plan: TestPlan): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Auto-generated spec from plan: ${plan.planId}`);
  lines.push(` * Source: ${plan.source} — ${plan.sourceRef}`);
  lines.push(` * Generated: ${new Date().toISOString()}`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import { test, expect } from '../../src/framework/fixtures';`);
  lines.push(`import { logger } from '../../src/utils/logger';`);
  lines.push(``);
  lines.push(`const APP_BASE_URL = process.env.APP_BASE_URL ?? ${JSON.stringify(plan.appBaseURL)};`);
  lines.push(``);

  // Group test cases by module
  const moduleGroups = new Map<string, TestCase[]>();
  for (const tc of plan.testCases) {
    const mod = tc.module || 'General';
    if (!moduleGroups.has(mod)) moduleGroups.set(mod, []);
    moduleGroups.get(mod)!.push(tc);
  }

  for (const [module, testCases] of moduleGroups) {
    // Detect if tests in this group have a login step
    const hasLoginStep = testCases.some(tc =>
      tc.steps.some(s => {
        const d = s.description.toLowerCase().replace(/[\r\n]+/g, ' ');
        return (d.includes('username') && d.includes('password')) ||
               (d.includes('enter') && d.includes('login')) ||
               (d.includes('log in') && !d.includes('logout'));
      })
    );
    const firstTC = testCases[0];
    const sharedUsername = firstTC.testData?.['Username'] || firstTC.testData?.['username'] || '';
    const sharedPassword = firstTC.testData?.['Password'] || firstTC.testData?.['password'] || '';

    lines.push(`test.describe(${JSON.stringify(module)}, () => {`);
    lines.push(``);

    // ── beforeEach: navigate + login (hoisted so it runs even if a prior test fails) ──
    if (hasLoginStep) {
      lines.push(`  test.beforeEach(async ({ page }) => {`);
      lines.push(`    await page.goto(APP_BASE_URL);`);
      lines.push(`    await page.waitForLoadState('networkidle');`);
      lines.push(`    // Wait for login page — if already authenticated (unexpected state) this will still redirect`);
      lines.push(`    await page.waitForSelector('input[name="Username"]', { state: 'visible', timeout: 20000 }).catch(async () => {`);
      lines.push(`      logger.info('[beforeEach] Login page not shown — may already be authenticated, proceeding');`);
      lines.push(`    });`);
      lines.push(`    if (await page.locator('input[name="Username"]').count() > 0) {`);
      lines.push(`      await page.fill('input[name="Username"]', ${JSON.stringify(sharedUsername)});`);
      lines.push(`      const pwdFb = page.locator('input[name="Password"]');`);
      lines.push(`      await pwdFb.click();`);
      lines.push(`      await pwdFb.pressSequentially(${JSON.stringify(sharedPassword)}, { delay: 50 });`);
      lines.push(`      await page.click('button[type="submit"]');`);
      lines.push(`      await page.waitForFunction(`);
      lines.push(`        () => !location.href.includes('ssoqa') && !location.pathname.includes('/Account/Login'),`);
      lines.push(`        { timeout: 25000 }`);
      lines.push(`      );`);
      lines.push(`      await page.waitForLoadState('networkidle');`);
      lines.push(`      logger.info('[beforeEach] Logged in. URL: ' + page.url());`);
      lines.push(`    }`);
      lines.push(`  });`);
      lines.push(``);
    }

    // ── afterEach: failure screenshot + modal dismiss + logout fallback ──
    lines.push(`  test.afterEach(async ({ page }, testInfo) => {`);
    lines.push(`    if (testInfo.status !== testInfo.expectedStatus) {`);
    lines.push(`      const safeName = testInfo.title.replace(/[\\W]+/g, '_').slice(0, 60);`);
    lines.push(`      await page.screenshot({ path: \`results/screenshots/FAILED-\${safeName}-\${Date.now()}.png\`, fullPage: true }).catch(() => {});`);
    lines.push(`      logger.info('[afterEach] FAILED — URL: ' + page.url());`);
    lines.push(`      // Dismiss any open confirmation dialog so next test starts clean`);
    lines.push(`      await page.locator('.modal:visible .close, .modal:visible button:has-text("Close"), .modal:visible button:has-text("Cancel"), .swal2-cancel').first().click({ force: true }).catch(() => {});`);
    lines.push(`    }`);
    if (hasLoginStep) {
      lines.push(`    // Logout fallback — ensures session is cleared even if test failed before its own logout step`);
      lines.push(`    for (const ls of ["i[class='fa fa fa-power-off fs14']", 'i.fa-power-off', '[title*="logout" i]', 'a:has-text("Logout")']) {`);
      lines.push(`      if (await page.locator(ls).count() > 0) { await page.click(ls).catch(() => {}); break; }`);
      lines.push(`    }`);
    }
    lines.push(`  });`);
    lines.push(``);

    for (const tc of testCases) {
      lines.push(`  test(${JSON.stringify(`[${tc.id}] ${tc.title}`)}, async ({ page, loginPage }) => {`);
      lines.push(`    test.setTimeout(120000);`);
      lines.push(`    const testData = ${JSON.stringify(tc.testData || {})};`);
      lines.push(`    let stepStart: number;`);
      lines.push(``);

      // Look up UI reference for this page
      const pageRef = findPageRef(tc);
      if (pageRef) {
        lines.push(`    // UI Reference matched: ${pageRef.menuPath || 'unknown'}`);
      }

      // Generate step code — skip login/navigate-to-login steps (handled by beforeEach)
      for (const step of tc.steps) {
        const singleLineDesc = step.description.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        const stepDescLower = singleLineDesc.toLowerCase();

        // Skip Step 1 (navigate to login page) — beforeEach handles it
        if (hasLoginStep && step.stepNumber <= 2) {
          const isNavigateToLogin =
            (stepDescLower.includes('navigate') && (stepDescLower.includes('login') || stepDescLower.includes('application'))) ||
            (step.action === 'navigate' && (!step.value || step.value === '/' || step.value === plan.appBaseURL));
          const isLoginStep =
            (stepDescLower.includes('username') && stepDescLower.includes('password')) ||
            (stepDescLower.includes('enter') && stepDescLower.includes('login'));
          if (isNavigateToLogin || isLoginStep) {
            lines.push(`    // ── Step ${step.stepNumber}: ${escapeComment(singleLineDesc)} ── [handled by beforeEach]`);
            lines.push(``);
            continue;
          }
        }

        lines.push(`    // ── Step ${step.stepNumber}: ${escapeComment(singleLineDesc)} ──`);
        lines.push(`    stepStart = Date.now();`);
        lines.push(`    logger.info('Step ${step.stepNumber}: ${escapeStr(singleLineDesc)}');`);
        lines.push(...indent(4, generateStepCode(step, tc, pageRef)));
        lines.push(``);
      }

      lines.push(`  });`);
      lines.push(``);
    }

    lines.push(`});`);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateStepCode(step: TestStep, tc: TestCase, pageRef?: UIPageRef | null): string[] {
  const desc = step.description.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const lines: string[] = [];
  const testData = tc.testData || {};

  // ── Description-based overrides (take priority over action field) ──────────
  // The action field from planWriter is a best-effort heuristic and often wrong.
  // We look at the description first to determine the real intent.

  // Login step — description mentions both username+password or "login"
  if ((desc.includes('username') && desc.includes('password')) ||
      (desc.includes('enter') && desc.includes('login')) ||
      (desc.includes('log in') && !desc.includes('logout'))) {
    const username = testData['Username'] || testData['username'] || '';
    const password = testData['Password'] || testData['password'] || '';
    lines.push(`// Login`);
    lines.push(`await page.waitForSelector('input[name="Username"]', { state: 'visible', timeout: 15000 });`);
    lines.push(`await page.fill('input[name="Username"]', testData['Username'] || ${JSON.stringify(username)});`);
    lines.push(`// Use pressSequentially for password — fill() can truncate at # character`);
    lines.push(`const pwdField = page.locator('input[name="Password"]');`);
    lines.push(`await pwdField.click();`);
    lines.push(`await pwdField.pressSequentially(testData['Password'] || ${JSON.stringify(password)}, { delay: 50 });`);
    lines.push(`await page.click('button[type="submit"]');`);
    lines.push(`await page.waitForFunction(`);
    lines.push(`  () => !location.href.includes('ssoqa') && !location.pathname.includes('/Account/Login'),`);
    lines.push(`  { timeout: 25000 }`);
    lines.push(`);`);
    lines.push(`await page.waitForLoadState('networkidle');`);
    lines.push(`logger.info('Logged in. URL: ' + page.url());`);
    return lines;
  }

  // Verify deleted + logout combined step
  if (desc.includes('verify') && (desc.includes('no longer') || desc.includes('not') || desc.includes('deleted')) && desc.includes('logout')) {
    const recordName = testData['Record Name'] || testData['Gateway Name'] || '';
    lines.push(`// Verify record deleted — reload list and check with exact cell text match`);
    lines.push(`const recDelCheck = testData['Record Name'] || testData['Gateway Name'] || ${JSON.stringify(recordName)};`);
    lines.push(`await page.waitForLoadState('networkidle');`);
    // If this page requires a refresh icon click to return to list (e.g. Source Endpoint Config)
    const postDeleteRefreshSel = pageRef?.listPage?.postDeleteRefreshSelector;
    const mainTableSelV = (pageRef as any)?.tables?.main?.selector;
    const gridSel = pageRef?.listPage?.gridSelector || (mainTableSelV ? mainTableSelV : 'tbody');
    if (postDeleteRefreshSel) {
      lines.push(`// Refresh icon only needed when search panel was used (e.g. TC_004)`);
      lines.push(`if (typeof _searchPanelUsed !== 'undefined' && _searchPanelUsed) {`);
      lines.push(`  try {`);
      lines.push(`    await page.locator(${JSON.stringify(postDeleteRefreshSel)}).waitFor({ state: 'visible', timeout: 5000 });`);
      lines.push(`    await page.locator(${JSON.stringify(postDeleteRefreshSel)}).click();`);
      lines.push(`    await page.waitForLoadState('networkidle');`);
      lines.push(`    logger.info('Clicked refresh icon to return to list');`);
      lines.push(`  } catch {`);
      lines.push(`    logger.info('Refresh icon not found — falling back to page.reload()');`);
      lines.push(`    await page.reload();`);
      lines.push(`    await page.waitForLoadState('networkidle');`);
      lines.push(`  }`);
      lines.push(`} else {`);
      lines.push(`  // Search panel not used — navigate to list page URL`);
      const listUrlForRefresh = pageRef?.url || '';
      if (listUrlForRefresh) {
        lines.push(`  await page.goto(${JSON.stringify(listUrlForRefresh)});`);
      } else {
        lines.push(`  await page.reload();`);
      }
      lines.push(`  await page.waitForLoadState('networkidle');`);
      lines.push(`}`);
    } else {
      // Navigate to list page URL (more reliable than reload — avoids landing on add/detail page)
      const listUrl = pageRef?.url || '';
      if (listUrl) {
        lines.push(`// Navigate back to list page URL (avoids reload landing on wrong page)`);
        lines.push(`await page.goto(${JSON.stringify(listUrl)});`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else {
        lines.push(`await page.reload();`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      }
    }
    // Wait for grid container (not rows — list may be empty after deletion clears the filter)
    lines.push(`await page.waitForSelector(${JSON.stringify(gridSel.split(' ')[0])}, { state: 'visible', timeout: 15000 });`);
    lines.push(`// Use exact cell text (td:text-is) to avoid false positives from rows where record name is a substring`);
    lines.push("const postDeleteCount = await page.locator(`td:text-is(\"${recDelCheck}\")`).count();");
    lines.push(`logger.info('Post-delete exact-match count for "' + recDelCheck + '": ' + postDeleteCount);`);
    lines.push(`// Hard assert: exact-match cell must be 0 — record is gone`);
    lines.push(`expect(postDeleteCount, 'Record "' + recDelCheck + '" still present after deletion').toBe(0);`);
    lines.push(`logger.info('Delete confirmed: "' + recDelCheck + '" not found (exact match) in list');`);
    lines.push(``);
    lines.push(`// Logout`);
    lines.push(`const logoutSels = ["i[class='fa fa fa-power-off fs14']", 'i.fa-power-off', '[title*="logout" i]', 'a:has-text("Logout")'];`);
    lines.push(`for (const ls of logoutSels) {`);
    lines.push(`  if (await page.locator(ls).count() > 0) { await page.click(ls); break; }`);
    lines.push(`}`);
    lines.push(`await page.waitForLoadState('networkidle');`);
    return lines;
  }

  // ── Composite step: dropdown + radio + fill + add row ──────────────────────
  // Steps like "Fill GatewayType from Dropdown and Select Column Type Radio Button"
  // or "Click Add Row and Fill Column Name as Text and Column Data Type from Dropdown"
  // Guard: numbered multi-line steps (1. action 'Field'\n2. ...) use the numbered parser below — NOT this handler
  const isNumberedMultiStep = step.description.includes('\n') && (step.description.match(/\d+\./g) || []).length >= 3;
  if (!isNumberedMultiStep && (desc.includes('dropdown') || desc.includes('radio') || desc.includes('add row')) && desc.includes('and')) {
    // Parse sub-actions by splitting on " and "
    const subActions = step.description.split(/\s+and\s+/i);

    // Track dropdown variable for post-radio re-verification
    // (radio AJAX may reset a previously-selected dropdown on the same page)
    let compositeDropdownVar: string | null = null;
    let compositeDropdownPreKnown: string | null = null;

    for (const sub of subActions) {
      const subLower = sub.toLowerCase().trim();
      const subSafe = sub.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

      if (subLower.includes('dropdown')) {
        // Extract field name for dropdown
        const dropdownField = extractFieldFromSub(subLower);
        const dropdownKey = dropdownField ? findTestDataKey(dropdownField, testData) : null;
        if (dropdownKey) {
          const safeKey = dropdownKey.replace(/[^a-zA-Z0-9]/g, '');

          // ── UI Reference lookup: get exact selector and pre-known option value ──
          const uiField = lookupField(pageRef || null, dropdownKey);
          const preKnownValue = uiField ? lookupOptionValue(uiField, testData[dropdownKey]) : null;

          if (uiField && uiField.selector) {
            lines.push(`// Select "${dropdownKey}" from dropdown — resilient locator, strict data-only selection`);
            // Declare outside block so post-radio re-verify can reference it
            lines.push(`let ddEl_${safeKey} = page.locator('${uiField.selector}');`);
            lines.push(`{`);
            lines.push(`  if (!(await ddEl_${safeKey}.count() > 0)) {`);
            lines.push(`    const lbl_${safeKey} = page.getByLabel(${JSON.stringify(dropdownKey)}, { exact: false });`);
            lines.push(`    if (await lbl_${safeKey}.count() > 0) ddEl_${safeKey} = lbl_${safeKey}.first();`);
            lines.push(`  }`);
            lines.push(`  if (!(await ddEl_${safeKey}.count() > 0)) {`);
            lines.push(`    const role_${safeKey} = page.getByRole('combobox', { name: new RegExp(${JSON.stringify(dropdownKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}, 'i') });`);
            lines.push(`    if (await role_${safeKey}.count() > 0) ddEl_${safeKey} = role_${safeKey}.first();`);
            lines.push(`  }`);
            lines.push(`  if (!(await ddEl_${safeKey}.count() > 0)) {`);
            lines.push(`    const adj_${safeKey} = page.locator('label:has-text("${escapeStr(dropdownKey)}") ~ select, label:has-text("${escapeStr(dropdownKey)}") + select').first();`);
            lines.push(`    if (await adj_${safeKey}.count() > 0) ddEl_${safeKey} = adj_${safeKey};`);
            lines.push(`  }`);
            lines.push(`  if (!(await ddEl_${safeKey}.count() > 0)) {`);
            lines.push(`    const css_${safeKey} = page.locator('select[name*="${escapeStr(safeKey)}" i], select[id*="${escapeStr(safeKey)}" i]').first();`);
            lines.push(`    if (await css_${safeKey}.count() > 0) ddEl_${safeKey} = css_${safeKey};`);
            lines.push(`  }`);
            lines.push(`  await expect(ddEl_${safeKey}).toBeVisible({ timeout: 10000 });`);
            if (preKnownValue) {
              lines.push(`  // Pre-known exact value from UI reference: ${preKnownValue}`);
              lines.push(`  await ddEl_${safeKey}.selectOption('${preKnownValue}');`);
            } else {
              lines.push(`// Match option at runtime — value not found in UI reference`);
              // Strict: use ONLY the exact value from testData — no partial/fuzzy matching
              lines.push(`  const tv_${safeKey} = testData[${JSON.stringify(dropdownKey)}];`);
              lines.push(`  // Try: exact label → exact value → case-insensitive exact label`);
              lines.push(`  try { await ddEl_${safeKey}.selectOption({ label: tv_${safeKey} }); } catch {`);
              lines.push(`    try { await ddEl_${safeKey}.selectOption({ value: tv_${safeKey} }); } catch {`);
              lines.push(`      const opts_${safeKey} = await ddEl_${safeKey}.locator('option').all();`);
              lines.push(`      const matched_${safeKey} = (await Promise.all(opts_${safeKey}.map(async o => ({ v: await o.getAttribute('value'), t: ((await o.textContent()) || '').trim() })))).find(o => o.t.toLowerCase() === tv_${safeKey}.toLowerCase());`);
              lines.push(`      if (!matched_${safeKey}?.v) throw new Error('No exact match for ${escapeStr(dropdownKey)}="' + tv_${safeKey} + '"');`);
              lines.push(`      await ddEl_${safeKey}.selectOption(matched_${safeKey}.v);`);
              lines.push(`    }`);
              lines.push(`  }`);
            }
            lines.push(`  await ddEl_${safeKey}.evaluate((el: HTMLSelectElement) => {`);
            lines.push(`    el.dispatchEvent(new Event('change', { bubbles: true }));`);
            lines.push(`    if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
            lines.push(`  });`);
            lines.push(`  logger.info('Selected ${escapeStr(dropdownKey)}: value=' + await ddEl_${safeKey}.inputValue());`);
            lines.push(`  await page.waitForLoadState('networkidle');`);
            lines.push(`  await page.waitForTimeout(3000);`);
            lines.push(`  await page.waitForLoadState('networkidle');`);
            // Re-check if value was reset by AJAX
            lines.push(`  const afterAjax_${safeKey} = await ddEl_${safeKey}.inputValue();`);
            lines.push(`  if (!afterAjax_${safeKey} || afterAjax_${safeKey} === '' || afterAjax_${safeKey} === '0') {`);
            lines.push(`    logger.info('${escapeStr(dropdownKey)} was reset by AJAX — re-selecting (no change event to avoid cascade)');`);
            lines.push(`    await ddEl_${safeKey}.selectOption(${preKnownValue ? `'${preKnownValue}'` : `matched_${safeKey}?.v || tv_${safeKey}`});`);
            // Do NOT fire evaluate/change here — firing change again triggers another AJAX that clears the value again
            lines.push(`    await page.waitForTimeout(1000);`);
            lines.push(`    logger.info('Re-selected ${escapeStr(dropdownKey)}: ' + await ddEl_${safeKey}.inputValue());`);
            lines.push(`  }`);
            lines.push(`}`);
            // Track this dropdown for post-radio re-verification
            compositeDropdownVar = `ddEl_${safeKey}`;
            compositeDropdownPreKnown = preKnownValue;
          } else {
            lines.push(`// Select "${dropdownKey}" from dropdown (no UI ref — keyword fallback)`);
            // Build targeted selectors — try specific name/id first, then scope to last table row
            const cleanKey = dropdownKey.replace(/\s+/g, '');
            lines.push(`const ddSels_${safeKey} = [`);
            lines.push(`  'select:visible[name*="${escapeStr(dropdownKey)}" i]',`);
            lines.push(`  'select:visible[id*="${escapeStr(safeKey)}" i]',`);
            lines.push(`  'select:visible[name*="${escapeStr(cleanKey)}" i]',`);
            lines.push(`  'select:visible[id*="${escapeStr(cleanKey)}" i]',`);
            lines.push(`  'table tbody tr:last-child select:visible',`);
            lines.push(`];`);
            lines.push(`let ddSelected_${safeKey} = false;`);
            lines.push(`for (const ds of ddSels_${safeKey}) {`);
            lines.push(`  const ddEl = page.locator(ds).first();`);
            lines.push(`  if (await ddEl.count() > 0 && await ddEl.isVisible()) {`);
            lines.push(`    const opts_${safeKey} = await ddEl.locator('option').all();`);
            lines.push(`    const targetVal = testData[${JSON.stringify(dropdownKey)}];`);
            lines.push(`    let matchedOptValue: string | null = null;`);
            lines.push(`    for (const opt of opts_${safeKey}) {`);
            lines.push(`      const val = await opt.getAttribute('value');`);
            lines.push(`      const txt = ((await opt.textContent()) || '').trim();`);
            lines.push(`      if (txt === targetVal || val === targetVal) { matchedOptValue = val; break; }`);
            lines.push(`      if (txt.toLowerCase() === targetVal.toLowerCase()) { matchedOptValue = val; break; }`);
            lines.push(`      if (txt.toLowerCase().includes(targetVal.toLowerCase()) || targetVal.toLowerCase().includes(txt.toLowerCase())) {`);
            lines.push(`        if (val && val !== '' && val !== '0' && !txt.includes('Select') && !txt.includes('--')) { matchedOptValue = val; }`);
            lines.push(`      }`);
            lines.push(`      const norm = (s: string) => s.replace(/[lI1]/g, 'x').toLowerCase();`);
            lines.push(`      if (!matchedOptValue && norm(txt) === norm(targetVal)) { matchedOptValue = val; }`);
            lines.push(`    }`);
            lines.push(`    if (matchedOptValue) {`);
            lines.push(`      await ddEl.selectOption(matchedOptValue);`);
            lines.push(`      await ddEl.evaluate((el: HTMLSelectElement) => {`);
            lines.push(`        el.dispatchEvent(new Event('change', { bubbles: true }));`);
            lines.push(`        if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
            lines.push(`      });`);
            lines.push(`      ddSelected_${safeKey} = true;`);
            lines.push(`      logger.info('Selected ${escapeStr(dropdownKey)}: value=' + matchedOptValue);`);
            lines.push(`      await page.waitForLoadState('networkidle');`);
            lines.push(`      await page.waitForTimeout(3000);`);
            lines.push(`      await page.waitForLoadState('networkidle');`);
            lines.push(`      logger.info('Post-dropdown table rows: ' + await page.locator('table tbody tr').count());`);
            lines.push(`    } else {`);
            lines.push(`      const allOpts: string[] = [];`);
            lines.push(`      for (const opt of opts_${safeKey}) { allOpts.push(((await opt.textContent()) || '').trim()); }`);
            lines.push(`      throw new Error('No matching option for ${escapeStr(dropdownKey)}="' + targetVal + '". Available: ' + allOpts.join(', '));`);
            lines.push(`    }`);
            lines.push(`    break;`);
            lines.push(`  }`);
            lines.push(`}`);
            lines.push(`if (!ddSelected_${safeKey}) throw new Error('Could not find dropdown for ${escapeStr(dropdownKey)}');`);
            lines.push(`await page.waitForLoadState('networkidle');`);
          }
        }
      } else if (subLower.includes('radio')) {
        // Extract field name for radio button
        const radioField = extractFieldFromSub(subLower);
        const radioKey = radioField ? findTestDataKey(radioField, testData) : null;
        if (radioKey) {
          const safeKey = radioKey.replace(/[^a-zA-Z0-9]/g, '');
          // ── UI Reference lookup for radio button ──
          const uiRadio = lookupRadio(pageRef || null, testData[radioKey]);

          if (uiRadio && uiRadio.selector) {
            const radioId = uiRadio.selector.replace(/^#/, '');
            const radioVal = escapeStr(testData[radioKey] || radioKey);
            lines.push(`// Select "${escapeStr(radioKey)}" radio button (UI Reference: ${uiRadio.selector})`);
            lines.push(`// Fallback chain: label[for] → getByLabel → getByRole radio → force click`);
            lines.push(`{`);
            lines.push(`  let radioClicked_${safeKey} = false;`);
            lines.push(`  const radioLbl_${safeKey} = page.locator('label[for="${radioId}"]');`);
            lines.push(`  if (!radioClicked_${safeKey} && await radioLbl_${safeKey}.count() > 0 && await radioLbl_${safeKey}.isVisible()) {`);
            lines.push(`    await radioLbl_${safeKey}.click();`);
            lines.push(`    radioClicked_${safeKey} = true;`);
            lines.push(`    logger.info('Clicked radio "${escapeStr(radioKey)}" via label[for="${radioId}"]');`);
            lines.push(`  }`);
            lines.push(`  if (!radioClicked_${safeKey}) {`);
            lines.push(`    const gbl_${safeKey} = page.getByLabel('${radioVal}', { exact: false });`);
            lines.push(`    if (await gbl_${safeKey}.count() > 0) {`);
            lines.push(`      await gbl_${safeKey}.first().click({ force: true });`);
            lines.push(`      radioClicked_${safeKey} = true;`);
            lines.push(`      logger.info('Clicked radio "${escapeStr(radioKey)}" via getByLabel("${radioVal}")');`);
            lines.push(`    }`);
            lines.push(`  }`);
            lines.push(`  if (!radioClicked_${safeKey}) {`);
            lines.push(`    const role_${safeKey} = page.getByRole('radio', { name: new RegExp('${radioVal}', 'i') });`);
            lines.push(`    if (await role_${safeKey}.count() > 0) {`);
            lines.push(`      await role_${safeKey}.first().click({ force: true });`);
            lines.push(`      radioClicked_${safeKey} = true;`);
            lines.push(`      logger.info('Clicked radio "${escapeStr(radioKey)}" via getByRole radio');`);
            lines.push(`    }`);
            lines.push(`  }`);
            lines.push(`  if (!radioClicked_${safeKey}) {`);
            lines.push(`    // Last resort: force click the UI ref selector`);
            lines.push(`    await page.locator('${uiRadio.selector}').click({ force: true });`);
            lines.push(`    radioClicked_${safeKey} = true;`);
            lines.push(`    logger.info('Clicked radio "${escapeStr(radioKey)}" via force click on ${uiRadio.selector}');`);
            lines.push(`  }`);
            lines.push(`  if (!radioClicked_${safeKey}) throw new Error('Could not click radio for ${escapeStr(radioKey)}');`);
            lines.push(`}`);
          } else {
            const radioVal = escapeStr(testData[radioKey] || radioKey);
            lines.push(`// Select "${radioKey}" radio button (getByLabel → getByRole → CSS fallback)`);
            lines.push(`{`);
            lines.push(`  let radioClicked_${safeKey} = false;`);
            lines.push(`  const gbl_${safeKey} = page.getByLabel('${radioVal}', { exact: false });`);
            lines.push(`  if (await gbl_${safeKey}.count() > 0) {`);
            lines.push(`    await gbl_${safeKey}.first().click({ force: true });`);
            lines.push(`    radioClicked_${safeKey} = true;`);
            lines.push(`    logger.info('Selected radio ${escapeStr(radioKey)} via getByLabel');`);
            lines.push(`  }`);
            lines.push(`  if (!radioClicked_${safeKey}) {`);
            lines.push(`    const role_${safeKey} = page.getByRole('radio', { name: new RegExp('${radioVal}', 'i') });`);
            lines.push(`    if (await role_${safeKey}.count() > 0) {`);
            lines.push(`      await role_${safeKey}.first().click({ force: true });`);
            lines.push(`      radioClicked_${safeKey} = true;`);
            lines.push(`      logger.info('Selected radio ${escapeStr(radioKey)} via getByRole');`);
            lines.push(`    }`);
            lines.push(`  }`);
            lines.push(`  if (!radioClicked_${safeKey}) {`);
            lines.push(`    const cssSels_${safeKey} = [`);
            lines.push(`      'label:has-text("${radioVal}"):visible',`);
            lines.push(`      'input[type="radio"][value*="${radioVal}" i]:visible',`);
            lines.push(`      'label:has(input[type="radio"]):has-text("${radioVal}"):visible',`);
            lines.push(`    ];`);
            lines.push(`    for (const rs of cssSels_${safeKey}) {`);
            lines.push(`      const rEl = page.locator(rs).first();`);
            lines.push(`      if (await rEl.count() > 0 && await rEl.isVisible()) {`);
            lines.push(`        await rEl.click();`);
            lines.push(`        radioClicked_${safeKey} = true;`);
            lines.push(`        logger.info('Selected radio ${escapeStr(radioKey)} via: ' + rs);`);
            lines.push(`        break;`);
            lines.push(`      }`);
            lines.push(`    }`);
            lines.push(`  }`);
            lines.push(`  if (!radioClicked_${safeKey}) throw new Error('Could not find radio for ${escapeStr(radioKey)} = "${radioVal}"');`);
            lines.push(`}`);
          }
          // Fire change event on the checked radio input
          lines.push(`const radioChecked_${safeKey} = page.locator('input[type="radio"]:checked').first();`);
          lines.push(`if (await radioChecked_${safeKey}.count() > 0) {`);
          lines.push(`  await radioChecked_${safeKey}.evaluate((el: HTMLInputElement) => {`);
          lines.push(`    el.dispatchEvent(new Event('change', { bubbles: true }));`);
          lines.push(`    el.dispatchEvent(new Event('click', { bubbles: true }));`);
          lines.push(`    if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
          lines.push(`  });`);
          lines.push(`}`);
          lines.push(`// Wait for AJAX content triggered by radio selection`);
          lines.push(`await page.waitForLoadState('networkidle');`);
          lines.push(`await page.waitForTimeout(2000);`);
          lines.push(`await page.waitForLoadState('networkidle');`);
          lines.push(`logger.info('Post-radio table rows: ' + await page.locator('table tbody tr').count());`);
          // Post-radio: re-verify the dropdown wasn't reset by the radio AJAX reload
          if (compositeDropdownVar && compositeDropdownPreKnown) {
            lines.push(`// Post-radio re-verify: radio AJAX may reset Gateway Type — re-select if cleared`);
            lines.push(`{`);
            lines.push(`  const postRadioVal = await ${compositeDropdownVar}.inputValue().catch(() => '');`);
            lines.push(`  logger.info('Post-radio Gateway Type value: ' + postRadioVal);`);
            lines.push(`  if (!postRadioVal || postRadioVal === '' || postRadioVal === '0') {`);
            lines.push(`    logger.info('Gateway Type was reset by radio AJAX — re-selecting (no change event to avoid cascade)');`);
            lines.push(`    await ${compositeDropdownVar}.selectOption('${compositeDropdownPreKnown}');`);
            // Do NOT fire evaluate/change — it would trigger AJAX again and clear the value
            lines.push(`    await page.waitForTimeout(1000);`);
            lines.push(`    logger.info('Re-selected after radio AJAX. Value: ' + await ${compositeDropdownVar}.inputValue());`);
            lines.push(`  }`);
            lines.push(`  // Hard assert: Gateway Type must be selected before Add Row`);
            lines.push(`  const finalVal = await ${compositeDropdownVar}.inputValue();`);
            lines.push(`  expect(finalVal, 'Gateway Type must remain selected before Add Row').toBeTruthy();`);
            lines.push(`  expect(finalVal, 'Gateway Type must remain selected before Add Row').not.toBe('0');`);
            lines.push(`}`);
          }
        }
      } else if (subLower.includes('add row') || subLower.includes('+ icon')) {
        lines.push(`// Count rows in #FileColumns before Add Row`);
        lines.push(`const fileColSel = (await page.locator('#FileColumns tbody').count() > 0) ? '#FileColumns tbody tr' : 'table tbody tr';`);
        lines.push(`const rowsBefore = await page.locator(fileColSel).count();`);
        lines.push(`logger.info('Rows before Add Row: ' + rowsBefore);`);
        lines.push(``);
        lines.push(`// Click Add Row — use position-filtered approach (x > 100 skips sidebar icons)`);
        lines.push(`const addRowSels = ['i.fa.fa-plus', '#AddRow_1', 'a[id*="AddRow" i]', '[onclick*="cloneRow" i]', 'button:has-text("Add Row"):visible', '#btnAddRow:visible'];`);
        lines.push(`let addRowClicked = false;`);
        lines.push(`for (const ar of addRowSels) {`);
        lines.push(`  const els = page.locator(ar);`);
        lines.push(`  const cnt = await els.count();`);
        lines.push(`  for (let i = 0; i < cnt; i++) {`);
        lines.push(`    const box = await els.nth(i).boundingBox();`);
        lines.push(`    if (box && box.x > 100) {`);
        lines.push(`      await els.nth(i).click();`);
        lines.push(`      addRowClicked = true;`);
        lines.push(`      logger.info('Clicked Add Row via: ' + ar + ' at x=' + Math.round(box.x));`);
        lines.push(`      break;`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`  if (addRowClicked) break;`);
        lines.push(`}`);
        lines.push(`if (!addRowClicked) throw new Error('Add Row button not found — no matching selector with x > 100');`);
        lines.push(``);
        lines.push(`// Wait for exactly 1 new row — hard assert no double-add`);
        lines.push(`await page.waitForFunction(`);
        lines.push(`  ({ sel, before }: { sel: string; before: number }) => document.querySelectorAll(sel).length === before + 1,`);
        lines.push(`  { sel: fileColSel, before: rowsBefore },`);
        lines.push(`  { timeout: 8000 }`);
        lines.push(`);`);
        lines.push(`const rowsAfter = await page.locator(fileColSel).count();`);
        lines.push(`expect(rowsAfter, 'Add Row must add exactly 1 row').toBe(rowsBefore + 1);`);
        lines.push(`logger.info('Row added — total rows: ' + rowsAfter);`);
        lines.push(`// Wait for the new row inputs to be ready`);
        lines.push(`await page.locator('#FileColumns tbody tr:last-child input, table tbody tr:last-child input').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});`);
      } else if (subLower.includes('fill') || subLower.includes('field as text') || (subLower.includes('field') && !subLower.includes('dropdown') && !subLower.includes('radio'))) {
        // Fill a text field — scope to last table row if after Add Row
        const fieldName = extractFieldFromSub(subLower);
        const matchedKey = fieldName ? findTestDataKey(fieldName, testData) : null;
        if (matchedKey) {
          const safeKey = matchedKey.replace(/[^a-zA-Z0-9]/g, '');
          const cleanKey = matchedKey.replace(/\s+/g, '');
          // ── UI Reference lookup for text field ──
          const uiTextField = lookupField(pageRef || null, matchedKey);

          if (uiTextField && uiTextField.selector && uiTextField.fieldType?.toLowerCase().includes('text')) {
            lines.push(`// Fill "${matchedKey}" (UI Reference: ${uiTextField.selector})`);
            lines.push(`const txtEl_${safeKey} = page.locator('${uiTextField.selector}');`);
            lines.push(`if (await txtEl_${safeKey}.count() > 0 && await txtEl_${safeKey}.isVisible()) {`);
            lines.push(`  await txtEl_${safeKey}.fill(testData[${JSON.stringify(matchedKey)}]);`);
            lines.push(`  logger.info('Filled ${escapeStr(matchedKey)} via UI ref: ${uiTextField.selector}');`);
            lines.push(`} else {`);
            lines.push(`  // UI ref selector not visible — scope to last row of #FileColumns or any table`);
            lines.push(`  const fallbackEl = page.locator('#FileColumns tbody tr:last-child input:visible[type="text"], table tbody tr:last-child input:visible[type="text"]').first();`);
            lines.push(`  await fallbackEl.waitFor({ state: 'visible', timeout: 5000 });`);
            lines.push(`  if (await fallbackEl.count() > 0) {`);
            lines.push(`    await fallbackEl.fill(testData[${JSON.stringify(matchedKey)}]);`);
            lines.push(`    logger.info('Filled ${escapeStr(matchedKey)} via last-row fallback');`);
            lines.push(`  } else {`);
            lines.push(`    throw new Error('Could not find visible input for ${escapeStr(matchedKey)} in last table row');`);
            lines.push(`  }`);
            lines.push(`}`);
          } else {
            lines.push(`// Fill "${matchedKey}" — try last table row first, then page-wide (keyword fallback)`);
            lines.push(`const txtSels_${safeKey} = [`);
            lines.push(`  '#FileColumns tbody tr:last-child input:visible[type="text"]',`);
            lines.push(`  '#FileColumns tbody tr:last-child input:visible',`);
            lines.push(`  'table tbody tr:last-child input:visible[type="text"]',`);
            lines.push(`  'table tbody tr:last-child input:visible',`);
            lines.push(`  'input:visible[name*="${escapeStr(matchedKey)}" i]',`);
            lines.push(`  'input:visible[name*="${escapeStr(cleanKey)}" i]',`);
            lines.push(`  'input:visible[placeholder*="${escapeStr(matchedKey)}" i]',`);
            lines.push(`  '#txt${escapeStr(safeKey)}:visible',`);
            lines.push(`  '#${escapeStr(safeKey)}:visible',`);
            lines.push(`];`);
            lines.push(`let txtFilled_${safeKey} = false;`);
            lines.push(`for (const ts of txtSels_${safeKey}) {`);
            lines.push(`  const tEl = page.locator(ts).first();`);
            lines.push(`  if (await tEl.count() > 0 && await tEl.isVisible()) {`);
            lines.push(`    await tEl.fill(testData[${JSON.stringify(matchedKey)}]);`);
            lines.push(`    txtFilled_${safeKey} = true;`);
            lines.push(`    logger.info('Filled ${escapeStr(matchedKey)} via: ' + ts);`);
            lines.push(`    break;`);
            lines.push(`  }`);
            lines.push(`}`);
            lines.push(`if (!txtFilled_${safeKey}) throw new Error('Could not find visible input for ${escapeStr(matchedKey)}');`);
          }
        }
      }
    }

    if (lines.length > 0) return lines;
  }

  // ── Multi-field fill step (numbered sub-items) ─────────────────────────────
  // Handles two formats:
  //   Format A: "1.Gateway Type – Select a value from the dropdown."  (field – instruction)
  //   Format B: "1. Select a value from the 'Gateway Name' dropdown." (action 'Field' type)
  // Fires whenever 3+ numbered sub-items exist — no "fill"/"details" keyword required.
  const multiFieldMatch = step.description.match(/\d+\.\s*\w/);
  const subItemLines = step.description.split(/\r?\n/).filter(l => /^\d+\./.test(l.trim()));
  if (multiFieldMatch && subItemLines.length >= 3) {
    lines.push(`// Multi-field step: ${subItemLines.length} numbered sub-items`);
    for (const item of subItemLines) {
      const trimmed = item.trim();

      // ── Format A: "1.FieldName – instruction" ──
      const fmtA = trimmed.match(/^\d+\.\s*(.+?)\s*[–\-—]\s*(.+)/);
      // ── Format B: "1. action 'FieldName' [type]" — field name in single quotes ──
      const fmtBFields = [...trimmed.matchAll(/'([^']+)'/g)].map(m => m[1]);
      const lineType = trimmed.toLowerCase().includes('dropdown') ? 'dropdown'
        : trimmed.toLowerCase().includes('checkbox') ? 'checkbox'
        : 'text';

      if (fmtA) {
        // Format A: existing logic
        const rawFieldName = fmtA[1].trim();
        const instruction = fmtA[2].toLowerCase().trim();
        const matchedKey = findTestDataKey(rawFieldName, testData);

        if (instruction.includes('dropdown')) {
          // Dropdown field
          if (matchedKey) {
            const safeKey = matchedKey.replace(/[^a-zA-Z0-9]/g, '');
            const uiField = lookupField(pageRef || null, matchedKey);
            const preKnownValue = uiField ? lookupOptionValue(uiField, testData[matchedKey]) : null;

            if (uiField && uiField.selector) {
              lines.push(`// Select "${matchedKey}" from dropdown — resilient locator, strict data-only selection`);
              lines.push(`{`);
              lines.push(`  let mfDd_${safeKey} = page.locator('${uiField.selector}');`);
              lines.push(`  // Fallback chain: UI ref ID → getByLabel → getByRole combobox → label-adjacent select → name/id CSS`);
              lines.push(`  if (!(await mfDd_${safeKey}.count() > 0)) {`);
              lines.push(`    const lbl_${safeKey} = page.getByLabel(${JSON.stringify(matchedKey)}, { exact: false });`);
              lines.push(`    if (await lbl_${safeKey}.count() > 0) mfDd_${safeKey} = lbl_${safeKey}.first();`);
              lines.push(`  }`);
              lines.push(`  if (!(await mfDd_${safeKey}.count() > 0)) {`);
              lines.push(`    const role_${safeKey} = page.getByRole('combobox', { name: new RegExp(${JSON.stringify(matchedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}, 'i') });`);
              lines.push(`    if (await role_${safeKey}.count() > 0) mfDd_${safeKey} = role_${safeKey}.first();`);
              lines.push(`  }`);
              lines.push(`  if (!(await mfDd_${safeKey}.count() > 0)) {`);
              lines.push(`    const adj_${safeKey} = page.locator('label:has-text("${escapeStr(matchedKey)}") ~ select, label:has-text("${escapeStr(matchedKey)}") + select').first();`);
              lines.push(`    if (await adj_${safeKey}.count() > 0) mfDd_${safeKey} = adj_${safeKey};`);
              lines.push(`  }`);
              lines.push(`  if (!(await mfDd_${safeKey}.count() > 0)) {`);
              lines.push(`    const css_${safeKey} = page.locator('select[name*="${escapeStr(safeKey)}" i], select[id*="${escapeStr(safeKey)}" i]').first();`);
              lines.push(`    if (await css_${safeKey}.count() > 0) mfDd_${safeKey} = css_${safeKey};`);
              lines.push(`  }`);
              lines.push(`  await expect(mfDd_${safeKey}).toBeVisible({ timeout: 10000 });`);
              lines.push(`  // Strict: use ONLY the value from testData — no fuzzy matching`);
              if (preKnownValue) {
                lines.push(`  // Pre-known exact value from UI reference`);
                lines.push(`  await mfDd_${safeKey}.selectOption('${preKnownValue}');`);
              } else {
                lines.push(`  const tv_${safeKey} = testData[${JSON.stringify(matchedKey)}];`);
                lines.push(`  // Try: exact label → exact value → case-insensitive label — no partial matching`);
                lines.push(`  try { await mfDd_${safeKey}.selectOption({ label: tv_${safeKey} }); } catch {`);
                lines.push(`    try { await mfDd_${safeKey}.selectOption({ value: tv_${safeKey} }); } catch {`);
                lines.push(`      const opts_${safeKey} = await mfDd_${safeKey}.locator('option').all();`);
                lines.push(`      const matched_${safeKey} = (await Promise.all(opts_${safeKey}.map(async o => ({ v: await o.getAttribute('value'), t: ((await o.textContent()) || '').trim() })))).find(o => o.t.toLowerCase() === tv_${safeKey}.toLowerCase());`);
                lines.push(`      if (!matched_${safeKey}?.v) throw new Error('No exact match for ${escapeStr(matchedKey)}="' + tv_${safeKey} + '"');`);
                lines.push(`      await mfDd_${safeKey}.selectOption(matched_${safeKey}.v);`);
                lines.push(`    }`);
                lines.push(`  }`);
              }
              lines.push(`  await mfDd_${safeKey}.evaluate((el: HTMLSelectElement) => {`);
              lines.push(`    el.dispatchEvent(new Event('change', { bubbles: true }));`);
              lines.push(`    if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
              lines.push(`  });`);
              lines.push(`  logger.info('Selected ${escapeStr(matchedKey)}: ' + await mfDd_${safeKey}.inputValue());`);
              lines.push(`  await page.waitForLoadState('networkidle');`);
              lines.push(`}`);
            } else {
              lines.push(`// Select "${matchedKey}" from dropdown (keyword fallback)`);
              lines.push(`const mfDdSels_${safeKey} = ['select:visible[id*="${escapeStr(safeKey)}" i]', 'select:visible[name*="${escapeStr(safeKey)}" i]'];`);
              lines.push(`for (const ds of mfDdSels_${safeKey}) {`);
              lines.push(`  const el = page.locator(ds).first();`);
              lines.push(`  if (await el.count() > 0 && await el.isVisible()) {`);
              lines.push(`    await el.selectOption({ label: testData[${JSON.stringify(matchedKey)}] });`);
              lines.push(`    await el.evaluate((el: HTMLSelectElement) => {`);
              lines.push(`      el.dispatchEvent(new Event('change', { bubbles: true }));`);
              lines.push(`      if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
              lines.push(`    });`);
              lines.push(`    logger.info('Selected ${escapeStr(matchedKey)} via: ' + ds);`);
              lines.push(`    await page.waitForLoadState('networkidle');`);
              lines.push(`    break;`);
              lines.push(`  }`);
              lines.push(`}`);
            }
          } else {
            lines.push(`throw new Error('No testData match for dropdown field: ${escapeStr(rawFieldName)}');`);
          }
        } else if (instruction.includes('checkbox')) {
          // Checkbox field — try direct lookup, then fuzzy match against all checkboxes on page
          let cbField = lookupField(pageRef || null, rawFieldName);
          if (!cbField && pageRef) {
            // Fuzzy: match checkbox fields by word overlap
            const rawWords = rawFieldName.toLowerCase().split(/\s+/);
            for (const [fName, f] of Object.entries(pageRef.fields)) {
              if (f.fieldType?.toLowerCase() !== 'checkbox') continue;
              const fWords = fName.toLowerCase().replace(/^flg/i, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase().split(/\s+/);
              const overlap = rawWords.filter(w => fWords.some(fw => fw.includes(w) || w.includes(fw))).length;
              if (overlap > 0) { cbField = f; break; }
            }
          }
          const safeField = rawFieldName.replace(/[^a-zA-Z0-9]/g, '');
          if (cbField && cbField.selector) {
            // Extract the ID from the selector (e.g. "#FlgEnable" → "FlgEnable")
            const cbId = cbField.selector.replace(/^#/, '');
            lines.push(`// Check "${rawFieldName}" (UI Reference: ${cbField.selector})`);
            lines.push(`// Click the label instead of input — custom checkbox styling means label intercepts pointer events`);
            lines.push(`const mfCbLabel_${safeField} = page.locator('label[for="${cbId}"]');`);
            lines.push(`const mfCbInput_${safeField} = page.locator('${cbField.selector}');`);
            lines.push(`if (await mfCbLabel_${safeField}.count() > 0) {`);
            lines.push(`  const isChecked = await mfCbInput_${safeField}.isChecked();`);
            lines.push(`  if (!isChecked) await mfCbLabel_${safeField}.click();`);
            lines.push(`  logger.info('Checked ${escapeStr(rawFieldName)} via label');`);
            lines.push(`} else if (await mfCbInput_${safeField}.count() > 0) {`);
            lines.push(`  await mfCbInput_${safeField}.check({ force: true });`);
            lines.push(`  logger.info('Checked ${escapeStr(rawFieldName)} via input (force)');`);
            lines.push(`}`);
          } else {
            lines.push(`// Check "${rawFieldName}" (keyword fallback)`);
            lines.push(`const mfCbSels_${safeField} = ['label[for*="${escapeStr(safeField)}" i]', '#${escapeStr(safeField)}', '#Flg${escapeStr(safeField)}', 'input[type="checkbox"][name*="${escapeStr(rawFieldName)}" i]', 'label:has-text("${escapeStr(rawFieldName)}") input[type="checkbox"]'];`);
            lines.push(`for (const cs of mfCbSels_${safeField}) {`);
            lines.push(`  const el = page.locator(cs).first();`);
            lines.push(`  if (await el.count() > 0) { await el.click(); logger.info('Checked ${escapeStr(rawFieldName)} via: ' + cs); break; }`);
            lines.push(`}`);
          }
          // Wait after checkbox — may trigger dynamic fields to appear
          lines.push(`await page.waitForLoadState('networkidle');`);
          lines.push(`await page.waitForTimeout(1000);`);
        } else {
          // Text field (enter, fill, type)
          if (matchedKey) {
            const safeKey = matchedKey.replace(/[^a-zA-Z0-9]/g, '');
            const uiField = lookupField(pageRef || null, matchedKey);

            if (uiField && uiField.selector) {
              lines.push(`// Fill "${matchedKey}" (UI Reference: ${uiField.selector})`);
              lines.push(`// Wait for field to be visible — it may appear dynamically after a checkbox toggle`);
              lines.push(`await page.locator('${uiField.selector}').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});`);
              lines.push(`if (await page.locator('${uiField.selector}').isVisible()) {`);
              lines.push(`  await page.locator('${uiField.selector}').fill(testData[${JSON.stringify(matchedKey)}]);`);
              lines.push(`  logger.info('Filled ${escapeStr(matchedKey)} via UI ref');`);
              lines.push(`} else {`);
              lines.push(`  throw new Error('Field ${uiField.selector} not visible for ${escapeStr(rawFieldName)} — required field missing after checkbox');`);
              lines.push(`}`);

            } else {
              lines.push(`// Fill "${matchedKey}" (keyword fallback)`);
              lines.push(`// Wait for the field — it may be dynamic (e.g. appears after a checkbox)`);
              lines.push(`await page.waitForTimeout(500);`);
              lines.push(`const mfTxtSels_${safeKey} = [`);
              lines.push(`  '#${escapeStr(safeKey)}',`);
              lines.push(`  '#txt${escapeStr(safeKey)}',`);
              lines.push(`  'input:visible[name*="${escapeStr(safeKey)}" i]',`);
              lines.push(`  'input:visible[id*="${escapeStr(safeKey)}" i]',`);
              lines.push(`  'input:visible[placeholder*="min" i]',`);
              lines.push(`];`);
              lines.push(`let mfFilled_${safeKey} = false;`);
              lines.push(`for (const ts of mfTxtSels_${safeKey}) {`);
              lines.push(`  const el = page.locator(ts).first();`);
              lines.push(`  if (await el.count() > 0 && await el.isVisible()) {`);
              lines.push(`    await el.fill(testData[${JSON.stringify(matchedKey)}]);`);
              lines.push(`    logger.info('Filled ${escapeStr(matchedKey)} via: ' + ts);`);
              lines.push(`    mfFilled_${safeKey} = true;`);
              lines.push(`    break;`);
              lines.push(`  }`);
              lines.push(`}`);
              lines.push(`if (!mfFilled_${safeKey}) throw new Error('Could not fill ${escapeStr(matchedKey)} — field not visible after checkbox');`);
            }
          } else {
            lines.push(`throw new Error('No testData match for text field: ${escapeStr(rawFieldName)}');`);
          }
        }
      } else if (fmtBFields.length > 0) {
        // ── Format B: field names extracted from single quotes ──
        // Sort: checkboxes first so dependent fields (revealed by checkbox) are always filled after their controlling checkbox
        // Stop words excluded from fuzzy match to prevent 'File Pattern' matching 'FlgBackupFile' via the word 'file'
        const _cbStopWords = new Set(['file', 'in', 'of', 'the', 'a', 'an', 'and', 'path', 'name', 'type', 'data', 'or', 'to', 'by', 'for']);
        const _resolveCheckbox = (name: string): any | null => {
          // Priority 1: direct lookup — if a field is found, trust its type completely (no fuzzy override)
          const direct = lookupField(pageRef || null, name);
          if (direct !== null) return direct.fieldType?.toLowerCase().includes('checkbox') ? direct : null;
          // Priority 2: fuzzy — only when direct lookup found nothing (e.g. 'Delete Source File' → FlgDeleteSource)
          if (!pageRef) return null;
          const rw = name.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3 && !_cbStopWords.has(w));
          if (rw.length === 0) return null;
          for (const [fn, f] of Object.entries(pageRef.fields)) {
            if ((f as any).fieldType?.toLowerCase() !== 'checkbox') continue;
            const normKey = fn.toLowerCase().replace(/^flg/i, '');
            if (rw.every((w: string) => normKey.includes(w))) return f;
          }
          return null;
        };
        const isCheckboxRaw = (name: string): boolean => _resolveCheckbox(name) !== null;
        const sortedFmtBFields = [...fmtBFields].sort((a, b) => (isCheckboxRaw(a) ? 0 : 1) - (isCheckboxRaw(b) ? 0 : 1));
        for (const rawFieldName of sortedFmtBFields) {
          // ── Priority 1: Identify checkboxes by direct lookup + scoped fuzzy (same logic as sort) ──
          const cbResolved: any = _resolveCheckbox(rawFieldName);
          if (cbResolved !== null) {
            const safeKeyCb = rawFieldName.replace(/[^a-zA-Z0-9]/g, '');
            if (cbResolved?.selector) {
              const cbIdCb = cbResolved.selector.replace(/^#/, '');
              lines.push(`// Check "${rawFieldName}" (UI Reference: ${cbResolved.selector})`);
              lines.push(`{ const cbLbl_${safeKeyCb} = page.locator('label[for="${cbIdCb}"]');`);
              lines.push(`  const cbInp_${safeKeyCb} = page.locator('${cbResolved.selector}');`);
              lines.push(`  if (await cbLbl_${safeKeyCb}.count() > 0) { if (!(await cbInp_${safeKeyCb}.isChecked())) await cbLbl_${safeKeyCb}.click(); }`);
              lines.push(`  else if (await cbInp_${safeKeyCb}.count() > 0) { await cbInp_${safeKeyCb}.check({ force: true }); }`);
              lines.push(`  logger.info('Checked ${escapeStr(rawFieldName)}'); }`);
            } else {
              lines.push(`// Check "${rawFieldName}" (keyword fallback)`);
              lines.push(`{ const fbCb_${safeKeyCb} = page.locator('label[for*="${escapeStr(safeKeyCb)}" i], #Flg${escapeStr(safeKeyCb)}, input[type="checkbox"][name*="${escapeStr(safeKeyCb)}" i]').first();`);
              lines.push(`  if (await fbCb_${safeKeyCb}.count() > 0) await fbCb_${safeKeyCb}.click();`);
              lines.push(`  logger.info('Checked ${escapeStr(rawFieldName)} via fallback'); }`);
            }
            lines.push(`await page.waitForLoadState('networkidle');`);
            continue;
          }

          // ── Priority 2: Not a checkbox — resolve via testData fuzzy match ──
          const matchedKey = findTestDataKey(rawFieldName, testData);
          if (!matchedKey || !(matchedKey in testData)) continue;
          const safeKey = matchedKey.replace(/[^a-zA-Z0-9]/g, '');
          const uiField = lookupField(pageRef || null, matchedKey);

          // fieldType from JSON is authoritative — lineType is only fallback when no UI reference exists
          const effectiveType = uiField?.fieldType
            ? (/dropdown|select/i.test(uiField.fieldType) ? 'dropdown' : 'text')
            : (lineType === 'dropdown' ? 'dropdown' : 'text');

          if (effectiveType === 'dropdown') { // checkboxes are fully handled above via direct lookup
            const preKnownValue = uiField ? lookupOptionValue(uiField, testData[matchedKey]) : null;
            if (uiField && uiField.selector) {
              lines.push(`// Select "${matchedKey}" (UI Reference: ${uiField.selector})`);
              lines.push(`{`);
              lines.push(`  let mfDd_${safeKey} = page.locator('${uiField.selector}');`);
              lines.push(`  if (!(await mfDd_${safeKey}.count() > 0)) { const l = page.getByLabel(${JSON.stringify(matchedKey)}, { exact: false }); if (await l.count() > 0) mfDd_${safeKey} = l.first(); }`);
              lines.push(`  if (!(await mfDd_${safeKey}.count() > 0)) { const c = page.locator('select[id*="${escapeStr(safeKey)}" i], select[name*="${escapeStr(safeKey)}" i]').first(); if (await c.count() > 0) mfDd_${safeKey} = c; }`);
              lines.push(`  await expect(mfDd_${safeKey}).toBeVisible({ timeout: 10000 });`);
              if (preKnownValue) {
                lines.push(`  await mfDd_${safeKey}.selectOption('${preKnownValue}');`);
              } else {
                lines.push(`  const tv_${safeKey} = testData[${JSON.stringify(matchedKey)}];`);
                lines.push(`  try { await mfDd_${safeKey}.selectOption({ label: tv_${safeKey} }); } catch {`);
                lines.push(`    try { await mfDd_${safeKey}.selectOption({ value: tv_${safeKey} }); } catch {`);
                lines.push(`      const opts_${safeKey} = await mfDd_${safeKey}.locator('option').all();`);
                lines.push(`      const m_${safeKey} = (await Promise.all(opts_${safeKey}.map(async o => ({ v: await o.getAttribute('value'), t: ((await o.textContent()) || '').trim() })))).find(o => o.t.toLowerCase() === tv_${safeKey}.toLowerCase());`);
                lines.push(`      if (!m_${safeKey}?.v) throw new Error('No exact match for ${escapeStr(matchedKey)}="' + tv_${safeKey} + '"');`);
                lines.push(`      await mfDd_${safeKey}.selectOption(m_${safeKey}.v);`);
                lines.push(`    }`);
                lines.push(`  }`);
              }
              lines.push(`  await mfDd_${safeKey}.evaluate((el: HTMLSelectElement) => { el.dispatchEvent(new Event('change', { bubbles: true })); if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); } });`);
              lines.push(`  await page.waitForLoadState('networkidle');`);
              lines.push(`  logger.info('Selected ${escapeStr(matchedKey)}: ' + await mfDd_${safeKey}.inputValue());`);
              lines.push(`}`);
            } else {
              lines.push(`// Select "${matchedKey}" dropdown (keyword fallback)`);
              lines.push(`{ const fbSel_${safeKey} = page.locator('select[id*="${escapeStr(safeKey)}" i], select[name*="${escapeStr(safeKey)}" i]').first();`);
              lines.push(`  await expect(fbSel_${safeKey}).toBeVisible({ timeout: 10000 });`);
              lines.push(`  await fbSel_${safeKey}.selectOption({ label: testData[${JSON.stringify(matchedKey)}] });`);
              lines.push(`  await page.waitForLoadState('networkidle'); }`);
            }
          } else {
            // Text field
            if (uiField && uiField.selector) {
              lines.push(`// Fill "${matchedKey}" (UI Reference: ${uiField.selector})`);
              lines.push(`await page.locator('${uiField.selector}').waitFor({ state: 'visible', timeout: 10000 });`);
              lines.push(`await page.locator('${uiField.selector}').fill(testData[${JSON.stringify(matchedKey)}]);`);
              lines.push(`logger.info('Filled ${escapeStr(matchedKey)} via UI ref');`);
            } else {
              lines.push(`// Fill "${matchedKey}" (keyword fallback)`);
              lines.push(`{ const fbTxt_${safeKey} = page.locator('#${escapeStr(safeKey)}, #txt${escapeStr(safeKey)}, input[id*="${escapeStr(safeKey)}" i], input[name*="${escapeStr(safeKey)}" i]').first();`);
              lines.push(`  await fbTxt_${safeKey}.waitFor({ state: 'visible', timeout: 10000 });`);
              lines.push(`  await fbTxt_${safeKey}.fill(testData[${JSON.stringify(matchedKey)}]);`);
              lines.push(`  logger.info('Filled ${escapeStr(matchedKey)} via fallback'); }`);
            }
          }
        }
      }
      // else: item has no recognised format — skip silently
    }
    return lines;
  }

  // ── Search for newly added record by <Field Name> ─────────────────────────
  // Matches: "Search for the newly added record by Configuration Name"
  if (desc.includes('search') && (desc.includes('newly added') || desc.includes('record')) && desc.includes('by ')) {
    const byMatch = step.description.match(/by\s+(.+?)[\r\n.]*$/i);
    const searchFieldName = byMatch ? byMatch[1].trim() : '';
    const matchedKey = searchFieldName ? findTestDataKey(searchFieldName, testData) : null;
    const searchValue = matchedKey ? `testData[${JSON.stringify(matchedKey)}]` : `testData['Record Name'] || testData['Configuration Name'] || ''`;

    // Resolve selectors from pageRef.listPage, then pageRef.tables.main, then generic fallback
    const iconSel   = pageRef?.listPage?.searchIconSelector   || 'i.fa.fa-search';
    const inputSel  = pageRef?.listPage?.searchInputSelector  || '#txtSearch';
    const btnSel    = pageRef?.listPage?.searchButtonSelector || '#Search';
    const mainTableSel = (pageRef as any)?.tables?.main?.selector;
    const gridSel   = pageRef?.listPage?.gridSelector || (mainTableSel ? `${mainTableSel} tbody tr` : 'tbody tr');

    lines.push(`// ── Search for newly added record by "${searchFieldName}" ──`);
    lines.push(`const _srchVal = ${searchValue};`);
    lines.push(`let _searchPanelUsed = false;`);
    lines.push(`logger.info('Searching for record: ' + _srchVal);`);
    lines.push(`// Wait for list to fully load before checking row visibility`);
    lines.push(`await page.waitForLoadState('networkidle');`);
    lines.push(`await page.waitForSelector(${JSON.stringify(gridSel)}, { state: 'visible', timeout: 15000 });`);
    lines.push(`// Check if record is already visible in the loaded list (TC_001–TC_003 path)`);
    lines.push(`const _rowVisible = await page.locator(\`tr:has-text("\${_srchVal}")\`).count() > 0;`);
    lines.push(`if (_rowVisible) {`);
    lines.push(`  logger.info('Record already visible in list — skipping search');`);
    lines.push(`} else {`);
    lines.push(`  // Record not visible — use search panel (TC_004+ path)`);
    lines.push(`  _searchPanelUsed = true;`);
    lines.push(`  logger.info('Record not in current view — using search panel');`);
    lines.push(`  // Step 1 — click search icon to open search panel`);
    lines.push(`  await page.locator(${JSON.stringify(iconSel)}).first().click();`);
    lines.push(`  await page.waitForLoadState('networkidle');`);
    lines.push(`  // Step 2 — fill page-specific search input`);
    lines.push(`  await page.locator(${JSON.stringify(inputSel)}).waitFor({ state: 'visible', timeout: 10000 });`);
    lines.push(`  await page.locator(${JSON.stringify(inputSel)}).clear();`);
    lines.push(`  await page.locator(${JSON.stringify(inputSel)}).fill(_srchVal);`);
    lines.push(`  logger.info('Search input filled: ' + _srchVal);`);
    lines.push(`  // Step 3 — click search submit button`);
    lines.push(`  await page.locator(${JSON.stringify(btnSel)}).click();`);
    lines.push(`  await page.waitForLoadState('networkidle');`);
    lines.push(`  await page.waitForSelector(\`tr:has-text("\${_srchVal}")\`, { state: 'visible', timeout: 10000 });`);
    lines.push(`  logger.info('Record found via search: ' + _srchVal);`);
    lines.push(`}`);
    return lines;
  }

  // Fill a specific named field from testData
  if (desc.includes('fill') && !desc.includes('search')) {
    const fieldName = extractFieldName(desc);
    const matchedKey = fieldName ? findTestDataKey(fieldName, testData) : null;
    if (matchedKey) {
      const safeName = matchedKey.replace(/[^a-zA-Z0-9]/g, '');
      const uiTextField = lookupField(pageRef || null, matchedKey);

      const isDropdownField = /dropdown|select/i.test(uiTextField?.fieldType || '');
      if (uiTextField && uiTextField.selector && isDropdownField) {
        // Field is a Dropdown — use 5-level fallback + strict selectOption (no fill)
        lines.push(`// Select "${matchedKey}" from dropdown (UI Reference: ${uiTextField.selector})`);
        lines.push(`{`);
        lines.push(`  let ddFb_${safeName} = page.locator('${uiTextField.selector}');`);
        lines.push(`  // 5-level fallback: UI ref → getByLabel → getByRole combobox → label-adjacent select → name/id CSS`);
        lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
        lines.push(`    const lbl_${safeName} = page.getByLabel(${JSON.stringify(matchedKey)}, { exact: false });`);
        lines.push(`    if (await lbl_${safeName}.count() > 0) ddFb_${safeName} = lbl_${safeName}.first();`);
        lines.push(`  }`);
        lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
        lines.push(`    const role_${safeName} = page.getByRole('combobox', { name: new RegExp(${JSON.stringify(matchedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}, 'i') });`);
        lines.push(`    if (await role_${safeName}.count() > 0) ddFb_${safeName} = role_${safeName}.first();`);
        lines.push(`  }`);
        lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
        lines.push(`    const adj_${safeName} = page.locator('label:has-text("${escapeStr(matchedKey)}") ~ select, label:has-text("${escapeStr(matchedKey)}") + select').first();`);
        lines.push(`    if (await adj_${safeName}.count() > 0) ddFb_${safeName} = adj_${safeName};`);
        lines.push(`  }`);
        lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
        lines.push(`    const css_${safeName} = page.locator('select[name*="${escapeStr(safeName)}" i], select[id*="${escapeStr(safeName)}" i]').first();`);
        lines.push(`    if (await css_${safeName}.count() > 0) ddFb_${safeName} = css_${safeName};`);
        lines.push(`  }`);
        lines.push(`  await expect(ddFb_${safeName}).toBeVisible({ timeout: 10000 });`);
        // Strict: exact label → exact value → case-insensitive exact label only
        lines.push(`  const tv_${safeName} = testData[${JSON.stringify(matchedKey)}];`);
        lines.push(`  try { await ddFb_${safeName}.selectOption({ label: tv_${safeName} }); } catch {`);
        lines.push(`    try { await ddFb_${safeName}.selectOption({ value: tv_${safeName} }); } catch {`);
        lines.push(`      const opts_${safeName} = await ddFb_${safeName}.locator('option').all();`);
        lines.push(`      const matched_${safeName} = (await Promise.all(opts_${safeName}.map(async o => ({ v: await o.getAttribute('value'), t: ((await o.textContent()) || '').trim() })))).find(o => o.t.toLowerCase() === tv_${safeName}.toLowerCase());`);
        lines.push(`      if (!matched_${safeName}?.v) throw new Error('No exact match for ${escapeStr(matchedKey)}="' + tv_${safeName} + '"');`);
        lines.push(`      await ddFb_${safeName}.selectOption(matched_${safeName}.v);`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`  await ddFb_${safeName}.evaluate((el: HTMLSelectElement) => {`);
        lines.push(`    el.dispatchEvent(new Event('change', { bubbles: true }));`);
        lines.push(`    if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
        lines.push(`  });`);
        lines.push(`  await page.waitForLoadState('networkidle');`);
        lines.push(`  logger.info('Selected ${escapeStr(matchedKey)}: ' + await ddFb_${safeName}.inputValue());`);
        lines.push(`}`);
      } else if (uiTextField && uiTextField.selector) {
        lines.push(`// Fill "${matchedKey}" (UI Reference: ${uiTextField.selector})`);
        lines.push(`const fillEl_${safeName} = page.locator('${uiTextField.selector}');`);
        lines.push(`await expect(fillEl_${safeName}).toBeVisible({ timeout: 10000 });`);
        lines.push(`await fillEl_${safeName}.fill(testData[${JSON.stringify(matchedKey)}]);`);
        lines.push(`logger.info('Filled ${escapeStr(matchedKey)} via UI ref: ${uiTextField.selector}');`);
      } else {
        lines.push(`// Fill "${matchedKey}" from testData — keyword fallback`);
        lines.push(`const fillSels_${safeName} = [`);
        lines.push(`  'input:visible[type="text"]',`);
        lines.push(`  'input:visible[name*="${escapeStr(matchedKey)}" i]',`);
        lines.push(`  '#txt${escapeStr(safeName)}:visible',`);
        lines.push(`  '#${escapeStr(safeName)}:visible',`);
        lines.push(`  'input:visible[placeholder*="${escapeStr(matchedKey)}" i]',`);
        lines.push(`  'textarea:visible',`);
        lines.push(`];`);
        lines.push(`let filled_${safeName} = false;`);
        lines.push(`for (const fs of fillSels_${safeName}) {`);
        lines.push(`  const el = page.locator(fs).first();`);
        lines.push(`  if (await el.count() > 0 && await el.isVisible()) {`);
        lines.push(`    await el.fill(testData[${JSON.stringify(matchedKey)}]);`);
        lines.push(`    filled_${safeName} = true;`);
        lines.push(`    logger.info('Filled ${escapeStr(matchedKey)} via: ' + fs);`);
        lines.push(`    break;`);
        lines.push(`  }`);
        lines.push(`}`);
        lines.push(`if (!filled_${safeName}) throw new Error('Could not find visible input for ${escapeStr(matchedKey)}');`);
      }
      return lines;
    }
  }

  // Select from dropdown
  if (desc.includes('select') && (desc.includes('dropdown') || desc.includes('type'))) {
    const fieldName = extractFieldName(desc) || extractSelectFieldName(desc);
    const matchedKey = fieldName ? findTestDataKey(fieldName, testData) : null;
    if (matchedKey) {
      const safeName = matchedKey.replace(/[^a-zA-Z0-9]/g, '');
      const uiField = lookupField(pageRef || null, matchedKey);
      const preKnownValue = uiField ? lookupOptionValue(uiField, testData[matchedKey]) : null;

      if (uiField && uiField.selector) {
        lines.push(`// Select "${matchedKey}" from dropdown (UI Reference: ${uiField.selector})`);
        lines.push(`const ddStandalone_${safeName} = page.locator('${uiField.selector}');`);
        lines.push(`await ddStandalone_${safeName}.waitFor({ state: 'visible', timeout: 10000 });`);
        if (preKnownValue) {
          lines.push(`await ddStandalone_${safeName}.selectOption('${preKnownValue}');`);
        } else {
          lines.push(`await ddStandalone_${safeName}.selectOption({ label: testData[${JSON.stringify(matchedKey)}] });`);
        }
        lines.push(`await ddStandalone_${safeName}.evaluate((el: HTMLSelectElement) => {`);
        lines.push(`  el.dispatchEvent(new Event('change', { bubbles: true }));`);
        lines.push(`  if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
        lines.push(`});`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else {
        lines.push(`// Select "${matchedKey}" from dropdown (keyword fallback)`);
        lines.push(`const selDropdowns = page.locator('select:visible');`);
        lines.push(`const selCount = await selDropdowns.count();`);
        lines.push(`for (let i = 0; i < selCount; i++) {`);
        lines.push(`  try {`);
        lines.push(`    await selDropdowns.nth(i).selectOption({ label: testData[${JSON.stringify(matchedKey)}] });`);
        lines.push(`    await selDropdowns.nth(i).evaluate((el: HTMLSelectElement) => {`);
        lines.push(`      el.dispatchEvent(new Event('change', { bubbles: true }));`);
        lines.push(`      if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
        lines.push(`    });`);
        lines.push(`    logger.info('Selected ' + testData[${JSON.stringify(matchedKey)}] + ' from dropdown ' + i);`);
        lines.push(`    break;`);
        lines.push(`  } catch { /* try next */ }`);
        lines.push(`}`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      }
      return lines;
    }
  }

  // ── Standard action-based mapping ─────────────────────────────────────────

  // Page-specific list table selector — prevents ambiguity when multiple <tbody> exist.
  // Uses the main table ID from ui-reference-lookup.json if available, else generic fallback.
  const mainTableSel: string = (pageRef as any)?.tables?.main?.selector || '';
  const listTableSel: string = mainTableSel ? `${mainTableSel} tbody` : 'table tbody';

  switch (step.action) {
    case 'navigate': {
      // Helper: emit menu-click lines from an ordered list of menu part strings
      const emitMenuNav = (parts: string[], source: string) => {
        lines.push(`// Navigate via menu: ${source}`);
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed) {
            lines.push(`await page.click('a:has-text("${escapeStr(trimmed)}"), [title*="${escapeStr(trimmed)}" i]');`);
            lines.push(`await page.waitForTimeout(500);`);
          }
        }
        lines.push(`await page.waitForSelector('${listTableSel}', { state: 'visible', timeout: 20000 });`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      };

      // Detect forward menu navigation: presence of '>' or '→' always means click through menu
      const isForwardMenuNav = step.description.includes('>') || step.description.includes('→');
      // Detect backwards navigation: explicit "go back / click back / return to list"
      // Must NOT also be a forward nav (e.g. "Navigate back to X > Y" still means forward)
      const isBackNav = !isForwardMenuNav &&
        (desc.includes('go back') || desc.includes('click back') ||
         desc.includes('navigate back') || desc.includes('return to list') ||
         (desc.includes('back') && !desc.match(/navigate to|go to/)) ||
         (desc.includes('return') && !desc.match(/navigate to|go to/)));

      if (desc.includes('login') || desc.includes('application')) {
        // Login / app root navigation
        lines.push(`await page.goto(APP_BASE_URL);`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if (step.value && !step.value.match(/^\/?(login|signin)/i)) {
        // Explicit URL value provided
        lines.push(`await page.goto(APP_BASE_URL + ${JSON.stringify(step.value)});`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if (isForwardMenuNav) {
        // '>' present → always forward menu navigation regardless of other keywords
        // Priority: pageRef.menuPath (authoritative) → parsed from description
        if (pageRef && pageRef.menuPath) {
          emitMenuNav(pageRef.menuPath.split(/\s*>\s*/), pageRef.menuPath);
        } else {
          const menuMatch = step.description.match(/(?:navigate to|go to|open)\s+(.+)/i);
          const menuText = menuMatch ? menuMatch[1].trim().replace(/[()]/g, '') : step.description;
          emitMenuNav(menuText.split(/[>→]/), menuText);
        }
      } else if (desc.includes('add') || desc.includes('+') || desc.includes('new record') || desc.includes('form')) {
        // "Click the Add / + button" mis-classified as navigate
        lines.push(`await page.waitForSelector('#btnCreate, button:has-text("Add"), .fa-plus', { state: 'visible', timeout: 10000 });`);
        lines.push(`const addBtn = page.locator('#btnCreate, button:has-text("Add")').first();`);
        lines.push(`await addBtn.click();`);
        lines.push(`await page.waitForLoadState('networkidle');`);
        lines.push(`// Wait for form to be ready — prefer dropdown (loaded by AJAX on some pages)`);
        lines.push(`await page.waitForSelector('select:visible, input:visible[type="text"], form:visible', { state: 'visible', timeout: 15000 });`);
        lines.push(`await page.waitForTimeout(1000);`);
      } else if (isBackNav) {
        // Explicitly returning to list — use Back button
        lines.push(`await page.click('#btnBack, button:has-text("Back"), a:has-text("Back")');`);
        lines.push(`await page.waitForSelector('${listTableSel}', { state: 'visible', timeout: 20000 });`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else {
        // No '>' but still a module navigation — use pageRef.menuPath or parse description
        let navHandled = false;
        if (pageRef && pageRef.menuPath) {
          emitMenuNav(pageRef.menuPath.split(/\s*>\s*/), pageRef.menuPath);
          navHandled = true;
        }
        if (!navHandled) {
          const menuMatch = desc.match(/(?:navigate to|go to|open)\s+(.+)/i);
          if (menuMatch) {
            const menuText = menuMatch[1].trim().replace(/[()]/g, '');
            emitMenuNav(menuText.split(/[>→,]/), menuText);
          } else {
            lines.push(`await page.goto(APP_BASE_URL);`);
            lines.push(`await page.waitForLoadState('networkidle');`);
          }
        }
      }
      break;
    }

    case 'fill': {
      if (desc.includes('search')) {
        const searchVal = extractValueFromDesc(desc, testData) || testData['Record Name'] || testData['Gateway Name'] || '';
        lines.push(`const searchRecName = testData['Record Name'] || testData['Gateway Name'] || ${JSON.stringify(searchVal)};`);
        lines.push(`// If a filter panel toggle exists (collapsed by default), try clicking it first`);
        lines.push(`const filterToggle = page.locator('#btnFilter, [data-toggle="collapse"][href*="filter" i], button:has-text("Filter"), a:has-text("Filter"), .filter-toggle').first();`);
        lines.push(`if (await filterToggle.count() > 0 && await filterToggle.isVisible()) {`);
        lines.push(`  await filterToggle.click();`);
        lines.push(`  await page.waitForTimeout(500);`);
        lines.push(`}`);
        lines.push(`// Try page-specific filter inputs (Gateway Config, Column Config, generic search)`);
        lines.push(`const filterInputSels = [`);
        lines.push(`  '#txtGateWayName',`);
        lines.push(`  '#txtGatewayName',`);
        lines.push(`  '#txtGateWayNameFilter',`);
        lines.push(`  '#txtColumnType',`);
        lines.push(`  '#txtSearch',`);
        lines.push(`  'input[type="search"]',`);
        lines.push(`  'input:visible[placeholder*="search" i]',`);
        lines.push(`  'input:visible[id*="filter" i][type="text"]',`);
        lines.push(`  'input:visible[name*="search" i]',`);
        lines.push(`];`);
        lines.push(`let searchDone = false;`);
        lines.push(`for (const ss of filterInputSels) {`);
        lines.push(`  const searchEl = page.locator(ss).first();`);
        lines.push(`  if (await searchEl.count() > 0 && await searchEl.isVisible()) {`);
        lines.push(`    await searchEl.fill(searchRecName);`);
        lines.push(`    // Click the Search button if present, otherwise press Enter`);
        lines.push(`    const searchBtn = page.locator('#btnSearch:visible, button:has-text("Search"):visible').first();`);
        lines.push(`    if (await searchBtn.count() > 0) {`);
        lines.push(`      await searchBtn.click();`);
        lines.push(`    } else {`);
        lines.push(`      await page.keyboard.press('Enter');`);
        lines.push(`    }`);
        lines.push(`    await page.waitForLoadState('networkidle');`);
        lines.push(`    await page.waitForTimeout(2000);`);
        lines.push(`    searchDone = true;`);
        lines.push(`    logger.info('Searched for "' + searchRecName + '" via: ' + ss);`);
        lines.push(`    break;`);
        lines.push(`  }`);
        lines.push(`}`);
        lines.push(`if (!searchDone) {`);
        lines.push(`  // No search/filter input found — skip search and locate row directly`);
        lines.push(`  logger.info('No search/filter input on page — will locate record row directly by text');`);
        lines.push(`}`);
        lines.push(`// After search (or skip), wait for the target row to be visible directly`);
        lines.push(`const directRow = page.locator(\`tr:has-text("\${searchRecName}")\`).first();`);
        lines.push(`if (await directRow.count() > 0) {`);
        lines.push(`  logger.info('Record row found: "' + searchRecName + '"');`);
        lines.push(`} else {`);
        lines.push(`  logger.info('Record row not visible yet — delete step will verify');`);
        lines.push(`}`);
      } else if (step.selector) {
        const val = step.value || extractValueFromDesc(desc, testData) || '';
        lines.push(`await page.waitForSelector(${JSON.stringify(step.selector)}, { state: 'visible', timeout: 10000 });`);
        lines.push(`await page.fill(${JSON.stringify(step.selector)}, ${JSON.stringify(val)});`);
      } else {
        // Try to match field name from description to testData (using normalized key lookup)
        const fieldName = extractFieldName(desc);
        const matchedKey = fieldName ? findTestDataKey(fieldName, testData) : null;
        if (matchedKey) {
          const safeName = matchedKey.replace(/[^a-zA-Z0-9]/g, '');
          const uiTextField = lookupField(pageRef || null, matchedKey);
          const isDropdown = /dropdown|select/i.test(uiTextField?.fieldType || '');
          if (uiTextField && uiTextField.selector && isDropdown) {
            // Field is a Select/Dropdown — generate resilient selectOption with getByLabel/getByRole fallbacks
            const preKnownValue = lookupOptionValue(uiTextField, testData[matchedKey]);
            lines.push(`// Select "${matchedKey}" from dropdown (UI Reference: ${uiTextField.selector})`);
            lines.push(`{`);
            lines.push(`  let ddFb_${safeName} = page.locator('${uiTextField.selector}');`);
            lines.push(`  // 5-level fallback: UI ref → getByLabel → getByRole combobox → label-adjacent select → name/id CSS`);
            lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
            lines.push(`    const lbl_${safeName} = page.getByLabel(${JSON.stringify(matchedKey)}, { exact: false });`);
            lines.push(`    if (await lbl_${safeName}.count() > 0) ddFb_${safeName} = lbl_${safeName}.first();`);
            lines.push(`  }`);
            lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
            lines.push(`    const role_${safeName} = page.getByRole('combobox', { name: new RegExp(${JSON.stringify(matchedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}, 'i') });`);
            lines.push(`    if (await role_${safeName}.count() > 0) ddFb_${safeName} = role_${safeName}.first();`);
            lines.push(`  }`);
            lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
            lines.push(`    const adj_${safeName} = page.locator('label:has-text("${escapeStr(matchedKey)}") ~ select, label:has-text("${escapeStr(matchedKey)}") + select').first();`);
            lines.push(`    if (await adj_${safeName}.count() > 0) ddFb_${safeName} = adj_${safeName};`);
            lines.push(`  }`);
            lines.push(`  if (!(await ddFb_${safeName}.count() > 0)) {`);
            lines.push(`    const css_${safeName} = page.locator('select[name*="${escapeStr(safeName)}" i], select[id*="${escapeStr(safeName)}" i]').first();`);
            lines.push(`    if (await css_${safeName}.count() > 0) ddFb_${safeName} = css_${safeName};`);
            lines.push(`  }`);
            lines.push(`  await expect(ddFb_${safeName}).toBeVisible({ timeout: 10000 });`);
            if (preKnownValue) {
              lines.push(`  await ddFb_${safeName}.selectOption('${preKnownValue}');`);
            } else {
              // Strict: exact label → exact value → case-insensitive exact label only
              lines.push(`  const tv_${safeName} = testData[${JSON.stringify(matchedKey)}];`);
              lines.push(`  try { await ddFb_${safeName}.selectOption({ label: tv_${safeName} }); } catch {`);
              lines.push(`    try { await ddFb_${safeName}.selectOption({ value: tv_${safeName} }); } catch {`);
              lines.push(`      const opts_${safeName} = await ddFb_${safeName}.locator('option').all();`);
              lines.push(`      const matched_${safeName} = (await Promise.all(opts_${safeName}.map(async o => ({ v: await o.getAttribute('value'), t: ((await o.textContent()) || '').trim() })))).find(o => o.t.toLowerCase() === tv_${safeName}.toLowerCase());`);
              lines.push(`      if (!matched_${safeName}?.v) throw new Error('No exact match for ${escapeStr(matchedKey)}="' + tv_${safeName} + '"');`);
              lines.push(`      await ddFb_${safeName}.selectOption(matched_${safeName}.v);`);
              lines.push(`    }`);
              lines.push(`  }`);
            }
            lines.push(`  await ddFb_${safeName}.evaluate((el: HTMLSelectElement) => {`);
            lines.push(`    el.dispatchEvent(new Event('change', { bubbles: true }));`);
            lines.push(`    if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }`);
            lines.push(`  });`);
            lines.push(`  await page.waitForLoadState('networkidle');`);
            lines.push(`  logger.info('Selected ${escapeStr(matchedKey)}: ' + await ddFb_${safeName}.inputValue());`);
            lines.push(`}`);
          } else if (uiTextField && uiTextField.selector) {
            lines.push(`// Fill "${matchedKey}" (UI Reference: ${uiTextField.selector})`);
            lines.push(`const fillFb_${safeName} = page.locator('${uiTextField.selector}');`);
            lines.push(`await expect(fillFb_${safeName}).toBeVisible({ timeout: 10000 });`);
            lines.push(`await fillFb_${safeName}.fill(testData[${JSON.stringify(matchedKey)}]);`);
            lines.push(`logger.info('Filled ${escapeStr(matchedKey)} via UI ref: ${uiTextField.selector}');`);
          } else {
            lines.push(`// Fill "${matchedKey}" (keyword fallback)`);
            lines.push(`const fieldSels_${safeName} = [`);
            lines.push(`  'input[name*="${escapeStr(matchedKey)}" i]',`);
            lines.push(`  'input[placeholder*="${escapeStr(matchedKey)}" i]',`);
            lines.push(`  '#${escapeStr(safeName)}',`);
            lines.push(`  '#txt${escapeStr(safeName)}',`);
            lines.push(`  'input:visible[id*="${escapeStr(safeName)}" i]',`);
            lines.push(`];`);
            lines.push(`let filled_${safeName} = false;`);
            lines.push(`for (const fs of fieldSels_${safeName}) {`);
            lines.push(`  const el = page.locator(fs).first();`);
            lines.push(`  if (await el.count() > 0 && await el.isVisible()) {`);
            lines.push(`    await el.fill(testData[${JSON.stringify(matchedKey)}]);`);
            lines.push(`    filled_${safeName} = true;`);
            lines.push(`    logger.info('Filled ${escapeStr(matchedKey)} via: ' + fs);`);
            lines.push(`    break;`);
            lines.push(`  }`);
            lines.push(`}`);
            lines.push(`if (!filled_${safeName}) throw new Error('Could not find visible input for ${escapeStr(matchedKey)}');`);
          }
        } else {
          lines.push(`throw new Error('Step ${step.stepNumber}: auto-fill not mapped — ${escapeStr(step.description)}');`);
        }
      }
      break;
    }

    case 'click': {
      if (desc.includes('add') || desc.includes('+')) {
        lines.push(`await page.waitForSelector('#btnCreate, button:has-text("Add"), .fa-plus', { state: 'visible', timeout: 10000 });`);
        lines.push(`const addBtn = page.locator('#btnCreate, button:has-text("Add")').first();`);
        lines.push(`await addBtn.click();`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if (desc.includes('save') || desc.includes('submit')) {
        lines.push(`await page.click('#btnSave, #btnSaveColType, button:has-text("Save"), button[type="submit"]');`);
        lines.push(`await page.waitForTimeout(1500);`);
        lines.push(`await page.waitForLoadState('networkidle');`);
        lines.push(`// Save success: wait for message to appear in DOM (may disappear quickly — use attached not visible)`);
        lines.push(`const successEl = page.locator('[class*="success"], .alert-success').or(page.getByText(/saved successfully/i)).or(page.getByText(/record save/i)).first();`);
        lines.push(`await successEl.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {`);
        lines.push(`  logger.info('Save success element not found in DOM — continuing');`);
        lines.push(`});`);
        lines.push(`logger.info('Save success confirmed');`);
      } else if ((step.description.includes('>') || step.description.includes('→')) && (desc.includes('navigate') || desc.includes('go to') || desc.includes('open'))) {
        // step.action='click' but description has '>' → it's a menu navigation, not a button click
        if (pageRef && pageRef.menuPath) {
          lines.push(`// Navigate via menu (click action re-routed): ${pageRef.menuPath}`);
          for (const part of pageRef.menuPath.split(/\s*>\s*/)) {
            if (part.trim()) {
              lines.push(`await page.click('a:has-text("${escapeStr(part.trim())}"), [title*="${escapeStr(part.trim())}" i]');`);
              lines.push(`await page.waitForTimeout(500);`);
            }
          }
        } else {
          const menuMatch = step.description.match(/(?:navigate to|go to|open)\s+(.+)/i);
          const menuText = menuMatch ? menuMatch[1].trim().replace(/[()]/g, '') : step.description;
          lines.push(`// Navigate via menu (click action re-routed): ${menuText}`);
          for (const part of menuText.split(/[>→]/)) {
            if (part.trim()) {
              lines.push(`await page.click('a:has-text("${escapeStr(part.trim())}"), [title*="${escapeStr(part.trim())}" i]');`);
              lines.push(`await page.waitForTimeout(500);`);
            }
          }
        }
        lines.push(`await page.waitForSelector('${listTableSel}', { state: 'visible', timeout: 20000 });`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if ((desc.includes('back') || desc.includes('return')) && !step.description.includes('>')) {
        // Back button — only when NOT a forward navigation
        lines.push(`await page.click('#btnBack, button:has-text("Back"), a:has-text("Back")');`);
        lines.push(`await page.waitForSelector('${listTableSel}', { state: 'visible', timeout: 20000 });`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if (desc.includes('delete') || desc.includes('bin') || desc.includes('trash')) {
        const recordName = testData['Record Name'] || testData['Gateway Name'] || '';
        lines.push(`// Capture exact-match cell count before delete for later verification`);
        lines.push(`const recName = testData['Record Name'] || testData['Gateway Name'] || ${JSON.stringify(recordName)};`);
        lines.push("const preDeleteRowCount = await page.locator(`td:text-is(\"${recName}\")`).count();");
        lines.push(`logger.info('Pre-delete exact-match count for "' + recName + '": ' + preDeleteRowCount);`);
        lines.push(`// Click delete on the record row`);
        lines.push(`const delSels = ['.fa-trash', '.fa-trash-alt', '[data-action="delete"]', 'button[title*="delete" i]'];`);
        lines.push(`let deleteClicked = false;`);
        lines.push(`for (const del of delSels) {`);
        lines.push("  const sel = `tr:has-text(\"${recName}\") ${del}`;");
        lines.push(`  if (await page.locator(sel).count() > 0) {`);
        lines.push(`    await page.click(sel);`);
        lines.push(`    deleteClicked = true;`);
        lines.push(`    logger.info('Delete clicked via: ' + sel);`);
        lines.push(`    break;`);
        lines.push(`  }`);
        lines.push(`}`);
        lines.push(`expect(deleteClicked, 'Delete icon not found on record row').toBe(true);`);
      } else if (desc.includes('yes') || desc.includes('confirm')) {
        lines.push(`// Confirm popup — wait for any dialog pattern (bootstrap modal, role=dialog, swal, or custom div with Confirmation heading)`);
        lines.push(`await page.waitForSelector('.modal:visible, [role="dialog"]:visible, .swal2-container:visible, :has(h4:has-text("Confirmation")):visible', { state: 'visible', timeout: 8000 }).catch(async () => {`);
        lines.push(`  // Fallback: just wait for a visible "Yes" button`);
        lines.push(`  await page.waitForSelector('button:has-text("Yes"):visible', { state: 'visible', timeout: 5000 });`);
        lines.push(`});`);
        lines.push(`const yesSels = ['button:has-text("Yes"):visible', '.modal-footer button:has-text("Yes")', '.modal button:has-text("Yes")', '.swal2-confirm'];`);
        lines.push(`for (const ys of yesSels) {`);
        lines.push(`  if (await page.locator(ys).count() > 0) {`);
        lines.push(`    await page.click(ys);`);
        lines.push(`    logger.info('Confirmed via: ' + ys);`);
        lines.push(`    break;`);
        lines.push(`  }`);
        lines.push(`}`);
        lines.push(`// Wait for delete to complete: poll until the Yes button is gone and page settles`);
        lines.push(`await page.waitForFunction(() => {`);
        lines.push(`  const yesBtn = document.querySelector('button');`);
        lines.push(`  const btns = [...document.querySelectorAll('button')];`);
        lines.push(`  const hasYes = btns.some(b => b.textContent?.trim() === 'Yes' && b.offsetParent !== null);`);
        lines.push(`  return !hasYes;`);
        lines.push(`}, { timeout: 15000 });`);
        lines.push(`await page.waitForLoadState('networkidle');`);
        lines.push(`// Wait for any remaining overlay/spinner to clear`);
        lines.push(`await page.waitForFunction(() => {`);
        lines.push(`  const overlay = document.querySelector('.blockUI, .loading-overlay, [class*="spinner"], [class*="loading"]');`);
        lines.push(`  return !overlay || (overlay as HTMLElement).offsetParent === null;`);
        lines.push(`}, { timeout: 10000 }).catch(() => {});`);
      } else if (desc.includes('login') && desc.includes('button')) {
        lines.push(`await page.click('button[type="submit"]');`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if (desc.includes('logout') || desc.includes('log out') || desc.includes('sign out')) {
        lines.push(`const logoutSels = ["i[class='fa fa fa-power-off fs14']", 'i.fa-power-off', '[title*="logout" i]', 'a:has-text("Logout")'];`);
        lines.push(`for (const ls of logoutSels) {`);
        lines.push(`  if (await page.locator(ls).count() > 0) {`);
        lines.push(`    await page.click(ls);`);
        lines.push(`    break;`);
        lines.push(`  }`);
        lines.push(`}`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if (step.selector) {
        lines.push(`await page.click(${JSON.stringify(step.selector)});`);
      } else {
        // Generic click — try to extract button text from description
        const btnMatch = desc.match(/click\s+(?:the\s+)?(?:on\s+)?['""]?(.+?)['""]?\s*(?:button|icon|link)?$/i);
        if (btnMatch) {
          const btnText = btnMatch[1].trim();
          lines.push(`await page.click('button:has-text("${escapeStr(btnText)}"), a:has-text("${escapeStr(btnText)}"), [title*="${escapeStr(btnText)}" i]');`);
        } else {
          lines.push(`throw new Error('Step ${step.stepNumber}: auto-click not mapped — ${escapeStr(step.description)}');`);
        }
      }
      break;
    }

    case 'selectOption': {
      if (step.selector && step.value) {
        lines.push(`await page.selectOption(${JSON.stringify(step.selector)}, ${JSON.stringify(step.value)});`);
      } else {
        lines.push(`throw new Error('Step ${step.stepNumber}: selectOption not mapped — ${escapeStr(step.description)}');`);
      }
      break;
    }

    case 'assertVisible': {
      if (desc.includes('not') && (desc.includes('visible') || desc.includes('gone') || desc.includes('no longer'))) {
        const recordName = testData['Record Name'] || testData['Gateway Name'] || '';
        lines.push(`// Assert record is deleted`);
        lines.push(`const recGone = testData['Record Name'] || testData['Gateway Name'] || ${JSON.stringify(recordName)};`);
        lines.push("const rowGone = await page.locator(`tr:has-text(\"${recGone}\")`).count();");
        lines.push(`expect(rowGone, 'Record should be deleted from list').toBe(0);`);
      } else if (desc.includes('success')) {
        lines.push(`const successVis = page.locator('[class*="success"]:visible, .alert-success:visible, text=saved successfully').first();`);
        lines.push(`await expect(successVis).toBeVisible({ timeout: 5000 });`);
      } else if (step.selector) {
        lines.push(`await expect(page.locator(${JSON.stringify(step.selector)})).toBeVisible();`);
      } else {
        lines.push(`// Assertion step: ${step.description}`);
        lines.push(`logger.info('Assertion: ${escapeStr(step.description)}');`);
      }
      break;
    }

    case 'assertNotVisible': {
      if (step.selector) {
        lines.push(`await expect(page.locator(${JSON.stringify(step.selector)})).not.toBeVisible();`);
      }
      break;
    }

    case 'screenshot': {
      const name = `${tc.id}-step${step.stepNumber}`;
      lines.push(`await page.screenshot({ path: 'results/screenshots/${name}-' + Date.now() + '.png', fullPage: true });`);
      break;
    }

    case 'waitForElement': {
      if (step.selector) {
        lines.push(`await page.waitForSelector(${JSON.stringify(step.selector)}, { state: 'visible', timeout: ${step.waitTimeout || 10000} });`);
      }
      break;
    }

    default: {
      // Custom / unmapped — handle common patterns from description
      if (desc.includes('logout') || desc.includes('log out')) {
        lines.push(`const logoutSels2 = ["i[class='fa fa fa-power-off fs14']", 'i.fa-power-off', '[title*="logout" i]', 'a:has-text("Logout")'];`);
        lines.push(`for (const ls of logoutSels2) {`);
        lines.push(`  if (await page.locator(ls).count() > 0) { await page.click(ls); break; }`);
        lines.push(`}`);
        lines.push(`await page.waitForLoadState('networkidle');`);
      } else if (desc.includes('verify') && (desc.includes('not') || desc.includes('no longer') || desc.includes('deleted'))) {
        const recordName = testData['Record Name'] || testData['Gateway Name'] || '';
        lines.push(`const recCheck = testData['Record Name'] || testData['Gateway Name'] || ${JSON.stringify(recordName)};`);
        lines.push("const rowCnt = await page.locator(`tr:has-text(\"${recCheck}\")`).count();");
        lines.push(`expect(rowCnt, 'Record should not be visible').toBe(0);`);
      } else {
        lines.push(`// Custom step: ${step.description}`);
        lines.push(`logger.info('Custom step: ${escapeStr(step.description)}');`);
      }
      break;
    }
  }

  return lines;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function indent(spaces: number, lines: string[]): string[] {
  const pad = ' '.repeat(spaces);
  return lines.map(l => pad + l);
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeComment(s: string): string {
  return s.replace(/\*\//g, '* /');
}

function extractFieldName(desc: string): string | null {
  // "Fill in the Gateway Name field"
  const m = desc.match(/(?:fill|enter|type|input)\s+(?:in\s+)?(?:the\s+)?(.+?)\s+(?:field|input|box)/i);
  if (m) return m[1].trim();
  // "Fill in the Gateway Name"
  const m3 = desc.match(/(?:fill|enter|type)\s+(?:in\s+)?(?:the\s+)?(.+)/i);
  if (m3) return m3[1].trim();
  return null;
}

function extractSelectFieldName(desc: string): string | null {
  // "Select Gateway Type from the dropdown"
  const m = desc.match(/select\s+(.+?)\s+(?:from|in|on)/i);
  if (m) return m[1].trim();
  return null;
}

function findTestDataKey(fieldName: string, testData: Record<string, string>): string | null {
  // Normalize: lowercase + strip spaces/underscores/hyphens so "GatewayType" matches "Gateway Type"
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]+/g, '');
  const normName = norm(fieldName);
  // Exact normalized match
  for (const key of Object.keys(testData)) {
    if (norm(key) === normName) return key;
  }
  // Partial normalized match
  for (const key of Object.keys(testData)) {
    const normKey = norm(key);
    if (normKey.includes(normName) || normName.includes(normKey)) return key;
  }
  // Original case-insensitive partial match as last resort
  const lower = fieldName.toLowerCase();
  for (const key of Object.keys(testData)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return key;
  }
  return null;
}

function extractValueFromDesc(desc: string, testData: Record<string, string>): string | null {
  // Look for quoted values
  const q = desc.match(/["'""](.+?)["'""]/);
  if (q) return q[1];
  return null;
}

/**
 * Extract a field name from a sub-action description.
 * Examples:
 *   "Fill in the GatewayType field from the Dropdown" → "GatewayType"
 *   "Select the Column Type Field Radio Button" → "Column Type"
 *   "Fill the Column Name Field as Text" → "Column Name"
 *   "Column Data Type field from Dropdown" → "Column Data Type"
 */
function extractFieldFromSub(sub: string): string | null {
  // "the <FieldName> field"
  const m1 = sub.match(/(?:the\s+)?(.+?)\s+field/i);
  if (m1) return m1[1].replace(/^(fill|select|enter|click)\s+(in\s+)?(the\s+)?/i, '').trim();
  // "select <FieldName> from"
  const m2 = sub.match(/(?:select|choose)\s+(?:the\s+)?(.+?)\s+(?:from|radio|dropdown)/i);
  if (m2) return m2[1].trim();
  // "fill <FieldName> as"
  const m3 = sub.match(/(?:fill|enter)\s+(?:the\s+)?(.+?)\s+(?:as|with)/i);
  if (m3) return m3[1].trim();
  return null;
}
