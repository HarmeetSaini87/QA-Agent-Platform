/**
 * recorderParser.ts — QA Agent Platform UI Recorder
 *
 * Receives a raw recorded event from recorder.js, resolves the locator
 * against the project's Locator Repository, auto-creates a new repo entry
 * if no match is found, and returns a fully-shaped ScriptStep.
 *
 * Called by the /api/recorder/step endpoint in server.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { readAll, upsert, LOCATORS } from '../data/store';
import type { Locator, ScriptStep } from '../data/types';

// ── Raw event shape posted by recorder.js ─────────────────────────────────────
export interface RecorderEvent {
  token:        string;
  stepNum:      number;
  eventType:    string;   // CLICK | FILL | SELECT | CHECK | UNCHECK | UPLOAD | GOTO |
                          // ACCEPT_ALERT | ACCEPT_DIALOG | HANDLE_PROMPT
  selector:     string;   // best CSS / XPath / testid selector derived by recorder
  selectorType: string;   // css | xpath | testid
  value:        string;
  smartName:    string;   // human-readable name derived from element attributes
  tagName:      string;
  url:          string;
  shadowPath?:  boolean;
  iframeSrc?:   string | null;
}

// ── Keyword mapping ───────────────────────────────────────────────────────────
const EVENT_TO_KEYWORD: Record<string, string> = {
  CLICK:         'CLICK',
  FILL:          'FILL',
  SELECT:        'SELECT',
  CHECK:         'CHECK',
  UNCHECK:       'UNCHECK',
  UPLOAD:        'UPLOAD',
  GOTO:          'GOTO',
  ACCEPT_ALERT:  'ACCEPT ALERT',
  ACCEPT_DIALOG: 'ACCEPT DIALOG',
  HANDLE_PROMPT: 'HANDLE PROMPT',
};

// ── Locator Repository resolution ─────────────────────────────────────────────
/**
 * Normalise a selector for comparison: lowercase, collapse whitespace.
 */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Look up an existing Locator in the repo by selector (exact normalised match).
 * Returns the matched Locator or undefined.
 */
function findLocatorBySelector(projectId: string, selector: string): Locator | undefined {
  if (!selector) return undefined;
  const norm = normalise(selector);
  return readAll<Locator>(LOCATORS).find(
    l => l.projectId === projectId && normalise(l.selector) === norm,
  );
}

/**
 * Generate a clean locator name from smartName (fallback: numbered entry).
 */
function buildLocatorName(smartName: string, selector: string, stepNum: number): string {
  if (smartName && smartName.trim()) {
    // Capitalise each word, strip leading/trailing junk
    return smartName.trim().replace(/\s+/g, ' ').substring(0, 80);
  }
  // Derive from selector
  const m = selector.match(/#([\w-]+)/) || selector.match(/\[([\w-]+)="([^"]+)"\]/);
  if (m) return m[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return `Recorded Element ${stepNum}`;
}

/**
 * Auto-create a new Locator Repository entry for an unmatched selector.
 * Returns the new Locator.
 */
function createLocator(
  projectId: string,
  selector:  string,
  selectorType: string,
  smartName: string,
  stepNum:   number,
  createdBy: string,
): Locator {
  const name = buildLocatorName(smartName, selector, stepNum);
  const loc: Locator = {
    id:           uuidv4(),
    name,
    selector,
    selectorType: mapSelectorType(selectorType),
    pageModule:   '',               // user can categorise later
    projectId,
    description:  'Auto-captured by recorder',
    createdBy,
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
  upsert(LOCATORS, loc);
  return loc;
}

function mapSelectorType(raw: string): Locator['selectorType'] {
  const map: Record<string, Locator['selectorType']> = {
    css:    'css',
    xpath:  'xpath',
    id:     'id',
    name:   'name',
    text:   'text',
    testid: 'testid',
  };
  return map[raw] ?? 'css';
}

// ── Main parser ───────────────────────────────────────────────────────────────
export interface ParseResult {
  step:            ScriptStep;
  locatorCreated:  boolean;    // true if a new repo entry was auto-created
  locatorName:     string;     // name of the resolved / created locator
}

export function parseRecorderEvent(
  event:     RecorderEvent,
  projectId: string,
  createdBy: string,
  order:     number,           // 1-based step position in the script
): ParseResult {
  const keyword = EVENT_TO_KEYWORD[event.eventType] ?? event.eventType;

  // Keywords that don't target a DOM element — no locator needed
  const noLocatorKeywords = new Set([
    'GOTO', 'ACCEPT ALERT', 'ACCEPT DIALOG', 'HANDLE PROMPT',
  ]);

  let locatorId:   string | null = null;
  let locatorName: string        = '';
  let locator:     string | null = event.selector || null;
  let locatorType: string        = event.selectorType || 'css';
  let locatorCreated             = false;

  if (!noLocatorKeywords.has(keyword) && event.selector) {
    // Step 1: try to match existing repo entry
    const existing = findLocatorBySelector(projectId, event.selector);
    if (existing) {
      locatorId   = existing.id;
      locatorName = existing.name;
      locator     = existing.selector;
      locatorType = existing.selectorType;
    } else {
      // Step 2: auto-create new repo entry
      const newLoc = createLocator(
        projectId,
        event.selector,
        event.selectorType,
        event.smartName,
        event.stepNum,
        createdBy,
      );
      locatorId      = newLoc.id;
      locatorName    = newLoc.name;
      locator        = newLoc.selector;
      locatorType    = newLoc.selectorType;
      locatorCreated = true;
    }
  }

  const step: ScriptStep = {
    id:          uuidv4(),
    order,
    keyword,
    locator,
    locatorId,
    locatorType,
    locatorName: locatorName || undefined as any,  // convenience — not in type but used by UI
    valueMode:   'static',
    value:       event.value || null,
    testData:    [],
    description: buildDescription(event),
    screenshot:  false,
  } as ScriptStep & { locatorName?: string };

  return { step, locatorCreated, locatorName };
}

// ── Description builder ───────────────────────────────────────────────────────
function buildDescription(event: RecorderEvent): string {
  const name = event.smartName || event.selector || '';
  switch (event.eventType) {
    case 'CLICK':         return name ? `Click ${name}` : 'Click element';
    case 'FILL':          return name ? `Fill ${name}` : 'Fill input';
    case 'SELECT':        return name ? `Select ${event.value} in ${name}` : `Select ${event.value}`;
    case 'CHECK':         return name ? `Check ${name}` : 'Check element';
    case 'UNCHECK':       return name ? `Uncheck ${name}` : 'Uncheck element';
    case 'UPLOAD':        return `Upload file: ${event.value}`;
    case 'GOTO':          return `Navigate to ${event.value}`;
    case 'ACCEPT_ALERT':  return `Accept alert: ${event.value}`;
    case 'ACCEPT_DIALOG': return `Accept confirm dialog: ${event.value}`;
    case 'HANDLE_PROMPT': return `Handle prompt: ${event.value}`;
    default:              return event.eventType;
  }
}
