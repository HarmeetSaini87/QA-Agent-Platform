/**
 * healingEngine.ts — QA Agent Platform Self-Healing Locator Engine (T3)
 *
 * Weighted similarity scoring between a stored HealingProfile and
 * serialised DOM candidates captured via page.evaluate() in the spec.
 *
 * Scoring weights (total max = 49 → normalised to 0–100):
 *   testId     → 10   (strongest signal — intentionally stable)
 *   ariaLabel  →  9
 *   text       →  8
 *   role       →  7
 *   class      →  5   (at least one class token must match)
 *   id         →  4   (stable static IDs only)
 *   parentTag  →  3
 *   domDepth   →  2   (proximity — within ±2 levels)
 *   siblingIdx →  1   (proximity — within ±2 positions)
 * total max    = 49 → normalised to 0–100
 *
 * Auto-apply threshold: score ≥ 75  → T3 auto-heal
 * Human review:         score < 75  → T4 Proposal card
 * ASSERT steps:         ALWAYS T4   regardless of score
 */

import { HealingProfile, LocatorAlternative } from '../data/types';

export const T3_AUTO_THRESHOLD = 75;   // scores ≥ this → auto-apply
export const WEIGHTS = {
  testId:     10,
  ariaLabel:   9,
  text:        8,
  role:        7,
  class:       5,
  id:          4,
  parentTag:   3,
  domDepth:    2,
  siblingIdx:  1,
};
export const MAX_SCORE = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 49

// ── DOM candidate shape (serialised from page.evaluate in spec) ───────────────
export interface DomCandidate {
  tag:          string;
  id:           string | null;
  testId:       string | null;
  ariaLabel:    string | null;
  role:         string | null;
  text:         string | null;
  classes:      string[];
  placeholder:  string | null;
  name:         string | null;
  parentTag:    string | null;
  parentId:     string | null;
  parentClass:  string | null;
  domDepth:     number;
  siblingIndex: number;
  // Selector strings (built client-side for efficiency)
  cssSelector:  string;   // unique CSS path built by scanner
  xpathSelector?: string; // semantic XPath if available
}

// ── Scoring result ────────────────────────────────────────────────────────────
export interface ScoredCandidate {
  candidate:    DomCandidate;
  rawScore:     number;   // 0–49
  score:        number;   // 0–100 normalised
  breakdown:    Record<string, number>;  // per-dimension scores for explainability
  bestSelector: string;
  bestType:     string;
}

// ── String similarity helpers ─────────────────────────────────────────────────

/** Normalise a string for comparison: lowercase, collapse whitespace. */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True if two strings match (normalised). */
function strMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = norm(a), nb = norm(b);
  return !!na && !!nb && na === nb;
}

/** True if two text values are similar enough (one contains the other, min 4 chars). */
function textSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb || na.length < 3 || nb.length < 3) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

/** True if at least one class token matches between two class arrays. */
function classOverlap(a: string[], b: string[]): boolean {
  if (!a?.length || !b?.length) return false;
  const setA = new Set(a.map(c => c.toLowerCase()));
  return b.some(c => setA.has(c.toLowerCase()));
}

// ── Main scoring function ─────────────────────────────────────────────────────
export function scoreCandidate(
  profile:   HealingProfile,
  candidate: DomCandidate,
): ScoredCandidate {
  const bd: Record<string, number> = {};
  let raw = 0;

  // 1. testId — strongest signal
  if (profile.testId && strMatch(profile.testId, candidate.testId)) {
    bd.testId = WEIGHTS.testId; raw += WEIGHTS.testId;
  } else { bd.testId = 0; }

  // 2. ariaLabel
  if (profile.ariaLabel && strMatch(profile.ariaLabel, candidate.ariaLabel)) {
    bd.ariaLabel = WEIGHTS.ariaLabel; raw += WEIGHTS.ariaLabel;
  } else { bd.ariaLabel = 0; }

  // 3. text — partial match allowed
  if (profile.text && textSimilar(profile.text, candidate.text)) {
    bd.text = WEIGHTS.text; raw += WEIGHTS.text;
  } else { bd.text = 0; }

  // 4. role
  if (profile.role && strMatch(profile.role, candidate.role)) {
    bd.role = WEIGHTS.role; raw += WEIGHTS.role;
  } else { bd.role = 0; }

  // 5. class — at least one token overlap
  if (profile.classes?.length && classOverlap(profile.classes, candidate.classes)) {
    bd.class = WEIGHTS.class; raw += WEIGHTS.class;
  } else { bd.class = 0; }

  // 6. id
  if (profile.testId == null && strMatch(candidate.id, candidate.id) && candidate.id) {
    // Only award id points if no testId (to avoid double-counting stable identity)
    // Award when profile has no testId but candidate has a stable-looking id
    const hasStableId = candidate.id && !/^\d+$/.test(candidate.id) && candidate.id.length > 1;
    if (hasStableId) { bd.id = WEIGHTS.id; raw += WEIGHTS.id; }
    else { bd.id = 0; }
  } else { bd.id = 0; }

  // 7. parentTag
  if (profile.parentTag && strMatch(profile.parentTag, candidate.parentTag)) {
    bd.parentTag = WEIGHTS.parentTag; raw += WEIGHTS.parentTag;
  } else { bd.parentTag = 0; }

  // 8. domDepth — within ±2 levels
  if (Math.abs(profile.domDepth - candidate.domDepth) <= 2) {
    bd.domDepth = WEIGHTS.domDepth; raw += WEIGHTS.domDepth;
  } else { bd.domDepth = 0; }

  // 9. siblingIndex — within ±2 positions
  if (Math.abs(profile.siblingIndex - candidate.siblingIndex) <= 2) {
    bd.siblingIdx = WEIGHTS.siblingIdx; raw += WEIGHTS.siblingIdx;
  } else { bd.siblingIdx = 0; }

  const score = Math.round((raw / MAX_SCORE) * 100);

  // Pick the best selector to use for the healed locator
  const { bestSelector, bestType } = pickBestSelector(candidate);

  return { candidate, rawScore: raw, score, breakdown: bd, bestSelector, bestType };
}

// ── Selector picker — choose the most stable available selector ───────────────
function pickBestSelector(c: DomCandidate): { bestSelector: string; bestType: string } {
  if (c.testId)    return { bestSelector: c.testId,    bestType: 'testid' };
  if (c.ariaLabel) {
    const role = c.role || c.tag || 'generic';
    return { bestSelector: `${role}:${c.ariaLabel}`, bestType: 'role' };
  }
  if (c.role && c.text) return { bestSelector: `${c.role}:${c.text}`, bestType: 'role' };
  if (c.placeholder) return { bestSelector: c.placeholder, bestType: 'placeholder' };
  if (c.ariaLabel)   return { bestSelector: `//*[@aria-label="${c.ariaLabel}"]`, bestType: 'xpath' };
  if (c.id && c.id.length > 1) return { bestSelector: `#${c.id}`, bestType: 'css' };
  if (c.name)        return { bestSelector: `${c.tag}[name="${c.name}"]`, bestType: 'name' };
  if (c.xpathSelector) return { bestSelector: c.xpathSelector, bestType: 'xpath' };
  return { bestSelector: c.cssSelector, bestType: 'css' };
}

// ── Score a batch and return ranked results ───────────────────────────────────
export function scoreCandidates(
  profile:    HealingProfile,
  candidates: DomCandidate[],
): ScoredCandidate[] {
  return candidates
    .map(c => scoreCandidate(profile, c))
    .sort((a, b) => b.score - a.score);
}

// ── Build a LocatorAlternative from a scored candidate (for Repo update) ──────
export function toLocatorAlternative(sc: ScoredCandidate): LocatorAlternative {
  return {
    selector:     sc.bestSelector,
    selectorType: sc.bestType,
    confidence:   sc.score,
  };
}

// ── DOM scanner script injected into spec via page.evaluate() ─────────────────
// Returns a plain function string to be embedded in the generated spec.
// Must be a named function (NOT an IIFE) so Node.js does not invoke it at
// module load time — it is only executed inside page.evaluate() in the browser.
export const DOM_SCANNER_IIFE = `
function __qaDomScan() {
  const DYNAMIC_ID = [
    /^ember\\d+$/i, /^mat-.+-\\d+$/i, /^:\\w+:$/,
    /^ng-.+-\\d+$/i,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    /^\\d+$/, /^[a-z]+-\\d{4,}$/i, /^__/,
  ];
  function isDynId(id) { return !id || DYNAMIC_ID.some(rx => rx.test(id)); }

  function buildCss(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      const id  = node.id && !isDynId(node.id) ? '#' + node.id : null;
      if (id) { parts.unshift(id); break; }
      const idx = Array.from(node.parentElement?.children || []).indexOf(node) + 1;
      parts.unshift(idx > 1 ? tag + ':nth-child(' + idx + ')' : tag);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function getDepth(el) {
    let d = 0, n = el;
    while (n && n !== document.body) { d++; n = n.parentElement; }
    return d;
  }

  function getText(el) {
    const t = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return t && t.length >= 2 && t.length <= 100 ? t : null;
  }

  function filterClasses(el) {
    return Array.from(el.classList)
      .filter(c => c && c.length >= 2 && c.length <= 50 && !/^\\d+$/.test(c) && !/[a-f0-9]{6,}/.test(c))
      .slice(0, 8);
  }

  const INTERACTIVE = 'button,a,input:not([type="hidden"]),select,textarea,[role],[data-testid],[aria-label]';
  const nodes = Array.from(document.querySelectorAll(INTERACTIVE)).slice(0, 500);

  return nodes.map(el => {
    const parent = el.parentElement;
    const siblings = parent ? Array.from(parent.children) : [];
    const parentCls = parent && typeof parent.className === 'string'
      ? parent.className.split(/\\s+/).filter(c => c && c.length >= 2 && c.length <= 40)[0] || null
      : null;
    return {
      tag:          el.tagName.toLowerCase(),
      id:           (el.id && !isDynId(el.id)) ? el.id : null,
      testId:       el.getAttribute('data-testid') || null,
      ariaLabel:    el.getAttribute('aria-label') || null,
      role:         el.getAttribute('role') || null,
      text:         getText(el),
      classes:      filterClasses(el),
      placeholder:  el.getAttribute('placeholder') || null,
      name:         el.getAttribute('name') || null,
      parentTag:    parent ? parent.tagName.toLowerCase() : null,
      parentId:     (parent && parent.id && !isDynId(parent.id)) ? parent.id : null,
      parentClass:  parentCls,
      domDepth:     getDepth(el),
      siblingIndex: siblings.indexOf(el),
      cssSelector:  buildCss(el),
    };
  });
}
`.trim();
