/**
 * dom-scraper.agent.ts
 *
 * Proactive DOM intelligence layer — runs BEFORE field execution.
 *
 * Problem it solves
 * ─────────────────
 * When a user instruction contains:
 *   - A typo:            "39tlY9w85W"  → real option text is "39tIY9w85W"  (l vs I)
 *   - A case mismatch:   "String"      → real option text is "STRING"
 *   - A label/id mix-up: "Gateway Name" → real DOM id is "GateWayTypeID"
 *   - A syntax error:    "Column Data Type" → column header, not a label[for=…]
 *
 * The scraper builds a FieldMap from the raw HTML string of a form/module page,
 * then correlates each user-supplied (field, value) pair to the correct DOM element
 * and resolved value — before any Playwright action is executed.
 *
 * Pipeline position
 * ─────────────────
 *   User instruction
 *         │
 *         ▼
 *   scrapePageForModule(dom)  ← once per form page
 *         │  ModuleScrapeResult
 *         ▼
 *   correlateInstruction(userField, userValue, fieldMap)  ← once per instruction field
 *         │  CorrelationResult { selector, resolvedValue, confidence }
 *         ▼
 *   BasePage.fill / selectOption / check   ← uses resolved selector + value
 *         │
 *         └── if still fails → healer.agent.ts (existing reactive layer)
 *
 * Zero external dependencies. Pure synchronous TypeScript — no Playwright imports,
 * no fs/path, no async. Fully unit-testable with plain input strings.
 */

import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** One `<option>` inside a `<select>` */
export interface FieldOption {
  /** Visible option text as it appears in the DOM */
  text:      string;
  /** option value= attribute */
  value:     string;
  /** Normalised text for matching — see normalise() */
  textNorm:  string;
}

/** Casing/whitespace transforms inferred from the option list */
export type AutoTransform =
  | 'toUpperCase'
  | 'toLowerCase'
  | 'toTitleCase'
  | 'trim'
  | 'collapseWhitespace';

/**
 * One interactive control (input / select / radio group / checkbox group)
 * extracted from a DOM string.
 */
export interface FormFieldMap {
  /** Human-readable label text as seen in the UI — e.g. "Gateway Type" */
  label:       string;
  /** Normalised label for matching */
  labelNorm:   string;
  /** Best Playwright-ready selector */
  selector:    string;
  /** Additional selectors in stability order */
  fallbackSelectors: string[];
  /** Playwright action to use */
  type: 'fill' | 'selectOption' | 'check' | 'click' | 'setInputFiles';
  /** For <select>: all available options */
  options:     FieldOption[];
  /** Raw element attributes */
  attributes: {
    id?:         string;
    name?:       string;
    placeholder?: string;
    ariaLabel?:  string;
    dataTestId?: string;
  };
  /**
   * Casing transforms to try when matching a user-supplied value against options[].
   * Inferred during scrape — e.g. if all options are UPPERCASE, ['toUpperCase'] is set.
   */
  autoTransforms: AutoTransform[];
  /**
   * For inputs inside grid/table rows that have no explicit <label>:
   * the <th> column header text that contextualises this field.
   */
  columnContext?: string;
  /** For radio/checkbox groups: all visible option labels */
  groupLabels?:   string[];
}

/** High-level result of scraping a full module/form page */
export interface ModuleScrapeResult {
  fields:         FormFieldMap[];
  buttonLabels:   string[];
  columnHeaders:  string[];
  radioGroups:    Record<string, string[]>;
  checkboxGroups: Record<string, string[]>;
  scrapedAt:      string;
  domSizeBytes:   number;
}

export type MatchMethod =
  | 'exact'
  | 'normalised'
  | 'autoTransform'
  | 'levenshtein'
  | 'tokenOverlap'
  | 'substring'
  | 'acronym'
  | 'columnHeader'
  | 'unmatched';

/** Result of correlating one (userField, userValue) pair against a FieldMap */
export interface CorrelationResult {
  matched:             boolean;
  selector:            string | null;
  fallbackSelectors:   string[];
  actionType:          FormFieldMap['type'] | null;
  /**
   * The value to pass to fill() or the option text for selectOption().
   * May differ from userValue after transform / fuzzy option match.
   */
  resolvedValue:       string | null;
  /**
   * For <select>: the option.value= attribute — what selectOption({ value: … }) needs.
   * null for fill/check/click fields.
   */
  resolvedOptionValue: string | null;
  /** 0.0–1.0 */
  confidence:          number;
  confidenceTier:      'high' | 'medium' | 'low' | 'none';
  labelMatchMethod:    MatchMethod;
  valueMatchMethod:    MatchMethod | null;
  matchedField:        FormFieldMap | null;
  notes:               string[];
}

/** Recorded on BasePage.correlationEvents for results reporting */
export interface DomCorrelationEvent {
  userField:          string;
  userValue:          string;
  resolvedSelector:   string | null;
  resolvedValue:      string | null;
  confidence:         number;
  confidenceTier:     CorrelationResult['confidenceTier'];
  labelMatchMethod:   MatchMethod;
  valueMatchMethod:   MatchMethod | null;
  notes:              string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIDENCE = {
  HIGH:   0.85,
  MEDIUM: 0.65,
  LOW:    0.45,
} as const;

/** Selector stability tiers — higher = more stable = preferred */
const SELECTOR_TIER: Record<string, number> = {
  'data-testid': 100,
  'data-action':  95,
  'data-id':      90,
  id:             85,
  'aria-label':   80,
  role:           75,
  name:           70,
  placeholder:    65,
  type:           55,
  text:           50,
  class:          30,
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scrape all interactive fields from a raw HTML string.
 * Returns a FieldMap covering: selects, text inputs, radios, checkboxes,
 * and table-column-scoped inputs (e.g. editable grid rows).
 */
export function scrapeFormFields(htmlDom: string): FormFieldMap[] {
  const labelMap  = buildLabelMap(htmlDom);
  const ariaMap   = buildAriaLabelMap(htmlDom);
  const fields: FormFieldMap[] = [];

  fields.push(...extractSelectFields(htmlDom, labelMap, ariaMap));
  fields.push(...extractInputFields(htmlDom, labelMap, ariaMap));
  fields.push(...extractRadioGroups(htmlDom, labelMap));
  fields.push(...extractCheckboxGroups(htmlDom, labelMap));
  fields.push(...extractTableColumnFields(htmlDom));

  logger.info(`DOM Scraper: extracted ${fields.length} fields`);
  return fields;
}

/**
 * Correlate a user-supplied (field name, value) pair against a pre-scraped FieldMap.
 * Pure synchronous — no Playwright, no async, no external calls.
 */
export function correlateInstruction(
  userField: string,
  userValue: string,
  fieldMap:  FormFieldMap[],
): CorrelationResult {
  if (fieldMap.length === 0) {
    return noMatch(userField, userValue, ['FieldMap is empty — call scrapeFormFields first']);
  }

  // ── Label matching ───────────────────────────────────────────────────────
  let bestField:       FormFieldMap | null = null;
  let bestLabelScore   = 0;
  let bestLabelMethod: MatchMethod = 'unmatched';

  for (const field of fieldMap) {
    const { score, method } = matchLabel(userField, field);
    if (score > bestLabelScore) {
      bestLabelScore  = score;
      bestField       = field;
      bestLabelMethod = method;
    }
  }

  if (!bestField || bestLabelScore < CONFIDENCE.LOW) {
    return noMatch(userField, userValue, [
      `No field matched label "${userField}" (best score: ${bestLabelScore.toFixed(2)})`,
    ]);
  }

  const notes: string[] = [
    `Label "${userField}" → "${bestField.label}" via ${bestLabelMethod} (score ${bestLabelScore.toFixed(2)})`,
  ];
  if (bestField.label !== userField) {
    notes.push(`Corrected field name: "${userField}" → "${bestField.label}"`);
  }

  // ── Value matching (select / radio only) ────────────────────────────────
  let resolvedValue:       string | null = userValue || null;
  let resolvedOptionValue: string | null = null;
  let valueMethod: MatchMethod | null    = null;
  let valueScore   = 1.0; // plain fill fields always get full value score

  if ((bestField.type === 'selectOption' || bestField.type === 'click') &&
       bestField.options.length > 0 && userValue) {
    const vm = matchValue(userValue, bestField);
    resolvedValue       = vm.optionText;
    resolvedOptionValue = vm.optionValue;
    valueMethod         = vm.method;
    valueScore          = vm.score;
    if (vm.score < CONFIDENCE.LOW) {
      notes.push(`Warning: value "${userValue}" matched weakly (${vm.method}, score ${vm.score.toFixed(2)})`);
    } else if (vm.originalValue !== userValue) {
      notes.push(`Corrected value: "${userValue}" → "${vm.optionText}" (option value="${vm.optionValue}")`);
    }
  } else if (bestField.type === 'fill' && userValue &&
             bestField.autoTransforms.length > 0) {
    // For fill fields with known transforms (e.g. toUpperCase), report what the app will do
    const transformed = applyTransform(userValue, bestField.autoTransforms[0]);
    if (transformed !== userValue) {
      notes.push(`App auto-transform "${bestField.autoTransforms[0]}": "${userValue}" → "${transformed}"`);
    }
  }

  // ── Combined confidence ──────────────────────────────────────────────────
  const combined  = bestLabelScore * 0.6 + valueScore * 0.4;
  const tier      = tierFromScore(combined);

  logger.info(`DOM Scraper: correlated "${userField}" → "${bestField.selector}" (${tier})`);

  return {
    matched:             true,
    selector:            bestField.selector,
    fallbackSelectors:   bestField.fallbackSelectors,
    actionType:          bestField.type,
    resolvedValue,
    resolvedOptionValue,
    confidence:          combined,
    confidenceTier:      tier,
    labelMatchMethod:    bestLabelMethod,
    valueMatchMethod:    valueMethod,
    matchedField:        bestField,
    notes,
  };
}

/**
 * High-level entry point: scrape a full module/form page DOM.
 * Returns fields, buttons, column headers, and radio/checkbox groups.
 */
export function scrapePageForModule(pageDom: string): ModuleScrapeResult {
  const fields         = scrapeFormFields(pageDom);
  const buttonLabels   = extractButtonLabels(pageDom);
  const columnHeaders  = extractColumnHeaders(pageDom);
  const radioGroups    = buildGroupMap(fields, 'radio');
  const checkboxGroups = buildGroupMap(fields, 'checkbox');

  return {
    fields,
    buttonLabels,
    columnHeaders,
    radioGroups,
    checkboxGroups,
    scrapedAt:    new Date().toISOString(),
    domSizeBytes: pageDom.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOM PARSING INTERNALS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a map: elementId → label text
 * from all <label for="id"> tags in the DOM.
 * Also handles <label>text<input ...></label> (implicit labels) via a best-effort scan.
 */
function buildLabelMap(html: string): Map<string, string> {
  const map = new Map<string, string>();

  // Explicit <label for="id">text</label>
  const explicitRe = /<label[^>]+for=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi;
  let m: RegExpExecArray | null;
  while ((m = explicitRe.exec(html)) !== null) {
    const id   = m[1].trim();
    const text = cleanLabel(stripHtml(m[2]).trim());
    if (id && text) map.set(id, text);
  }

  // Implicit <label>text<input id="x" .../></label>
  const implicitRe = /<label[^>]*>([\s\S]*?)<\/label>/gi;
  while ((m = implicitRe.exec(html)) !== null) {
    const inner  = m[1];
    const text   = cleanLabel(stripHtml(inner).replace(/<[^>]+>/g, '').trim());
    const idM    = /id=["']([^"']+)["']/.exec(inner);
    const nameM  = /name=["']([^"']+)["']/.exec(inner);
    if (idM && text)   map.set(idM[1],   text);
    if (nameM && text) map.set(nameM[1], text);
  }

  return map;
}

/** Build aria-label map: id → aria-label value */
function buildAriaLabelMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const re  = /<(?:input|select|textarea)[^>]+aria-label=["']([^"']+)["'][^>]*(?:id=["']([^"']+)["'])?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[2]) map.set(m[2], m[1]);
  }
  return map;
}

/** Extract all <select> elements with their options */
function extractSelectFields(
  html:     string,
  labelMap: Map<string, string>,
  ariaMap:  Map<string, string>,
): FormFieldMap[] {
  const fields: FormFieldMap[] = [];
  // Match <select ...>...</select> blocks
  const selectRe = /<select([\s\S]*?)>([\s\S]*?)<\/select>/gi;
  let m: RegExpExecArray | null;

  while ((m = selectRe.exec(html)) !== null) {
    const attrBlock = m[1];
    const body      = m[2];

    const id          = attrVal(attrBlock, 'id');
    const name        = attrVal(attrBlock, 'name');
    const ariaLabel   = attrVal(attrBlock, 'aria-label');
    const dataTestId  = attrVal(attrBlock, 'data-testid');
    const label       = labelMap.get(id ?? '') ?? labelMap.get(name ?? '') ??
                        ariaMap.get(id ?? '') ?? ariaLabel ?? name ?? id ?? '';

    if (!label && !id && !name) continue; // unidentifiable — skip

    // Extract options
    const options = extractOptions(body);
    if (options.length <= 1) continue; // skip empty / placeholder-only selects

    const transforms = inferAutoTransforms(options);
    const selector   = buildSelector({ id, name, ariaLabel, dataTestId }, 'select');

    fields.push({
      label,
      labelNorm: normalise(label),
      selector,
      fallbackSelectors: buildFallbacks({ id, name, ariaLabel, dataTestId }, 'select'),
      type:    'selectOption',
      options,
      attributes: { id: id ?? undefined, name: name ?? undefined, ariaLabel: ariaLabel ?? undefined, dataTestId: dataTestId ?? undefined },
      autoTransforms: transforms,
    });
  }

  return fields;
}

/** Extract all visible text <input> elements (text, email, number, search, tel, password) */
function extractInputFields(
  html:     string,
  labelMap: Map<string, string>,
  ariaMap:  Map<string, string>,
): FormFieldMap[] {
  const fields: FormFieldMap[] = [];
  const inputRe = /<input([^>]*)>/gi;
  let m: RegExpExecArray | null;

  while ((m = inputRe.exec(html)) !== null) {
    const attrs  = m[1];
    const type   = (attrVal(attrs, 'type') ?? 'text').toLowerCase();
    if (!['text', 'email', 'number', 'search', 'tel', 'password'].includes(type)) continue;

    const id          = attrVal(attrs, 'id');
    const name        = attrVal(attrs, 'name');
    const placeholder = attrVal(attrs, 'placeholder');
    const ariaLabel   = attrVal(attrs, 'aria-label');
    const dataTestId  = attrVal(attrs, 'data-testid');
    const label       = labelMap.get(id ?? '') ?? labelMap.get(name ?? '') ??
                        ariaMap.get(id ?? '') ?? ariaLabel ?? placeholder ?? name ?? id ?? '';

    if (!label && !id && !name && !placeholder) continue;

    // Detect toUpperCase transform from oninput/onchange attribute
    const onInput = attrVal(attrs, 'oninput') ?? attrVal(attrs, 'onchange') ?? '';
    const transforms: AutoTransform[] = [];
    if (/toUpperCase/i.test(onInput)) transforms.push('toUpperCase');
    if (/toLowerCase/i.test(onInput)) transforms.push('toLowerCase');

    const selector = buildSelector({ id, name, ariaLabel, dataTestId, placeholder, type }, 'input');

    fields.push({
      label,
      labelNorm: normalise(label),
      selector,
      fallbackSelectors: buildFallbacks({ id, name, ariaLabel, dataTestId, placeholder, type }, 'input'),
      type:    'fill',
      options: [],
      attributes: { id: id ?? undefined, name: name ?? undefined, placeholder: placeholder ?? undefined, ariaLabel: ariaLabel ?? undefined, dataTestId: dataTestId ?? undefined },
      autoTransforms: transforms,
    });
  }

  return fields;
}

/** Extract radio button groups — returns one FormFieldMap per group */
function extractRadioGroups(html: string, labelMap: Map<string, string>): FormFieldMap[] {
  const groups = new Map<string, { options: FieldOption[]; firstId?: string; groupLabel?: string }>();

  const radioRe = /<input([^>]*)type=["']radio["']([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = radioRe.exec(html)) !== null) {
    const attrs = m[1] + m[2];
    const name  = attrVal(attrs, 'name');
    const value = attrVal(attrs, 'value') ?? '';
    const id    = attrVal(attrs, 'id');
    if (!name) continue;

    const labelText = id ? (labelMap.get(id) ?? value) : value;
    if (!groups.has(name)) {
      groups.set(name, { options: [], firstId: id ?? undefined, groupLabel: labelMap.get(name) });
    }
    const g = groups.get(name)!;
    g.options.push({ text: labelText, value, textNorm: normalise(labelText) });
  }

  return Array.from(groups.entries()).map(([name, g]) => {
    const label     = g.groupLabel ?? name;
    const selector  = `input[name="${name}"]`;
    return {
      label,
      labelNorm: normalise(label),
      selector,
      fallbackSelectors: [`[name="${name}"]`, `label:has-text("${label}")`],
      type:    'click' as const,
      options: g.options,
      attributes: { name },
      autoTransforms: [],
      groupLabels: g.options.map(o => o.text),
    };
  });
}

/** Extract checkbox groups — same structure as radio groups */
function extractCheckboxGroups(html: string, labelMap: Map<string, string>): FormFieldMap[] {
  const groups = new Map<string, { options: FieldOption[]; groupLabel?: string }>();

  const cbRe = /<input([^>]*)type=["']checkbox["']([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = cbRe.exec(html)) !== null) {
    const attrs = m[1] + m[2];
    const name  = attrVal(attrs, 'name') ?? '';
    const value = attrVal(attrs, 'value') ?? '';
    const id    = attrVal(attrs, 'id');
    const labelText = id ? (labelMap.get(id) ?? value) : (name || value);

    if (!groups.has(name)) {
      groups.set(name, { options: [], groupLabel: labelMap.get(name) });
    }
    groups.get(name)!.options.push({ text: labelText, value, textNorm: normalise(labelText) });
  }

  return Array.from(groups.entries()).map(([name, g]) => {
    const label = g.groupLabel ?? name;
    return {
      label,
      labelNorm: normalise(label),
      selector: `input[name="${name}"][type="checkbox"]`,
      fallbackSelectors: [`[name="${name}"]`],
      type:    'check' as const,
      options: g.options,
      attributes: { name },
      autoTransforms: [],
      groupLabels: g.options.map(o => o.text),
    };
  });
}

/**
 * Extract inputs that live inside `<td>` cells of a table where the column header
 * in the `<th>` provides the semantic label (e.g. inline editable grid rows).
 *
 * This handles the Column Name Configuration pattern where:
 *   <th>Column Name</th>   <td><input name="ColumnType" /></td>
 *   <th>Column Data Type</th> <td><select name="FieldTypeID">…</select></td>
 */
function extractTableColumnFields(html: string): FormFieldMap[] {
  const fields: FormFieldMap[] = [];

  // Find each <table ...>...</table> block
  const tableRe = /<table[\s\S]*?>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;

  while ((tm = tableRe.exec(html)) !== null) {
    const tableBody = tm[1];

    // Extract <th> headers in order
    const headers: string[] = [];
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = thRe.exec(tableBody)) !== null) {
      headers.push(stripHtml(hm[1]).trim());
    }
    if (headers.length === 0) continue;

    // For each <tr> in tbody, find <td> cells and match to header
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = trRe.exec(tableBody)) !== null) {
      const row = rm[1];
      // Skip header rows (contain <th>)
      if (/<th/i.test(row)) continue;

      // Extract <td> cells
      const tdRe   = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdIdx    = 0;
      let tdm: RegExpExecArray | null;
      while ((tdm = tdRe.exec(row)) !== null) {
        const cell   = tdm[1];
        const header = headers[tdIdx] ?? `col${tdIdx}`;
        tdIdx++;

        if (!header || header === 'Sr No.' || header === 'Action') continue;

        // Input in this cell?
        const inpM = /<input([^>]*)>/i.exec(cell);
        if (inpM) {
          const attrs     = inpM[1];
          const inputType = (attrVal(attrs, 'type') ?? 'text').toLowerCase();
          if (!['text', 'email', 'number', 'search', 'tel'].includes(inputType)) continue;
          const id   = attrVal(attrs, 'id');
          const name = attrVal(attrs, 'name');
          const ph   = attrVal(attrs, 'placeholder');
          const sel  = buildSelector({ id, name, placeholder: ph, type: inputType }, 'input');
          const onInput = attrVal(attrs, 'oninput') ?? '';
          const transforms: AutoTransform[] = [];
          if (/toUpperCase/i.test(onInput)) transforms.push('toUpperCase');

          // Avoid duplicates
          if (!fields.some(f => f.selector === sel)) {
            fields.push({
              label:     header,
              labelNorm: normalise(header),
              selector:  sel,
              fallbackSelectors: buildFallbacks({ id, name, placeholder: ph, type: inputType }, 'input'),
              type:      'fill',
              options:   [],
              attributes: { id: id ?? undefined, name: name ?? undefined, placeholder: ph ?? undefined },
              autoTransforms: transforms,
              columnContext: header,
            });
          }
        }

        // Select in this cell?
        const selM = /<select([\s\S]*?)>([\s\S]*?)<\/select>/i.exec(cell);
        if (selM) {
          const attrs   = selM[1];
          const body    = selM[2];
          const id      = attrVal(attrs, 'id');
          const name    = attrVal(attrs, 'name');
          const options = extractOptions(body);
          if (options.length > 1) {
            const sel        = buildSelector({ id, name }, 'select');
            const transforms = inferAutoTransforms(options);
            if (!fields.some(f => f.selector === sel)) {
              fields.push({
                label:     header,
                labelNorm: normalise(header),
                selector:  sel,
                fallbackSelectors: buildFallbacks({ id, name }, 'select'),
                type:      'selectOption',
                options,
                attributes: { id: id ?? undefined, name: name ?? undefined },
                autoTransforms: transforms,
                columnContext: header,
              });
            }
          }
        }
      }
    }
  }

  return fields;
}

/** Extract <option value="V">Text</option> pairs from a <select> body */
function extractOptions(body: string): FieldOption[] {
  const options: FieldOption[] = [];
  const re = /<option[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = stripHtml(m[2]).trim();
    if (text) {
      options.push({ text, value: m[1], textNorm: normalise(text) });
    }
  }
  return options;
}

/** Infer autoTransforms by examining the option texts */
function inferAutoTransforms(options: FieldOption[]): AutoTransform[] {
  const real = options.filter(o => o.value !== '');
  if (real.length === 0) return [];
  const allUpper = real.every(o => o.text === o.text.toUpperCase() && /[A-Z]/.test(o.text));
  const allLower = real.every(o => o.text === o.text.toLowerCase() && /[a-z]/.test(o.text));
  if (allUpper) return ['toUpperCase'];
  if (allLower) return ['toLowerCase'];
  return [];
}

/** Extract visible text from all <button> and submit inputs */
function extractButtonLabels(html: string): string[] {
  const labels = new Set<string>();
  const btnRe = /<button[^>]*>([\s\S]*?)<\/button>/gi;
  let m: RegExpExecArray | null;
  while ((m = btnRe.exec(html)) !== null) {
    const t = stripHtml(m[1]).trim();
    if (t) labels.add(t);
  }
  const spnRe = /<span[^>]*class=["'][^"']*btn-txt[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = spnRe.exec(html)) !== null) {
    const t = stripHtml(m[1]).trim();
    if (t) labels.add(t);
  }
  return [...labels];
}

/** Extract all <th> column header texts */
function extractColumnHeaders(html: string): string[] {
  const headers: string[] = [];
  const re = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = stripHtml(m[1]).trim();
    if (t) headers.push(t);
  }
  return [...new Set(headers)];
}

/** Group radio/checkbox fields into { groupName: [label1, label2] } maps */
function buildGroupMap(
  fields: FormFieldMap[],
  kind:   'radio' | 'checkbox',
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  const type = kind === 'radio' ? 'click' : 'check';
  for (const f of fields) {
    if (f.type === type && f.groupLabels) {
      groups[f.label] = f.groupLabels;
    }
  }
  return groups;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTOR BUILDING
// ═══════════════════════════════════════════════════════════════════════════════

interface AttrBag {
  id?:         string | null;
  name?:       string | null;
  ariaLabel?:  string | null;
  dataTestId?: string | null;
  placeholder?: string | null;
  type?:       string | null;
}

function buildSelector(attrs: AttrBag, tag: 'input' | 'select' | 'textarea'): string {
  if (attrs.dataTestId) return `[data-testid="${attrs.dataTestId}"]`;
  if (attrs.id)         return `#${attrs.id}`;
  if (attrs.name)       return `${tag}[name="${attrs.name}"]`;
  if (attrs.ariaLabel)  return `${tag}[aria-label="${attrs.ariaLabel}"]`;
  if (attrs.placeholder) return `${tag}[placeholder="${attrs.placeholder}"]`;
  if (attrs.type && tag === 'input') return `input[type="${attrs.type}"]:visible`;
  return `${tag}:visible`;
}

function buildFallbacks(attrs: AttrBag, tag: 'input' | 'select' | 'textarea'): string[] {
  const out: string[] = [];
  if (attrs.id)         out.push(`[id="${attrs.id}"]`);
  if (attrs.name)       out.push(`[name="${attrs.name}"]`);
  if (attrs.ariaLabel)  out.push(`[aria-label="${attrs.ariaLabel}"]`);
  if (attrs.placeholder) out.push(`${tag}[placeholder*="${attrs.placeholder}" i]`);
  if (attrs.type && tag === 'input') out.push(`input[type="${attrs.type}"]:visible`);
  return out.filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUZZY MATCHING — LABEL
// ═══════════════════════════════════════════════════════════════════════════════

interface LabelMatch { score: number; method: MatchMethod }

function matchLabel(userField: string, field: FormFieldMap): LabelMatch {
  const uf    = userField.trim();
  const label = field.label;
  const cn    = field.columnContext;

  // 1. Exact
  if (uf === label)                                         return { score: 1.0,  method: 'exact' };
  if (cn && uf === cn)                                      return { score: 1.0,  method: 'exact' };

  // 2. Normalised
  const ufn = normalise(uf);
  if (ufn === field.labelNorm)                              return { score: 0.95, method: 'normalised' };
  if (cn && ufn === normalise(cn))                          return { score: 0.95, method: 'normalised' };

  // 3. Token overlap
  const tok = tokenOverlap(uf, label);
  if (tok >= 0.85)                                          return { score: 0.85 + (tok - 0.85) * 0.5, method: 'tokenOverlap' };
  if (cn) {
    const ctok = tokenOverlap(uf, cn);
    if (ctok >= 0.85)                                       return { score: 0.85 + (ctok - 0.85) * 0.5, method: 'columnHeader' };
  }

  // 4. Substring
  const ulc = uf.toLowerCase();
  const llc = label.toLowerCase();
  if (ulc.includes(llc) || llc.includes(ulc))              return { score: 0.75, method: 'substring' };
  if (cn) {
    const cnlc = cn.toLowerCase();
    if (ulc.includes(cnlc) || cnlc.includes(ulc))          return { score: 0.75, method: 'columnHeader' };
  }

  // 5. Token overlap (lower threshold)
  if (tok >= 0.5)                                           return { score: 0.5 + tok * 0.2, method: 'tokenOverlap' };
  if (cn) {
    const ctok = tokenOverlap(uf, cn);
    if (ctok >= 0.5)                                        return { score: 0.5 + ctok * 0.2, method: 'columnHeader' };
  }

  // 6. Levenshtein — compare normalised strings to avoid label decoration noise
  const lev = levenshteinSimilarity(ufn, field.labelNorm);
  if (lev >= 0.7)                                           return { score: lev * 0.85, method: 'levenshtein' };

  // 6b. Levenshtein against column context
  if (cn) {
    const levCn = levenshteinSimilarity(ufn, normalise(cn));
    if (levCn >= 0.7)                                       return { score: levCn * 0.85, method: 'columnHeader' };
  }

  // 7. Acronym
  if (acronymOf(label) === uf.toUpperCase() && uf.length >= 2)
                                                            return { score: 0.6,  method: 'acronym' };

  return { score: Math.max(tok, lev) * 0.4, method: 'unmatched' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUZZY MATCHING — VALUE
// ═══════════════════════════════════════════════════════════════════════════════

interface ValueMatch {
  optionText:    string;
  optionValue:   string;
  originalValue: string;
  score:         number;
  method:        MatchMethod;
}

function matchValue(userValue: string, field: FormFieldMap): ValueMatch {
  const uv = userValue.trim();
  let best: ValueMatch = {
    optionText:    uv,
    optionValue:   uv,
    originalValue: uv,
    score:         0,
    method:        'unmatched',
  };

  for (const opt of field.options) {
    // 1. Exact
    if (uv === opt.text)                                 return { optionText: opt.text, optionValue: opt.value, originalValue: uv, score: 1.0,  method: 'exact' };

    // 2. Normalised
    if (normalise(uv) === opt.textNorm)                  { best = pick(best, { optionText: opt.text, optionValue: opt.value, originalValue: uv, score: 0.95, method: 'normalised' }); continue; }

    // 3. AutoTransform
    for (const tr of field.autoTransforms) {
      if (applyTransform(uv, tr) === opt.text)           { best = pick(best, { optionText: opt.text, optionValue: opt.value, originalValue: uv, score: 0.90, method: 'autoTransform' }); break; }
    }

    // 4. Levenshtein
    const lev = levenshteinSimilarity(uv, opt.text);
    if (lev >= 0.8)                                      { best = pick(best, { optionText: opt.text, optionValue: opt.value, originalValue: uv, score: lev * 0.9, method: 'levenshtein' }); continue; }

    // 5. Token overlap
    const tok = tokenOverlap(uv, opt.text);
    if (tok >= 0.7)                                      { best = pick(best, { optionText: opt.text, optionValue: opt.value, originalValue: uv, score: tok * 0.8, method: 'tokenOverlap' }); }
  }

  return best;
}

function pick(a: ValueMatch, b: ValueMatch): ValueMatch {
  return b.score > a.score ? b : a;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUZZY ALGORITHMS — PURE TYPESCRIPT
// ═══════════════════════════════════════════════════════════════════════════════

/** Two-row rolling Levenshtein — O(m×n) time, O(n) space */
function levenshtein(a: string, b: string): number {
  const aLen = a.length, bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  let prev = Array.from({ length: bLen + 1 }, (_, i) => i);
  let curr = new Array<number>(bLen + 1);
  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bLen];
}

export function levenshteinSimilarity(a: string, b: string): number {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  const dist   = levenshtein(al, bl);
  const maxLen = Math.max(al.length, bl.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

/** Jaccard-style token overlap on word sets */
export function tokenOverlap(a: string, b: string): number {
  const setA = new Set(tokenise(a));
  const setB = new Set(tokenise(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let hits = 0;
  for (const t of setA) if (setB.has(t)) hits++;
  return hits / Math.max(setA.size, setB.size);
}

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\W_]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);
}

function acronymOf(phrase: string): string {
  return tokenise(phrase).map(t => t[0]).join('').toUpperCase();
}

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function applyTransform(s: string, t: AutoTransform): string {
  switch (t) {
    case 'toUpperCase':       return s.toUpperCase();
    case 'toLowerCase':       return s.toLowerCase();
    case 'toTitleCase':       return s.replace(/\b\w/g, c => c.toUpperCase());
    case 'trim':              return s.trim();
    case 'collapseWhitespace': return s.replace(/\s+/g, ' ').trim();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Extract value of attribute `attr` from an HTML attribute block string */
function attrVal(attrs: string, attr: string): string | null {
  const re = new RegExp(`${attr}=["']([^"']*)["']`, 'i');
  const m  = re.exec(attrs);
  return m ? m[1] : null;
}

/** Strip all HTML tags from a string, returning plain text */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')        // remove tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#?\w+;/g, '');
}

/**
 * Clean a raw label string: strip required-field markers (* :), excess punctuation,
 * and collapse whitespace — so "Gateway Type :*" → "Gateway Type".
 */
function cleanLabel(raw: string): string {
  return raw
    .replace(/[*:]+/g, ' ')   // common required-field decorators
    .replace(/\s+/g, ' ')
    .trim();
}

function tierFromScore(score: number): CorrelationResult['confidenceTier'] {
  if (score >= CONFIDENCE.HIGH)   return 'high';
  if (score >= CONFIDENCE.MEDIUM) return 'medium';
  if (score >= CONFIDENCE.LOW)    return 'low';
  return 'none';
}

function noMatch(userField: string, userValue: string, notes: string[]): CorrelationResult {
  return {
    matched:             false,
    selector:            null,
    fallbackSelectors:   [],
    actionType:          null,
    resolvedValue:       userValue || null,
    resolvedOptionValue: null,
    confidence:          0,
    confidenceTier:      'none',
    labelMatchMethod:    'unmatched',
    valueMatchMethod:    null,
    matchedField:        null,
    notes,
  };
}
