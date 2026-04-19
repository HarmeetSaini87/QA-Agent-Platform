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
  ASSERT_VISIBLE: 'ASSERT VISIBLE',  // auto-captured from flash/toast messages
  ASSERT_TOAST:   'ASSERT TOAST',    // CR4: auto-captured toast with text assertion
  ASSERT_URL:     'ASSERT URL',      // CR4: auto-captured after SPA navigation
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
    ASSERT_URL:     'Assert URL',
    HOVER:          'Hover',
    FOCUS:          'Focus',
    DBLCLICK:       'Double Click',
    RIGHT_CLICK:    'Right Click',
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
    pageKey: pageKey ?? null,
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
    case 'ASSERT_URL':     return val  ? `Assert URL contains: ${val}` : 'Assert page URL';
    case 'GOTO':           return val  ? `Navigate to ${val}` : 'Navigate to page';
    case 'ACCEPT_ALERT':   return val  ? `Accept alert: ${val}` : 'Accept alert';
    case 'ACCEPT_DIALOG':  return val  ? `Accept dialog: ${val}` : 'Accept dialog';
    case 'DISMISS_DIALOG': return val  ? `Dismiss dialog: ${val}` : 'Dismiss dialog';
    case 'HANDLE_PROMPT':  return val  ? `Handle prompt: ${val}` : 'Handle prompt';
    case 'HOVER':          return name ? `Hover over ${name}` : 'Hover over element';
    case 'FOCUS':          return name ? `Focus on ${name}` : 'Focus on element';
    case 'DBLCLICK':       return name ? `Double-click ${name}` : 'Double-click element';
    case 'RIGHT_CLICK':    return name ? `Right-click ${name}` : 'Right-click element';
    default:               return name ? `${verb} ${name}` : verb;
  }
}
