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

import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';
import { TestScript, ScriptStep, Project, ProjectEnvironment, CommonFunction, CommonData, Locator, LocatorAlternative } from '../data/types';
import { readAll, COMMON_DATA, LOCATORS } from '../data/store';
import { logger } from './logger';
import { DOM_SCANNER_IIFE } from './healingEngine';

// ── Stable per-test identifier: TID_<8-hex> ──────────────────────────────────
// Deterministic: same suiteId + testName always yields the same testId.
// Used by flakiness intelligence (quarantine, promote, groupRunsByTestId).
function makeTestId(suiteId: string, testName: string): string {
  return 'TID_' + crypto.createHash('sha256')
    .update(`${suiteId}::${testName}`)
    .digest('hex')
    .slice(0, 8);
}

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

// OLD: buildLocatorExpr(locatorType, locator) — always used `page` as root, broke iframe steps
// function buildLocatorExpr(locatorType: string | null | undefined, locator: string): string { ... }
function buildLocatorExpr(locatorType: string | null | undefined, locator: string, frameCtx?: string | null): string {
  const t = (locatorType || 'css').toLowerCase();
  // Use double-quoted JS strings for all locators — avoids single-quote
  // conflicts with XPath predicates like normalize-space()='...'
  const dq = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // When step lives inside an iframe, scope to frameLocator instead of page directly.
  // frameCtx is the iframe CSS selector e.g. "#flowIframe".
  const root = frameCtx ? `page.frameLocator("${dq(frameCtx)}")` : 'page';

  switch (t) {
    case 'text':    return `${root}.getByText("${dq(locator)}")`;
    case 'testid':  return `${root}.getByTestId("${dq(locator)}")`;
    case 'role': {
      const [role, ...nameParts] = locator.split(':');
      const name = nameParts.join(':').trim();
      return name
        ? `${root}.getByRole("${dq(role.trim())}", { name: "${dq(name)}" })`
        : `${root}.getByRole("${dq(role.trim())}")`;
    }
    case 'xpath':   return `${root}.locator("xpath=${dq(locator)}")`;
    case 'id':      return `${root}.locator("#${dq(locator.replace(/^#/, ''))}")`;
    case 'name':    return locator.includes('[name=') ? `${root}.locator("${dq(locator)}")` : `${root}.locator("[name=\\"${dq(locator)}\\"]")`;
    case 'label':   return `${root}.getByLabel("${dq(locator.replace(/^label:/i, ''))}")`;
    case 'placeholder': return `${root}.getByPlaceholder("${dq(locator)}")`;
    case 'nth': {
      // format: "css-selector:N"  e.g.  ".row:2"  (0-based index)
      const lastColon = locator.lastIndexOf(':');
      if (lastColon > 0) {
        const sel = locator.slice(0, lastColon);
        const idx = parseInt(locator.slice(lastColon + 1), 10);
        return `${root}.locator("${dq(sel)}").nth(${isNaN(idx) ? 0 : idx})`;
      }
      return `${root}.locator("${dq(locator)}").nth(0)`;
    }
    case 'last':    return `${root}.locator("${dq(locator)}").last()`;
    default:        return `${root}.locator("${dq(locator)}")`;   // css
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
  if (/^random\.firstName$/.test(inner)) {
    return `(['James','John','Robert','Michael','William','David','Richard','Joseph','Thomas','Charles','Mary','Patricia','Jennifer','Linda','Barbara','Elizabeth','Susan','Jessica','Sarah','Karen'][Math.floor(Math.random()*20)])`;
  }
  if (/^date\.today$/.test(inner)) {
    return 'new Date().toISOString().split("T")[0]';
  }

  // ── Fix existing tokens that had no handler (emitted as literals) ──────────────
  if (inner === 'random.uuid') {
    return 'crypto.randomUUID()';
  }
  if (inner === 'random.phone') {
    return '`+1-${Math.floor(Math.random()*900+100)}-${Math.floor(Math.random()*900+100)}-${Math.floor(Math.random()*9000+1000)}`';
  }
  if (inner === 'timestamp') {
    return 'Date.now().toString()';
  }
  if (inner === 'datetime') {
    return 'new Date().toISOString()';
  }
  if (inner === 'date') {
    return "new Date().toISOString().split('T')[0]";
  }
  if (inner === 'random.number') {
    return 'String(Math.floor(Math.random()*10000))';
  }

  // ── Person ─────────────────────────────────────────────────────────────────────
  if (inner === 'random.lastName') {
    return `(['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin'][Math.floor(Math.random()*20)])`;
  }
  if (inner === 'random.jobTitle') {
    return `(['Software Engineer','QA Engineer','Product Manager','DevOps Engineer','Data Analyst','UX Designer','Business Analyst','Scrum Master','Technical Lead','Project Manager'][Math.floor(Math.random()*10)])`;
  }
  if (inner === 'random.jobType') {
    return `(['Full-time','Part-time','Contract','Freelance','Internship','Remote','Hybrid'][Math.floor(Math.random()*7)])`;
  }
  if (inner === 'random.zodiacSign') {
    return `(['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'][Math.floor(Math.random()*12)])`;
  }
  if (inner === 'random.avatar') {
    return '`https://i.pravatar.cc/150?u=${Math.random().toString(36).substring(2,10)}`';
  }

  // ── Address ────────────────────────────────────────────────────────────────────
  if (inner === 'random.address') {
    return '`${Math.floor(Math.random()*9000+1000)} ${[\'Oak\',\'Maple\',\'Pine\',\'Cedar\',\'Elm\',\'Birch\',\'Walnut\',\'Ash\',\'Willow\',\'Spruce\'][Math.floor(Math.random()*10)]} ${[\'St\',\'Ave\',\'Blvd\',\'Dr\',\'Ln\',\'Rd\',\'Way\',\'Ct\'][Math.floor(Math.random()*8)]}`';
  }
  if (inner === 'random.city') {
    return `(['New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville','Fort Worth','Columbus','Charlotte'][Math.floor(Math.random()*15)])`;
  }
  if (inner === 'random.state') {
    return `(['California','Texas','Florida','New York','Pennsylvania','Illinois','Ohio','Georgia','North Carolina','Michigan','New Jersey','Virginia','Washington','Arizona','Massachusetts'][Math.floor(Math.random()*15)])`;
  }
  if (inner === 'random.country') {
    return `(['United States','United Kingdom','Canada','Australia','Germany','France','India','Japan','Brazil','Mexico','Italy','Spain','Netherlands','Sweden','Norway'][Math.floor(Math.random()*15)])`;
  }
  if (inner === 'random.zipCode') {
    return 'String(Math.floor(Math.random()*90000)+10000)';
  }

  // ── Internet ───────────────────────────────────────────────────────────────────
  if (inner === 'random.url') {
    return '`https://${[\'example\',\'test\',\'demo\',\'sample\',\'mysite\',\'webtest\'][Math.floor(Math.random()*6)]}.${[\'com\',\'org\',\'net\',\'io\',\'co\'][Math.floor(Math.random()*5)]}`';
  }
  if (inner === 'random.domainName') {
    return '`${[\'example\',\'testsite\',\'demoapp\',\'sampleco\',\'webapp\',\'qatest\'][Math.floor(Math.random()*6)]}.${[\'com\',\'org\',\'net\',\'io\',\'co\'][Math.floor(Math.random()*5)]}`';
  }
  if (inner === 'random.ipv4') {
    return '`${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*256)}`';
  }
  if (inner === 'random.ipv6') {
    return `Array.from({length:8},()=>Math.floor(Math.random()*65536).toString(16).padStart(4,'0')).join(':')`;
  }
  if (inner === 'random.mac') {
    return `Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join(':')`;
  }
  if (inner === 'random.userAgent') {
    return `(['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/119.0 Safari/537.36','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/118.0 Safari/537.36','Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'][Math.floor(Math.random()*4)])`;
  }

  // ── Finance ────────────────────────────────────────────────────────────────────
  if (inner === 'random.accountName') {
    return `((['James','John','Robert','Michael','William','David','Mary','Patricia','Jennifer','Linda'][Math.floor(Math.random()*10)]+' '+['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez'][Math.floor(Math.random()*10)]))`;
  }
  if (inner === 'random.accountNumber') {
    return 'String(Math.floor(Math.random()*9000000000)+1000000000)';
  }
  if (/^random\.creditCardNumber\(visa\)$/.test(inner)) {
    return `('4'+Array.from({length:15},()=>Math.floor(Math.random()*10)).join(''))`;
  }
  if (/^random\.creditCardNumber\(mastercard\)$/.test(inner)) {
    return `('5'+String(Math.floor(Math.random()*5)+1)+Array.from({length:14},()=>Math.floor(Math.random()*10)).join(''))`;
  }
  if (/^random\.creditCardNumber\(\w+\)$/.test(inner)) {
    return `('6'+Array.from({length:15},()=>Math.floor(Math.random()*10)).join(''))`;
  }
  if (inner === 'random.creditCardCVV') {
    return 'String(Math.floor(Math.random()*900)+100)';
  }
  if (inner === 'random.creditCardIssuer') {
    return `(['Visa','Mastercard','American Express','Discover','JCB','UnionPay'][Math.floor(Math.random()*6)])`;
  }

  // ── Travel ─────────────────────────────────────────────────────────────────────
  if (inner === 'random.airline') {
    return `(['American Airlines','Delta Air Lines','United Airlines','Southwest Airlines','British Airways','Emirates','Air France','Lufthansa','Singapore Airlines','Qantas'][Math.floor(Math.random()*10)])`;
  }
  if (inner === 'random.airplane') {
    return `(['Boeing 737','Boeing 747','Boeing 777','Airbus A320','Airbus A330','Airbus A380','Embraer E175','Bombardier CRJ-900'][Math.floor(Math.random()*8)])`;
  }
  if (inner === 'random.flightNumber') {
    return '`${[\'AA\',\'DL\',\'UA\',\'SW\',\'BA\',\'EK\',\'AF\',\'LH\'][Math.floor(Math.random()*8)]}${Math.floor(Math.random()*9000+1000)}`';
  }

  // ── Vehicle ────────────────────────────────────────────────────────────────────
  if (inner === 'random.vehicle') {
    return `(['Toyota Camry','Honda Civic','Ford Mustang','Chevrolet Silverado','BMW 3 Series','Mercedes C-Class','Audi A4','Tesla Model 3','Volkswagen Golf','Nissan Altima'][Math.floor(Math.random()*10)])`;
  }
  if (inner === 'random.bicycle') {
    return `(['Trek','Specialized','Giant','Cannondale','Scott','Bianchi','Cervelo','Pinarello','Raleigh','Fuji'][Math.floor(Math.random()*10)])`;
  }
  if (inner === 'random.color') {
    return `(['Red','Blue','Green','Yellow','Orange','Purple','Pink','Brown','Black','White','Grey','Cyan','Magenta','Teal','Navy'][Math.floor(Math.random()*15)])`;
  }
  if (inner === 'random.fuel') {
    return `(['Petrol','Diesel','Electric','Hybrid','LPG','CNG','Hydrogen'][Math.floor(Math.random()*7)])`;
  }
  if (inner === 'random.model') {
    return `(['Camry','Civic','Mustang','Silverado','3 Series','C-Class','A4','Model 3','Golf','Altima','Corolla','F-150','Accord','Escape','Explorer'][Math.floor(Math.random()*15)])`;
  }
  if (inner === 'random.vin') {
    return `Array.from({length:17},()=>'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'[Math.floor(Math.random()*33)]).join('')`;
  }
  if (inner === 'random.vrm') {
    return `(()=>{const l='ABCDEFGHJKLMNPRSTUVWXYZ';const r=()=>l[Math.floor(Math.random()*l.length)];return r()+r()+String(Math.floor(Math.random()*90)+10)+' '+r()+r()+r()})()`;
  }

  // ── Commerce ───────────────────────────────────────────────────────────────────
  if (inner === 'random.product' || inner === 'random.productName') {
    return `(['Wireless Headphones','Leather Wallet','Running Shoes','Coffee Maker','Yoga Mat','Bluetooth Speaker','Sunglasses','Smart Watch','Backpack','Water Bottle'][Math.floor(Math.random()*10)])`;
  }
  if (inner === 'random.productDescription') {
    return `(['High quality product for everyday use','Premium grade material with excellent durability','Lightweight and portable design','Energy efficient and eco-friendly','Advanced technology for superior performance'][Math.floor(Math.random()*5)])`;
  }
  if (inner === 'random.productMaterial') {
    return `(['Cotton','Polyester','Leather','Steel','Aluminum','Wood','Plastic','Rubber','Glass','Ceramic'][Math.floor(Math.random()*10)])`;
  }
  if (inner === 'random.department') {
    return `(['Engineering','Marketing','Sales','Finance','Human Resources','Operations','Legal','Customer Support','Product','Research & Development'][Math.floor(Math.random()*10)])`;
  }

  // ── Strings ────────────────────────────────────────────────────────────────────
  if (/^random\.word\((\d+)\)$/.test(inner)) {
    const len = inner.match(/\d+/)![0];
    return `Math.random().toString(36).substring(2).replace(/[^a-z]/g,'').substring(0,${len}).padEnd(${len},'a')`;
  }
  if (/^random\.string\((\d+)\)$/.test(inner)) {
    const len = inner.match(/\d+/)![0];
    return `Array.from({length:${len}},()=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*62)]).join('')`;
  }

  // ── Numbers ────────────────────────────────────────────────────────────────────
  if (inner === 'random.phoneimei') {
    return 'String(Math.floor(Math.random()*9e14)+1e14)';
  }

  // ── Date with offset (runtime) ─────────────────────────────────────────────────
  if (/^date\.offset\((-?\d+),([^)]+)\)$/.test(inner)) {
    const mo = inner.match(/^date\.offset\((-?\d+),([^)]+)\)$/)!;
    const days = mo[1];
    const fmt = mo[2];
    return `(()=>{const d=new Date();d.setDate(d.getDate()+(${days}));const Y=String(d.getFullYear()),Mo=String(d.getMonth()+1).padStart(2,'0'),D=String(d.getDate()).padStart(2,'0');return '${fmt}'.replace('YYYY',Y).replace('MM',Mo).replace('DD',D)})()`;
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
  pageVarName: string = 'page',
): string {
  const _raw = _generateStepCode(step, project, environment, allFunctions, dataMap, indent, runIdx);
  return pageVarName === 'page' ? _raw : _raw.replace(/\bpage\./g, `${pageVarName}.`);
}

function _generateStepCode(
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
  // frameCtx: non-null when step lives inside an iframe (set by SWITCH_FRAME in script)
  const fc = (step as any).frameContext as string | null | undefined;

  // OLD: buildLocatorExpr(lt, loc) — never passed frameCtx, iframe steps always searched top frame
  // const locExpr = loc ? buildLocatorExpr(lt, loc) : null;
  const locExpr = loc ? buildLocatorExpr(lt, loc, fc) : null;

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
    // OLD: only handled space-separated name; RIGHT_CLICK (underscore) now handled in v5 block below
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
      if (step.storeAs && locExpr) {
        // OLD: used fillVal inline — dynamic tokens produce different values for action vs store
        // return line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.fill(${fillVal});`)
        return line(
          `const ${pinValIdent(step.order)} = ${fillVal};\n` +
          `${indent}await ${locExpr}.waitFor({ state: 'visible' });\n` +
          `${indent}await ${locExpr}.fill(${pinValIdent(step.order)});`
        );
      }
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.fill(${fillVal});`)
        : line(`// FILL: missing locator`);
    }

    case 'CLEAR':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.clear();`)
        : line(`// CLEAR: missing locator`);

    case 'SELECT':
      if (step.storeAs && locExpr) {
        // OLD: used val inline — dynamic tokens produce different values for action vs store
        // return line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.selectOption(${val});`)
        return line(
          `const ${pinValIdent(step.order)} = ${val};\n` +
          `${indent}await ${locExpr}.waitFor({ state: 'visible' });\n` +
          `${indent}await ${locExpr}.selectOption(${pinValIdent(step.order)});`
        );
      }
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

    // Recorder v5 event types — mapped from extension content_script.js
    case 'PRESS_KEY':
    case 'PRESS KEY':
      // val is the chord string e.g. "Escape", "Control+S", "Tab"
      return line(`await page.keyboard.press(${val});`);

    case 'RIGHT_CLICK':
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.click({ button: 'right' });`)
        : line(`// RIGHT_CLICK: missing locator`);

    case 'DRAG': {
      // step.locator = source selector; step.value = target selector (set by recorder)
      const src = step.locator || '';
      const tgt = step.value   || '';
      if (src && tgt) {
        return line(`await page.dragAndDrop('${src.replace(/'/g, "\\'")}', '${tgt.replace(/'/g, "\\'")}');`);
      }
      return line(`// DRAG: missing source or target selector`);
    }

    case 'SCROLL': {
      // value is JSON { x, y } — scroll the element or window
      let sx = 0, sy = 0;
      try { const p = JSON.parse(step.value || '{}'); sx = p.x || 0; sy = p.y || 0; } catch {}
      if (locExpr && step.locator !== 'window') {
        return line(`await ${locExpr}.evaluate((el, [x, y]) => el.scrollTo(x, y), [${sx}, ${sy}]);`);
      }
      return line(`await page.evaluate(([x, y]) => window.scrollTo(x, y), [${sx}, ${sy}]);`);
    }

    // ── React Flow semantic actions ────────────────────────────────────────────
    // All RF cases read the live viewport transform at replay time and convert
    // flow-space coordinates back to screen-space — stable across zoom/pan/resize.
    case 'RF NODE DRAG':
    case 'RF_NODE_DRAG': {
      let nodeId = '', fromFlow = { x: 0, y: 0 }, toFlow = { x: 0, y: 0 };
      try {
        const d  = JSON.parse(step.value || '{}');
        nodeId   = d.nodeId   || '';
        fromFlow = d.fromFlow || { x: 0, y: 0 };
        toFlow   = d.toFlow   || { x: 0, y: 0 };
      } catch {}
      const i   = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await (async () => {`,
        `${i}  // Read live viewport transform — stable across zoom/pan changes`,
        `${i}  const __vp = await page.evaluate(() => {`,
        `${i}    const vEl = document.querySelector('.react-flow__viewport');`,
        `${i}    if (!vEl) return { tx: 0, ty: 0, zoom: 1 };`,
        `${i}    const raw = vEl.style.transform || getComputedStyle(vEl).transform || '';`,
        `${i}    const t = raw.match(/translate\\(([\\-\\d.]+)px,\\s*([\\-\\d.]+)px\\)\\s*scale\\(([\\-\\d.]+)\\)/);`,
        `${i}    if (t) return { tx: +t[1], ty: +t[2], zoom: +t[3] };`,
        `${i}    const m = raw.match(/matrix\\(([\\-\\d.]+),[^,]+,[^,]+,[^,]+,([\\-\\d.]+),([\\-\\d.]+)\\)/);`,
        `${i}    return m ? { tx: +m[2], ty: +m[3], zoom: +m[1] } : { tx: 0, ty: 0, zoom: 1 };`,
        `${i}  });`,
        `${i}  const __rfRoot = page.locator('.react-flow');`,
        `${i}  const __rfBox  = await __rfRoot.boundingBox();`,
        `${i}  if (!__rfBox) throw new Error('RF NODE DRAG: react-flow root not found');`,
        `${i}  const __fromX = __rfBox.x + ${fromFlow.x} * __vp.zoom + __vp.tx;`,
        `${i}  const __fromY = __rfBox.y + ${fromFlow.y} * __vp.zoom + __vp.ty;`,
        `${i}  const __toX   = __rfBox.x + ${toFlow.x}  * __vp.zoom + __vp.tx;`,
        `${i}  const __toY   = __rfBox.y + ${toFlow.y}  * __vp.zoom + __vp.ty;`,
        `${i}  await page.mouse.move(__fromX, __fromY);`,
        `${i}  await page.mouse.down();`,
        `${i}  await page.mouse.move(__toX, __toY, { steps: 20 });`,
        `${i}  await page.mouse.up();`,
        `${i}})();`,
      ].join('\n');
    }

    case 'RF CONNECT':
    case 'RF_CONNECT': {
      // Semantic edge creation: drag from source handle to target handle.
      // Uses node label/id to find elements — stable across layout changes.
      let sourceNode = '', sourceHandle = 'source', targetNode = '', targetHandle = 'target';
      let sourceNodeLabel = '', targetNodeLabel = '';
      let sourcePos  = '', targetPos = '';
      let fromFlow = { x: 0, y: 0 }, toFlow = { x: 0, y: 0 };
      try {
        const d    = JSON.parse(step.value || '{}');
        sourceNode = d.sourceNode   || '';
        sourceNodeLabel = d.sourceNodeLabel || '';
        sourceHandle = d.sourceHandle || 'source';
        sourcePos  = d.sourcePosition || '';
        targetNode = d.targetNode   || '';
        targetNodeLabel = d.targetNodeLabel || '';
        targetHandle = d.targetHandle || 'target';
        targetPos  = d.targetPosition || '';
        fromFlow   = d.fromFlow || { x: 0, y: 0 };
        toFlow     = d.toFlow   || { x: 0, y: 0 };
      } catch {}
      const i   = indent;
      const pfx = comment ? comment + '\n' : '';
      // Build handle selectors — use label (stable) not node ID (dynamic rf__node-node_N)
      const srcLookup = sourceNodeLabel || sourceNode;
      const tgtLookup = targetNodeLabel || targetNode;
      const srcNodeSel = srcLookup
        ? `.react-flow__node:has(*:text-is("${srcLookup.replace(/"/g, '\\"')}"), [data-id="${srcLookup.replace(/"/g, '\\"')}"]):first-of-type`
        : '.react-flow__node:first-of-type';
      const tgtNodeSel = tgtLookup
        ? `.react-flow__node:has(*:text-is("${tgtLookup.replace(/"/g, '\\"')}"), [data-id="${tgtLookup.replace(/"/g, '\\"')}"]):first-of-type`
        : '.react-flow__node:last-of-type';
      const srcHandleSel = sourcePos
        ? `[data-handlepos="${sourcePos}"][data-handletype="${sourceHandle}"]`
        : `.react-flow__handle.${sourceHandle}`;
      const tgtHandleSel = targetPos
        ? `[data-handlepos="${targetPos}"][data-handletype="${targetHandle}"]`
        : `.react-flow__handle.${targetHandle}`;
      return pfx + [
        `${i}await (async () => {`,
        `${i}  // RF CONNECT: drag source handle → target handle`,
        `${i}  // Read live viewport for coordinate fallback`,
        `${i}  const __vp = await page.evaluate(() => {`,
        `${i}    const vEl = document.querySelector('.react-flow__viewport');`,
        `${i}    const raw = vEl?.style.transform || '';`,
        `${i}    const t = raw.match(/translate\\(([\\-\\d.]+)px,\\s*([\\-\\d.]+)px\\)\\s*scale\\(([\\-\\d.]+)\\)/);`,
        `${i}    return t ? { tx: +t[1], ty: +t[2], zoom: +t[3] } : { tx: 0, ty: 0, zoom: 1 };`,
        `${i}  });`,
        `${i}  const __rfBox = await page.locator('.react-flow').boundingBox();`,
        `${i}  if (!__rfBox) throw new Error('RF CONNECT: react-flow root not found');`,
        `${i}  // Try semantic handle locators first, fall back to flow-space coords`,
        `${i}  try {`,
        `${i}    const __srcHandle = page.locator('${srcNodeSel}').locator('${srcHandleSel}');`,
        `${i}    const __tgtHandle = page.locator('${tgtNodeSel}').locator('${tgtHandleSel}');`,
        `${i}    await __srcHandle.waitFor({ state: 'visible', timeout: 5000 });`,
        `${i}    await __tgtHandle.waitFor({ state: 'visible', timeout: 5000 });`,
        `${i}    await __srcHandle.dragTo(__tgtHandle);`,
        `${i}  } catch {`,
        `${i}    // Fallback: flow-space coordinate drag`,
        `${i}    const __fX = __rfBox.x + ${fromFlow.x} * __vp.zoom + __vp.tx;`,
        `${i}    const __fY = __rfBox.y + ${fromFlow.y} * __vp.zoom + __vp.ty;`,
        `${i}    const __tX = __rfBox.x + ${toFlow.x}  * __vp.zoom + __vp.tx;`,
        `${i}    const __tY = __rfBox.y + ${toFlow.y}  * __vp.zoom + __vp.ty;`,
        `${i}    await page.mouse.move(__fX, __fY);`,
        `${i}    await page.mouse.down();`,
        `${i}    await page.mouse.move(__tX, __tY, { steps: 20 });`,
        `${i}    await page.mouse.up();`,
        `${i}  }`,
        `${i}})();`,
      ].join('\n');
    }

    case 'RF PAN':
    case 'RF_PAN': {
      let dx = 0, dy = 0;
      try { const d = JSON.parse(step.value || '{}'); dx = d.dx || 0; dy = d.dy || 0; } catch {}
      const i   = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await (async () => {`,
        `${i}  const __pane = page.locator('.react-flow__pane');`,
        `${i}  await __pane.waitFor({ state: 'visible' });`,
        `${i}  const __box  = await __pane.boundingBox();`,
        `${i}  if (!__box) throw new Error('RF PAN: pane not found');`,
        `${i}  const __cx = __box.x + __box.width  / 2;`,
        `${i}  const __cy = __box.y + __box.height / 2;`,
        `${i}  await page.mouse.move(__cx, __cy);`,
        `${i}  await page.mouse.down();`,
        `${i}  await page.mouse.move(__cx + ${dx}, __cy + ${dy}, { steps: 15 });`,
        `${i}  await page.mouse.up();`,
        `${i}})();`,
      ].join('\n');
    }

    case 'RF DROP NODE':
    case 'RF_DROP_NODE': {
      let nodeType = 'node', dropFlow = { x: 0, y: 0 };
      try {
        const d   = JSON.parse(step.value || '{}');
        nodeType  = d.nodeType  || 'node';
        dropFlow  = d.dropFlow  || { x: 0, y: 0 };
      } catch {}
      const i   = indent;
      const pfx = comment ? comment + '\n' : '';
      // OLD: page.evaluate / page.locator — ran in top frame, missed iframe canvas entirely
      // NEW: when frameContext set, scope all RF locators to frameLocator; use locator.evaluate for viewport transform
      const rfRoot = fc ? `page.frameLocator('${fc}')` : `page`;
      const fcExpr = fc ? `'${fc}'` : `null`;
      return pfx + [
        `${i}await (async () => {`,
        `${i}  // RF DROP NODE: fire dragstart on sidebar node-box to populate dataTransfer,`,
        `${i}  // then drop on pane — browser security allows getData() only in same-dt sequence`,
        `${i}  const __rfRoot = ${rfRoot};`,
        `${i}  const __vp = await __rfRoot.locator('.react-flow__viewport').evaluate((vEl: HTMLElement) => {`,
        `${i}    const raw = vEl?.style.transform || '';`,
        `${i}    const t = raw.match(/translate\\(([\\-\\d.]+)px,\\s*([\\-\\d.]+)px\\)\\s*scale\\(([\\-\\d.]+)\\)/);`,
        `${i}    return t ? { tx: +t[1], ty: +t[2], zoom: +t[3] } : { tx: 0, ty: 0, zoom: 1 };`,
        `${i}  });`,
        `${i}  const __rfBox = await __rfRoot.locator('.react-flow').boundingBox();`,
        `${i}  if (!__rfBox) throw new Error('RF DROP NODE: react-flow root not found');`,
        `${i}  const __dropX = __rfBox.x + ${dropFlow.x} * __vp.zoom + __vp.tx;`,
        `${i}  const __dropY = __rfBox.y + ${dropFlow.y} * __vp.zoom + __vp.ty;`,
        `${i}  // OLD: new DataTransfer() + dispatchEvent — browser clears getData() outside trusted drag`,
        `${i}  // NEW: dragstart on sidebar source populates dt, then drop on pane reads same dt object`,
        `${i}  await __rfRoot.locator('.react-flow__pane').evaluate((pane, [x, y, nt]) => {`,
        `${i}    const doc = pane.ownerDocument;`,
        `${i}    const win = doc.defaultView as any;`,
        `${i}    const srcBox = Array.from(doc.querySelectorAll<HTMLElement>('[draggable="true"]'))`,
        `${i}      .find(el => (el.innerText || el.textContent || '').trim() === nt);`,
        `${i}    if (!srcBox) return;`,
        `${i}    const sr = srcBox.getBoundingClientRect();`,
        `${i}    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;`,
        `${i}    const opts = (cx: number, cy: number) => ({ bubbles: true, cancelable: true, clientX: cx, clientY: cy, screenX: cx, screenY: cy });`,
        `${i}    const dt = new win.DataTransfer();`,
        `${i}    srcBox.dispatchEvent(new win.DragEvent('dragstart', { ...opts(sx, sy), dataTransfer: dt }));`,
        `${i}    pane.dispatchEvent(new win.DragEvent('dragenter', { ...opts(x, y), dataTransfer: dt }));`,
        `${i}    pane.dispatchEvent(new win.DragEvent('dragover',  { ...opts(x, y), dataTransfer: dt }));`,
        `${i}    pane.dispatchEvent(new win.DragEvent('drop',      { ...opts(x, y), dataTransfer: dt }));`,
        `${i}  }, [__dropX, __dropY, '${nodeType.replace(/'/g, "\\'")}'] as [number, number, string]);`,
        `${i}})();`,
      ].join('\n');
    }

    case 'CANVAS DRAG':
    case 'CANVAS_DRAG': {
      // Coordinate-based drag on a <canvas> element (flow builders, charts, diagram editors).
      // value = JSON { fromX, fromY, toX, toY } relative to canvas top-left.
      // Uses page.mouse for pixel-precise control; 20 intermediate steps for smooth drag.
      let fromX = 0, fromY = 0, toX = 0, toY = 0;
      try {
        const cd = JSON.parse(step.value || '{}');
        fromX = cd.fromX || 0; fromY = cd.fromY || 0;
        toX   = cd.toX   || 0; toY   = cd.toY   || 0;
      } catch {}
      if (!locExpr) return line(`// CANVAS DRAG: missing canvas locator`);
      const i = indent;
      const pfx = comment ? comment + '\n' : '';
      return pfx + [
        `${i}await (async () => {`,
        `${i}  await ${locExpr}.waitFor({ state: 'visible' });`,
        `${i}  const __box = await ${locExpr}.boundingBox();`,
        `${i}  if (!__box) throw new Error('CANVAS DRAG: canvas element not found');`,
        `${i}  const __absFromX = __box.x + ${fromX};`,
        `${i}  const __absFromY = __box.y + ${fromY};`,
        `${i}  const __absToX   = __box.x + ${toX};`,
        `${i}  const __absToY   = __box.y + ${toY};`,
        `${i}  await page.mouse.move(__absFromX, __absFromY);`,
        `${i}  await page.mouse.down();`,
        `${i}  await page.mouse.move(__absToX, __absToY, { steps: 20 });`,
        `${i}  await page.mouse.up();`,
        `${i}})();`,
      ].join('\n');
    }

    case 'CLICK AT COORDS':
    case 'CLICK_AT_COORDS': {
      // value is JSON { x, y } relative to element bounds
      let cx = 0, cy = 0;
      try { const p = JSON.parse(step.value || '{}'); cx = p.x || 0; cy = p.y || 0; } catch {}
      return locExpr
        ? line(`await ${locExpr}.waitFor({ state: 'visible' });\n${indent}await ${locExpr}.click({ position: { x: ${cx}, y: ${cy} } });`)
        : line(`// CLICK AT COORDS: missing locator`);
    }

    case 'SWITCH_FRAME': {
      // Emitted when user clicks a cross-origin iframe — signals frame context switch.
      // Generates a frameLocator variable for subsequent steps to use.
      const frameSel = step.locator || step.value || 'iframe';
      return line(`// Switch to cross-origin frame — use frame.locator() for elements inside\nconst frame = page.frameLocator('${frameSel.replace(/'/g, "\\'")}');`);
    }

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

    case 'SCROLL TO': {
      // Recorder v5 SCROLL: value is JSON {x,y} — scroll to position
      // Manual keyword SCROLL TO with a locator: scroll element into view
      let ssx = 0, ssy = 0;
      let hasPosVal = false;
      try { const sp = JSON.parse(step.value || ''); ssx = sp.x || 0; ssy = sp.y || 0; hasPosVal = true; } catch {}
      if (hasPosVal) {
        if (locExpr && step.locator && step.locator !== 'window') {
          return line(`await ${locExpr}.evaluate((el, [x, y]) => el.scrollTo(x, y), [${ssx}, ${ssy}]);`);
        }
        return line(`await page.evaluate(([x, y]) => window.scrollTo(x, y), [${ssx}, ${ssy}]);`);
      }
      return locExpr
        ? line(`await ${locExpr}.scrollIntoViewIfNeeded();`)
        : line(`await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`);
    }

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
      // Use the recorder-captured locator when available (e.g. #MessageAlert, #MessageSuccess)
      // Fall back to generic toast selector only when no specific locator was captured
      const toastSel2 = `[role="alert"], [role="status"], [class*="toast"], [class*="snackbar"], [class*="flash"], [class*="notification"]`;
      const toastExpr = locExpr || `page.locator(${JSON.stringify(toastSel2)}).first()`;
      return val
        ? line(`await ${toastExpr}.waitFor({ state: 'visible', timeout: 8000 });\n${indent}await expect(${toastExpr}).toContainText(${val}, { ignoreCase: true });`)
        : line(`await ${toastExpr}.waitFor({ state: 'visible', timeout: 8000 });`);
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

    case '':
      // Empty keyword — step has no action defined; emit nothing so test body stays valid
      return comment ? comment : '';

    default:
      return comment
        ? `${comment}\n${indent}// ⚠ Unknown keyword: ${kw}`
        : `${indent}// ⚠ Unknown keyword: ${kw}`;
  }
}

// ── Temp variable for pinned step value ──────────────────────────────────────
/** Temp variable name used to capture a pinned step's resolved value at runtime */
function pinValIdent(order: number): string { return `_pinVal_${order}`; }

// Emit a storeAs line after a step if the 📌 pin is set
// OLD: storeAsLine stored raw step.value template for FILL/TYPE (e.g. '{{random.text(8)}}') instead of resolved value
// function storeAsLine(step: ScriptStep, locExpr: string | null, indent: string): string {
//   const varName = (step.storeAs || '').trim();
//   if (!varName || step.keyword?.toUpperCase() === 'SET VARIABLE') return '';
//   const store = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
//   const kw = (step.keyword || '').toUpperCase();
//   if (kw === 'FILL' || kw === 'TYPE') {
//     const raw = (step.value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
//     return `${indent}${store}['${varName}'] = '${raw}'; // 📌 pinned`;
//   }
//   if (locExpr) {
//     return `${indent}${store}['${varName}'] = (await ${locExpr}.innerText().catch(() => '')).trim(); // 📌 pinned`;
//   }
//   return '';
// }
function storeAsLine(step: ScriptStep, locExpr: string | null, indent: string, val?: string): string {
  const varName = (step.storeAs || '').trim();
  if (!varName || step.keyword?.toUpperCase() === 'SET VARIABLE') return '';
  const store = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
  const kw = (step.keyword || '').toUpperCase();
  if ((kw === 'FILL' || kw === 'TYPE' || kw === 'SELECT') && val) {
    // val resolved by valueExpr() — caller emits the _pinVal_N temp var and action, we just store it
    // OLD: return `${indent}${store}['${varName}'] = _pinVal_${step.order}; // 📌 pinned`;
    return `${indent}${store}['${varName}'] = ${pinValIdent(step.order)}; // 📌 pinned`;
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
  const { suiteName, suiteId, runId, scripts, project, environment, allFunctions,
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
  lines.push(`// Test index counter — used for QA_TEST_ID logging (global across all browsers)`);
  lines.push(`let __testIdx = -1;`);
  if (fastMode && fastModeSteps.length > 0) {
    lines.push(`// Fast Mode: page+context registry so afterEach can screenshot and close`);
    lines.push(`const __fastPages = new Map<string, { page: import('@playwright/test').Page, ctx: import('@playwright/test').BrowserContext }>();`);
  }
  lines.push(`// Per-browser counters — used for FAILED-<idx>-<browser>.png to match attachFailureScreenshots()`);
  lines.push(`const __browserIdx: Record<string, number> = { chromium: -1, firefox: -1, webkit: -1 };`);
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
  lines.push(`    case 'label':        return page.getByLabel(selector.replace(/^label:/i, ''));`);
  lines.push(`    case 'placeholder':  return page.getByPlaceholder(selector);`);
  lines.push(`    case 'text':         return page.getByText(selector, { exact: false });`);
  lines.push(`    case 'xpath':        return page.locator('xpath=' + selector);`);
  lines.push(`    case 'id':           return page.locator('#' + selector.replace(/^#/, ''));`);
  lines.push(`    case 'name':         return selector.includes('[name=') ? page.locator(selector) : page.locator('[name="' + selector.replace(/"/g, '\\\\"') + '"]');`);
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
  lines.push(`    // GAP13 — new locator-based keywords wired into T2/T3 healing dispatch`);
  lines.push(`    case 'RIGHT CLICK':    await loc.waitFor({ state: 'visible', timeout: 5000 }); await loc.click({ button: 'right' }); break;`);
  lines.push(`    case 'DRAG': {`);
  lines.push(`      // value = target selector; loc = source element`);
  lines.push(`      await loc.waitFor({ state: 'visible', timeout: 5000 });`);
  lines.push(`      const __dragBox_heal = await loc.boundingBox();`);
  lines.push(`      if (__dragBox_heal) {`);
  lines.push(`        const __tgtLoc_heal = page.locator(value).first();`);
  lines.push(`        const __tgtBox_heal = await __tgtLoc_heal.boundingBox();`);
  lines.push(`        if (__tgtBox_heal) { await page.dragAndDrop(await loc.evaluate((el: any) => el.tagName), value); }`);
  lines.push(`      } break; }`);
  lines.push(`    case 'CLICK AT COORDS': {`);
  lines.push(`      await loc.waitFor({ state: 'visible', timeout: 5000 });`);
  lines.push(`      try { const __pos_heal = JSON.parse(value); await loc.click({ position: { x: __pos_heal.x, y: __pos_heal.y } }); } catch { await loc.click(); }`);
  lines.push(`      break; }`);
  lines.push(`    case 'CANVAS DRAG': {`);
  lines.push(`      // loc = canvas element; value = JSON {fromX,fromY,toX,toY} relative to element`);
  lines.push(`      await loc.waitFor({ state: 'visible', timeout: 5000 });`);
  lines.push(`      try {`);
  lines.push(`        const __cd_heal = JSON.parse(value); const __box_heal = await loc.boundingBox();`);
  lines.push(`        if (__box_heal) {`);
  lines.push(`          await page.mouse.move(__box_heal.x + __cd_heal.fromX, __box_heal.y + __cd_heal.fromY);`);
  lines.push(`          await page.mouse.down();`);
  lines.push(`          await page.mouse.move(__box_heal.x + __cd_heal.toX, __box_heal.y + __cd_heal.toY, { steps: 20 });`);
  lines.push(`          await page.mouse.up();`);
  lines.push(`        }`);
  lines.push(`      } catch { await loc.click(); } break; }`);
  lines.push(`    case 'RF NODE DRAG': {`);
  lines.push(`      // loc = RF pane; value = JSON {nodeId,fromFlowX,fromFlowY,toFlowX,toFlowY}`);
  lines.push(`      try {`);
  lines.push(`        const __rnd_heal = JSON.parse(value);`);
  lines.push(`        const __rfBox_heal = await loc.boundingBox();`);
  lines.push(`        const __vp_heal = await page.evaluate(() => { const t = document.querySelector('.react-flow__viewport'); const m = t ? (getComputedStyle(t).transform || '') : ''; const nums = m.match(/matrix\\(([^)]+)\\)/); const p = nums ? nums[1].split(',').map(Number) : [1,0,0,1,0,0]; return { zoom: p[0], tx: p[4], ty: p[5] }; });`);
  lines.push(`        if (__rfBox_heal && __vp_heal) {`);
  lines.push(`          const sx = __rfBox_heal.x + __rnd_heal.fromFlowX * __vp_heal.zoom + __vp_heal.tx;`);
  lines.push(`          const sy = __rfBox_heal.y + __rnd_heal.fromFlowY * __vp_heal.zoom + __vp_heal.ty;`);
  lines.push(`          const tx = __rfBox_heal.x + __rnd_heal.toFlowX  * __vp_heal.zoom + __vp_heal.tx;`);
  lines.push(`          const ty = __rfBox_heal.y + __rnd_heal.toFlowY  * __vp_heal.zoom + __vp_heal.ty;`);
  lines.push(`          await page.mouse.move(sx, sy); await page.mouse.down();`);
  lines.push(`          await page.mouse.move(tx, ty, { steps: 20 }); await page.mouse.up();`);
  lines.push(`        }`);
  lines.push(`      } catch { await loc.click(); } break; }`);
  lines.push(`    case 'RF CONNECT': {`);
  lines.push(`      // loc = RF container; value = JSON {sourceNode,sourceHandle,targetNode,targetHandle}`);
  lines.push(`      try {`);
  lines.push(`        const __rc_heal = JSON.parse(value);`);
  lines.push(`        const __srcH_heal = loc.locator(\`[data-nodeid="\${__rc_heal.sourceNode}"][data-handleid="\${__rc_heal.sourceHandle}"]\`).first();`);
  lines.push(`        const __tgtH_heal = loc.locator(\`[data-nodeid="\${__rc_heal.targetNode}"][data-handleid="\${__rc_heal.targetHandle}"]\`).first();`);
  lines.push(`        await __srcH_heal.dragTo(__tgtH_heal);`);
  lines.push(`      } catch { await loc.click(); } break; }`);
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
  lines.push(`test.describe.serial('${suiteName.replace(/'/g, "\\'")}', () => {`);
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
    // OLD: test.beforeAll(async ({ browser }) => { — Firefox worker closes context → Playwright 1.58 tears down shared browser
    lines.push(`  test.beforeAll(async ({ browser }, testInfo) => {`);
    lines.push(`    if (!testInfo.project.name.toLowerCase().includes('chromium')) return;`);
    lines.push(`    // Step 1: authenticate and persist storage state`);
    lines.push(`    const __authCtx  = await browser.newContext({ ignoreHTTPSErrors: true });`);
    lines.push(`    const __authPage = await __authCtx.newPage();`);
    lines.push(`    await __authPage.goto('${escUrl}', { waitUntil: 'domcontentloaded' });`);
    lines.push(`    await __authPage.waitForLoadState('domcontentloaded');`);
    for (let hi = 0; hi < fastModeSteps.length; hi++) {
      const ps   = hookPseudoStep(fastModeSteps[hi], hi);
      const code = generateStepCode(ps, project, environment, allFunctions, dataMap, '    ', 0, '__authPage');
      if (code) lines.push(code);
    }
    // OLD: storageState saved immediately after login click — captured mid-OIDC handshake cookies only
    // OLD: waitForLoadState('networkidle') also failed — resolves on departed page, not final redirect target
    // NEW: wait until page URL returns to app domain (handles SSO/OIDC/OAuth/direct — no hardcoding)
    lines.push(`    await __authPage.waitForURL('${escUrl}**', { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});`);
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
  lines.push(`  test.afterEach(async ({ page: __fixturePage, browserName }, testInfo) => {`);
  lines.push(`    const __curIdx = __testIdx; // captured at afterEach time (global, used for QA_TEST_ID)`);
  lines.push(`    const __brIdx  = __browserIdx[browserName] ?? __curIdx; // per-browser index for FAILED filename`);
  if (fastMode && fastModeSteps.length > 0) {
    // Fast Mode: fixture page is blank — use the real app page registered by the test body
    lines.push(`    // Fast Mode: resolve real page from registry (fixture page is blank)`);
    lines.push(`    const __fastEntry = __fastPages.get(browserName + ':' + __brIdx);`);
    lines.push(`    const __ssPage = __fastEntry?.page ?? __fixturePage;`);
  } else {
    lines.push(`    const __ssPage = __fixturePage;`);
  }
  lines.push(`    if (testInfo.status !== testInfo.expectedStatus) {`);
  lines.push(`      // Use per-browser index — matches attachFailureScreenshots() grouping in run-spawner`);
  lines.push(`      const __failPath = \`\${__SS_DIR}/FAILED-\${__brIdx}-\${browserName}.png\`;`);
  lines.push(`      await __ssPage.screenshot({ path: __failPath, fullPage: true }).catch(() => {});`);
  lines.push(`      await testInfo.attach('failure-screenshot', { path: __failPath, contentType: 'image/png' }).catch(() => {});`);
  lines.push(`    }`);
  if (fastMode && fastModeSteps.length > 0) {
    // Close Fast Mode context here — after screenshot, before next test
    lines.push(`    // Fast Mode: close context after screenshot (not in test body)`);
    lines.push(`    if (__fastEntry) {`);
    lines.push(`      // Save video to predictable path before closing context`);
    lines.push(`      const __vid = __fastEntry.page.video();`);
    lines.push(`      await __fastEntry.ctx.close().catch(() => {});`);
    lines.push(`      if (__vid) { await __vid.saveAs(\`\${__SS_DIR}/\${__brIdx}-\${browserName}.webm\`).catch(() => {}); }`);
    lines.push(`      __fastPages.delete(browserName + ':' + __brIdx);`);
    lines.push(`    }`);
  }
  lines.push(`    // Attach captured console errors to Playwright HTML report`);
  // OLD: used fixture `page` — in Fast Mode this is blank, not the real app page
  lines.push(`    const __errs = (__ssPage as any).__qaConsoleErrors as string[] | undefined;`);
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
    // TRACE EVIDENCE (run d3768256): beforeAll({ browser }) shares the project's browser instance.
    // Firefox worker: beforeAll opens __psCtx, closes it → Playwright 1.58 tears down the shared
    // Firefox browser → test's page fixture fails "browserContext.newPage: browser has been closed".
    // FIX: beforeAll with NO fixtures. Use require('playwright').chromium directly — this is a raw
    // Node.js require, completely outside Playwright's fixture system. No fixture lifecycle interaction.
    // Only runs prescan on chromium worker (testInfo.project.name check). Firefox/WebKit workers
    // hit the early return immediately with zero browser activity.
    lines.push(`  // P5: Pre-scan — chromium only, raw browser outside fixture system (no fixture lifecycle conflict)`);
    lines.push(`  test.beforeAll(async ({}, testInfo) => {`);
    lines.push(`    if (!testInfo.project.name.toLowerCase().includes('chromium')) return;`);
    lines.push(`    try {`);
    lines.push(`      // eslint-disable-next-line @typescript-eslint/no-var-requires`);
    lines.push(`      const { chromium } = require('playwright') as typeof import('playwright');`);
    lines.push(`      const __psBrowser = await chromium.launch({ headless: true });`);
    lines.push(`      const __psCtx     = await __psBrowser.newContext({ ignoreHTTPSErrors: true });`);
    lines.push(`      const __psPage    = await __psCtx.newPage();`);
    lines.push(`      await __psPage.goto('${esc(prescanUrl)}', { waitUntil: 'domcontentloaded', timeout: 20000 });`);
    lines.push(`      await __psPage.waitForTimeout(1500);`);
    lines.push(`      const __psCandidates = await __psPage.evaluate(__DOM_SCAN).catch(() => []);`);
    lines.push(`      await __psCtx.close().catch(() => {});`);
    lines.push(`      await __psBrowser.close().catch(() => {});`);
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
      // Compute stable testId for this test (suiteId + full test title, browser-agnostic)
      const fullTestTitle = `${testName}${runLabel}`;
      const testId = makeTestId(suiteId, fullTestTitle);
      if (isFastMode) {
        lines.push(`  test('${testName}${runLabel.replace(/'/g, "\\'")}', async ({ browser, browserName }) => {`);
        lines.push(`    __testIdx++;`);
        lines.push(`    __browserIdx[browserName] = (__browserIdx[browserName] ?? -1) + 1;`);
        lines.push(`    console.log(\`[QA_TEST_ID]:\${__testIdx}:${testId}\`);`);
        lines.push(`    const __browser = browserName;`);
        lines.push(`    const __sessionVars: Record<string, string> = {};`);
        lines.push(`    // Fast Mode: open context with saved auth state — beforeAll wrote this file`);
        lines.push(`    const __fastCtx  = await browser.newContext({ storageState: __AUTH_STATE, ignoreHTTPSErrors: true, recordVideo: { dir: __SS_DIR } });`);
        lines.push(`    const page       = await __fastCtx.newPage();`);
        lines.push(`    __fastPages.set(browserName + ':' + (__browserIdx[browserName] ?? 0), { page, ctx: __fastCtx });`);
        // OLD: no navigation after newPage — page stayed at about:blank, scripts failed at step 2
        const __fastAppUrl = environment?.url || project.appUrl || '';
        const __fastEscUrl = __fastAppUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        lines.push(`    await page.goto('${__fastEscUrl}', { waitUntil: 'domcontentloaded' });`);
      } else {
        lines.push(`  test('${testName}${runLabel.replace(/'/g, "\\'")}', async ({ page, browserName }) => {`);
        lines.push(`    __testIdx++;`);
        lines.push(`    __browserIdx[browserName] = (__browserIdx[browserName] ?? -1) + 1;`);
        lines.push(`    console.log(\`[QA_TEST_ID]:\${__testIdx}:${testId}\`);`);
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

      // Frame context tracker — updated by SWITCH_FRAME steps, consumed by locator expressions.
      // null = top frame (page); string = iframe selector e.g. "#flowIframe"
      let __activeFrameCtx: string | null = null;

      for (let si = 0; si < sortedSteps.length; si++) {
        const step     = sortedSteps[si];
        const kw       = (step.keyword || '').toUpperCase().trim();

        // Track frame context: SWITCH_FRAME updates active frame for all subsequent steps.
        // SWITCH_MAIN (auto-emitted by recorder) resets to top frame — equivalent to empty selector.
        // "_top", "top", or empty value = return to top frame (page).
        if (kw === 'SWITCH_FRAME' || kw === 'SWITCH FRAME') {
          const frameSel = step.locator || step.value || '';
          __activeFrameCtx = (!frameSel || frameSel === '_top' || frameSel === 'top') ? null : frameSel;
        } else if (kw === 'SWITCH_MAIN' || kw === 'SWITCH MAIN') {
          __activeFrameCtx = null;
        }
        // Propagate active frame context to the step so _generateStepCode uses correct root
        // Skip frame-switch steps themselves — they don't target elements
        const isFrameSwitch = kw === 'SWITCH_FRAME' || kw === 'SWITCH FRAME' || kw === 'SWITCH_MAIN' || kw === 'SWITCH MAIN';
        if (__activeFrameCtx && !isFrameSwitch) {
          (step as any).frameContext = __activeFrameCtx;
        }
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
          // OLD: storeAsLine(step, ...) — did not pass val, FILL/TYPE stored raw template
          // const pinLine = storeAsLine(step, step.locator ? buildLocatorExpr(step.locatorType || 'css', step.locator) : null, '        ');
          const pinLine = storeAsLine(step, step.locator ? buildLocatorExpr(step.locatorType || 'css', step.locator, (step as any).frameContext) : null, '        ', valueExpr(step, dataMap, runIdx));
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
          // OLD: storeAsLine(step, ...) — did not pass val, FILL/TYPE stored raw template
          // const pinLine = storeAsLine(step, step.locator ? buildLocatorExpr(step.locatorType || 'css', step.locator) : null, '      ');
          const pinLine = storeAsLine(step, step.locator ? buildLocatorExpr(step.locatorType || 'css', step.locator, (step as any).frameContext) : null, '      ', valueExpr(step, dataMap, runIdx));
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
        // OLD: closed __fastCtx here — caused afterEach fixture page to be blank + status mismatch for passing tests
        // context is now closed in afterEach after screenshot is taken
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
  lines.push(`import { test, expect } from '@playwright/test';`);
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
  // OLD: __buildLocator(page, lt, loc) — always used page as root, broke iframe steps
  // NEW: accepts optional frameCtx — when set, scopes to page.frameLocator(frameCtx)
  lines.push(`function __buildLocator(page: any, lt: string, loc: string, frameCtx?: string | null): any {`);
  lines.push(`  const root = frameCtx ? page.frameLocator(frameCtx) : page;`);
  lines.push(`  switch ((lt || 'css').toLowerCase()) {`);
  lines.push(`    case 'text':        return root.getByText(loc);`);
  lines.push(`    case 'testid':      return root.getByTestId(loc);`);
  lines.push(`    case 'label':       return root.getByLabel(loc.replace(/^label:/i, ''));`);
  lines.push(`    case 'placeholder': return root.getByPlaceholder(loc);`);
  lines.push(`    case 'title':       return root.getByTitle(loc);`);
  lines.push(`    case 'xpath':       return root.locator('xpath=' + loc);`);
  lines.push(`    case 'id':          return root.locator('#' + loc.replace(/^#/, ''));`);
  lines.push(`    case 'name':        return loc.includes('[name=') ? root.locator(loc) : root.locator('[name="' + loc + '"]');`);
  lines.push(`    case 'role': {`);
  lines.push(`      const ci = loc.lastIndexOf(':');`);
  lines.push(`      if (ci > -1) return root.getByRole(loc.slice(0, ci) as any, { name: loc.slice(ci + 1) });`);
  lines.push(`      return root.getByRole(loc as any);`);
  lines.push(`    }`);
  lines.push(`    case 'nth': {`);
  lines.push(`      const ci = loc.lastIndexOf(':');`);
  lines.push(`      if (ci > -1) return root.locator(loc.slice(0, ci)).nth(parseInt(loc.slice(ci + 1), 10) || 0);`);
  lines.push(`      return root.locator(loc).nth(0);`);
  lines.push(`    }`);
  lines.push(`    case 'last':        return root.locator(loc).last();`);
  lines.push(`    default:            return root.locator(loc);  // css`);
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
  lines.push(`  const color = ['CLICK', 'DBLCLICK', 'RIGHT CLICK', 'RIGHT_CLICK'].includes(kw) ? '#ef4444'`);
  lines.push(`    : ['FILL', 'TYPE', 'CLEAR'].includes(kw)                               ? '#3b82f6'`);
  lines.push(`    : ['SELECT', 'CHECK', 'UNCHECK'].includes(kw)                          ? '#f97316'`);
  lines.push(`    : ['HOVER', 'HOVER AND CLICK', 'FOCUS'].includes(kw)                  ? '#eab308'`);
  lines.push(`    : kw.startsWith('ASSERT')                                              ? '#22c55e'`);
  lines.push(`    : ['DRAG', 'CANVAS DRAG', 'CANVAS_DRAG', 'RF NODE DRAG', 'RF_NODE_DRAG', 'RF CONNECT', 'RF_CONNECT', 'RF DROP NODE', 'RF_DROP_NODE'].includes(kw) ? '#ec4899'`);
  lines.push(`    : ['RF PAN', 'RF_PAN', 'SCROLL TO', 'SCROLL_TO', 'SCROLL INTO VIEW'].includes(kw) ? '#06b6d4'`);
  lines.push(`    : ['PRESS KEY', 'PRESS_KEY', 'SWITCH FRAME', 'SWITCH_FRAME', 'SWITCH MAIN', 'SWITCH_MAIN', 'CLICK AT COORDS', 'CLICK_AT_COORDS'].includes(kw) ? '#a855f7'`);
  lines.push(`    : '#8b5cf6';`);
  lines.push(`  try {`);
  lines.push(`    let loc: any;`);
  lines.push(`    switch (locType) {`);
  lines.push(`      case 'text':        loc = page.getByText(locVal, { exact: false }); break;`);
  lines.push(`      case 'testid':      loc = page.getByTestId(locVal); break;`);
  lines.push(`      case 'label':       loc = page.getByLabel(locVal.replace(/^label:/i, '')); break;`);
  lines.push(`      case 'placeholder': loc = page.getByPlaceholder(locVal); break;`);
  lines.push(`      case 'xpath':       loc = page.locator('xpath=' + locVal); break;`);
  lines.push(`      case 'id':          loc = page.locator('#' + locVal.replace(/^#/, '')); break;`);
  lines.push(`      case 'name':        loc = locVal.includes('[name=') ? page.locator(locVal) : page.locator('[name="' + locVal.replace(/"/g, '\\\\"') + '"]'); break;`);
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

  // Frame context tracker for debug spec — updated by SWITCH_FRAME steps
  let __dbgActiveFrameCtx: string | null = null;

  for (let si = 0; si < sortedSteps.length; si++) {
    const step = sortedSteps[si];
    const kw      = (step.keyword || '').toUpperCase().trim();
    const loc     = step.locator || '';
    const lt      = step.locatorType || 'css';
    const dispVal = debugValueDisplay(step).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const dispLoc = loc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const kwSlug  = kw.replace(/\s+/g, '_');

    // Track frame context across steps in debug spec
    if (kw === 'SWITCH_FRAME' || kw === 'SWITCH FRAME') {
      const frameSel = step.locator || step.value || '';
      __dbgActiveFrameCtx = (!frameSel || frameSel === '_top' || frameSel === 'top') ? null : frameSel;
    } else if (kw === 'SWITCH_MAIN' || kw === 'SWITCH MAIN') {
      __dbgActiveFrameCtx = null;
    }
    // frameContext for this step: use step's own value if set (from recorder), else active tracker
    const stepFc = (step as any).frameContext as string | null | undefined ?? __dbgActiveFrameCtx;

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
    // frameContext: bake in the step's frame context at generation time; allow override via gate (Apply & Retry)
    const fcLiteral = stepFc ? `'${stepFc.replace(/'/g, "\\'")}'` : 'null';
    lines.push(`        let __patchedFc_${step.order}   = __gate_${step.order}.frameContext ?? ${fcLiteral};`);
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
      lines.push(`            const __retryLoc_${o} = __buildLocator(page, __patchedLt_${o}, __patchedLoc_${o}, __patchedFc_${o});`);
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
      // ── Locator-based ASSERT cases missing from original switch ──────────────
      lines.push(`              case 'ASSERT HIDDEN': case 'ASSERTHIDDEN': case 'ASSERT NOT VISIBLE': case 'ASSERTNOTVISIBLE':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'attached', timeout: 10000 });`);
      lines.push(`                await expect(__retryLoc_${o}).toBeHidden(); break;`);
      lines.push(`              case 'ASSERT CONTAINS':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                { const t = await __retryLoc_${o}.innerText(); if (!t.includes(__patchedVal_${o})) throw new Error('Text mismatch: expected "' + __patchedVal_${o} + '" in "' + t + '"'); } break;`);
      lines.push(`              case 'ASSERT NOT CONTAINS':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                { const t = await __retryLoc_${o}.innerText(); if (t.includes(__patchedVal_${o})) throw new Error('Text should NOT contain "' + __patchedVal_${o} + '" but got "' + t + '"'); } break;`);
      lines.push(`              case 'ASSERT UNCHECKED':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                { const chk = await __retryLoc_${o}.isChecked(); if (chk) throw new Error('Element should be unchecked'); } break;`);
      lines.push(`              case 'ASSERT ENABLED':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await expect(__retryLoc_${o}).toBeEnabled(); break;`);
      lines.push(`              case 'ASSERT DISABLED':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await expect(__retryLoc_${o}).toBeDisabled(); break;`);
      lines.push(`              case 'ASSERT EDITABLE':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await expect(__retryLoc_${o}).toBeEditable(); break;`);
      lines.push(`              case 'ASSERT READONLY':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await expect(__retryLoc_${o}).not.toBeEditable(); break;`);
      lines.push(`              case 'ASSERT EMPTY':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await expect(__retryLoc_${o}).toBeEmpty(); break;`);
      lines.push(`              case 'ASSERT FOCUSED':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await expect(__retryLoc_${o}).toBeFocused(); break;`);
      lines.push(`              case 'ASSERT CLASS': {`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                const __cls_${o} = await __retryLoc_${o}.getAttribute('class') ?? '';`);
      lines.push(`                if (!__cls_${o}.split(' ').includes(__patchedVal_${o}.trim())) throw new Error('Class "' + __patchedVal_${o} + '" not found in "' + __cls_${o} + '"');`);
      lines.push(`                break; }`);
      lines.push(`              case 'ASSERT CSS': {`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                const __cssRaw_${o} = __patchedVal_${o}; const __cssColon_${o} = __cssRaw_${o}.indexOf(':');`);
      lines.push(`                if (__cssColon_${o} !== -1) { const __cssProp_${o} = __cssRaw_${o}.slice(0, __cssColon_${o}).trim(); const __cssExp_${o} = __cssRaw_${o}.slice(__cssColon_${o} + 1).trim();`);
      lines.push(`                  await expect(__retryLoc_${o}).toHaveCSS(__cssProp_${o}, __cssExp_${o}); }`);
      lines.push(`                break; }`);
      lines.push(`              case 'ASSERT ATTRIBUTE': case 'ASSERT ATTR NOT': case 'ASSERT ATTR CONTAINS': {`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'attached', timeout: 10000 });`);
      lines.push(`                const __attrRaw_${o} = __patchedVal_${o}; const __attrEq_${o} = __attrRaw_${o}.indexOf('=');`);
      lines.push(`                if (__attrEq_${o} !== -1) {`);
      lines.push(`                  const __attrN_${o} = __attrRaw_${o}.slice(0, __attrEq_${o}).trim(); const __attrV_${o} = __attrRaw_${o}.slice(__attrEq_${o} + 1).trim();`);
      lines.push(`                  const __attrActual_${o} = await __retryLoc_${o}.getAttribute(__attrN_${o}) ?? '';`);
      lines.push(`                  if ('${kw}' === 'ASSERT ATTR NOT') { if (__attrActual_${o} === __attrV_${o}) throw new Error('Attr "' + __attrN_${o} + '" should NOT equal "' + __attrV_${o} + '"'); }`);
      lines.push(`                  else if ('${kw}' === 'ASSERT ATTR CONTAINS') { if (!__attrActual_${o}.includes(__attrV_${o})) throw new Error('Attr "' + __attrN_${o} + '" should contain "' + __attrV_${o} + '" but got "' + __attrActual_${o} + '"'); }`);
      lines.push(`                  else { if (__attrActual_${o} !== __attrV_${o}) throw new Error('Attr "' + __attrN_${o} + '": expected "' + __attrV_${o} + '" got "' + __attrActual_${o} + '"'); }`);
      lines.push(`                } break; }`);
      lines.push(`              case 'ASSERT COUNT':`);
      lines.push(`                await expect(__retryLoc_${o}).toHaveCount(parseInt(__patchedVal_${o}, 10) || 0); break;`);
      lines.push(`              case 'ASSERT COUNT GT': {`);
      lines.push(`                const __cntGt_${o} = parseInt(__patchedVal_${o}, 10) || 0;`);
      lines.push(`                const __actualCnt_${o} = await __retryLoc_${o}.count(); if (__actualCnt_${o} <= __cntGt_${o}) throw new Error('Count ' + __actualCnt_${o} + ' not > ' + __cntGt_${o});`);
      lines.push(`                break; }`);
      lines.push(`              case 'ASSERT COUNT LT': {`);
      lines.push(`                const __cntLt_${o} = parseInt(__patchedVal_${o}, 10) || 0;`);
      lines.push(`                const __actualCntLt_${o} = await __retryLoc_${o}.count(); if (__actualCntLt_${o} >= __cntLt_${o}) throw new Error('Count ' + __actualCntLt_${o} + ' not < ' + __cntLt_${o});`);
      lines.push(`                break; }`);
      lines.push(`              case 'ASSERT GREATER THAN': {`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                const __gtRaw_${o} = parseFloat((await __retryLoc_${o}.innerText()).replace(/[^0-9.-]/g, '')) || 0;`);
      lines.push(`                const __gtExp_${o} = parseFloat(__patchedVal_${o}) || 0;`);
      lines.push(`                if (__gtRaw_${o} <= __gtExp_${o}) throw new Error('Expected > ' + __gtExp_${o} + ' but got ' + __gtRaw_${o});`);
      lines.push(`                break; }`);
      lines.push(`              case 'ASSERT LESS THAN': {`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                const __ltRaw_${o} = parseFloat((await __retryLoc_${o}.innerText()).replace(/[^0-9.-]/g, '')) || 0;`);
      lines.push(`                const __ltExp_${o} = parseFloat(__patchedVal_${o}) || 0;`);
      lines.push(`                if (__ltRaw_${o} >= __ltExp_${o}) throw new Error('Expected < ' + __ltExp_${o} + ' but got ' + __ltRaw_${o});`);
      lines.push(`                break; }`);
      lines.push(`              case 'ASSERT ARIA': {`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                const __ariaRaw_${o} = __patchedVal_${o}; const __ariaEq_${o} = __ariaRaw_${o}.indexOf('=');`);
      lines.push(`                if (__ariaEq_${o} !== -1) { const __ariaAttr_${o} = __ariaRaw_${o}.slice(0, __ariaEq_${o}).trim(); const __ariaVal_${o} = __ariaRaw_${o}.slice(__ariaEq_${o} + 1).trim();`);
      lines.push(`                  const __ariaActual_${o} = await __retryLoc_${o}.getAttribute(__ariaAttr_${o}) ?? '';`);
      lines.push(`                  if (__ariaActual_${o} !== __ariaVal_${o}) throw new Error('ARIA "' + __ariaAttr_${o} + '": expected "' + __ariaVal_${o} + '" got "' + __ariaActual_${o} + '"'); }`);
      lines.push(`                break; }`);
      lines.push(`              case 'ASSERT TOAST': case 'ASSERTTOAST': {`);
      lines.push(`                const __toastSel_${o} = __patchedLoc_${o} || '[role="alert"],[role="status"],[class*="toast"],[class*="snackbar"],[class*="flash"],[class*="notification"]';`);
      lines.push(`                const __toastLoc_${o} = __patchedLoc_${o} ? __buildLocator(page, __patchedLt_${o}, __patchedLoc_${o}, __patchedFc_${o}) : page.locator(__toastSel_${o}).first();`);
      lines.push(`                await __toastLoc_${o}.waitFor({ state: 'visible', timeout: 8000 });`);
      lines.push(`                if (__patchedVal_${o}) { const __toastTxt_${o} = await __toastLoc_${o}.innerText(); if (!__toastTxt_${o}.toLowerCase().includes(__patchedVal_${o}.toLowerCase())) throw new Error('Toast text mismatch: expected "' + __patchedVal_${o} + '" in "' + __toastTxt_${o} + '"'); }`);
      lines.push(`                break; }`);
      // ── Page-level ASSERT cases (no locator — act on page directly) ──────────
      lines.push(`              case 'ASSERT URL':`);
      lines.push(`                await expect(page).toHaveURL(__patchedVal_${o}); break;`);
      lines.push(`              case 'ASSERT URL NOT':`);
      lines.push(`                await expect(page).not.toHaveURL(__patchedVal_${o}); break;`);
      lines.push(`              case 'ASSERT TITLE':`);
      lines.push(`                await expect(page).toHaveTitle(__patchedVal_${o}); break;`);
      lines.push(`              case 'ASSERT TITLE NOT':`);
      lines.push(`                await expect(page).not.toHaveTitle(__patchedVal_${o}); break;`);
      lines.push(`              case 'ASSERT DOWNLOAD COUNT':`);
      lines.push(`                expect(__downloadCount ?? 0).toBe(parseInt(__patchedVal_${o}, 10) || 1); break;`);
      lines.push(`              case 'ASSERT RESPONSE OK':`);
      lines.push(`                { const __respOk_${o} = __interceptedResponses?.get(__patchedVal_${o}); if (!__respOk_${o}) throw new Error('No intercepted response for "' + __patchedVal_${o} + '"'); if (!__respOk_${o}.ok) throw new Error('Response not OK for "' + __patchedVal_${o} + '": status ' + __respOk_${o}.status); } break;`);
      lines.push(`              case 'ASSERT FILE DOWNLOADED': case 'ASSERT EXCEL ROW COUNT':`);
      lines.push(`                // File-system asserts — re-execute original generated code path`);
      lines.push(`                ${code.trim().split('\n').join(' ')} break;`);
      // ── GAP13 + RF: new keyword cases in retry switch ────────────────────────
      lines.push(`              // ── GAP13 new keywords ─────────────────────────────────────────────────`);
      lines.push(`              case 'RIGHT CLICK':`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.click({ button: 'right' }); break;`);
      lines.push(`              case 'PRESS KEY': case 'PRESS_KEY':`);
      lines.push(`                // page-level — value is the key combo (e.g. "Enter", "Control+A")`);
      lines.push(`                await page.keyboard.press(__patchedVal_${o}); break;`);
      lines.push(`              case 'SCROLL TO': case 'SCROLL_TO': {`);
      lines.push(`                // with locator → scroll element into view; without → page.mouse.wheel from JSON`);
      lines.push(`                if (__patchedLoc_${o}) { await __retryLoc_${o}.scrollIntoViewIfNeeded(); }`);
      lines.push(`                else { try { const __sc_${o} = JSON.parse(__patchedVal_${o}); await page.mouse.wheel(__sc_${o}.x ?? 0, __sc_${o}.y ?? 0); } catch {} }`);
      lines.push(`                break; }`);
      lines.push(`              case 'DRAG': {`);
      lines.push(`                // locator = source selector, value = target selector`);
      lines.push(`                const __dragSrc_${o} = __patchedLoc_${o}; const __dragTgt_${o} = __patchedVal_${o};`);
      lines.push(`                if (__dragSrc_${o} && __dragTgt_${o}) { await page.dragAndDrop(__dragSrc_${o}, __dragTgt_${o}); }`);
      lines.push(`                break; }`);
      lines.push(`              case 'CLICK AT COORDS': case 'CLICK_AT_COORDS': {`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                try { const __pos_${o} = JSON.parse(__patchedVal_${o}); await __retryLoc_${o}.click({ position: { x: __pos_${o}.x, y: __pos_${o}.y } }); }`);
      lines.push(`                catch { await __retryLoc_${o}.click(); } break; }`);
      lines.push(`              case 'SWITCH FRAME': case 'SWITCH_FRAME':`);
      lines.push(`                // page-level — value is frame selector/URL; nothing to retry meaningfully, just wait`);
      lines.push(`                await page.frameLocator(__patchedVal_${o}).locator('body').waitFor({ timeout: 10000 }).catch(() => {}); break;`);
      lines.push(`              case 'SWITCH MAIN': case 'SWITCH_MAIN':`);
      lines.push(`                // no-op — returning to main frame has no retry action`);
      lines.push(`                break;`);
      lines.push(`              case 'CANVAS DRAG': case 'CANVAS_DRAG': {`);
      lines.push(`                // locator = canvas element; value = JSON {fromX,fromY,toX,toY}`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                try {`);
      lines.push(`                  const __cd_${o} = JSON.parse(__patchedVal_${o}); const __cdBox_${o} = await __retryLoc_${o}.boundingBox();`);
      lines.push(`                  if (__cdBox_${o}) {`);
      lines.push(`                    await page.mouse.move(__cdBox_${o}.x + __cd_${o}.fromX, __cdBox_${o}.y + __cd_${o}.fromY);`);
      lines.push(`                    await page.mouse.down();`);
      lines.push(`                    await page.mouse.move(__cdBox_${o}.x + __cd_${o}.toX, __cdBox_${o}.y + __cd_${o}.toY, { steps: 20 });`);
      lines.push(`                    await page.mouse.up();`);
      lines.push(`                  }`);
      lines.push(`                } catch { await __retryLoc_${o}.click(); } break; }`);
      lines.push(`              case 'RF NODE DRAG': case 'RF_NODE_DRAG': {`);
      lines.push(`                // locator = RF pane; value = JSON {nodeId,fromFlowX,fromFlowY,toFlowX,toFlowY}`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                try {`);
      lines.push(`                  const __rnd_${o} = JSON.parse(__patchedVal_${o});`);
      lines.push(`                  const __rfBox_${o} = await __retryLoc_${o}.boundingBox();`);
      lines.push(`                  const __vp_${o} = await page.evaluate(() => { const t = document.querySelector('.react-flow__viewport'); const m = t ? (getComputedStyle(t).transform || '') : ''; const n = m.match(/matrix\\\\(([^)]+)\\\\)/); const p = n ? n[1].split(',').map(Number) : [1,0,0,1,0,0]; return { zoom: p[0], tx: p[4], ty: p[5] }; });`);
      lines.push(`                  if (__rfBox_${o} && __vp_${o}) {`);
      lines.push(`                    const __sx_${o} = __rfBox_${o}.x + __rnd_${o}.fromFlowX * __vp_${o}.zoom + __vp_${o}.tx;`);
      lines.push(`                    const __sy_${o} = __rfBox_${o}.y + __rnd_${o}.fromFlowY * __vp_${o}.zoom + __vp_${o}.ty;`);
      lines.push(`                    const __tx_${o} = __rfBox_${o}.x + __rnd_${o}.toFlowX  * __vp_${o}.zoom + __vp_${o}.tx;`);
      lines.push(`                    const __ty_${o} = __rfBox_${o}.y + __rnd_${o}.toFlowY  * __vp_${o}.zoom + __vp_${o}.ty;`);
      lines.push(`                    await page.mouse.move(__sx_${o}, __sy_${o}); await page.mouse.down();`);
      lines.push(`                    await page.mouse.move(__tx_${o}, __ty_${o}, { steps: 20 }); await page.mouse.up();`);
      lines.push(`                  }`);
      lines.push(`                } catch { await __retryLoc_${o}.click(); } break; }`);
      lines.push(`              case 'RF CONNECT': case 'RF_CONNECT': {`);
      lines.push(`                // locator = RF container; value = JSON {sourceNode,sourceHandle,targetNode,targetHandle}`);
      lines.push(`                // OLD: dragTo — React Flow handles don't use HTML5 drag, need page.mouse`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'attached', timeout: 10000 });`);
      lines.push(`                try {`);
      lines.push(`                  const __rc_${o} = JSON.parse(__patchedVal_${o});`);
      lines.push(`                  // Use label-based node lookup; fall back to fromFlow/toFlow coords`);
      lines.push(`                  const __srcLabel_${o} = __rc_${o}.sourceNodeLabel || __rc_${o}.sourceNode;`);
      lines.push(`                  const __tgtLabel_${o} = __rc_${o}.targetNodeLabel || __rc_${o}.targetNode;`);
      lines.push(`                  const __rfRoot_${o} = __patchedFc_${o} ? page.frameLocator(__patchedFc_${o}) : page;`);
      lines.push(`                  const __rfBox_${o} = await __rfRoot_${o}.locator('.react-flow').boundingBox();`);
      lines.push(`                  const __rfVp_${o} = await __rfRoot_${o}.locator('.react-flow__viewport').evaluate((vEl: HTMLElement) => { const raw = vEl?.style.transform || ''; const t = raw.match(/translate\\(([\\-\\d.]+)px,\\s*([\\-\\d.]+)px\\)\\s*scale\\(([\\-\\d.]+)\\)/); return t ? { tx: +t[1], ty: +t[2], zoom: +t[3] } : { tx: 0, ty: 0, zoom: 1 }; });`);
      lines.push(`                  let __sx_${o} = 0, __sy_${o} = 0, __tx_${o} = 0, __ty_${o} = 0;`);
      lines.push(`                  try {`);
      lines.push(`                    const __srcNode_${o} = __rfRoot_${o}.locator(\`.react-flow__node:has(*:text-is("\${__srcLabel_${o}}"))\`).first();`);
      lines.push(`                    const __tgtNode_${o} = __rfRoot_${o}.locator(\`.react-flow__node:has(*:text-is("\${__tgtLabel_${o}}"))\`).first();`);
      lines.push(`                    const __srcH_${o} = __srcNode_${o}.locator(\`.react-flow__handle[data-handlepos="\${__rc_${o}.sourcePosition || 'bottom'}"]\`).first();`);
      lines.push(`                    const __tgtH_${o} = __tgtNode_${o}.locator(\`.react-flow__handle[data-handlepos="\${__rc_${o}.targetPosition || 'top'}"]\`).first();`);
      lines.push(`                    const __srcBox_${o} = await __srcH_${o}.boundingBox();`);
      lines.push(`                    const __tgtBox_${o} = await __tgtH_${o}.boundingBox();`);
      lines.push(`                    if (__srcBox_${o} && __tgtBox_${o}) {`);
      lines.push(`                      __sx_${o} = __srcBox_${o}.x + __srcBox_${o}.width/2; __sy_${o} = __srcBox_${o}.y + __srcBox_${o}.height/2;`);
      lines.push(`                      __tx_${o} = __tgtBox_${o}.x + __tgtBox_${o}.width/2; __ty_${o} = __tgtBox_${o}.y + __tgtBox_${o}.height/2;`);
      lines.push(`                    }`);
      lines.push(`                  } catch {}`);
      lines.push(`                  if (!__sx_${o} && __rfBox_${o} && __rfVp_${o}) {`);
      lines.push(`                    __sx_${o} = __rfBox_${o}.x + (__rc_${o}.fromFlow?.x ?? 0) * __rfVp_${o}.zoom + __rfVp_${o}.tx;`);
      lines.push(`                    __sy_${o} = __rfBox_${o}.y + (__rc_${o}.fromFlow?.y ?? 0) * __rfVp_${o}.zoom + __rfVp_${o}.ty;`);
      lines.push(`                    __tx_${o} = __rfBox_${o}.x + (__rc_${o}.toFlow?.x ?? 0) * __rfVp_${o}.zoom + __rfVp_${o}.tx;`);
      lines.push(`                    __ty_${o} = __rfBox_${o}.y + (__rc_${o}.toFlow?.y ?? 0) * __rfVp_${o}.zoom + __rfVp_${o}.ty;`);
      lines.push(`                  }`);
      lines.push(`                  if (__sx_${o} && __tx_${o}) {`);
      lines.push(`                    await page.mouse.move(__sx_${o}, __sy_${o});`);
      lines.push(`                    await page.mouse.down();`);
      lines.push(`                    await page.mouse.move(__sx_${o} + (__tx_${o}-__sx_${o})*0.3, __sy_${o} + (__ty_${o}-__sy_${o})*0.3, { steps: 5 });`);
      lines.push(`                    await page.mouse.move(__tx_${o}, __ty_${o}, { steps: 10 });`);
      lines.push(`                    await page.mouse.up();`);
      lines.push(`                  }`);
      lines.push(`                } catch { await __retryLoc_${o}.click(); } break; }`);
      lines.push(`              case 'RF PAN': case 'RF_PAN': {`);
      lines.push(`                // page-level pan — value = JSON {deltaX,deltaY}; locator = RF pane`);
      lines.push(`                try {`);
      lines.push(`                  const __rp_${o} = JSON.parse(__patchedVal_${o});`);
      lines.push(`                  const __rpBox_${o} = await __retryLoc_${o}.boundingBox();`);
      lines.push(`                  if (__rpBox_${o}) {`);
      lines.push(`                    const __cx_${o} = __rpBox_${o}.x + __rpBox_${o}.width / 2;`);
      lines.push(`                    const __cy_${o} = __rpBox_${o}.y + __rpBox_${o}.height / 2;`);
      lines.push(`                    await page.mouse.move(__cx_${o}, __cy_${o}); await page.mouse.down();`);
      lines.push(`                    await page.mouse.move(__cx_${o} + (__rp_${o}.deltaX ?? 0), __cy_${o} + (__rp_${o}.deltaY ?? 0), { steps: 15 }); await page.mouse.up();`);
      lines.push(`                  }`);
      lines.push(`                } catch {} break; }`);
      lines.push(`              case 'RF DROP NODE': case 'RF_DROP_NODE': {`);
      lines.push(`                // OLD: new DataTransfer() — browser clears getData() outside trusted drag`);
      lines.push(`                // NEW: dragstart on sidebar source populates dt; drop on pane reads same dt`);
      lines.push(`                try {`);
      lines.push(`                  const __rdn_${o} = JSON.parse(__patchedVal_${o});`);
      lines.push(`                  const __rdnRoot_${o} = __patchedFc_${o} ? page.frameLocator(__patchedFc_${o}) : page;`);
      lines.push(`                  const __rdnVp_${o} = await __rdnRoot_${o}.locator('.react-flow__viewport').evaluate((vEl: HTMLElement) => { const raw = vEl?.style.transform || ''; const t = raw.match(/translate\\\\(([\\\\-\\\\d.]+)px,\\\\s*([\\\\-\\\\d.]+)px\\\\)\\\\s*scale\\\\(([\\\\-\\\\d.]+)\\\\)/); return t ? { tx: +t[1], ty: +t[2], zoom: +t[3] } : { tx: 0, ty: 0, zoom: 1 }; });`);
      lines.push(`                  const __rdnBox_${o} = await __rdnRoot_${o}.locator('.react-flow').boundingBox();`);
      lines.push(`                  if (__rdnBox_${o} && __rdnVp_${o}) {`);
      lines.push(`                    const __rdnTx_${o} = __rdnBox_${o}.x + (__rdn_${o}.dropFlow?.x ?? __rdn_${o}.flowX ?? 0) * __rdnVp_${o}.zoom + __rdnVp_${o}.tx;`);
      lines.push(`                    const __rdnTy_${o} = __rdnBox_${o}.y + (__rdn_${o}.dropFlow?.y ?? __rdn_${o}.flowY ?? 0) * __rdnVp_${o}.zoom + __rdnVp_${o}.ty;`);
      lines.push(`                    await __rdnRoot_${o}.locator('.react-flow__pane').evaluate((pane, [nt, tx, ty]: [string, number, number]) => {`);
      lines.push(`                      const doc = pane.ownerDocument; const win = doc.defaultView as any;`);
      lines.push(`                      const srcBox = Array.from(doc.querySelectorAll<HTMLElement>('[draggable="true"]')).find(el => (el.innerText || el.textContent || '').trim() === nt);`);
      lines.push(`                      if (!srcBox) return;`);
      lines.push(`                      const sr = srcBox.getBoundingClientRect(); const sx = sr.left + sr.width/2, sy = sr.top + sr.height/2;`);
      lines.push(`                      const opts = (cx: number, cy: number) => ({ bubbles: true, cancelable: true, clientX: cx, clientY: cy, screenX: cx, screenY: cy });`);
      lines.push(`                      const dt = new win.DataTransfer();`);
      lines.push(`                      srcBox.dispatchEvent(new win.DragEvent('dragstart', { ...opts(sx, sy), dataTransfer: dt }));`);
      lines.push(`                      pane.dispatchEvent(new win.DragEvent('dragenter', { ...opts(tx, ty), dataTransfer: dt }));`);
      lines.push(`                      pane.dispatchEvent(new win.DragEvent('dragover',  { ...opts(tx, ty), dataTransfer: dt }));`);
      lines.push(`                      pane.dispatchEvent(new win.DragEvent('drop',      { ...opts(tx, ty), dataTransfer: dt }));`);
      lines.push(`                    }, [__rdn_${o}.nodeType, __rdnTx_${o}, __rdnTy_${o}]);`);
      lines.push(`                  }`);
      lines.push(`                } catch {} break; }`);
      lines.push(`              default:`);
      lines.push(`                // Fallback: attempt click for unknown keywords with a locator`);
      lines.push(`                await __retryLoc_${o}.waitFor({ state: 'visible', timeout: 10000 });`);
      lines.push(`                await __retryLoc_${o}.click();`);
      lines.push(`            }`);

    }
    // 📌 Pin — store value into __sessionVars/__globalVars if storeAs is set (use patched locator)
    // OLD: storeAsLine emitted _pinVal_N — not declared in debug path (uses __patchedVal_N)
    // const dbgPinLine = storeAsLine(step, step.locator ? `__buildLocator(page, __patchedLt_${step.order}, __patchedLoc_${step.order})` : null, '            ', `__patchedVal_${step.order}`);
    const dbgVarName = (step.storeAs || '').trim();
    if (dbgVarName && step.keyword?.toUpperCase() !== 'SET VARIABLE') {
      const dbgStore = step.storeScope === 'global' ? '__globalVars' : '__sessionVars';
      const dbgKw = (step.keyword || '').toUpperCase();
      if (dbgKw === 'FILL' || dbgKw === 'TYPE' || dbgKw === 'SELECT') {
        lines.push(`            ${dbgStore}['${dbgVarName}'] = __patchedVal_${step.order}; // 📌 pinned (debug)`);
      } else if (step.locator) {
        lines.push(`            ${dbgStore}['${dbgVarName}'] = (await __buildLocator(page, __patchedLt_${step.order}, __patchedLoc_${step.order}, __patchedFc_${step.order}).innerText().catch(() => '')).trim(); // 📌 pinned (debug)`);
      }
    }
    // OLD: if (dbgPinLine) lines.push(dbgPinLine);
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
    lines.push(`            if (__reGate_${step.order}.frameContext !== undefined) __patchedFc_${step.order} = __reGate_${step.order}.frameContext ?? null;`);
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
