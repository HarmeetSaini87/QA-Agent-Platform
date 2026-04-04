/**
 * healer.agent.ts
 *
 * Self-healing selector engine.
 *
 * How it works
 * ────────────
 * When a Playwright step fails because a selector is not found, BasePage calls
 * `healSelector()`.  The healer:
 *
 *   1. Receives: failed selector + DOM snapshot + step context
 *   2. Runs heuristic analysis (no external API required):
 *      - Scores every interactive element in the DOM
 *      - Ranks by selector stability (data-testid > id > aria > name > text > class)
 *      - Applies row-scoping when a row-text is detected in the step description
 *   3. Returns a `HealResponse` with the best candidate selector
 *   4. Optionally writes an AI prompt file so the AI IDE can review and improve the result
 *   5. The caller (BasePage / executor) may then call `applyPatch()` to update the POM
 *
 * The heuristic covers the majority of real breakages (attribute renames, class changes,
 * framework upgrades).  AI-assisted healing is layered on top for ambiguous cases.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HealRequest {
  /** The selector that failed */
  failedSelector: string;
  /** Human-readable step description — used to understand intent */
  stepDescription: string;
  /** Playwright action type (click, fill, assertVisible, …) */
  stepAction: string;
  /** The raw error message from Playwright */
  errorMessage: string;
  /** Full or scoped page DOM as an HTML string */
  domSnapshot: string;
  /** Optional: absolute path to the POM file that contains the selector */
  pomFile?: string;
  /** Optional: the line number (1-based) of the selector in the POM file */
  pomLine?: number;
  /** Optional: row text that should scope the selector (e.g. a record name) */
  rowScopeText?: string;
}

export interface PatchInstruction {
  pomFile: string;
  findLine: string;
  replaceLine: string;
}

export interface HealResponse {
  status: 'healed' | 'failed' | 'ambiguous';
  originalSelector: string;
  healedSelector: string;
  fallbackSelectors: string[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  rowScoped: boolean;
  rowScopeSelector: string | null;
  patchInstruction: PatchInstruction | null;
  shouldPatch: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Selector stability tiers — higher number = more stable */
const SELECTOR_TIER: Record<string, number> = {
  'data-testid':  100,
  'data-action':   95,
  'data-id':       90,
  id:              85,
  'aria-label':    80,
  role:            75,
  name:            70,
  placeholder:     65,
  type:            55,
  text:            50,
  class:           30,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempt to heal a broken selector.
 * Returns a HealResponse — caller decides whether to apply the patch.
 */
export async function healSelector(req: HealRequest): Promise<HealResponse> {
  logger.info(`Healer: analysing broken selector "${req.failedSelector}"`);

  const candidates = extractCandidates(req.domSnapshot, req.stepDescription, req.stepAction);

  if (candidates.length === 0) {
    return failedResponse(req, 'No interactive elements found in DOM snapshot');
  }

  // Apply row-scoping if we have row text context
  const rowText = extractRowText(req.rowScopeText, req.stepDescription);
  if (rowText) {
    for (const c of candidates) {
      c.selector = `tr:has-text("${rowText}") ${c.selector}`;
      c.tier += 5; // slight boost for being row-scoped
    }
  }

  // Sort by tier descending
  candidates.sort((a, b) => b.tier - a.selector.length - (a.tier - b.tier < 0 ? 0 : 0));
  candidates.sort((a, b) => b.tier - a.tier);

  const best = candidates[0];
  const rest = candidates.slice(1, 4).map(c => c.selector);

  const confidence: 'high' | 'medium' | 'low' =
    best.tier >= 80 ? 'high' :
    best.tier >= 50 ? 'medium' : 'low';

  const status: 'healed' | 'ambiguous' =
    candidates.length > 1 && best.tier === candidates[1].tier ? 'ambiguous' : 'healed';

  // Build patch instruction if POM file is known
  const patchInstruction = buildPatchInstruction(req, best.selector, confidence);
  const shouldPatch = confidence === 'high' && patchInstruction !== null;

  const response: HealResponse = {
    status,
    originalSelector:  req.failedSelector,
    healedSelector:    best.selector,
    fallbackSelectors: rest,
    confidence,
    reasoning: best.reasoning,
    rowScoped:         !!rowText,
    rowScopeSelector:  rowText ? `tr:has-text("${rowText}")` : null,
    patchInstruction,
    shouldPatch,
  };

  logger.info(
    `Healer: ${status} (${confidence}) — "${req.failedSelector}" → "${best.selector}"`
  );

  // Write AI prompt file for audit / AI-IDE review
  writeAiPromptFile(req, response);

  return response;
}

/**
 * Apply a confirmed heal patch to the POM file on disk.
 * Returns true if the patch was applied, false if the line was not found.
 */
export function applyPatch(patch: PatchInstruction): boolean {
  if (!fs.existsSync(patch.pomFile)) {
    logger.warn(`Patcher: POM file not found: ${patch.pomFile}`);
    return false;
  }

  const content = fs.readFileSync(patch.pomFile, 'utf-8');
  if (!content.includes(patch.findLine)) {
    logger.warn(`Patcher: line not found in ${patch.pomFile}: "${patch.findLine}"`);
    return false;
  }

  const patched = content.replace(patch.findLine, patch.replaceLine);
  fs.writeFileSync(patch.pomFile, patched, 'utf-8');
  logger.info(`Patcher: updated ${path.basename(patch.pomFile)} — "${patch.findLine}" → "${patch.replaceLine}"`);
  return true;
}

// ── DOM analysis ──────────────────────────────────────────────────────────────

interface Candidate {
  selector: string;
  tier: number;
  reasoning: string;
}

/**
 * Parse the DOM snapshot and score every interactive element as a candidate.
 * Uses regex extraction — no full HTML parser needed for typical snapshots.
 */
function extractCandidates(
  dom: string,
  stepDescription: string,
  stepAction: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  const descLower = stepDescription.toLowerCase();

  // Determine what kind of element we're looking for from the action + description
  const wantButton  = /click|submit|save|delete|add|confirm|cancel|back|search/.test(descLower) || stepAction === 'click';
  const wantInput   = /fill|type|enter|input|field/.test(descLower) || stepAction === 'fill';
  const wantSelect  = /select|choose|dropdown/.test(descLower) || stepAction === 'selectOption';
  const wantFile    = /upload|file/.test(descLower) || stepAction === 'setInputFiles';

  // Helper: match both single and double quoted attribute values
  const attrVal = (name: string) =>
    new RegExp(`${name}=["']([^"']+)["']`, 'g');

  // ── data-testid ───────────────────────────────────────────────────────────
  for (const m of dom.matchAll(attrVal('data-testid'))) {
    const val = m[1];
    if (!isRelevantAttr(val, descLower)) continue;
    candidates.push({
      selector:  `[data-testid="${val}"]`,
      tier:      SELECTOR_TIER['data-testid'],
      reasoning: `Found data-testid="${val}" in DOM — matches step intent`,
    });
  }

  // ── data-action ───────────────────────────────────────────────────────────
  for (const m of dom.matchAll(attrVal('data-action'))) {
    const val = m[1];
    if (!isRelevantAttr(val, descLower)) continue;
    candidates.push({
      selector:  `[data-action="${val}"]`,
      tier:      SELECTOR_TIER['data-action'],
      reasoning: `Found data-action="${val}" in DOM — matches step intent`,
    });
  }

  // ── id attribute ─────────────────────────────────────────────────────────
  const idTagPattern = (wantInput || wantSelect || wantFile)
    ? /(?:input|textarea|select|div|span)[^>]*\sid=["']([^"']+)["']/g
    : /(?:button|a|input|div|span)[^>]*\sid=["']([^"']+)["']/g;

  for (const m of dom.matchAll(idTagPattern)) {
    const val = m[1];
    if (!isRelevantAttr(val, descLower)) continue;
    candidates.push({
      selector:  `#${cssEscapeId(val)}`,
      tier:      SELECTOR_TIER['id'],
      reasoning: `Found id="${val}" — semantically matches "${stepDescription}"`,
    });
  }

  // ── aria-label ────────────────────────────────────────────────────────────
  for (const m of dom.matchAll(attrVal('aria-label'))) {
    const val = m[1];
    if (!isRelevantAttr(val, descLower)) continue;
    candidates.push({
      selector:  `[aria-label="${val}"]`,
      tier:      SELECTOR_TIER['aria-label'],
      reasoning: `Found aria-label="${val}" in DOM`,
    });
  }

  // ── name attribute ────────────────────────────────────────────────────────
  for (const m of dom.matchAll(attrVal('name'))) {
    const val = m[1];
    if (!isRelevantAttr(val, descLower)) continue;
    const tag = wantSelect ? 'select' : 'input';
    candidates.push({
      selector:  `${tag}[name="${val}"]`,
      tier:      SELECTOR_TIER['name'],
      reasoning: `Found name="${val}" attribute`,
    });
  }

  // ── placeholder ───────────────────────────────────────────────────────────
  if (wantInput) {
    for (const m of dom.matchAll(attrVal('placeholder'))) {
      const val = m[1];
      if (!isRelevantAttr(val, descLower)) continue;
      candidates.push({
        selector:  `input[placeholder="${val}"]`,
        tier:      SELECTOR_TIER['placeholder'],
        reasoning: `Found placeholder="${val}" attribute`,
      });
    }
  }

  // ── Button / link text ────────────────────────────────────────────────────
  if (wantButton) {
    // <button>Text</button>  — allow nested spans but capture direct text nodes
    for (const m of dom.matchAll(/<button[^>]*>\s*(?:<[^>]+>)*\s*([A-Za-z][^<]{1,39}?)\s*(?:<\/[^>]+>)*\s*<\/button>/gi)) {
      const text = m[1].trim();
      if (!isRelevantText(text, descLower)) continue;
      candidates.push({
        selector:  `button:has-text("${text}")`,
        tier:      SELECTOR_TIER['text'],
        reasoning: `Found button with text "${text}"`,
      });
    }
    // <a>Text</a>
    for (const m of dom.matchAll(/<a[^>]*>\s*([^<]{2,40})\s*<\/a>/gi)) {
      const text = m[1].trim();
      if (!isRelevantText(text, descLower)) continue;
      candidates.push({
        selector:  `a:has-text("${text}")`,
        tier:      SELECTOR_TIER['text'],
        reasoning: `Found anchor with text "${text}"`,
      });
    }
  }

  // ── Class-based fallback (last resort) ────────────────────────────────────
  if (candidates.length === 0) {
    const classTagPat = wantButton
      ? /<button[^>]*class=["']([^"']+)["']/g
      : /<input[^>]*class=["']([^"']+)["']/g;
    for (const m of dom.matchAll(classTagPat)) {
      const classes = m[1].split(/\s+/).filter(c => isRelevantAttr(c, descLower));
      if (classes.length === 0) continue;
      candidates.push({
        selector:  `.${classes[0]}`,
        tier:      SELECTOR_TIER['class'],
        reasoning: `Fallback: found class "${classes[0]}" on <${wantButton ? 'button' : 'input'}>`,
      });
    }
  }

  return candidates;
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

/**
 * Returns true if the attribute value is semantically related to the step description.
 * Uses token overlap — splits both into words and checks for common terms.
 */
function isRelevantAttr(attr: string, descLower: string): boolean {
  if (!attr || attr.length < 2) return false;
  const attrWords = attr.toLowerCase().replace(/[-_]/g, ' ').split(/\s+/);
  for (const word of attrWords) {
    if (word.length >= 3 && descLower.includes(word)) return true;
  }
  return false;
}

function isRelevantText(text: string, descLower: string): boolean {
  const textLower = text.toLowerCase().trim();
  if (textLower.length < 2 || textLower.length > 50) return false;
  // Direct containment
  if (descLower.includes(textLower)) return true;
  // Word overlap
  const words = textLower.split(/\s+/);
  return words.some(w => w.length >= 3 && descLower.includes(w));
}

// ── Row scope extraction ──────────────────────────────────────────────────────

/**
 * Determine if the step should be row-scoped and extract the row text.
 * Looks for quoted strings, record names, or explicit rowScopeText.
 */
function extractRowText(
  explicitRowText: string | undefined,
  stepDescription: string,
): string | null {
  if (explicitRowText?.trim()) return explicitRowText.trim();

  // Look for quoted text in the description: 'GW-Test-01' or "My Record"
  const quoted = stepDescription.match(/["']([^"']{3,}?)["']/);
  if (quoted) return quoted[1];

  // Look for "on row X" or "for X" or "record X" patterns
  const rowMatch = stepDescription.match(/(?:on row|for record|record named?|row)\s+["']?([A-Za-z0-9_\-\.]+)["']?/i);
  if (rowMatch) return rowMatch[1];

  return null;
}

// ── Patch instruction builder ─────────────────────────────────────────────────

function buildPatchInstruction(
  req: HealRequest,
  healedSelector: string,
  confidence: 'high' | 'medium' | 'low',
): PatchInstruction | null {
  if (!req.pomFile || !fs.existsSync(req.pomFile)) return null;
  if (confidence !== 'high') return null;

  try {
    const lines = fs.readFileSync(req.pomFile, 'utf-8').split('\n');

    // Find the line containing the failed selector
    let findLine: string | null = null;
    for (const line of lines) {
      if (line.includes(req.failedSelector)) {
        findLine = line;
        break;
      }
    }

    if (!findLine) return null;

    // Build the replacement line: swap the selector value, keep the rest
    const replaceLine = findLine.replace(
      JSON.stringify(req.failedSelector).replace(/^"|"$/g, '').replace(/'/g, "\\'"),
      healedSelector,
    ) || findLine.replace(req.failedSelector, healedSelector);

    if (replaceLine === findLine) return null; // nothing changed

    return { pomFile: req.pomFile, findLine, replaceLine };
  } catch {
    return null;
  }
}

// ── Failed response helper ────────────────────────────────────────────────────

function failedResponse(req: HealRequest, reason: string): HealResponse {
  return {
    status:            'failed',
    originalSelector:  req.failedSelector,
    healedSelector:    req.failedSelector,
    fallbackSelectors: [],
    confidence:        'low',
    reasoning:         reason,
    rowScoped:         false,
    rowScopeSelector:  null,
    patchInstruction:  null,
    shouldPatch:       false,
  };
}

// ── AI prompt file writer ─────────────────────────────────────────────────────

/**
 * Writes a structured JSON file that an AI IDE can read, improve upon,
 * and write back as a confirmed heal response.
 * File: results/heals/<timestamp>-<safeSelector>.json
 */
function writeAiPromptFile(req: HealRequest, heuristic: HealResponse): void {
  try {
    const dir     = path.resolve('results', 'heals');
    fs.mkdirSync(dir, { recursive: true });

    const safe    = req.failedSelector.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const ts      = Date.now();
    const file    = path.join(dir, `${ts}-${safe}.json`);

    const payload = {
      _note: 'AI-review file — edit healedSelector/fallbackSelectors/patchInstruction and set confirmed:true',
      confirmed:        false,
      heuristicResult:  heuristic,
      request: {
        failedSelector:  req.failedSelector,
        stepDescription: req.stepDescription,
        stepAction:      req.stepAction,
        errorMessage:    req.errorMessage,
        pomFile:         req.pomFile ?? null,
        pomLine:         req.pomLine ?? null,
        domSnapshot:     req.domSnapshot.slice(0, 8000), // cap to 8 KB
      },
    };

    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    logger.debug(`Healer: AI prompt written → ${file}`);
  } catch {
    // Non-fatal — logging only
  }
}

// ── CSS ID escaping ────────────────────────────────────────────────────────────

function cssEscapeId(id: string): string {
  // Escape leading digits and special chars for CSS id selectors
  return id.replace(/^(\d)/, '\\3$1 ').replace(/([^\w-])/g, '\\$1');
}
