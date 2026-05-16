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
import type { Locator, ScriptStep, LocatorAlternative, HealingProfile } from '../data/types';

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
  // ── Self-Healing fields (recorder v4+) ─────────────────────────────────────
  healingProfile?:   HealingProfile;
  alternatives?:     LocatorAlternative[];
  importanceScore?:  number;
  pageKey?:          string;
  // ── v5 gap-fix fields ──────────────────────────────────────────────────────
  frameContext?:    { frameId: string | null; frameName: string | null; frameSrc: string | null } | null;
  position?:        { x: number; y: number } | null;   // CLICK_AT_COORDS
  scrollPosition?:  { x: number; y: number } | null;   // SCROLL
  toSelector?:      string | null;                      // DRAG target selector
  toSelectorType?:  string | null;                      // DRAG target selectorType
  canvasDrag?:      { fromX: number; fromY: number; toX: number; toY: number } | null; // CANVAS_DRAG
  rfAction?:        Record<string, unknown> | null; // RF_* semantic payload
  enrichRfDrop?:    boolean;                        // true = update last RF_DROP_NODE step, not create new
}

// ── Keyword mapping ───────────────────────────────────────────────────────────
const EVENT_TO_KEYWORD: Record<string, string> = {
  CLICK:          'CLICK',
  FILL:           'FILL',
  SELECT:         'SELECT',
  CHECK:          'CHECK',
  UNCHECK:        'UNCHECK',
  UPLOAD:         'UPLOAD FILE',
  FILE_CHOOSER:   'FILE CHOOSER',
  DATE_PICKER:    'DATE PICKER',
  GOTO:           'GOTO',
  ACCEPT_ALERT:   'ACCEPT ALERT',
  ACCEPT_DIALOG:  'ACCEPT DIALOG',
  HANDLE_PROMPT:  'HANDLE PROMPT',
  ASSERT_VISIBLE:  'ASSERT VISIBLE',  // auto-captured from flash/toast messages
  ASSERT_TOAST:    'ASSERT TOAST',    // CR4: auto-captured toast with text assertion
  ASSERT_TEXT:     'ASSERT TEXT',     // CR4: inline validation / field error message
  ASSERT_URL:      'ASSERT URL',      // CR4: auto-captured after SPA navigation
  // ── v5 new event types ────────────────────────────────────────────────────
  HOVER:           'HOVER',
  DBLCLICK:        'DBLCLICK',
  RIGHT_CLICK:     'RIGHT CLICK',
  PRESS_KEY:       'PRESS KEY',
  DRAG:            'DRAG DROP',
  SCROLL:          'SCROLL TO',
  CLICK_AT_COORDS: 'CLICK AT COORDS',
  SWITCH_FRAME:    'SWITCH FRAME',
  SWITCH_MAIN:     'SWITCH MAIN',   // auto-emitted by recorder when returning to main frame
  CANVAS_DRAG:     'CANVAS DRAG',
  // ── React Flow semantic actions ───────────────────────────────────────────
  RF_NODE_DRAG:    'RF NODE DRAG',
  RF_CONNECT:      'RF CONNECT',
  RF_PAN:          'RF PAN',
  RF_DROP_NODE:    'RF DROP NODE',
};

// ── Locator Repository resolution ─────────────────────────────────────────────
/**
 * Normalise a selector for comparison: lowercase, collapse whitespace.
 */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// HTML tag names — single-word names matching these are junk (icon tags, containers)
const JUNK_NAMES = new Set([
  'i', 'span', 'div', 'a', 'li', 'ul', 'button', 'input', 'form',
  'p', 'td', 'tr', 'th', 'img', 'svg', 'path', 'section', 'article',
  'header', 'footer', 'nav', 'main', 'aside',
]);

/**
 * Look up an existing Locator in the repo by selector (exact normalised match).
 */
function findLocatorBySelector(projectId: string, selector: string): Locator | undefined {
  if (!selector) return undefined;
  const norm = normalise(selector);
  return readAll<Locator>(LOCATORS).find(
    l => l.projectId === projectId && normalise(l.selector) === norm,
  );
}

/**
 * Look up an existing Locator by name (case-insensitive) within a project.
 * Used to avoid duplicate names from recorder auto-creates.
 */
function findLocatorByName(projectId: string, name: string): Locator | undefined {
  if (!name) return undefined;
  const norm = name.toLowerCase().trim();
  return readAll<Locator>(LOCATORS).find(
    l => l.projectId === projectId && l.name.toLowerCase().trim() === norm,
  );
}

/**
 * Convert a raw event type into a natural-language verb phrase.
 * Handles multi-word types like FILE_CHOOSER → "Choose File",
 * DATE_PICKER → "Set Date", ACCEPT_ALERT → "Accept Alert", etc.
 */
function eventTypeToVerb(eventType: string): string {
  const map: Record<string, string> = {
    CLICK:          'Click',
    FILL:           'Fill',
    SELECT:         'Select',
    CHECK:          'Check',
    UNCHECK:        'Uncheck',
    UPLOAD:         'Upload',
    FILE_CHOOSER:   'Choose File',
    DATE_PICKER:    'Set Date',
    GOTO:           'Navigate To',
    ACCEPT_ALERT:   'Accept Alert',
    ACCEPT_DIALOG:  'Accept Dialog',
    DISMISS_DIALOG: 'Dismiss Dialog',
    HANDLE_PROMPT:  'Handle Prompt',
    ASSERT_VISIBLE: 'Assert Visible',
    ASSERT_TOAST:   'Assert Toast',
    ASSERT_TEXT:    'Assert Text',
    ASSERT_URL:     'Assert URL',
    HOVER:           'Hover',
    FOCUS:           'Focus',
    DBLCLICK:        'Double Click',
    RIGHT_CLICK:     'Right Click',
    PRESS_KEY:       'Press Key',
    DRAG:            'Drag & Drop',
    SCROLL:          'Scroll',
    CLICK_AT_COORDS: 'Click At Coordinates',
    SWITCH_FRAME:    'Switch Frame',
    SWITCH_MAIN:     'Switch Main Frame',
    CANVAS_DRAG:     'Canvas Drag',
    RF_NODE_DRAG:    'RF Node Drag',
    RF_CONNECT:      'RF Connect Nodes',
    RF_PAN:          'RF Pan Canvas',
    RF_DROP_NODE:    'RF Drop Node',
  };
  if (map[eventType]) return map[eventType];
  // Generic: FILE_CHOOSER-style fallback → "File Chooser" (Title Case, underscores → spaces)
  return eventType
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Generate a clean, meaningful locator name.
 * Priority: verb-prefixed smartName > selector-derived > numbered fallback.
 * Filters out junk single-char / HTML-tag-only names.
 */
function buildLocatorName(
  smartName:    string,
  selector:     string,
  eventType:    string,
  stepNum:      number,
): string {
  const verb = eventTypeToVerb(eventType);  // e.g. "Click", "Choose File", "Set Date"

  // Clean and validate smartName
  const clean = (smartName || '').trim().replace(/\s+/g, ' ');
  const isJunk = !clean
    || clean.length <= 1
    || JUNK_NAMES.has(clean.toLowerCase())
    || /^\d+$/.test(clean);   // purely numeric

  if (!isJunk && clean.length <= 80) {
    // Prefix with verb for clarity: "Click Mediation Configuration", "Choose File Upload Area"
    return `${verb} ${clean}`.substring(0, 80);
  }

  // Derive a meaningful label from the selector — extract the human-readable part
  // 1. Stable ID: #submitBtn or @id="submitBtn" → "Submit Btn"
  const idMatch = selector.match(/(?:^#|@id=["'])([a-zA-Z][\w-]{1,40})/);
  if (idMatch) {
    return `${verb} ${idMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
  }
  // 2. for attribute on label: label[for="FlgEnable"] → "Flg Enable"
  const forMatch = selector.match(/\[for="([^"]{1,60})"\]/);
  if (forMatch) {
    return `${verb} ${forMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
  }
  // 3. aria-label, placeholder, name, title attributes
  const attrMatch = selector.match(/\[(?:aria-label|placeholder|name|title)="([^"]{2,60})"\]/);
  if (attrMatch) {
    return `${verb} ${attrMatch[1].replace(/\b\w/g, c => c.toUpperCase())}`.substring(0, 80);
  }
  // 4. XPath text: //span[normalize-space(.)="Some Text"]
  const xpathText = selector.match(/normalize-space\(\.\)="([^"]{2,60})"/);
  if (xpathText) {
    return `${verb} ${xpathText[1]}`.substring(0, 80);
  }
  // 5. data-testid / data-qa / data-cy
  const testid = selector.match(/data-(?:testid|qa|cy)="([^"]+)"/);
  if (testid) {
    return `${verb} ${testid[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`.substring(0, 80);
  }
  // 6. aria-controls / aria-owns (custom widget anchors)
  const ariaControls = selector.match(/aria-controls="([^"]{2,50})"/);
  if (ariaControls) {
    return `${verb} ${ariaControls[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
  }
  // 7. href-based: a[href="/patients"] → "Patients Link"
  const hrefMatch = selector.match(/a\[href="([^"]{1,60})"\]/);
  if (hrefMatch) {
    const hrefLabel = hrefMatch[1].replace(/^\/+/, '').replace(/[-_/]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (hrefLabel) return `${verb} ${hrefLabel} Link`.substring(0, 80);
  }
  // 8. Generic type attribute: input[type="submit"] → "Submit Input"
  const typeMatch = selector.match(/\[type="([^"]{2,30})"\]/);
  if (typeMatch) {
    return `${verb} ${typeMatch[1].replace(/\b\w/g, c => c.toUpperCase())}`;
  }

  // Numbered fallback — still prefixed with natural verb
  return `${verb} Element ${stepNum}`;
}

/**
 * Auto-create a new draft Locator Repository entry for an unmatched selector.
 * Marked as draft=true — will be deduped and finalised at Save Script time.
 * Returns the newly created Locator.
 */
function createLocator(
  projectId:      string,
  selector:       string,
  selectorType:   string,
  smartName:      string,
  eventType:      string,
  stepNum:        number,
  createdBy:      string,
  healingProfile?: HealingProfile,
  alternatives?:   LocatorAlternative[],
  importanceScore?: number,
  pageKey?:        string,
): { loc: Locator; created: boolean } {
  const name = buildLocatorName(smartName, selector, eventType, stepNum);

  const loc: Locator = {
    id:             uuidv4(),
    name,
    selector,
    selectorType:   mapSelectorType(selectorType),
    pageModule:     '',
    projectId,
    description:    'Auto-captured by recorder',
    draft:          true,   // finalised (deduped) when script is saved
    createdBy,
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    // Self-healing fields
    importanceScore: importanceScore ?? undefined,
    alternatives:    alternatives?.length ? alternatives : undefined,
    healingProfile:  healingProfile ?? undefined,
    healingStats: {
      healCount:      0,
      lastHealedAt:   null,
      lastHealedFrom: null,
      lastHealedBy:   null,
    },
    pageKey:    pageKey ?? null,
    nameSource: 'auto',   // recorder-generated — user rename via UI flips this to 'user'
  };
  upsert(LOCATORS, loc);
  return { loc, created: true };
}

function mapSelectorType(raw: string): Locator['selectorType'] {
  const map: Record<string, Locator['selectorType']> = {
    css:         'css',
    xpath:       'xpath',
    id:          'id',
    name:        'name',
    text:        'text',
    testid:      'testid',
    role:        'role',
    label:       'label',
    placeholder: 'placeholder',
    nth:         'nth',
    last:        'last',
  };
  return map[raw] ?? 'css';
}

/**
 * Recorder v2 emits composite selector strings for Playwright-native locators:
 *   role:button:Upload Files   → locatorType='role',    locator='button:Upload Files'
 *   label:Username             → locatorType='label',   locator='Username'
 *   placeholder:Enter name     → locatorType='placeholder', locator='Enter name'
 *
 * This function decodes those and returns { selector, selectorType } ready for storage.
 */
function decodeSelector(raw: string, rawType: string): { selector: string; selectorType: string } {
  if (rawType === 'role' || raw.startsWith('role:')) {
    const parts = raw.replace(/^role:/, '').split(':');
    // parts[0] = role (button/link/…), parts[1..] = accessible name
    const name = parts.slice(1).join(':');
    return { selector: `${parts[0]}:${name}`, selectorType: 'role' };
  }
  if (rawType === 'label' || raw.startsWith('label:')) {
    return { selector: raw.replace(/^label:/, ''), selectorType: 'label' };
  }
  if (rawType === 'placeholder' || raw.startsWith('placeholder:')) {
    return { selector: raw.replace(/^placeholder:/, ''), selectorType: 'placeholder' };
  }
  return { selector: raw, selectorType: rawType };
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
    'ASSERT URL', 'ASSERT TOAST', 'WAIT FOR TOAST',
    'PRESS KEY',    // chord string, not a DOM element
    'SCROLL TO',    // positional scroll — value carries {x,y}; locator is optional
    'SWITCH FRAME', // frame selector stored in value, not locator repo
    'SWITCH MAIN',  // no locator — returns to top-level document
    'RF PAN',       // viewport pan — no element locator
    'RF DROP NODE', // drop target is the canvas pane, not a stable element locator
    // RF NODE DRAG: selector is nodeStableSel (data-testid/aria-label/text) — saved to locator repo
    // RF CONNECT:   selector is sourceNodeStableSel — saved to locator repo for self-healing
    // CANVAS DRAG, RF NODE DRAG, RF CONNECT intentionally NOT here — node locator IS saved to repo.
    // ASSERT TEXT and ASSERT VISIBLE DO have a locator target
  ]);

  let locatorId:   string | null = null;
  let locatorName: string        = '';
  let locatorCreated             = false;

  // Decode composite selector strings emitted by recorder v2
  // e.g. "role:button:Upload Files" → { selector: "button:Upload Files", selectorType: "role" }
  const decoded = decodeSelector(event.selector || '', event.selectorType || 'css');
  let locator:     string | null = decoded.selector || null;
  let locatorType: string        = decoded.selectorType;

  if (!noLocatorKeywords.has(keyword) && decoded.selector) {
    // Step 1: match by exact decoded selector
    const existing = findLocatorBySelector(projectId, decoded.selector);
    if (existing) {
      locatorId   = existing.id;
      locatorName = existing.name;
      locator     = existing.selector;
      locatorType = existing.selectorType;
      // Refresh healing data from recorder v4+ if not yet captured
      if (event.healingProfile && !existing.healingProfile) {
        upsert(LOCATORS, {
          ...existing,
          healingProfile:  event.healingProfile,
          alternatives:    event.alternatives?.length ? event.alternatives : existing.alternatives,
          importanceScore: event.importanceScore ?? existing.importanceScore,
          pageKey:         event.pageKey ?? existing.pageKey ?? null,
          healingStats:    existing.healingStats ?? { healCount: 0, lastHealedAt: null, lastHealedFrom: null, lastHealedBy: null },
          updatedAt:       new Date().toISOString(),
        });
      }
    } else {
      // Step 2: auto-create with decoded selector + type (including healing data from recorder v4+)
      const { loc: newLoc, created } = createLocator(
        projectId,
        decoded.selector,
        decoded.selectorType,
        event.smartName,
        event.eventType,
        event.stepNum,
        createdBy,
        event.healingProfile,
        event.alternatives,
        event.importanceScore,
        event.pageKey,
      );
      locatorId      = newLoc.id;
      locatorName    = newLoc.name;
      locator        = newLoc.selector;
      locatorType    = newLoc.selectorType;
      locatorCreated = created;
    }
  }

  const step: ScriptStep = {
    id:          uuidv4(),
    order,
    keyword,
    locator,
    locatorId,
    locatorType,
    locatorName:  locatorName || undefined as any,  // convenience — not in type but used by UI
    valueMode:    'static',
    value:        event.value ?? null,
    testData:     [],
    description:  buildDescription(event),
    screenshot:   false,
    // ── v5 extra metadata (stored on step for codegen + UI display) ──────────
    ...(event.frameContext  ? { frameContext:   event.frameContext  } : {}),
    ...(event.position      ? { position:       event.position      } : {}),
    ...(event.scrollPosition? { scrollPosition: event.scrollPosition} : {}),
    ...(event.toSelector    ? { toSelector:     event.toSelector,
                                toSelectorType: event.toSelectorType } : {}),
    ...(event.canvasDrag    ? { canvasDrag:     event.canvasDrag    } : {}),
    ...(event.rfAction      ? { rfAction:       event.rfAction      } : {}),
  } as ScriptStep & { locatorName?: string };

  return { step, locatorCreated, locatorName };
}

// ── Description builder ───────────────────────────────────────────────────────
function buildDescription(event: RecorderEvent): string {
  const name  = event.smartName || event.selector || '';
  const val   = event.value || '';
  const verb  = eventTypeToVerb(event.eventType);   // always natural language
  switch (event.eventType) {
    case 'CLICK':          return name ? `Click ${name}` : 'Click element';
    case 'FILL':           return name ? `Fill "${val}" in ${name}` : `Fill "${val}"`;
    case 'SELECT':         return name ? `Select "${val}" in ${name}` : `Select "${val}"`;
    case 'CHECK':          return name ? `Check ${name}` : 'Check element';
    case 'UNCHECK':        return name ? `Uncheck ${name}` : 'Uncheck element';
    case 'UPLOAD':         return val  ? `Upload file: ${val}` : 'Upload file';
    case 'FILE_CHOOSER':   return name ? `Choose file for ${name}` : 'Choose file';
    case 'DATE_PICKER':    return name ? `Set date "${val}" on ${name}` : `Set date "${val}"`;
    case 'ASSERT_VISIBLE': return val  ? `Assert visible: ${val}` : 'Assert element visible';
    case 'ASSERT_TOAST':   return val  ? `Assert toast: "${val}"` : 'Assert toast appeared';
    case 'ASSERT_TEXT':    return val  ? `Assert text: "${val}"` : 'Assert element text';
    case 'ASSERT_URL':     return val  ? `Assert URL contains: ${val}` : 'Assert page URL';
    case 'GOTO':           return val  ? `Navigate to ${val}` : 'Navigate to page';
    case 'ACCEPT_ALERT':   return val  ? `Accept alert: ${val}` : 'Accept alert';
    case 'ACCEPT_DIALOG':  return val  ? `Accept dialog: ${val}` : 'Accept dialog';
    case 'DISMISS_DIALOG': return val  ? `Dismiss dialog: ${val}` : 'Dismiss dialog';
    case 'HANDLE_PROMPT':  return val  ? `Handle prompt: ${val}` : 'Handle prompt';
    case 'HOVER':          return name ? `Hover over ${name}` : 'Hover over element';
    case 'FOCUS':          return name ? `Focus on ${name}` : 'Focus on element';
    case 'DBLCLICK':        return name ? `Double-click ${name}` : 'Double-click element';
    case 'RIGHT_CLICK':     return name ? `Right-click ${name}` : 'Right-click element';
    case 'PRESS_KEY':       return val  ? `Press key: ${val}` : 'Press key';
    case 'DRAG':            return name ? `Drag ${name}` : 'Drag element';
    case 'SCROLL':          return val  ? `Scroll to ${val}` : 'Scroll page';
    case 'CLICK_AT_COORDS': return val  ? `Click canvas at ${val}` : 'Click at coordinates';
    case 'SWITCH_FRAME':    return val  ? `Switch to frame: ${val}` : 'Switch frame';
    case 'SWITCH_MAIN':     return 'Switch to main frame';
    case 'CANVAS_DRAG': {
      try {
        const cd = JSON.parse(val || '{}');
        return `Canvas drag (${cd.fromX ?? '?'},${cd.fromY ?? '?'}) → (${cd.toX ?? '?'},${cd.toY ?? '?'})`;
      } catch { return 'Canvas drag'; }
    }
    case 'RF_NODE_DRAG': {
      try {
        const d = JSON.parse(val || '{}');
        const lbl = d.nodeLabel || d.nodeId || '?';
        return `Move node "${lbl}" by (${d.deltaFlow?.x ?? '?'}, ${d.deltaFlow?.y ?? '?'})`;
      } catch { return 'RF node drag'; }
    }
    case 'RF_CONNECT': {
      try {
        const d = JSON.parse(val || '{}');
        const src = d.sourceNodeLabel || d.sourceNode || '?';
        const tgt = d.targetNodeLabel || d.targetNode || '?';
        return `Connect "${src}" → "${tgt}"`;
      } catch { return name ? `Connect "${name}"` : 'Connect nodes'; }
    }
    case 'RF_PAN': {
      try {
        const d = JSON.parse(val || '{}');
        return `Pan canvas (${d.dx ?? '?'}, ${d.dy ?? '?'})`;
      } catch { return 'Pan canvas'; }
    }
    case 'RF_DROP_NODE': {
      try {
        const d = JSON.parse(val || '{}');
        const lbl = d.placedNodeLabel || d.nodeType || '?';
        return `Drop node "${lbl}" at flow (${d.dropFlow?.x ?? '?'}, ${d.dropFlow?.y ?? '?'})`;
      } catch { return 'Drop node'; }
    }
    default:                return name ? `${verb} ${name}` : verb;
  }
}

// ── Post-recording step normalizer ────────────────────────────────────────────
//
// Runs once when the user clicks Stop Recording (called in recorder.routes.ts
// before the steps array is returned to the UI).  Never mutates steps in-place
// during live capture — only applied to the completed snapshot.
//
// Rules applied in order:
//  N1. Drop blank steps (empty keyword AND empty locator AND empty value)
//  N2. Drop SCROLL steps where position is {x:0,y:0} (initial-position noise)
//  N3. Collapse consecutive SCROLL steps on the same target — keep last only
//  N4. Merge consecutive FILL steps on the same locator — keep last value only
//  N5. Drop CLICK that immediately precedes a FILL/SELECT on the same locator
//  N6. Drop CLICK that immediately follows a SELECT on the same locator (browser synthetic)
//  N7. Deduplicate consecutive identical steps (same keyword + locator + value)
//  N8. Collapse burst of consecutive ASSERT_TEXT / ASSERT_TOAST / ASSERT_VISIBLE
//      with identical text → keep first occurrence only
//  N9. Re-number order field 1-based after cleanup

export function normalizeRecordedSteps(steps: ScriptStep[]): ScriptStep[] {
  if (!steps || steps.length === 0) return steps;

  let out = [...steps];

  // N1 — blank steps
  out = out.filter(s => {
    const kw  = (s.keyword  ?? '').trim();
    const loc = (s.locator  ?? '').trim();
    const val = (s.value    ?? '').toString().trim();
    return kw !== '' || loc !== '' || val !== '';
  });

  // N2 — scroll to {x:0,y:0} OR {} (initial-position noise emitted before real scroll)
  out = out.filter(s => {
    if (s.keyword !== 'SCROLL TO') return true;
    const raw = (s.value ?? '').toString().trim();
    if (raw === '{}' || raw === '') return false;  // empty object = zero position
    try {
      const pos = JSON.parse(raw);
      if ((pos.x ?? 0) === 0 && (pos.y ?? 0) === 0) return false;
    } catch { /* not JSON — keep */ }
    return true;
  });

  // Helper: case-insensitive keyword comparison (stored data is UPPERCASE)
  const kw = (s: ScriptStep) => (s.keyword ?? '').toUpperCase().trim();

  // N3 — consecutive SCROLLs on same target → keep last
  out = collapseConsecutive(out, (s) => kw(s) === 'SCROLL TO', (a, b) => locKey(a) === locKey(b));

  // N4 — consecutive FILLs on same locator → keep last (final typed value)
  out = collapseConsecutive(out, (s) => kw(s) === 'FILL', (a, b) => locKey(a) === locKey(b));

  // N5 — CLICK that precedes a FILL/SELECT on the same locator → drop the CLICK
  //       Forward-look window of 3 steps: skips intervening CLICKs on other locators
  //       (e.g. CLICK Username → CLICK Password → FILL Username removes Username click)
  out = forwardLookFilter(out, (arr, i) => {
    if (kw(arr[i]) !== 'CLICK') return true;
    const lk = locKey(arr[i]);
    for (let j = i + 1; j < arr.length && j <= i + 3; j++) {
      const nx = arr[j];
      if ((kw(nx) === 'FILL' || kw(nx) === 'SELECT') && locKey(nx) === lk) return false;
      // Only stop scanning on steps that are clearly a different interaction boundary
      // (navigations, assertions, frame switches) — keep scanning through CLICKs and FILLs
      const nxk = kw(nx);
      if (nxk !== 'CLICK' && nxk !== 'FILL' && nxk !== 'SELECT' && nxk !== 'PRESS KEY') break;
    }
    return true;
  });

  // N5b — empty-value CLICK cluster before SELECT on same locator
  //        Pattern: CLICK combobox → CLICK Month → SELECT combobox → SELECT Month
  out = forwardLookFilter(out, (arr, i) => {
    if (kw(arr[i]) !== 'CLICK' || (arr[i].value ?? '') !== '') return true;
    const lk = locKey(arr[i]);
    for (let j = i + 1; j < arr.length && j <= i + 3; j++) {
      if (kw(arr[j]) === 'SELECT' && locKey(arr[j]) === lk) return false;
    }
    return true;
  });

  // N6 — CLICK immediately after SELECT on same locator → drop the CLICK
  out = filterWithContext(out, (prev, cur) => {
    if (!prev) return true;
    if (kw(cur) === 'CLICK' && kw(prev) === 'SELECT' && locKey(prev) === locKey(cur)) return false;
    return true;
  });

  // N7 — consecutive exact duplicates (same keyword + locator + value) → keep first
  out = collapseConsecutive(out, () => true, (a, b) => kw(a) === kw(b) && locKey(a) === locKey(b) && String(a.value ?? '') === String(b.value ?? ''));

  // N8 — burst of consecutive ASSERTs with same text → keep first
  const ASSERT_KWS = new Set(['ASSERT TEXT', 'ASSERT TOAST', 'ASSERT VISIBLE']);
  out = collapseConsecutive(
    out,
    (s) => ASSERT_KWS.has(kw(s)),
    (a, b) => kw(a) === kw(b) && String(a.value ?? '') === String(b.value ?? ''),
  );

  // N9 — dual-locator collapse: consecutive same-keyword + same-value on DIFFERENT locators
  out = dualLocatorCollapse(out);

  // N10 — drop ASSERT TOAST/TEXT matching pagination pattern ("Showing X to Y of Z entries")
  const PAGINATION_RE = /^showing\s+\d+\s+to\s+\d+\s+of\s+\d+/i;
  out = out.filter(s => {
    if (kw(s) !== 'ASSERT TOAST' && kw(s) !== 'ASSERT TEXT') return true;
    return !PAGINATION_RE.test((s.value ?? '').toString().trim());
  });

  // N11 — dual-locator collapse for ASSERT steps (strips "Error " prefix injected by alert: locator)
  out = dualLocatorCollapse(out, (s) => ASSERT_KWS.has(kw(s)));

  // N12 — HOVER immediately before CLICK/FILL/SELECT on same locator → drop HOVER (not the action)
  // Uses forwardLookFilter so the HOVER is dropped and the CLICK/FILL/SELECT is preserved.
  out = forwardLookFilter(out, (arr, i) => {
    if (kw(arr[i]) !== 'HOVER') return true;
    const next = arr[i + 1];
    if (!next) return true;
    const nk = kw(next);
    if ((nk === 'CLICK' || nk === 'FILL' || nk === 'SELECT') && locKey(arr[i]) === locKey(next)) return false;
    return true;
  });

  // N13 — re-number
  out = out.map((s, i) => ({ ...s, order: i + 1 }));

  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Stable locator identity: prefer locatorId, fall back to locator string lowercased
function locKey(s: ScriptStep): string {
  return (s.locatorId ?? (s.locator ?? '').toLowerCase().trim());
}

// For steps matching predicate, collapse consecutive runs where groupFn says they're equivalent
// — within each run, only the LAST item survives (most-recent state wins).
function collapseConsecutive(
  steps: ScriptStep[],
  predicate: (s: ScriptStep) => boolean,
  groupFn: (a: ScriptStep, b: ScriptStep) => boolean,
): ScriptStep[] {
  const result: ScriptStep[] = [];
  let i = 0;
  while (i < steps.length) {
    if (!predicate(steps[i])) {
      result.push(steps[i++]);
      continue;
    }
    // Collect run of consecutive matching steps that are equivalent
    let runEnd = i;
    while (runEnd + 1 < steps.length && predicate(steps[runEnd + 1]) && groupFn(steps[i], steps[runEnd + 1])) {
      runEnd++;
    }
    // Keep last of run (final value / final scroll position)
    result.push(steps[runEnd]);
    i = runEnd + 1;
  }
  return result;
}

// Filter where each step sees its predecessor (after prior filters have run)
function filterWithContext(
  steps: ScriptStep[],
  keep: (prev: ScriptStep | null, cur: ScriptStep) => boolean,
): ScriptStep[] {
  const result: ScriptStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const prev = result.length > 0 ? result[result.length - 1] : null;
    if (keep(prev, steps[i])) result.push(steps[i]);
  }
  return result;
}

// Forward-look filter: keep(steps, i) receives the FULL original array and current index.
// Allows rules to peek ahead without being blocked by already-removed steps.
function forwardLookFilter(
  steps: ScriptStep[],
  keep: (steps: ScriptStep[], i: number) => boolean,
): ScriptStep[] {
  return steps.filter((_, i) => keep(steps, i));
}

// N9 helper: collapse consecutive same-keyword + same-value pairs that differ only in locator.
// Recorder emits both the XPath path and the label/role locator for the same element.
// Keep whichever has the better locator (non-XPath wins); drop the other.
// predicate: optional filter — only collapse steps matching this predicate (default: all steps)
function dualLocatorCollapse(steps: ScriptStep[], predicate?: (s: ScriptStep) => boolean): ScriptStep[] {
  function isXPath(s: ScriptStep): boolean {
    return s.locatorType === 'xpath' || (s.locator ?? '').startsWith('//*') || (s.locator ?? '').startsWith('(//');
  }
  // For asserts, also normalise value for comparison — strip leading "Error " prefix that
  // the alert: composite locator injects (e.g. "Error Internal server error..." vs "Internal server error...")
  function normVal(s: ScriptStep): string {
    return String(s.value ?? '').replace(/^Error\s+/i, '').trim();
  }
  const result: ScriptStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const cur  = steps[i];
    const prev = result.length > 0 ? result[result.length - 1] : null;
    const applies = !predicate || predicate(cur);
    // Dual-emit guard for empty-value CLICKs only:
    // The recorder emits two locators for one physical click (XPath + friendly CSS).
    // But consecutive CLICKs with empty value can also be two DIFFERENT navigation clicks.
    // Rule: if BOTH steps have distinct non-null locatorIds AND the value is empty (CLICK),
    // treat them as different elements and do NOT collapse.
    // For FILL / SELECT / HOVER (value present or locator-typed), same-element dual-emit
    // is always safe to collapse by the XPath-vs-label heuristic regardless of locatorId.
    const curVal  = normVal(cur);
    const prevVal = prev != null ? normVal(prev) : '';
    const bothEmptyValue = curVal === '' && prevVal === '';
    const bothHaveDistinctLocatorIds =
      bothEmptyValue &&
      cur.locatorId != null && prev != null && prev.locatorId != null &&
      cur.locatorId !== prev.locatorId;
    if (
      applies &&
      prev &&
      (!predicate || predicate(prev)) &&
      !bothHaveDistinctLocatorIds &&
      (prev.keyword ?? '').toUpperCase() === (cur.keyword ?? '').toUpperCase() &&
      normVal(prev) === normVal(cur) &&
      locKey(prev) !== locKey(cur)   // different locators — potential dual-emit
    ) {
      const prevXPath = isXPath(prev);
      const curXPath  = isXPath(cur);
      if (!prevXPath && curXPath) {
        continue;                         // prev already better — drop cur
      }
      if (prevXPath && !curXPath) {
        result[result.length - 1] = cur;  // cur is better — replace prev
        continue;
      }
      continue;                           // both same quality — keep prev, drop cur
    }
    result.push(cur);
  }
  return result;
}

// ── Login boilerplate detector ────────────────────────────────────────────────
//
// Scans the first N steps of a recorded script for the canonical login sequence:
//   FILL Username → FILL Password → CLICK btnLogin   (+ optional nav CLICKs after)
//
// Returns suggestions for wrapping the boilerplate in a CALL FUNCTION.
// Detection only — does NOT modify steps.

export interface BoilerplateSuggestion {
  startIndex: number;   // 0-based index of first boilerplate step
  endIndex:   number;   // 0-based index of last boilerplate step (inclusive)
  stepCount:  number;
  type:       'login';
  label:      string;
}

export function detectBoilerplate(steps: ScriptStep[]): BoilerplateSuggestion[] {
  const suggestions: BoilerplateSuggestion[] = [];
  if (!steps || steps.length < 3) return suggestions;

  const head = steps.slice(0, Math.min(12, steps.length));
  let userIdx = -1, passIdx = -1, loginIdx = -1;

  for (let i = 0; i < head.length; i++) {
    const s   = head[i];
    const kw  = (s.keyword  ?? '').toLowerCase();
    const loc = (s.locator  ?? '').toLowerCase();
    const val = (s.value    ?? '').toString().toLowerCase();

    if (kw === 'fill' && (loc.includes('username') || loc.includes('user') || loc.includes('email') || val.includes('user'))) {
      userIdx = i;
    }
    if (kw === 'fill' && (loc.includes('password') || loc.includes('pass'))) {
      passIdx = i;
    }
    if (
      (kw === 'click' && (loc.includes('login') || loc.includes('signin') || loc.includes('btnlogin') || loc.includes('submit'))) ||
      (kw === 'press key' && val === 'enter')
    ) {
      loginIdx = i;
    }
  }

  if (userIdx === -1 || passIdx === -1 || loginIdx === -1) return suggestions;
  if (!(userIdx < passIdx && passIdx < loginIdx)) return suggestions;

  // Extend to include immediate post-login nav CLICKs (menu/sidebar items)
  let endIdx = loginIdx;
  const NAV_RE = /^m\d+p\d*$|^nav|^menu|^sidebar/i;
  for (let i = loginIdx + 1; i < head.length && i <= loginIdx + 4; i++) {
    const s = head[i];
    if ((s.keyword ?? '') === 'Click' && NAV_RE.test((s.locator ?? '').trim())) {
      endIdx = i;
    } else {
      break;
    }
  }

  suggestions.push({
    startIndex: userIdx,
    endIndex:   endIdx,
    stepCount:  endIdx - userIdx + 1,
    type:       'login',
    label:      `Login + navigation (${endIdx - userIdx + 1} steps) — wrap in a reusable function?`,
  });

  return suggestions;
}
