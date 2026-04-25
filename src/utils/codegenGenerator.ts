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
import { TestScript, ScriptStep, Project, ProjectEnvironment, CommonFunction, CommonData, Locator, LocatorAlternative } from '../data/types';
import { readAll, COMMON_DATA, LOCATORS } from '../data/store';
import { logger } from './logger';
import { DOM_SCANNER_IIFE } from './healingEngine';

// ── P5: Normalize URL → pageKey (matches recorder.js normalizePageKey) ────────
// Strips the origin + replaces numeric path segments with :id
// e.g. https://app.com/patients/123/records → /patients/:id/records
export function normalizePageKey(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/$/, '') || '/';
  } catch { return '/'; }
}

// ── Self-healing: look up stored alternatives + healing profile for a step ────
function getStepAlternatives(locatorId: string | null): LocatorAlternative[] {
  if (!locatorId) return [];
  const loc = readAll<Locator>(LOCATORS).find(l => l.id === locatorId);
  return loc?.alternatives ?? [];
}

function getStepHealingProfile(locatorId: string | null): object | null {
  if (!locatorId) return null;
  const loc = readAll<Locator>(LOCATORS).find(l => l.id === locatorId);
  return loc?.healingProfile ?? null;
}

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
    case 'nth': {
      // format: "css-selector:N"  e.g.  ".row:2"  (0-based index)
      const lastColon = locator.lastIndexOf(':');
      if (lastColon > 0) {
        const sel = locator.slice(0, lastColon);
        const idx = parseInt(locator.slice(lastColon + 1), 10);
        return `page.locator("${dq(sel)}").nth(${isNaN(idx) ? 0 : idx})`;
      }
      return `page.locator("${dq(locator)}").nth(0)`;
    }
    case 'last':    return `page.locator("${dq(locator)}").last()`;
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

// ── Date token resolver (build-time — resolved when spec is generated) ─────────
// Tokens: {{date.today}}, {{date.format('DD/MM/YYYY')}},
//         {{date.add(7,'days')}}, {{date.subtract(1,'month')}},
//         {{date.diff(date1,date2,'days')}}

function resolveDateTokens(raw: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  function applyFormat(d: Date, fmt: string): string {
    const Y  = d.getFullYear();
    const M  = d.getMonth() + 1;
    const D  = d.getDate();
    const h  = d.getHours();
    const m  = d.getMinutes();
    const s  = d.getSeconds();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return fmt
      .replace(/YYYY/g, String(Y))
      .replace(/YY/g,   String(Y).slice(-2))
      .replace(/MMM/g,  months[M - 1])
      .replace(/MM/g,   pad(M))
      .replace(/DD/g,   pad(D))
      .replace(/HH/g,   pad(h))
      .replace(/mm/g,   pad(m))
      .replace(/ss/g,   pad(s));
  }

  function addToDate(d: Date, amount: number, unit: string): Date {
    const r = new Date(d);
    switch (unit.toLowerCase()) {
      case 'days':   case 'day':   r.setDate(r.getDate() + amount); break;
      case 'months': case 'month': r.setMonth(r.getMonth() + amount); break;
      case 'years':  case 'year':  r.setFullYear(r.getFullYear() + amount); break;
      case 'hours':  case 'hour':  r.setHours(r.getHours() + amount); break;
    }
    return r;
  }

  // {{date.today}} → ISO date YYYY-MM-DD
  raw = raw.replace(/\{\{date\.today\}\}/g, () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  });

  // {{date.format('DD/MM/YYYY')}}
  raw = raw.replace(/\{\{date\.format\('([^']+)'\)\}\}/g, (_, fmt) =>
    applyFormat(new Date(), fmt)
  );

  // {{date.add(N,'unit')}}
  raw = raw.replace(/\{\{date\.add\((\d+),'([^']+)'\)\}\}/g, (_, n, unit) => {
    const d = addToDate(new Date(), parseInt(n, 10), unit);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  });

  // {{date.subtract(N,'unit')}}
  raw = raw.replace(/\{\{date\.subtract\((\d+),'([^']+)'\)\}\}/g, (_, n, unit) => {
    const d = addToDate(new Date(), -parseInt(n, 10), unit);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  });

  // {{date.diff(date1,date2,'unit')}} — dates in YYYY-MM-DD
  raw = raw.replace(/\{\{date\.diff\('([^']+)','([^']+)','([^']+)'\)\}\}/g, (_, d1, d2, unit) => {
    const ms   = new Date(d2).getTime() - new Date(d1).getTime();
    const days = ms / 86400000;
    switch (unit.toLowerCase()) {
      case 'days':   return String(Math.round(days));
      case 'months': return String(Math.round(days / 30.44));
      case 'years':  return String(Math.round(days / 365.25));
      default:       return String(Math.round(days));
    }
  });

  return raw;
}

// ── Value expression ───────────────────────────────────────────────────────────

// Resolve {{var.name}} tokens → runtime var lookup expression (session first, global fallback)
function resolveVarTokens(raw: string): string {
  return raw.replace(/\{\{var\.([A-Za-z0-9_]+)\}\}/g,
    (_, name) => `' + (__sessionVars['${name}'] ?? __globalVars['${name}'] ?? '') + '`
  );
}

function valueExpr(step: ScriptStep, dataMap: Record<string, string> = {}, runIdx: number = 0): string {
  if (step.valueMode === 'testdata') {
    const rows = step.testData || [];
    if (!rows.length) return "''";
    const row = rows[runIdx] ?? rows[rows.length - 1];
    const raw = row?.value || '';
    return `'${raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  // Variable mode — value is just the var name, session first then global fallback
  if (step.valueMode === 'variable') {
    const varName = (step.value || '').trim();
    return varName ? `(__sessionVars['${varName}'] ?? __globalVars['${varName}'] ?? '')` : "''";
  }
  if (!step.value) return "''";
  const resolved = resolveDateTokens(resolveDataTokens(step.value, dataMap));
  if (step.valueMode === 'dynamic') return resolveToken(resolved);
  // Resolve {{var.name}} inline tokens in static values
  const withVars = resolveVarTokens(resolved.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  return `'${withVars}'`;
}

// ── Dialog look-ahead helper ──────────────────────────────────────────────────
// Returns the dialog handler line if the given step is ACCEPT/DISMISS DIALOG,
// otherwise returns null. Used by generation loops to prepend the handler before
// the PRECEDING step that triggers the dialog — keeping user step order natural.
function dialogHandlerCode(step: ScriptStep | undefined, indent: string): string | null {
  const kw = (step?.keyword || '').toUpperCase().trim();
  if (kw === 'ACCEPT DIALOG')  return `${indent}page.once('dialog', async dialog => { await dialog.accept(); });`;
  if (kw === 'DISMISS DIALOG') return `${indent}page.once('dialog', async dialog => { await dialog.dismiss(); });`;
  return null;
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
      return line(`await page.goto(${val}, { waitUntil: 'domcontentloaded' });\n${indent}await page.waitForLoadState('domcontentloaded');`);

    case 'RELOAD':
      return line(`await page.reload({ waitUntil: 'domcontentloaded' });\n${indent}await page.waitForLoadState('domcontentloaded');`);

    case 'BACK':
      return line(`await page.goBack({ waitUntil: 'domcontentloaded' });\n${indent}await page.waitForLoadState('domcontentloaded');`);

    case 'FORWARD':
      return line(`await page.goForward({ waitUntil: 'domcontentloaded' });\n${indent}await page.waitForLoadState('domcontentloaded');`);

    // ── Actions ──────────────────────────────────────────────────────────────
    case 'CLICK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.click();`)
        : line(`// CLICK: missing locator`);

    case 'DBLCLICK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.dblclick();`)
        : line(`// DBLCLICK: missing locator`);

    case 'RIGHT CLICK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.click({ button: 'right' });`)
        : line(`// RIGHT CLICK: missing locator`);

    case 'JS CLICK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'attached' });\n${indent}await ${locExpr}.evaluate((el: HTMLElement) => el.click());`)
        : line(`// JS CLICK: missing locator`);

    case 'SELECT BY INDEX': {
      const idx = parseInt((step.value || '0').trim(), 10) || 0;
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.selectOption({ index: ${idx} });`)
        : line(`// SELECT BY INDEX: missing locator`);
    }

    case 'DRAG BY OFFSET': {
      if (!locExpr) return line(`// DRAG BY OFFSET: missing locator`);
      const parts = (step.value || '0,0').split(',').map(s => parseInt(s.trim(), 10) || 0);
      const dx = parts[0] ?? 0;
      const dy = parts[1] ?? 0;
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await (async () => {`,
        `${i}  const __box = await ${locExpr}.boundingBox();`,
        `${i}  if (!__box) throw new Error('DRAG BY OFFSET: element not found');`,
        `${i}  await page.mouse.move(__box.x + __box.width / 2, __box.y + __box.height / 2);`,
        `${i}  await page.mouse.down();`,
        `${i}  await page.mouse.move(__box.x + __box.width / 2 + ${dx}, __box.y + __box.height / 2 + ${dy}, { steps: 10 });`,
        `${i}  await page.mouse.up();`,
        `${i}})();`,
      ].join('\n');
    }

    case 'CLICK N TIMES': {
      if (!locExpr) return line(`// CLICK N TIMES: missing locator`);
      const n = Math.max(1, parseInt((step.value || '1').trim(), 10) || 1);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await ${locExpr}.waitFor({ state: 'visible' });`,
        `${i}for (let __ci = 0; __ci < ${n}; __ci++) {`,
        `${i}  await ${locExpr}.click();`,
        `${i}  if (__ci < ${n - 1}) await page.waitForTimeout(200);`,
        `${i}}`,
      ].join('\n');
    }

    case 'HOVER AND CLICK': {
      if (!locExpr) return line(`// HOVER AND CLICK: missing locator`);
      const targetSel = (step.value || '').trim().replace(/'/g, "\\'");
      if (!targetSel) return line(`// HOVER AND CLICK: set Value to the selector of the element to click after hover`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await ${locExpr}.waitFor({ state: 'visible' });`,
        `${i}await ${locExpr}.hover();`,
        `${i}await page.locator('${targetSel}').waitFor({ state: 'visible' });`,
        `${i}await page.locator('${targetSel}').click();`,
      ].join('\n');
    }

    case 'PROMPT TYPE': {
      const promptText = (step.value || '').replace(/'/g, "\\'");
      return line(`page.once('dialog', async dialog => { await dialog.accept('${promptText}'); });`);
    }

    case 'SWITCH TO WINDOW': {
      const target = (step.value || '0').trim();
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      const isIndex = /^\d+$/.test(target);
      if (isIndex) {
        return pfx + [
          `${i}// SWITCH TO WINDOW — by index ${target}`,
          `${i}await page.context().pages()[${target}]?.bringToFront();`,
        ].join('\n');
      }
      return pfx + [
        `${i}// SWITCH TO WINDOW — by title containing "${target}"`,
        `${i}const __targetPage = page.context().pages().find(p => p.title().includes('${target.replace(/'/g, "\\'")}'));`,
        `${i}if (__targetPage) await __targetPage.bringToFront();`,
        `${i}else throw new Error('SWITCH TO WINDOW: no window with title containing "${target.replace(/"/g, '\\"')}"');`,
      ].join('\n');
    }

    case 'CALL API': {
      const varName  = (step.storeAs || '').trim();
      const store    = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
      // value format: "METHOD url"
      const rawVal   = (step.value || '').trim();
      const spaceIdx = rawVal.indexOf(' ');
      const method   = spaceIdx > -1 ? rawVal.slice(0, spaceIdx).toUpperCase() : 'GET';
      const urlRaw   = spaceIdx > -1 ? rawVal.slice(spaceIdx + 1).trim() : rawVal;
      // Parse BODY: and HEADERS: from description field
      const desc     = step.description || '';
      const bodyMatch    = desc.match(/BODY:\s*(\{[\s\S]*\})/i);
      const headersMatch = desc.match(/HEADERS:\s*(\{[\s\S]*\})/i);
      const bodyStr      = bodyMatch    ? bodyMatch[1].replace(/`/g, '\\`')    : '';
      const headersStr   = headersMatch ? headersMatch[1].replace(/`/g, '\\`') : '';
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      const urlExpr = urlRaw.replace(/\{\{var\.([A-Za-z0-9_]+)\}\}/g,
        (_, n) => `\${__sessionVars['${n}'] ?? __globalVars['${n}'] ?? ''}`);
      const bodyExpr = bodyStr.replace(/\{\{var\.([A-Za-z0-9_]+)\}\}/g,
        (_, n) => `\${__sessionVars['${n}'] ?? __globalVars['${n}'] ?? ''}`);
      const lines2: string[] = [
        `${i}const __apiResp_${step.order} = await (async () => {`,
        `${i}  const __url = \`${urlExpr}\`;`,
        `${i}  const __opts: RequestInit = { method: '${method}', headers: { 'Content-Type': 'application/json'${headersStr ? `, ...(JSON.parse(\`${headersStr}\`))` : ''} } };`,
      ];
      if (bodyStr) lines2.push(`${i}  __opts.body = \`${bodyExpr}\`;`);
      lines2.push(`${i}  const __r = await fetch(__url, __opts);`);
      lines2.push(`${i}  return await __r.text();`);
      lines2.push(`${i}})();`);
      if (varName) lines2.push(`${i}${store}['${varName}'] = __apiResp_${step.order}; // CALL API → ${varName}`);
      return pfx + lines2.join('\n');
    }

    case 'ASSERT FILE DOWNLOADED': {
      const partial = (step.value || '').trim().replace(/'/g, "\\'");
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}const __dl_${step.order} = await page.waitForEvent('download', { timeout: 30000 });`,
        `${i}expect(__dl_${step.order}.suggestedFilename()).toContain('${partial}');`,
      ].join('\n');
    }

    case 'ASSERT DOWNLOAD COUNT': {
      const expected = parseInt((step.value || '1').trim(), 10) || 1;
      return line(`expect(__downloadCount ?? 0).toBe(${expected}); // ASSERT DOWNLOAD COUNT`);
    }

    case 'READ EXCEL VALUE': {
      const varName = (step.storeAs || '').trim();
      const store   = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
      // format: filePath|sheetName|row|col
      const parts   = (step.value || '').split('|').map(s => s.trim());
      const fp = parts[0] || '';
      const sh = parts[1] || 'Sheet1';
      const ro = parseInt(parts[2] || '1', 10);
      const co = parseInt(parts[3] || '1', 10);
      if (!fp)     return line(`// READ EXCEL VALUE: set Value as filePath|sheetName|row|col`);
      if (!varName) return line(`// READ EXCEL VALUE: set Save As (📌 pin) to a variable name`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}const __xl_${step.order} = (() => { const XLSX = require('xlsx'); const wb = XLSX.readFile('${fp.replace(/'/g,"\\'")}'); const ws = wb.Sheets['${sh.replace(/'/g,"\\'")}'] ?? wb.Sheets[wb.SheetNames[0]]; const d = XLSX.utils.sheet_to_json(ws, { header: 1 }); return String((d[${ro - 1}] ?? [])[${co - 1}] ?? ''); })();`,
        `${i}${store}['${varName}'] = __xl_${step.order}; // READ EXCEL VALUE → ${varName}`,
      ].join('\n');
    }

    case 'ASSERT EXCEL ROW COUNT': {
      // format: filePath|sheetName|expectedCount
      const parts2  = (step.value || '').split('|').map(s => s.trim());
      const fp2     = parts2[0] || '';
      const sh2     = parts2[1] || 'Sheet1';
      const expected2 = parseInt(parts2[2] || '1', 10);
      if (!fp2) return line(`// ASSERT EXCEL ROW COUNT: set Value as filePath|sheetName|expectedCount`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}const __xlRows_${step.order} = (() => { const XLSX = require('xlsx'); const wb = XLSX.readFile('${fp2.replace(/'/g,"\\'")}'); const ws = wb.Sheets['${sh2.replace(/'/g,"\\'")}'] ?? wb.Sheets[wb.SheetNames[0]]; const d = XLSX.utils.sheet_to_json(ws, { header: 1 }); return d.filter((r: any[]) => r.some((c: any) => c !== null && c !== undefined && String(c).trim() !== '')).length - 1; })();`,
        `${i}expect(__xlRows_${step.order}).toBe(${expected2}); // ASSERT EXCEL ROW COUNT`,
      ].join('\n');
    }

    case 'READ PDF TEXT': {
      // format: filePath|textToFind
      const pdfParts = (step.value || '').split('|').map(s => s.trim());
      const pdfFp    = pdfParts[0] || '';
      const pdfTxt   = (pdfParts[1] || '').replace(/'/g, "\\'");
      if (!pdfFp) return line(`// READ PDF TEXT: set Value as filePath|textToFind`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}const __pdfData_${step.order} = await require('pdf-parse')(require('fs').readFileSync('${pdfFp.replace(/'/g,"\\'")}'));`,
        `${i}expect(__pdfData_${step.order}.text).toContain('${pdfTxt}'); // READ PDF TEXT`,
      ].join('\n');
    }

    case 'DATE TOKEN':
      return line(`// DATE TOKEN is a reference keyword — use date tokens inside value fields of other steps`);

    // ── Browser Control ───────────────────────────────────────────────────────

    case 'MOCK RESPONSE': {
      // format: urlPattern|statusCode|jsonBody
      const parts = (step.value || '').split('|');
      const urlPat   = (parts[0] || '').trim().replace(/'/g, "\\'");
      const status   = parseInt(parts[1] || '200', 10) || 200;
      const bodyStr  = (parts.slice(2).join('|') || '{}').replace(/\\/g, '\\\\').replace(/`/g, '\\`');
      return [
        comment,
        `${indent}await page.route('${urlPat}', async route => {`,
        `${indent}  await route.fulfill({ status: ${status}, contentType: 'application/json', body: \`${bodyStr}\` });`,
        `${indent}});`,
      ].filter(Boolean).join('\n');
    }

    case 'SET CLOCK': {
      const isoVal = (step.value || '').trim().replace(/'/g, "\\'");
      return [
        comment,
        `${indent}await page.clock.setFixedTime('${isoVal}');`,
      ].filter(Boolean).join('\n');
    }

    case 'SET OFFLINE': {
      const isOffline = (step.value || '').trim().toLowerCase() === 'true';
      return [
        comment,
        `${indent}await page.context().setOffline(${isOffline});`,
      ].filter(Boolean).join('\n');
    }

    case 'ASSERT ARIA': {
      if (!locExpr) return '';
      // format: aria-label=expected  or  role=button  or  aria-expanded=true
      const eqIdx    = (step.value || '').indexOf('=');
      const attrName = eqIdx > 0 ? (step.value || '').slice(0, eqIdx).trim() : (step.value || '').trim();
      const attrVal  = eqIdx > 0 ? (step.value || '').slice(eqIdx + 1).trim() : '';
      return [
        comment,
        `${indent}await expect(${locExpr}).toHaveAttribute('${attrName.replace(/'/g, "\\'")}', '${attrVal.replace(/'/g, "\\'")}');`,
      ].filter(Boolean).join('\n');
    }

    case 'FILL':
    case 'TYPE': {
      const fillVal = val === "''" ? `''` : val;
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.fill(${fillVal});`)
        : line(`// FILL: missing locator`);
    }

    case 'CLEAR':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.clear();`)
        : line(`// CLEAR: missing locator`);

    case 'SELECT':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.selectOption(${val});`)
        : line(`// SELECT: missing locator`);

    case 'CHECK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.check();`)
        : line(`// CHECK: missing locator`);

    case 'UNCHECK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.uncheck();`)
        : line(`// UNCHECK: missing locator`);

    case 'HOVER':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.hover();`)
        : line(`// HOVER: missing locator`);

    case 'FOCUS':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.focus();`)
        : line(`// FOCUS: missing locator`);

    case 'PRESS KEY':
      return line(`await page.keyboard.press(${val});`);

    case 'UPLOAD FILE':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.setInputFiles(${val});`)
        : line(`// UPLOAD: missing locator`);

    case 'FILE CHOOSER': {
      // Playwright intercepts the browser-level file chooser BEFORE the OS dialog opens.
      // fileChooser.setFiles() sets the file programmatically — Windows dialog never appears.
      // val = relative server path stored at upload time (e.g. 'test-files/proj-123/file.pdf')
      // require('path').resolve() converts to absolute path on whatever machine runs Playwright.
      if (!locExpr) return line(`// FILE CHOOSER: missing locator`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}// FILE CHOOSER — Playwright intercepts before OS dialog opens`,
        `${i}const [__fc] = await Promise.all([`,
        `${i}  page.waitForEvent('filechooser'),`,
        `${i}  ${locExpr}.click(),`,
        `${i}]);`,
        `${i}await __fc.setFiles(require('path').resolve(${val}));`,
      ].join('\n');
    }

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
    // All element assertions waitFor visible/attached first — prevents flakiness
    // after AJAX actions where the element may not yet be in the DOM.
    case 'ASSERT VISIBLE':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeVisible();`)
        : line(`// ASSERT VISIBLE: missing locator`);

    case 'ASSERT HIDDEN':
    case 'ASSERTHIDDEN':
    case 'ASSERT NOT VISIBLE':
    case 'ASSERTNOTVISIBLE':
      // For hidden assertions we wait for attached (element exists but is hidden)
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'attached', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeHidden();`)
        : line(`// ASSERT HIDDEN: missing locator`);

    case 'ASSERT TEXT':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toContainText(${val});`)
        : line(`// ASSERT TEXT: missing locator`);

    case 'ASSERT VALUE':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toHaveValue(${val});`)
        : line(`// ASSERT VALUE: missing locator`);

    case 'ASSERT ATTRIBUTE':
      if (locExpr && step.value) {
        const [attr, ...rest] = step.value.split('=');
        const attrVal = rest.join('=');
        return line(`await ${locExpr}.waitFor({ state: 'attached', timeout: 10000 });\n${indent}await expect(${locExpr}).toHaveAttribute('${attr.trim()}', '${attrVal.trim().replace(/'/g, "\\'")}');`);
      }
      return line(`// ASSERT ATTRIBUTE: set value as "attr=expected"`);

    case 'ASSERT COUNT':
      // Count assertions don't waitFor — count may legitimately be 0
      return locExpr ? line(`await expect(${locExpr}).toHaveCount(${val});`) : line(`// ASSERT COUNT: missing locator`);

    case 'ASSERT VISUAL': {
      if (!locExpr) return line(`// ASSERT VISUAL: missing locator`);
      const threshold = (step.value && !isNaN(parseFloat(step.value)))
        ? parseFloat(step.value) / 100   // user enters 0–100, pixelmatch expects 0–1
        : 0.1;
      const locName = step.locator || 'element';
      return line(
        `{
${indent}  // ASSERT VISUAL — capture and compare against stored baseline
${indent}  await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });
${indent}  const __vsBuffer = await ${locExpr}.screenshot({ type: 'png' });
${indent}  const __vsPort = process.env.QA_SERVER_PORT || '3003';
${indent}  const __vsResult = await fetch(\`http://localhost:\${__vsPort}/api/visual-baselines/compare\`, {
${indent}    method: 'POST',
${indent}    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.QA_INTERNAL_API_KEY || '' },
${indent}    body: JSON.stringify({
${indent}      projectId:   '${project.id}',
${indent}      testName:    test.info().title,
${indent}      locatorName: ${JSON.stringify(locName)},
${indent}      imageBase64: __vsBuffer.toString('base64'),
${indent}      threshold:   ${threshold},
${indent}    }),
${indent}  }).then(r => r.json());
${indent}  if (__vsResult.status === 'new-baseline') {
${indent}    console.log('[VISUAL] New baseline captured for: ${locName}');
${indent}  } else if (__vsResult.status === 'fail') {
${indent}    throw new Error(\`[VISUAL] ${locName}: \${__vsResult.message}\`);
${indent}  } else {
${indent}    console.log(\`[VISUAL] OK — \${__vsResult.message}\`);
${indent}  }
${indent}}`
      );
    }

    case 'ASSERT URL':
      // toHaveURL has built-in retry — no extra wait needed
      return line(`await expect(page).toHaveURL(${val});`);

    case 'ASSERT TITLE':
      return line(`await expect(page).toHaveTitle(${val});`);

    case 'ASSERT CHECKED':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeChecked();`)
        : line(`// ASSERT CHECKED: missing locator`);

    case 'ASSERT ENABLED':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeEnabled();`)
        : line(`// ASSERT ENABLED: missing locator`);

    case 'ASSERT DISABLED':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeDisabled();`)
        : line(`// ASSERT DISABLED: missing locator`);

    case 'ASSERT UNCHECKED':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).not.toBeChecked();`)
        : line(`// ASSERT UNCHECKED: missing locator`);

    case 'ASSERT EDITABLE':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeEditable();`)
        : line(`// ASSERT EDITABLE: missing locator`);

    case 'ASSERT READONLY':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).not.toBeEditable();`)
        : line(`// ASSERT READONLY: missing locator`);

    case 'ASSERT EMPTY':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeEmpty();`)
        : line(`// ASSERT EMPTY: missing locator`);

    case 'ASSERT FOCUSED':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toBeFocused();`)
        : line(`// ASSERT FOCUSED: missing locator`);

    case 'ASSERT CLASS': {
      if (!locExpr) return line(`// ASSERT CLASS: missing locator`);
      const cssClass = (step.value || '').trim();
      if (!cssClass) return line(`// ASSERT CLASS: missing expected class name in Value`);
      return line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toHaveClass(new RegExp('(?:^|\\\\s)${cssClass.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}(?:\\\\s|$)'));`);
    }

    case 'ASSERT CSS': {
      if (!locExpr) return line(`// ASSERT CSS: missing locator`);
      const rawCss = (step.value || '').trim();
      const colonIdx = rawCss.indexOf(':');
      if (colonIdx < 1) return line(`// ASSERT CSS: value must be "property:expected-value"`);
      const cssProp = rawCss.slice(0, colonIdx).trim();
      const cssVal  = rawCss.slice(colonIdx + 1).trim();
      return line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toHaveCSS(${JSON.stringify(cssProp)}, ${JSON.stringify(cssVal)});`);
    }

    case 'ASSERT RESPONSE OK': {
      const pfxRO = comment ? comment + '\n' : '';
      return pfxRO + [
        `${indent}// ASSERT RESPONSE OK — requires prior API INTERCEPT step`,
        `${indent}if (!__lastApiResponse) throw new Error('ASSERT RESPONSE OK: no intercepted response found. Add an API INTERCEPT step before this assertion.');`,
        `${indent}await expect(__lastApiResponse).toBeOK();`,
      ].join('\n');
    }

    case 'ASSERT CONTAINS':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).toContainText(${val});`)
        : line(`// ASSERT CONTAINS: missing locator`);

    case 'ASSERT NOT CONTAINS':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });\n${indent}await expect(${locExpr}).not.toContainText(${val});`)
        : line(`// ASSERT NOT CONTAINS: missing locator`);

    case 'ASSERT COUNT GT': {
      const gtN = parseInt((step.value || '0').trim(), 10) || 0;
      return locExpr
        ? line(`await expect(${locExpr}).toHaveCount(expect.any(Number));\n${indent}expect(await ${locExpr}.count()).toBeGreaterThan(${gtN});`)
        : line(`// ASSERT COUNT GT: missing locator`);
    }

    case 'ASSERT COUNT LT': {
      const ltN = parseInt((step.value || '0').trim(), 10) || 0;
      return locExpr
        ? line(`expect(await ${locExpr}.count()).toBeLessThan(${ltN});`)
        : line(`// ASSERT COUNT LT: missing locator`);
    }

    case 'ASSERT GREATER THAN': {
      if (!locExpr) return line(`// ASSERT GREATER THAN: missing locator`);
      const gtVal = parseFloat((step.value || '0').trim()) || 0;
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });`,
        `${i}const __numGT = parseFloat((await ${locExpr}.innerText()).replace(/[^0-9.-]/g, ''));`,
        `${i}expect(__numGT).toBeGreaterThan(${gtVal});`,
      ].join('\n');
    }

    case 'ASSERT LESS THAN': {
      if (!locExpr) return line(`// ASSERT LESS THAN: missing locator`);
      const ltVal = parseFloat((step.value || '0').trim()) || 0;
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await ${locExpr}.waitFor({ state: 'visible', timeout: 10000 });`,
        `${i}const __numLT = parseFloat((await ${locExpr}.innerText()).replace(/[^0-9.-]/g, ''));`,
        `${i}expect(__numLT).toBeLessThan(${ltVal});`,
      ].join('\n');
    }

    case 'ASSERT URL NOT':
      return line(`await expect(page).not.toHaveURL(${val});`);

    case 'ASSERT TITLE NOT':
      return line(`await expect(page).not.toHaveTitle(${val});`);

    case 'ASSERT ATTR NOT': {
      if (locExpr && step.value) {
        const [attrN, ...restN] = step.value.split('=');
        const attrValN = restN.join('=');
        return line(`await ${locExpr}.waitFor({ state: 'attached', timeout: 10000 });\n${indent}await expect(${locExpr}).not.toHaveAttribute('${attrN.trim()}', '${attrValN.trim().replace(/'/g, "\\'")}');`);
      }
      return line(`// ASSERT ATTR NOT: set value as "attr=unexpectedValue"`);
    }

    case 'ASSERT ATTR CONTAINS': {
      if (locExpr && step.value) {
        const [attrC, ...restC] = step.value.split('=');
        const attrValC = restC.join('=').trim().replace(/'/g, "\\'");
        return line(`await ${locExpr}.waitFor({ state: 'attached', timeout: 10000 });\n${indent}await expect(${locExpr}).toHaveAttribute('${attrC.trim()}', /.*${attrValC}.*/);`);
      }
      return line(`// ASSERT ATTR CONTAINS: set value as "attr=partialValue"`);
    }

    case 'WAIT FOR TOAST':
    case 'WAITFORTOAST': {
      // Wait for any toast/snackbar/alert notification to appear — no locator or value needed
      const toastSel = `[role="alert"], [role="status"], [class*="toast"], [class*="snackbar"], [class*="flash"], [class*="notification"]`;
      return line(`await page.locator(${JSON.stringify(toastSel)}).first().waitFor({ state: 'visible', timeout: 8000 });`);
    }

    case 'ASSERT TOAST':
    case 'ASSERTTOAST': {
      // Wait for any toast to appear and assert it contains the expected text (case-insensitive partial)
      const toastSel2 = `[role="alert"], [role="status"], [class*="toast"], [class*="snackbar"], [class*="flash"], [class*="notification"]`;
      return val
        ? line(`await page.locator(${JSON.stringify(toastSel2)}).first().waitFor({ state: 'visible', timeout: 8000 });\n${indent}await expect(page.locator(${JSON.stringify(toastSel2)}).first()).toContainText(${val}, { ignoreCase: true });`)
        : line(`await page.locator(${JSON.stringify(toastSel2)}).first().waitFor({ state: 'visible', timeout: 8000 });`);
    }

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

    case 'WAIT ENABLED':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await expect(${locExpr}).toBeEnabled({ timeout: 15000 });`)
        : line(`// WAIT ENABLED: missing locator`);

    case 'WAIT TEXT': {
      if (!locExpr) return line(`// WAIT TEXT: missing locator`);
      const waitTxt = val === "''" ? "''" : val;
      return line(`await expect(${locExpr}).toContainText(${waitTxt}, { timeout: 15000 });`);
    }

    case 'WAIT ALERT':
      return line(`await page.waitForEvent('dialog', { timeout: 10000 });`);

    case 'WAIT DISABLED':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await expect(${locExpr}).toBeDisabled({ timeout: 15000 });`)
        : line(`// WAIT DISABLED: missing locator`);

    // ── Dialog handling ───────────────────────────────────────────────────────
    // These steps are injected by the generation loop BEFORE the preceding action
    // that triggers the dialog (look-ahead). They must NOT be emitted inline here
    // because Playwright requires the handler to be registered before the trigger.
    // The loop detects the NEXT step as dialog and prepends the handler automatically,
    // so the user writes steps in natural order (Click → Accept Dialog).
    case 'ACCEPT DIALOG':
    case 'DISMISS DIALOG':
      return ''; // emitted by look-ahead in the generation loop, not inline

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

    case 'GET ATTRIBUTE': {
      const varName = (step.storeAs || '').trim();
      const store   = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
      const attr    = (step.value || '').trim().replace(/'/g, "\\'");
      if (!locExpr) return line(`// GET ATTRIBUTE: missing locator`);
      if (!attr)    return line(`// GET ATTRIBUTE: set Value to the attribute name (e.g. href, data-id)`);
      if (!varName) return line(`// GET ATTRIBUTE: set Save As (pin 📌) to a variable name`);
      return line(`${store}['${varName}'] = (await ${locExpr}.getAttribute('${attr}') ?? '').trim(); // GET ATTRIBUTE → ${varName}`);
    }

    case 'GET CURRENT URL': {
      const varName = (step.storeAs || '').trim();
      const store   = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
      if (!varName) return line(`// GET CURRENT URL: set Save As (pin 📌) to a variable name`);
      return line(`${store}['${varName}'] = page.url(); // GET CURRENT URL → ${varName}`);
    }

    case 'GET ALERT TEXT': {
      const varName = (step.storeAs || '').trim();
      const store   = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
      if (!varName) return line(`// GET ALERT TEXT: set Save As (pin 📌) to a variable name`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await page.once('dialog', async dialog => {`,
        `${i}  ${store}['${varName}'] = dialog.message(); // GET ALERT TEXT → ${varName}`,
        `${i}  await dialog.dismiss();`,
        `${i}});`,
      ].join('\n');
    }

    case 'GET NETWORK RESPONSE': {
      const varName  = (step.storeAs || '').trim();
      const store    = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
      const urlPat   = (step.value || '').trim().replace(/'/g, "\\'");
      if (!urlPat)  return line(`// GET NETWORK RESPONSE: set Value to URL pattern (e.g. /api/patients)`);
      if (!varName) return line(`// GET NETWORK RESPONSE: set Save As (pin 📌) to a variable name`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}const __netResp_${step.order} = await page.waitForResponse(r => r.url().includes('${urlPat}'), { timeout: 15000 });`,
        `${i}${store}['${varName}'] = await __netResp_${step.order}.text().catch(() => ''); // GET NETWORK RESPONSE → ${varName}`,
      ].join('\n');
    }

    case 'SET VARIABLE': {
      // Captures a value from the page into __sessionVars or __globalVars at runtime
      const varName = (step.storeAs || '').trim();
      if (!varName) return line(`// SET VARIABLE: no variable name specified`);
      const src     = step.storeSource || 'text';
      const isGlobal = step.storeScope === 'global';
      const store   = isGlobal ? `__globalVars` : `__sessionVars`;
      const scopeLbl = isGlobal ? 'global' : 'session';
      const i   = indent;
      const pfx = comment ? comment + '\n' : '';
      if (src === 'js') {
        const jsExpr = (step.value || '').trim() || 'undefined';
        return pfx + [
          `${i}// SET VARIABLE (js, ${scopeLbl}) → ${varName}`,
          `${i}${store}['${varName}'] = String(await page.evaluate(() => { return (${jsExpr}); }) ?? '');`,
        ].join('\n');
      }
      if (!locExpr) return line(`// SET VARIABLE: missing locator`);
      if (src === 'value') {
        return pfx + [
          `${i}// SET VARIABLE (input value, ${scopeLbl}) → ${varName}`,
          `${i}${store}['${varName}'] = (await ${locExpr}.inputValue()).trim();`,
        ].join('\n');
      }
      if (src === 'attr') {
        const attr = (step.storeAttrName || '').trim() || 'value';
        return pfx + [
          `${i}// SET VARIABLE (attribute: ${attr}, ${scopeLbl}) → ${varName}`,
          `${i}${store}['${varName}'] = (await ${locExpr}.getAttribute('${attr}') ?? '').trim();`,
        ].join('\n');
      }
      // default: text
      return pfx + [
        `${i}// SET VARIABLE (text, ${scopeLbl}) → ${varName}`,
        `${i}${store}['${varName}'] = (await ${locExpr}.innerText()).trim();`,
      ].join('\n');
    }

    case 'DATE PICKER': {
      if (!locExpr) return line(`// DATE PICKER: missing locator`);
      const dateVal = (step.value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const locLit  = (step.locator || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const ltLit   = step.locatorType || 'css';
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}// DATE PICKER — Bootstrap Datepicker (jQuery API)`,
        `${i}await (async () => {`,
        `${i}  // 3-letter abbreviations so both "Apr" and "April" match via .slice(0,3)`,
        `${i}  const _mo = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];`,
        `${i}  const _mi = (name: string) => _mo.indexOf(name.toLowerCase().slice(0, 3));`,
        `${i}  const _parse = (s: string): Date => {`,
        `${i}    const m1 = s.match(/^(\\d{1,2})\\s+([A-Za-z]+)\\s+(\\d{4})$/);`,
        `${i}    if (m1) { const mo = _mi(m1[2]); if (mo < 0) throw new Error('DATE PICKER: unknown month: ' + m1[2]); return new Date(+m1[3], mo, +m1[1]); }`,
        `${i}    const m2 = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);`,
        `${i}    if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);`,
        `${i}    const m3 = s.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);`,
        `${i}    if (m3) return new Date(+m3[3], +m3[1] - 1, +m3[2]);`,
        `${i}    const m4 = s.match(/^([A-Za-z]+)\\s+(\\d{1,2}),?\\s+(\\d{4})$/);`,
        `${i}    if (m4) { const mo = _mi(m4[1]); if (mo < 0) throw new Error('DATE PICKER: unknown month: ' + m4[1]); return new Date(+m4[3], mo, +m4[2]); }`,
        `${i}    throw new Error('DATE PICKER: unrecognised format: ' + s);`,
        `${i}  };`,
        `${i}  const _target = _parse('${dateVal}');`,
        `${i}  // 1. Click the input to open the picker (shows calendar in debug screenshot)`,
        `${i}  await ${locExpr}.click();`,
        `${i}  await page.waitForSelector('.datepicker', { state: 'visible' });`,
        `${i}  // 2. Set date via jQuery datepicker API — bypasses all UI navigation, works with multiple pickers on same page`,
        `${i}  await page.evaluate((args: any) => {`,
        `${i}    const [locType, locVal, y, m, d] = args;`,
        `${i}    const el: any = locType === 'xpath'`,
        `${i}      ? (document as any).evaluate(locVal, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`,
        `${i}      : document.querySelector(locVal);`,
        `${i}    if (!el) throw new Error('DATE PICKER: element not found for locator: ' + locVal);`,
        `${i}    const jq = (window as any).$;`,
        `${i}    if (!jq || typeof jq(el).datepicker !== 'function')`,
        `${i}      throw new Error('DATE PICKER: jQuery datepicker plugin not available on element');`,
        `${i}    jq(el).datepicker('setDate', new Date(y, m, d));`,
        `${i}  }, ['${ltLit}', '${locLit}', _target.getFullYear(), _target.getMonth(), _target.getDate()] as any);`,
        `${i}  // 3. Press Tab to close the picker and commit the value`,
        `${i}  await page.keyboard.press('Tab');`,
        `${i}})();`,
      ].join('\n');
    }

    case 'EVALUATE':
      return line(`await page.evaluate(${step.value || `() => {}`});`);

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
          locator:     fs.selector ?? fs.detail ?? null,   // FunctionStep stores value as 'selector'
          locatorId:   null,
          locatorType: fs.locatorType || 'css',
          valueMode:   saved?.valueMode || 'static',
          value:       saved?.value ?? null,
          testData:    saved?.testData || [],
          fnStepValues: [],
          description: fs.description || fs.detail || '',
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

// Emit a storeAs line after a step if the 📌 pin is set
function storeAsLine(step: ScriptStep, locExpr: string | null, indent: string): string {
  const varName = (step.storeAs || '').trim();
  if (!varName || step.keyword?.toUpperCase() === 'SET VARIABLE') return '';
  const store = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
  const kw = (step.keyword || '').toUpperCase();
  if (kw === 'FILL' || kw === 'TYPE') {
    const raw = (step.value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `${indent}${store}['${varName}'] = '${raw}'; // 📌 pinned`;
  }
  if (locExpr) {
    return `${indent}${store}['${varName}'] = (await ${locExpr}.innerText().catch(() => '')).trim(); // 📌 pinned`;
  }
  return '';
}

// ── Screenshot after step (if step.screenshot = true) ─────────────────────────

function maybeScreenshot(step: ScriptStep, indent: string, runIdx: number = 0): string {
  if (!step.screenshot) return '';
  const suffix = runIdx > 0 ? `-r${runIdx + 1}` : '';
  return `${indent}await page.screenshot({ path: 'screenshots/step-${step.order}-${step.keyword.toLowerCase()}${suffix}.png' });`;
}

// ── Build full .spec.ts for a suite ───────────────────────────────────────────

export interface CodegenInput {
  suiteName:        string;
  suiteId:          string;
  runId:            string;  // unique per run — prevents spec file collisions
  scripts:          TestScript[];
  project:          Project;
  environment:      ProjectEnvironment | null;  // selected env for this run
  allFunctions:     CommonFunction[];
  port?:            number;  // server port — used by T3 to POST /api/heal
  beforeEachSteps?: import('../data/types').SuiteHookStep[];
  afterEachSteps?:  import('../data/types').SuiteHookStep[];
  fastMode?:        boolean;
  fastModeSteps?:   import('../data/types').SuiteHookStep[];
  overlayHandlers?: import('../data/types').OverlayHandler[];
}

export function generateCodegenSpec(input: CodegenInput): string {
  const { suiteName, runId, scripts, project, environment, allFunctions,
          beforeEachSteps = [], afterEachSteps = [],
          fastMode = false, fastModeSteps = [],
          overlayHandlers = [] } = input;
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
  lines.push(`// Global Variable Store — shared across all scripts in this suite run`);
  lines.push(`const __globalVars: Record<string, string> = {};`);
  lines.push(``);
  lines.push(`// Test index counter — used by afterEach to produce FAILED-<idx>.png (workers:1 guaranteed)`);
  lines.push(`let __testIdx = -1;`);
  lines.push(``);
  lines.push(`// ── Self-Healing T2: Alternatives fallback ───────────────────────────────────`);
  lines.push(`const __HEAL_LOG = \`\${__SS_DIR}/healed.ndjson\`;`);
  lines.push(`async function __buildLoc(page: any, selector: string, selectorType: string): Promise<any> {`);
  lines.push(`  switch (selectorType) {`);
  lines.push(`    case 'testid':       return page.getByTestId(selector);`);
  lines.push(`    case 'role': {`);
  lines.push(`      const [r, ...np] = selector.split(':'); const n = np.join(':').trim();`);
  lines.push(`      return n ? page.getByRole(r.trim() as any, { name: n }) : page.getByRole(r.trim() as any);`);
  lines.push(`    }`);
  lines.push(`    case 'label':        return page.getByLabel(selector);`);
  lines.push(`    case 'placeholder':  return page.getByPlaceholder(selector);`);
  lines.push(`    case 'text':         return page.getByText(selector, { exact: false });`);
  lines.push(`    case 'xpath':        return page.locator('xpath=' + selector);`);
  lines.push(`    case 'id':           return page.locator('#' + selector.replace(/^#/, ''));`);
  lines.push(`    case 'name':         return page.locator('[name="' + selector.replace(/"/g, '\\\\"') + '"]');`);
  lines.push(`    case 'nth': {`);
  lines.push(`      const [__sel, ...__idxParts] = selector.split(':');`);
  lines.push(`      const __idx = parseInt(__idxParts.join(':').trim(), 10) || 0;`);
  lines.push(`      return page.locator(__sel.trim()).nth(__idx);`);
  lines.push(`    }`);
  lines.push(`    case 'last':         return page.locator(selector).last();`);
  lines.push(`    default:             return page.locator(selector);`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(`async function __tryAlts(`);
  lines.push(`  page: any, stepOrder: number, keyword: string, locatorId: string,`);
  lines.push(`  alts: Array<{ selector: string; selectorType: string; confidence: number }>`);
  lines.push(`): Promise<{ selector: string; selectorType: string; confidence: number } | null> {`);
  lines.push(`  if (!alts || alts.length === 0) return null;`);
  lines.push(`  const sorted = [...alts].sort((a, b) => b.confidence - a.confidence);`);
  lines.push(`  for (const alt of sorted) {`);
  lines.push(`    try {`);
  lines.push(`      const loc = await __buildLoc(page, alt.selector, alt.selectorType);`);
  lines.push(`      const visible = await loc.first().isVisible({ timeout: 2000 });`);
  lines.push(`      if (visible) {`);
  lines.push(`        const evt = { stepOrder, keyword, locatorId, healed: alt.selector, healedType: alt.selectorType, confidence: alt.confidence, tier: 'T2', at: new Date().toISOString() };`);
  lines.push(`        try { _fs.appendFileSync(__HEAL_LOG, JSON.stringify(evt) + '\\n'); } catch {}`);
  lines.push(`        return alt;`);
  lines.push(`      }`);
  lines.push(`    } catch {}`);
  lines.push(`  }`);
  lines.push(`  return null;`);
  lines.push(`}`);
  lines.push(`async function __execWithLoc(page: any, keyword: string, loc: any, value: string): Promise<void> {`);
  lines.push(`  const kw = keyword.toUpperCase().trim();`);
  lines.push(`  switch (kw) {`);
  lines.push(`    case 'CLICK':          await loc.waitFor({ state: 'visible', timeout: 5000 }); await loc.click(); break;`);
  lines.push(`    case 'DBLCLICK':       await loc.waitFor({ state: 'visible', timeout: 5000 }); await loc.dblclick(); break;`);
  lines.push(`    case 'FILL': case 'TYPE': await loc.waitFor({ state: 'visible', timeout: 5000 }); await loc.fill(value); break;`);
  lines.push(`    case 'CLEAR':          await loc.clear(); break;`);
  lines.push(`    case 'HOVER':          await loc.hover(); break;`);
  lines.push(`    case 'FOCUS':          await loc.focus(); break;`);
  lines.push(`    case 'CHECK':          await loc.check(); break;`);
  lines.push(`    case 'UNCHECK':        await loc.uncheck(); break;`);
  lines.push(`    case 'SELECT':         await loc.selectOption(value); break;`);
  lines.push(`    case 'WAIT SELECTOR': case 'WAIT VISIBLE': await loc.waitFor({ state: 'visible' }); break;`);
  lines.push(`    case 'WAIT HIDDEN':    await loc.waitFor({ state: 'hidden' }); break;`);
  lines.push(`    // ASSERT cases — used by T4 heal: verify element found with new selector`);
  lines.push(`    case 'ASSERT VISIBLE':  await loc.waitFor({ state: 'visible',  timeout: 8000 }); break;`);
  lines.push(`    case 'ASSERT HIDDEN':   await loc.waitFor({ state: 'hidden',   timeout: 8000 }); break;`);
  lines.push(`    case 'ASSERT TEXT': case 'ASSERT CONTAINS': await loc.waitFor({ state: 'visible', timeout: 8000 }); break;`);
  lines.push(`    case 'ASSERT VALUE': case 'ASSERT CHECKED': case 'ASSERT UNCHECKED': case 'ASSERT ENABLED': case 'ASSERT DISABLED': case 'ASSERT EDITABLE': case 'ASSERT READONLY': case 'ASSERT EMPTY': case 'ASSERT FOCUSED': case 'ASSERT CLASS': case 'ASSERT CSS': await loc.waitFor({ state: 'visible', timeout: 8000 }); break;`);
  lines.push(`    case 'ASSERT ATTRIBUTE': case 'ASSERT COUNT': await loc.waitFor({ state: 'attached', timeout: 8000 }); break;`);
  lines.push(`    default:               await loc.waitFor({ state: 'visible', timeout: 5000 }); await loc.click(); break;`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);
  // ── T3 DOM scanner + similarity scoring via server ──────────────────────────
  lines.push(`// ── Self-Healing T3: Similarity Engine ──────────────────────────────────────`);
  lines.push(`const __PLATFORM_URL = 'http://localhost:${input.port ?? 3000}';`);
  // Embed __qaDomScan as a named function — NOT an IIFE.
  // Node.js loads this at module level, so using document.querySelectorAll here
  // would crash immediately ("document is not defined").
  // page.evaluate(__DOM_SCAN) serialises the function and runs it in the browser.
  lines.push(DOM_SCANNER_IIFE);
  lines.push(`const __DOM_SCAN = __qaDomScan;`);
  lines.push(`async function __tryT3Heal(`);
  lines.push(`  page: any, stepOrder: number, keyword: string,`);
  lines.push(`  locatorId: string, profile: any, runId: string`);
  lines.push(`): Promise<{ selector: string; selectorType: string; score: number } | null> {`);
  lines.push(`  if (!profile || !locatorId) return null;`);
  lines.push(`  try {`);
  lines.push(`    const candidates = await page.evaluate(__DOM_SCAN).catch(() => [] as any[]);`);
  lines.push(`    if (!candidates || !candidates.length) return null;`);
  lines.push(`    const resp = await fetch(__PLATFORM_URL + '/api/heal', {`);
  lines.push(`      method: 'POST',`);
  lines.push(`      headers: { 'Content-Type': 'application/json' },`);
  lines.push(`      body: JSON.stringify({ locatorId, profile, candidates, stepOrder, keyword, runId }),`);
  lines.push(`    }).catch(() => null);`);
  lines.push(`    if (!resp || !resp.ok) return null;`);
  lines.push(`    const result = await resp.json().catch(() => null);`);
  lines.push(`    if (!result || !result.selector) return null;`);
  lines.push(`    // Log T3 heal event`);
  lines.push(`    const evt = { stepOrder, keyword, locatorId, healed: result.selector, healedType: result.selectorType, confidence: result.score, tier: 'T3', at: new Date().toISOString() };`);
  lines.push(`    try { _fs.appendFileSync(__HEAL_LOG, JSON.stringify(evt) + '\\n'); } catch {}`);
  lines.push(`    return result;`);
  lines.push(`  } catch { return null; }`);
  lines.push(`}`);
  lines.push(``);
  // ── Self-Healing T4: Non-blocking pending-review path ────────────────────────
  // T4 no longer blocks test execution. When T3 returns a score 50–74 (plausible
  // but not confident), the candidate is used immediately so execution continues.
  // A "healed-pending" event is written to healed.ndjson; after the run completes,
  // attachHealEvents() creates a pending-review proposal for async human approval.
  //
  // Score < 50: nothing viable — step fails as normal (throw original error).
  // ASSERT steps: same non-blocking logic — use candidate if score ≥ 50, fail if < 50.
  //   Asserts that pass with a pending candidate are marked amber in the report.
  //
  // Human review outcomes (in Healing Proposals tab):
  //   Approve Permanent  → T3 candidate becomes new primary selector
  //   Approve Temporary  → T3 candidate added to alternatives[], primary unchanged
  //   Reject             → candidate discarded; next run will fail or re-trigger T3
  lines.push(`// ── Self-Healing T4: Non-blocking pending path ──────────────────────────────`);
  lines.push(`async function __tryT4NonBlocking(`);
  lines.push(`  page: any, stepOrder: number, keyword: string, locatorId: string,`);
  lines.push(`  profile: any, runId: string,`);
  lines.push(`  candidateSelector: string | null, candidateSelectorType: string | null,`);
  lines.push(`  score: number`);
  lines.push(`): Promise<{ selector: string; selectorType: string } | null> {`);
  lines.push(`  // If T3 returned nothing at all, try running it now (ASSERT path enters here directly)`);
  lines.push(`  if (!candidateSelector && profile && locatorId) {`);
  lines.push(`    const _t3 = await __tryT3Heal(page, stepOrder, keyword, locatorId, profile, runId).catch(() => null);`);
  lines.push(`    if (_t3) { candidateSelector = _t3.selector; candidateSelectorType = _t3.selectorType; score = _t3.score; }`);
  lines.push(`  }`);
  lines.push(`  // Score < 50 — nothing viable, let the step fail`);
  lines.push(`  if (!candidateSelector || score < 50) return null;`);
  lines.push(`  // Score 50–74 — use candidate non-blocking, queue for human review`);
  lines.push(`  const evt = {`);
  lines.push(`    stepOrder, keyword, locatorId,`);
  lines.push(`    healed: candidateSelector,`);
  lines.push(`    healedType: candidateSelectorType ?? 'css',`);
  lines.push(`    confidence: score,`);
  lines.push(`    tier: 'T4-pending',`);
  lines.push(`    at: new Date().toISOString(),`);
  lines.push(`  };`);
  lines.push(`  try { _fs.appendFileSync(__HEAL_LOG, JSON.stringify(evt) + '\\n'); } catch {}`);
  lines.push(`  return { selector: candidateSelector, selectorType: candidateSelectorType ?? 'css' };`);
  lines.push(`}`);
  lines.push(``);

  // ── Helper: convert SuiteHookStep → pseudo ScriptStep for generateStepCode ────
  const hookPseudoStep = (hs: { order: number; keyword: string; locator: string; value: string; description: string }, idx: number): ScriptStep => ({
    id: `hook-${idx}`, order: idx + 1, keyword: hs.keyword,
    locatorType: 'css', locator: hs.locator, locatorId: null,
    valueMode: 'static', value: hs.value, testData: [], description: hs.description,
    screenshot: false,
  } as unknown as ScriptStep);

  // ── One test.describe per suite, one test() per script (or per data row) ─────
  lines.push(`test.describe('${suiteName.replace(/'/g, "\\'")}', () => {`);
  lines.push(``);

  // ── Fast Mode: capture auth state once, reuse across all tests ───────────────
  // NOTE: test.use({ storageState }) is intentionally NOT used here.
  // It is evaluated at collection time (before beforeAll runs), so the file does
  // not exist yet and Playwright throws ENOENT. Instead each test() opens its own
  // browser.newContext({ storageState }) after beforeAll has written the file.
  if (fastMode && fastModeSteps.length > 0) {
    const envUrl = environment?.url || project.appUrl || '';
    const escUrl = envUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`  // Fast Mode — login once, reuse auth state for all tests`);
    lines.push(`  const __AUTH_STATE = \`\${__SS_DIR}/auth-state.json\`;`);
    lines.push(``);
    // Single beforeAll: auth first, then prescan on the authenticated page
    lines.push(`  test.beforeAll(async ({ browser }) => {`);
    lines.push(`    // Step 1: authenticate and persist storage state`);
    lines.push(`    const __authCtx  = await browser.newContext({ ignoreHTTPSErrors: true });`);
    lines.push(`    const __authPage = await __authCtx.newPage();`);
    lines.push(`    await __authPage.goto('${escUrl}', { waitUntil: 'domcontentloaded' });`);
    lines.push(`    await __authPage.waitForLoadState('domcontentloaded');`);
    for (let hi = 0; hi < fastModeSteps.length; hi++) {
      const ps   = hookPseudoStep(fastModeSteps[hi], hi);
      const code = generateStepCode(ps, project, environment, allFunctions, dataMap, '    ');
      if (code) lines.push(code);
    }
    lines.push(`    await __authCtx.storageState({ path: __AUTH_STATE });`);
    lines.push(`    // Step 2: prescan DOM on the authenticated page (reuse same context)`);
    const prescanUrlFM  = environment?.url || project.appUrl || '';
    const prescanKeyFM  = normalizePageKey(prescanUrlFM);
    const escFM         = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`    try {`);
    lines.push(`      await __authPage.waitForTimeout(1500);`);
    lines.push(`      const __psCandidates = await __authPage.evaluate(__DOM_SCAN).catch(() => []);`);
    lines.push(`      await fetch(__PLATFORM_URL + '/api/prescan', {`);
    lines.push(`        method: 'POST',`);
    lines.push(`        headers: { 'Content-Type': 'application/json' },`);
    lines.push(`        body: JSON.stringify({ projectId: '${project.id}', pageKey: '${prescanKeyFM}', candidates: __psCandidates, runId: '${runId}' }),`);
    lines.push(`      }).catch(() => {});`);
    lines.push(`    } catch { /* prescan failure never blocks tests */ }`);
    lines.push(`    await __authCtx.close();`);
    lines.push(`  });`);
    lines.push(``);
  }

  // ── afterEach: screenshot on failure + console error report ──────────────────
  lines.push(`  test.afterEach(async ({ page, browserName }, testInfo) => {`);
  lines.push(`    const __curIdx = __testIdx; // captured at afterEach time`);
  lines.push(`    if (testInfo.status !== testInfo.expectedStatus) {`);
  lines.push(`      // Capture failure screenshot — browser-qualified to avoid multi-browser collisions`);
  lines.push(`      const __failPath = \`\${__SS_DIR}/FAILED-\${__curIdx}-\${browserName}.png\`;`);
  lines.push(`      await page.screenshot({ path: __failPath, fullPage: true }).catch(() => {});`);
  lines.push(`      await testInfo.attach('failure-screenshot', { path: __failPath, contentType: 'image/png' }).catch(() => {});`);
  lines.push(`    }`);
  lines.push(`    // Attach captured console errors to Playwright HTML report`);
  lines.push(`    const __errs = (page as any).__qaConsoleErrors as string[] | undefined;`);
  lines.push(`    if (__errs && __errs.length) {`);
  lines.push(`      await testInfo.attach('console-errors', {`);
  lines.push(`        body: __errs.join('\\n'),`);
  lines.push(`        contentType: 'text/plain',`);
  lines.push(`      }).catch(() => {});`);
  lines.push(`      // Phase A: emit structured log so server.ts stdout parser picks it up`);
  lines.push(`      console.log(\`[QA_CONSOLE_ERRORS]:\${__curIdx}:\${JSON.stringify(__errs)}\`);`);
  lines.push(`    }`);
  lines.push(`  });`);
  lines.push(``);

  // ── Suite Hooks: beforeEach / afterEach keyword steps ────────────────────────
  if (beforeEachSteps.length > 0) {
    lines.push(`  // Suite beforeEach — runs before every test in this suite`);
    lines.push(`  test.beforeEach(async ({ page }) => {`);
    for (let hi = 0; hi < beforeEachSteps.length; hi++) {
      const ps   = hookPseudoStep(beforeEachSteps[hi], hi);
      const code = generateStepCode(ps, project, environment, allFunctions, dataMap, '    ');
      if (code) lines.push(code);
    }
    lines.push(`  });`);
    lines.push(``);
  }

  if (afterEachSteps.length > 0) {
    lines.push(`  // Suite afterEach — runs after every test in this suite (after built-in afterEach)`);
    lines.push(`  test.afterEach(async ({ page }) => {`);
    for (let hi = 0; hi < afterEachSteps.length; hi++) {
      const ps   = hookPseudoStep(afterEachSteps[hi], hi);
      const code = generateStepCode(ps, project, environment, allFunctions, dataMap, '    ');
      if (code) lines.push(code);
    }
    lines.push(`  });`);
    lines.push(``);
  }

  // ── P5: Pre-scan beforeAll — only when NOT fast mode (fast mode merges prescan into its beforeAll) ─
  if (!(fastMode && fastModeSteps.length > 0)) {
    const prescanUrl     = environment?.url || project.appUrl || '';
    const prescanPageKey = normalizePageKey(prescanUrl);
    const esc            = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`  // P5: Pre-scan — DOM health check before any test begins`);
    lines.push(`  test.beforeAll(async ({ browser }) => {`);
    lines.push(`    const __psCtx  = await browser.newContext({ ignoreHTTPSErrors: true });`);
    lines.push(`    const __psPage = await __psCtx.newPage();`);
    lines.push(`    try {`);
    lines.push(`      await __psPage.goto('${esc(prescanUrl)}', { waitUntil: 'domcontentloaded', timeout: 20000 });`);
    lines.push(`      await __psPage.waitForTimeout(1500); // brief SPA settle`);
    lines.push(`      const __psCandidates = await __psPage.evaluate(__DOM_SCAN).catch(() => []);`);
    lines.push(`      await fetch(__PLATFORM_URL + '/api/prescan', {`);
    lines.push(`        method: 'POST',`);
    lines.push(`        headers: { 'Content-Type': 'application/json' },`);
    lines.push(`        body: JSON.stringify({`);
    lines.push(`          projectId: '${project.id}',`);
    lines.push(`          pageKey:   '${prescanPageKey}',`);
    lines.push(`          candidates: __psCandidates,`);
    lines.push(`          runId:     '${runId}',`);
    lines.push(`        }),`);
    lines.push(`      }).catch(() => {});`);
    lines.push(`    } catch { /* prescan failure never blocks tests */ }`);
    lines.push(`    await __psCtx.close().catch(() => {});`);
    lines.push(`  });`);
    lines.push(``);
  }

  for (const script of scripts) {
    const sortedSteps = script.steps.slice().sort((a, b) => a.order - b.order);
    // Prefix title with tcId so execution report can extract and display it
    const testName    = (script.tcId ? `[${script.tcId}] ` : '') + script.title.replace(/'/g, "\\'");

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
      const isFastMode = fastMode && fastModeSteps.length > 0;
      if (isFastMode) {
        lines.push(`  test('${testName}${runLabel.replace(/'/g, "\\'")}', async ({ browser, browserName }) => {`);
        lines.push(`    __testIdx++;`);
        lines.push(`    const __browser = browserName;`);
        lines.push(`    const __sessionVars: Record<string, string> = {};`);
        lines.push(`    // Fast Mode: open context with saved auth state — beforeAll wrote this file`);
        lines.push(`    const __fastCtx  = await browser.newContext({ storageState: __AUTH_STATE, ignoreHTTPSErrors: true });`);
        lines.push(`    const page       = await __fastCtx.newPage();`);
      } else {
        lines.push(`  test('${testName}${runLabel.replace(/'/g, "\\'")}', async ({ page, browserName }) => {`);
        lines.push(`    __testIdx++; // increment module-level counter — used by afterEach for FAILED-<idx>.png`);
        lines.push(`    const __browser = browserName;`);
        lines.push(`    const __sessionVars: Record<string, string> = {};`);
      }
      lines.push(``);
      lines.push(`    // ── Console error collection ──────────────────────────────────────────────`);
      lines.push(`    const __qaConsoleErrors: string[] = [];`);
      lines.push(`    (page as any).__qaConsoleErrors = __qaConsoleErrors;`);
      lines.push(`    page.on('console', msg => { if (msg.type() === 'error') __qaConsoleErrors.push(\`[console.error] \${msg.text()}\`); });`);
      lines.push(`    page.on('pageerror', err => { __qaConsoleErrors.push(\`[JS exception] \${err.message}\`); });`);
      lines.push(``);

      // ── Overlay Handlers — auto-dismiss unexpected dialogs ─────────────────
      if (overlayHandlers.length > 0) {
        lines.push(`    // Suite overlay handlers — auto-handle unexpected dialogs`);
        lines.push(`    page.on('dialog', async __dialog => {`);
        lines.push(`      const __dtype = __dialog.type(); // 'alert' | 'confirm' | 'prompt' | 'beforeunload'`);
        for (const oh of overlayHandlers) {
          const cond = oh.type === 'any' ? 'true' : `__dtype === '${oh.type}'`;
          if (oh.action === 'accept' && oh.text) {
            const escaped = (oh.text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            lines.push(`      if (${cond}) { await __dialog.accept('${escaped}'); return; }`);
          } else if (oh.action === 'accept') {
            lines.push(`      if (${cond}) { await __dialog.accept(); return; }`);
          } else {
            lines.push(`      if (${cond}) { await __dialog.dismiss(); return; }`);
          }
        }
        lines.push(`    });`);
        lines.push(``);
      }

      // Auto-inject navigation — URL from suite environment, never from steps
      lines.push(generateNavBlock(environment, project, '    '));
      lines.push('');

      // Keywords that don't need visual diff wrapping
      const NO_DIFF_KW = new Set(['SCREENSHOT', 'WAIT', 'GOTO', 'VERIFY', 'ASSERT TEXT', 'ASSERT VISIBLE', 'ASSERT HIDDEN', 'ASSERT VALUE', 'WAIT FOR TOAST', 'ASSERT TOAST', 'ASSERT UNCHECKED', 'ASSERT CHECKED', 'ASSERT EDITABLE', 'ASSERT READONLY', 'ASSERT EMPTY', 'ASSERT FOCUSED', 'ASSERT CLASS', 'ASSERT CSS', 'ASSERT RESPONSE OK']);

      for (let si = 0; si < sortedSteps.length; si++) {
        const step     = sortedSteps[si];
        const kw       = (step.keyword || '').toUpperCase().trim();
        const needsDiff = !NO_DIFF_KW.has(kw);

        // Skip dialog steps — they are injected before the PRECEDING step via look-ahead
        if (kw === 'ACCEPT DIALOG' || kw === 'DISMISS DIALOG') continue;

        // Build step label for test.step() — "Step N: KEYWORD | description"
        const stepDesc  = (step.description || '').trim();
        const stepLabel = `Step ${step.order}: ${kw}${stepDesc ? ' | ' + stepDesc.slice(0, 60) : ''}`.replace(/'/g, "\\'");
        lines.push(`    await test.step('${stepLabel}', async () => {`);

        // Look-ahead: if the NEXT step is a dialog handler, inject it before this step
        const dlgCode = dialogHandlerCode(sortedSteps[si + 1], '      ');
        if (dlgCode) lines.push(dlgCode);

        // CR3: Look-ahead — if the NEXT step is a GOTO/NAVIGATE, wrap this step's
        // click in a Promise.all with waitForLoadState so we catch the navigation.
        // This prevents timing failures when a button click triggers a full page load.
        const nextKw = (sortedSteps[si + 1]?.keyword || '').toUpperCase().trim();
        const thisStepTriggersNav = nextKw === 'GOTO' || nextKw === 'NAVIGATE' || nextKw === 'GOTO URL';
        if (thisStepTriggersNav && (kw === 'CLICK' || kw === 'SUBMIT')) {
          lines.push(`      // CR3: next step is navigation — wrap click with waitForLoadState`);
          lines.push(`      const __navWait_${step.order} = page.waitForLoadState('domcontentloaded');`);
        }

        if (needsDiff) {
          // T2 self-healing: embed alternatives for steps with a locator (non-ASSERT, non-CALL FUNCTION)
          const isAssert = kw.startsWith('ASSERT');
          const isFnCall = kw === 'CALL FUNCTION';
          const stepAlts = (!isAssert && !isFnCall && step.locatorId)
            ? getStepAlternatives(step.locatorId)
            : [];
          const locatorIdStr = (step.locatorId || '').replace(/'/g, "\\'");
          lines.push(`      const __alt_${step.order}: Array<{selector:string;selectorType:string;confidence:number}> = ${JSON.stringify(stepAlts)};`);
          lines.push(`      await page.screenshot({ path: \`\${__SS_DIR}/${testIdx}-\${__browser}-before-${step.order}.png\`, fullPage: false }).catch(() => {});`);
          lines.push(`      try {`);
          const innerCode = generateStepCode(step, project, environment, allFunctions, dataMap, '        ', runIdx);
          if (innerCode) lines.push(innerCode);
          const pinLine = storeAsLine(step, step.locator ? buildLocatorExpr(step.locatorType || 'css', step.locator) : null, '        ');
          if (pinLine) lines.push(pinLine);
          lines.push(`      } catch (__e_${step.order}: any) {`);
          lines.push(`        await page.screenshot({ path: \`\${__SS_DIR}/${testIdx}-\${__browser}-after-${step.order}.png\`, fullPage: false }).catch(() => {});`);
          // stepVal needed in both T2/T3 and T4 (ASSERT) branches
          const stepVal = valueExpr(step, dataMap, runIdx);
          if (!isAssert && !isFnCall) {
            const healProfile = getStepHealingProfile(step.locatorId);
            const profileJson = healProfile ? JSON.stringify(healProfile) : 'null';
            // T2: try stored alternatives first (fast, no server round-trip)
            lines.push(`        const __healed_${step.order} = await __tryAlts(page, ${step.order}, '${kw}', '${locatorIdStr}', __alt_${step.order});`);
            lines.push(`        if (__healed_${step.order}) {`);
            lines.push(`          try {`);
            lines.push(`            const __healLoc_${step.order} = await __buildLoc(page, __healed_${step.order}.selector, __healed_${step.order}.selectorType);`);
            lines.push(`            await __execWithLoc(page, '${kw}', __healLoc_${step.order}, ${stepVal});`);
            lines.push(`          } catch { throw __e_${step.order}; }`);
            lines.push(`        } else {`);
            // T3: DOM scan + server-side similarity scoring
            lines.push(`          // T3: all alternatives exhausted — run DOM scanner + similarity scoring`);
            lines.push(`          const __t3Profile_${step.order} = ${profileJson};`);
            lines.push(`          const __t3Result_${step.order} = await __tryT3Heal(page, ${step.order}, '${kw}', '${locatorIdStr}', __t3Profile_${step.order}, '${runId}');`);
            lines.push(`          if (__t3Result_${step.order} && __t3Result_${step.order}.score >= 75) {`);
            lines.push(`            try {`);
            lines.push(`              const __t3Loc_${step.order} = await __buildLoc(page, __t3Result_${step.order}.selector, __t3Result_${step.order}.selectorType);`);
            lines.push(`              await __execWithLoc(page, '${kw}', __t3Loc_${step.order}, ${stepVal});`);
            lines.push(`            } catch { throw __e_${step.order}; }`);
            lines.push(`          } else {`);
            lines.push(`            // T4-nonblocking: score 50–74 → use candidate + queue for human review`);
            lines.push(`            const __t4Dec_${step.order} = await __tryT4NonBlocking(page, ${step.order}, '${kw}', '${locatorIdStr}', __t3Profile_${step.order}, '${runId}', __t3Result_${step.order}?.selector ?? null, __t3Result_${step.order}?.selectorType ?? null, __t3Result_${step.order}?.score ?? 0);`);
            lines.push(`            if (__t4Dec_${step.order}) {`);
            lines.push(`              try {`);
            lines.push(`                const __t4Loc_${step.order} = await __buildLoc(page, __t4Dec_${step.order}.selector, __t4Dec_${step.order}.selectorType);`);
            lines.push(`                await __execWithLoc(page, '${kw}', __t4Loc_${step.order}, ${stepVal});`);
            lines.push(`              } catch { throw __e_${step.order}; }`);
            lines.push(`            } else { throw __e_${step.order}; }`);
            lines.push(`          }`);
            lines.push(`        }`);
          } else if (isAssert) {
            // ASSERT: non-blocking T4 — use T3 candidate if score ≥ 50, else fail
            const assertProfile = getStepHealingProfile(step.locatorId);
            const assertProfileJson = assertProfile ? JSON.stringify(assertProfile) : 'null';
            lines.push(`        // ASSERT: non-blocking heal — use T3 candidate if score ≥ 50, queue for review`);
            lines.push(`        const __t4AssertProfile_${step.order} = ${assertProfileJson};`);
            lines.push(`        const __t4AssertDec_${step.order} = await __tryT4NonBlocking(page, ${step.order}, '${kw}', '${locatorIdStr}', __t4AssertProfile_${step.order}, '${runId}', null, null, 0);`);
            lines.push(`        if (__t4AssertDec_${step.order}) {`);
            lines.push(`          try {`);
            lines.push(`            const __t4AssertLoc_${step.order} = await __buildLoc(page, __t4AssertDec_${step.order}.selector, __t4AssertDec_${step.order}.selectorType);`);
            lines.push(`            await __execWithLoc(page, '${kw}', __t4AssertLoc_${step.order}, ${stepVal});`);
            lines.push(`          } catch { throw __e_${step.order}; }`);
            lines.push(`        } else { throw __e_${step.order}; }`);
          } else {
            // CALL FUNCTION — just throw (no healing inside function calls)
            lines.push(`        throw __e_${step.order};`);
          }
          lines.push(`      }`);
        } else {
          const code = generateStepCode(step, project, environment, allFunctions, dataMap, '      ', runIdx);
          if (code) lines.push(code);
          const pinLine = storeAsLine(step, step.locator ? buildLocatorExpr(step.locatorType || 'css', step.locator) : null, '      ');
          if (pinLine) lines.push(pinLine);
        }

        // CR3: await the navigation promise after the step block completes
        if (thisStepTriggersNav && (kw === 'CLICK' || kw === 'SUBMIT')) {
          lines.push(`      await __navWait_${step.order}; // CR3: wait for navigation triggered by ${kw}`);
        }

        const ss = maybeScreenshot(step, '      ', runIdx);
        if (ss) lines.push(ss);

        // Close test.step()
        lines.push(`    }); // Step ${step.order}: ${kw}`);
      }

      if (isFastMode) {
        lines.push(`    await __fastCtx.close().catch(() => {});`);
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
  lines.push(`const __ERROR      = \`\${__SS_DIR}/error.json\`;`);
  lines.push(`_fs.mkdirSync(__SS_DIR, { recursive: true });`);
  lines.push(``);

  // ── __debugPause helper — file-based IPC ───────────────────────────────────
  // Writes step info to pending.json, then polls for gate.json written by server.
  // Zero network dependency — works regardless of proxy/firewall.
  lines.push(`interface __GateResult {`);
  lines.push(`  action: 'continue' | 'skip' | 'stop' | 'retry';`);
  lines.push(`  locator?: string;      // set when action='retry'`);
  lines.push(`  locatorType?: string;  // set when action='retry'`);
  lines.push(`  value?: string;        // set when action='retry'`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function __debugPause(`);
  lines.push(`  stepIdx: number, keyword: string, locator: string, value: string, ssPath: string`);
  lines.push(`): Promise<__GateResult> {`);
  lines.push(`  // Signal the server: write step info`);
  lines.push(`  try { _fs.unlinkSync(__GATE); } catch {}`);
  lines.push(`  // Ensure screenshot file exists on disk before signaling server`);
  lines.push(`  await new Promise<void>(r => { const iv = setInterval(() => { if (_fs.existsSync(ssPath)) { clearInterval(iv); r(); } }, 50); setTimeout(() => { clearInterval(iv); r(); }, 5000); });`);
  lines.push(`  _fs.writeFileSync(__PENDING, JSON.stringify({ stepIdx, keyword, locator, value, screenshotPath: ssPath }));`);
  lines.push(`  // Wait for server to write gate.json (UI clicked Step/Skip/Stop/Retry)`);
  lines.push(`  return new Promise((resolve) => {`);
  lines.push(`    const iv = setInterval(() => {`);
  lines.push(`      try {`);
  lines.push(`        if (_fs.existsSync(__GATE)) {`);
  lines.push(`          const d = JSON.parse(_fs.readFileSync(__GATE, 'utf-8'));`);
  lines.push(`          clearInterval(iv);`);
  lines.push(`          try { _fs.unlinkSync(__GATE); } catch {}`);
  lines.push(`          try { _fs.unlinkSync(__PENDING); } catch {}`);
  lines.push(`          resolve({ action: d.action || 'continue', locator: d.locator, locatorType: d.locatorType, value: d.value });`);
  lines.push(`        }`);
  lines.push(`      } catch {}`);
  lines.push(`    }, 300);`);
  lines.push(`    // Safety timeout: 30 minutes`);
  lines.push(`    setTimeout(() => { clearInterval(iv); resolve({ action: 'stop' }); }, 30 * 60 * 1000);`);
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
  // ── __buildLocator — runtime universal locator builder (all types) ───────────
  // Used exclusively in debug retry blocks so patched locatorType+locator are
  // resolved at runtime rather than being baked into the spec at generation time.
  lines.push(`function __buildLocator(page: any, lt: string, loc: string): any {`);
  lines.push(`  switch ((lt || 'css').toLowerCase()) {`);
  lines.push(`    case 'text':        return page.getByText(loc);`);
  lines.push(`    case 'testid':      return page.getByTestId(loc);`);
  lines.push(`    case 'label':       return page.getByLabel(loc);`);
  lines.push(`    case 'placeholder': return page.getByPlaceholder(loc);`);
  lines.push(`    case 'title':       return page.getByTitle(loc);`);
  lines.push(`    case 'xpath':       return page.locator('xpath=' + loc);`);
  lines.push(`    case 'id':          return page.locator('#' + loc.replace(/^#/, ''));`);
  lines.push(`    case 'name':        return page.locator('[name="' + loc + '"]');`);
  lines.push(`    case 'role': {`);
  lines.push(`      const ci = loc.lastIndexOf(':');`);
  lines.push(`      if (ci > -1) return page.getByRole(loc.slice(0, ci) as any, { name: loc.slice(ci + 1) });`);
  lines.push(`      return page.getByRole(loc as any);`);
  lines.push(`    }`);
  lines.push(`    case 'nth': {`);
  lines.push(`      const ci = loc.lastIndexOf(':');`);
  lines.push(`      if (ci > -1) return page.locator(loc.slice(0, ci)).nth(parseInt(loc.slice(ci + 1), 10) || 0);`);
  lines.push(`      return page.locator(loc).nth(0);`);
  lines.push(`    }`);
  lines.push(`    case 'last':        return page.locator(loc).last();`);
  lines.push(`    default:            return page.locator(loc);  // css`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);

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
  lines.push(`      case 'nth': {`);
  lines.push(`        const ci = locVal.lastIndexOf(':');`);
  lines.push(`        loc = ci > -1 ? page.locator(locVal.slice(0, ci)).nth(parseInt(locVal.slice(ci + 1), 10) || 0) : page.locator(locVal).nth(0); break;`);
  lines.push(`      }`);
  lines.push(`      case 'last': loc = page.locator(locVal).last(); break;`);
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
  lines.push(`    const __sessionVars: Record<string, string> = {}; // Variable Store`);
  lines.push(`    const __globalVars: Record<string, string> = {}; // Global Variable Store`);
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

  for (let si = 0; si < sortedSteps.length; si++) {
    const step = sortedSteps[si];
    const kw      = (step.keyword || '').toUpperCase().trim();
    const loc     = step.locator || '';
    const lt      = step.locatorType || 'css';
    const dispVal = debugValueDisplay(step).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const dispLoc = loc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const kwSlug  = kw.replace(/\s+/g, '_');

    // Dialog steps are injected before the PRECEDING step via look-ahead.
    // In the debugger we still show them as an instant "done" step (no pause)
    // so the user can see in the step list that the dialog was handled.
    if (kw === 'ACCEPT DIALOG' || kw === 'DISMISS DIALOG') {
      const dlgSsVar  = `__ss_${step.order}`;
      const dlgAction = kw === 'ACCEPT DIALOG' ? 'accepted' : 'dismissed';
      lines.push(`    // Step ${step.order}: ${kw} — auto-handled (dialog ${dlgAction} by preceding step)`);
      lines.push(`    {`);
      lines.push(`      const ${dlgSsVar} = \`\${__SS_DIR}/${step.order}-${kwSlug}.jpg\`;`);
      lines.push(`      await page.screenshot({ path: ${dlgSsVar}, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);
      lines.push(`      await __debugPause(${step.order}, '${kw}', '', 'Dialog ${dlgAction} ✓', ${dlgSsVar});`);
      lines.push(`    }`);
      lines.push(``);
      continue;
    }

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
      lines.push(`      if (__act_${step.order}_fn.action === 'stop') { await page.close().catch(() => {}); return; }`);
      lines.push(`      if (__act_${step.order}_fn.action !== 'skip') {`);

      if (fn && fnSortedSteps.length > 0) {
        // ── Sub-step blocks ────────────────────────────────────────────────────
        fnSortedSteps.forEach((fs: any, fi: number) => {
          const saved      = fnStepValues.find((v: any) => v.fnStepIdx === fi);
          const pseudoStep: ScriptStep = {
            id:           `fn-${fs.order}`,
            order:        fs.order,
            keyword:      fs.keyword,
            locator:      fs.selector ?? fs.detail ?? null,   // FunctionStep stores value as 'selector'
            locatorId:    null,
            locatorType:  fs.locatorType || 'css',
            valueMode:    saved?.valueMode || 'static',
            value:        saved?.value ?? null,
            testData:     saved?.testData || [],
            fnStepValues: [],
            description:  fs.description || fs.detail || '',
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
          lines.push(`          if (${subActVar}.action === 'stop') { await page.close().catch(() => {}); return; }`);
          lines.push(`          if (${subActVar}.action !== 'skip') {`);
          lines.push(`            while (true) {`);
          lines.push(`              try {`);

          // Note: nested CALL FUNCTION inside a function runs without sub-pause (one level deep only)
          const subCode = generateStepCode(pseudoStep, project, environment, allFunctions, dataMap, '                ', 0);
          if (subCode) lines.push(subCode);
          lines.push(`                await __waitForPageSettle(page);`);
          lines.push(`                break; // success — exit sub-step retry loop`);

          lines.push(`              } catch (__err_${step.order}_${subNum}: any) {`);
          lines.push(`                const __errMsg_${step.order}_${subNum} = __err_${step.order}_${subNum} instanceof Error ? __err_${step.order}_${subNum}.message : String(__err_${step.order}_${subNum});`);
          lines.push(`                try { _fs.writeFileSync(__ERROR, JSON.stringify({ stepIdx: ${subStepIdx}, keyword: '${subKw}', locator: '${subDispLoc}', errorMessage: __errMsg_${step.order}_${subNum}, errorType: __err_${step.order}_${subNum}?.constructor?.name || 'Error' })); } catch {}`);
          lines.push(`                const __reSub_${step.order}_${subNum} = \`\${__SS_DIR}/${step.order}.${subNum}-${subKwSlug}-err.jpg\`;`);
          lines.push(`                await page.screenshot({ path: __reSub_${step.order}_${subNum}, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);
          lines.push(`                const __reSubGate_${step.order}_${subNum} = await __debugPause(${subStepIdx}, '${subKw}', '${subDispLoc}', '${subDispVal}', __reSub_${step.order}_${subNum});`);
          lines.push(`                if (__reSubGate_${step.order}_${subNum}.action === 'stop') { await page.close().catch(() => {}); return; }`);
          lines.push(`                if (__reSubGate_${step.order}_${subNum}.action === 'skip') break;`);
          lines.push(`                // Retry: loop back with same code (user can Stop or Skip to exit)`);
          lines.push(`              }`);
          lines.push(`            } // end sub-step retry loop`);
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
    lines.push(`      const __gate_${step.order} = await __debugPause(${step.order}, '${kw}', '${dispLoc}', '${dispVal}', ${ssVar});`);
    lines.push(`      if (__gate_${step.order}.action === 'stop') { await page.close().catch(() => {}); return; }`);
    lines.push(`      if (__gate_${step.order}.action !== 'skip') {`);
    lines.push(`        // Retry loop: on action='retry' re-execute with patched locator/value (no limit — user must Stop or Skip)`);
    lines.push(`        let __retryCount_${step.order} = 0;`);
    lines.push(`        let __patchedLoc_${step.order}  = __gate_${step.order}.locator ?? '${loc.replace(/'/g, "\\'")}';`);
    lines.push(`        let __patchedLt_${step.order}   = __gate_${step.order}.locatorType ?? '${lt}';`);
    lines.push(`        let __patchedVal_${step.order}  = __gate_${step.order}.value ?? '${dispVal.replace(/'/g, "\\'")}';`);
    lines.push(`        let __currentAction_${step.order} = __gate_${step.order}.action;`);
    lines.push(`        while (true) {`);
    lines.push(`          try {`);

    // Look-ahead: if NEXT step is a dialog handler, inject it before execution
    const dbgDlgCode = dialogHandlerCode(sortedSteps[si + 1], '            ');
    if (dbgDlgCode) lines.push(dbgDlgCode);

    // Actual step execution — use patched loc/lt/val when available
    const code = generateStepCode(step, project, environment, allFunctions, dataMap, '            ', 0);
    if (code) {
      // Replace static locator references with runtime patched variables in generated code
      // Retry execution: use __buildLocator + keyword dispatch instead of regex-patching
      // generated code. This handles ALL locator types correctly without fragile string
      // replacement that breaks on chained methods or special characters in selectors.
      const o = step.order;
      lines.push(`            const __retryLoc_${o} = __buildLocator(page, __patchedLt_${o}, __patchedLoc_${o});`);
      lines.push(`            switch ('${kw}') {`);
      lines.push(`              case 'CLICK': case 'JS CLICK':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.click(); break;`);
      lines.push(`              case 'DBLCLICK':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.dblclick(); break;`);
      lines.push(`              case 'RIGHT CLICK':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.click({ button: 'right' }); break;`);
      lines.push(`              case 'FILL': case 'TYPE':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.fill(__patchedVal_${o}); break;`);
      lines.push(`              case 'SELECT':`);
      lines.push(`                await __retryLoc_${o}.selectOption(__patchedVal_${o}); break;`);
      lines.push(`              case 'HOVER': case 'HOVER AND CLICK':`);
      lines.push(`                await __retryLoc_${o}.hover(); break;`);
      lines.push(`              case 'CLEAR':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.clear(); break;`);
      lines.push(`              case 'ASSERT VISIBLE':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 }); break;`);
      lines.push(`              case 'ASSERT NOT VISIBLE':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'hidden', timeout: 10000 }); break;`);
      lines.push(`              case 'ASSERT TEXT':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                { const t = await __retryLoc_${o}.innerText(); if (!t.includes(__patchedVal_${o})) throw new Error('Text mismatch: expected "' + __patchedVal_${o} + '" in "' + t + '"'); } break;`);
      lines.push(`              case 'ASSERT VALUE':`);
      lines.push(`                { const v = await __retryLoc_${o}.inputValue(); if (v !== __patchedVal_${o}) throw new Error('Value mismatch: expected "' + __patchedVal_${o} + '" got "' + v + '"'); } break;`);
      lines.push(`              case 'ASSERT CHECKED':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                { const checked = await __retryLoc_${o}.isChecked(); if (!checked) throw new Error('Element not checked'); } break;`);
      lines.push(`              case 'CHECK': await __retryLoc_${o}.check(); break;`);
      lines.push(`              case 'UNCHECK': await __retryLoc_${o}.uncheck(); break;`);
      lines.push(`              case 'FOCUS': await __retryLoc_${o}.focus(); break;`);
      lines.push(`              case 'SCROLL INTO VIEW': await __retryLoc_${o}.scrollIntoViewIfNeeded(); break;`);
      lines.push(`              default:`);
      lines.push(`                // Fallback: attempt click for unknown keywords with a locator`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.click();`);
      lines.push(`            }`);

    }
    // 📌 Pin — store value into __sessionVars if storeAs is set (use patched locator)
    const dbgPinLine = storeAsLine(step, step.locator ? `__buildLocator(page, __patchedLt_${step.order}, __patchedLoc_${step.order})` : null, '            ');
    if (dbgPinLine) lines.push(dbgPinLine);
    // Wait for DOM/network to settle
    lines.push(`            await __waitForPageSettle(page);`);
    lines.push(`            break; // success — exit retry loop`);

    lines.push(`          } catch (__err_${step.order}: any) {`);
    lines.push(`            const __errMsg_${step.order} = __err_${step.order} instanceof Error ? __err_${step.order}.message : String(__err_${step.order});`);
    lines.push(`            try { _fs.writeFileSync(__ERROR, JSON.stringify({ stepIdx: ${step.order}, keyword: '${kw}', locator: __patchedLoc_${step.order}, errorMessage: __errMsg_${step.order}, errorType: __err_${step.order}?.constructor?.name || 'Error' })); } catch {}`);
    lines.push(`            // Browser stays open — user must Stop or Skip to exit. Loop back to __debugPause.`);
    lines.push(`            const __reSsPath_${step.order} = \`\${__SS_DIR}/${step.order}-${kwSlug}-retry\${++__retryCount_${step.order}}.jpg\`;`);
    lines.push(`            await page.screenshot({ path: __reSsPath_${step.order}, fullPage: false, type: 'jpeg', quality: 80 }).catch(() => {});`);
    lines.push(`            const __reGate_${step.order} = await __debugPause(${step.order}, '${kw}', __patchedLoc_${step.order}, __patchedVal_${step.order}, __reSsPath_${step.order});`);
    lines.push(`            if (__reGate_${step.order}.action === 'stop') { await page.close().catch(() => {}); return; }`);
    lines.push(`            if (__reGate_${step.order}.action === 'skip') break;`);
    lines.push(`            if (__reGate_${step.order}.locator)     __patchedLoc_${step.order} = __reGate_${step.order}.locator!;`);
    lines.push(`            if (__reGate_${step.order}.locatorType) __patchedLt_${step.order}  = __reGate_${step.order}.locatorType!;`);
    lines.push(`            if (__reGate_${step.order}.value !== undefined) __patchedVal_${step.order} = __reGate_${step.order}.value!;`);
    lines.push(`            __currentAction_${step.order} = __reGate_${step.order}.action;`);
    lines.push(`          }`);
    lines.push(`        } // end retry loop`);
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
