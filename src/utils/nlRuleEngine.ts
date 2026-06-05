/**
 * nlRuleEngine.ts — Pure stateless NL → keyword rule-based matcher.
 * No DB, no HTTP, no side effects.
 */

import type { SuggestedStep, ConfidenceBreakdown, NlAliasMap, NlConfig } from '../data/types';

// ── Verb → keyword patterns ───────────────────────────────────────────────────

interface VerbPattern { pattern: RegExp; keyword: string; verbScore: number; }

const VERB_PATTERNS: VerbPattern[] = [
  // Multi-word patterns first — must beat single-word overlaps
  { pattern: /\b(press key|hit key|keyboard)\b/i,                                        keyword: 'PRESS KEY',      verbScore: 1.0 },
  { pattern: /\b(hover and click)\b/i,                                                   keyword: 'HOVER AND CLICK',verbScore: 1.0 },
  { pattern: /\b(double.?click|dblclick)\b/i,                                            keyword: 'DBLCLICK',       verbScore: 1.0 },
  { pattern: /\b(right.?click|context.?menu)\b/i,                                        keyword: 'RIGHT CLICK',    verbScore: 1.0 },
  { pattern: /\b(wait for|wait until)\b/i,                                               keyword: 'WAIT SELECTOR',  verbScore: 1.0 },
  { pattern: /\b(hover|mouse over)\b/i,                                                  keyword: 'HOVER',          verbScore: 1.0 },
  // CLEAR before FILL — "input" in FILL would otherwise match "clear the input field"
  { pattern: /\b(clear|empty|erase)\b/i,                                                 keyword: 'CLEAR',          verbScore: 1.0 },
  { pattern: /\b(click|tap|hit|select link)\b/i,                                         keyword: 'CLICK',          verbScore: 1.0 },
  { pattern: /\b(type|enter|fill|input|write|add|set|put)\b/i,                           keyword: 'FILL',           verbScore: 1.0 },
  { pattern: /\b(select|choose|pick)\b/i,                                                keyword: 'SELECT',         verbScore: 1.0 },
  { pattern: /\b(uncheck|untick)\b/i,                                                    keyword: 'UNCHECK',        verbScore: 1.0 },
  { pattern: /\b(check|tick)\b/i,                                                        keyword: 'CHECK',          verbScore: 1.0 },
  { pattern: /\b(navigate|go to|open|visit|load|goto)\b/i,                               keyword: 'GOTO',           verbScore: 1.0 },
  { pattern: /\b(verify|assert|check that|confirm|should (be|have|show|contain))\b/i,    keyword: 'ASSERT TEXT',    verbScore: 0.8 },
  { pattern: /\b(screenshot|capture)\b/i,                                                keyword: 'SCREENSHOT',     verbScore: 1.0 },
  { pattern: /\b(scroll|swipe)\b/i,                                                      keyword: 'SCROLL TO',      verbScore: 1.0 },
];

// ── Sentence splitter ─────────────────────────────────────────────────────────

// Action verbs used for compound-object detection and sentence splitting
const ACTION_VERB_RE = /^(?:click|enter|fill|type|navigate|go|verify|assert|check|hover|scroll|wait|press|select|clear|take|open|visit|add|set|put|double|right|capture|choose|pick|tick|uncheck|erase|empty|swipe|hit|tap)\b/i;

// Fill-family verbs — "Fill X and Y" → two fill steps
const FILL_VERB_RE = /^(fill|type|enter|input|write|add|set|put)\b/i;

/**
 * Expand a sentence like "Fill the username and Password" (one verb, two noun objects,
 * no action verb after "and") into ["Fill the username", "Fill the Password"].
 * Leaves sentences intact when "and" is followed by an action verb (already handled
 * by the main splitter).
 */
function expandCompoundObjects(sentence: string): string[] {
  // Match: FILL_VERB [the] NOUN1 and [the] NOUN2  (NOUN2 must NOT start with an action verb)
  const m = sentence.match(
    /^((?:fill|type|enter|input|write|add|set|put)\s+(?:the\s+)?)([\w][\w\s\-]*?)\s+and\s+(?:the\s+)?([\w][\w\s\-]*)$/i
  );
  if (!m) return [sentence];
  const [, verbPrefix, noun1, noun2] = m;
  // Only split if noun2 does NOT start with an action verb (those are already split upstream)
  if (ACTION_VERB_RE.test(noun2.trim())) return [sentence];
  return [
    (verbPrefix + noun1).trim(),
    (verbPrefix + noun2).trim(),
  ];
}

export function splitSentences(text: string): string[] {
  // Protect decimal numbers and common abbreviations before splitting
  const protected_ = text
    .replace(/(\d)\.(\d)/g,      '$1\x00$2')      // 3.5 → 3\x00.5
    .replace(/\b(e\.g|i\.e|vs|etc|Mr|Mrs|Dr)\.(\s)/gi, '$1\x01$2');  // abbrev

  // Split on: sentence-ending punctuation, newlines, comma, "and then"/"then", bare "and" between steps
  // "bare and" split: only when followed by a verb-like word (click|enter|fill|type|navigate|verify|assert|check|hover|scroll|wait|press|select|clear|take)
  const raw = protected_.split(
    /(?<=[.!?;])\s+|\n+|,\s+(?=\w)|(?:\band\s+then\b|\bthen\b)\s+|(?<=\w)\s+and\s+(?=(?:click|enter|fill|type|navigate|go|verify|assert|check|hover|scroll|wait|press|select|clear|take|open|visit|add|set|put|double|right|capture|choose|pick|tick|uncheck|erase|empty|swipe|hit|tap)\b)/i
  );

  const cleaned = raw
    .map(s => s.replace(/\x00/g, '.').replace(/\x01/g, '.').trim())
    .filter(s => s.length > 2);

  // Expand compound-object fill sentences: "Fill username and Password" → 2 steps
  return cleaned.flatMap(expandCompoundObjects);
}

// ── Jaro-Winkler similarity ───────────────────────────────────────────────────

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end   = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++; break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches/len1 + matches/len2 + (matches - transpositions/2)/matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ── Locator resolution ────────────────────────────────────────────────────────

interface LocatorMatch { name: string; score: number; }

function normalize(s: string): string {
  return s.toLowerCase().replace(/\b(the|a|an)\b/g, '').replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Split camelCase/PascalCase into words: "usernameField" → "username field"
function splitCamel(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

const UI_SUFFIXES = new Set(['field', 'input', 'button', 'btn', 'label', 'checkbox', 'dropdown', 'select', 'link', 'text', 'box', 'area', 'wrap', 'container']);

/**
 * Expand a raw locator name into a ranked list of normalized candidate strings
 * for fuzzy matching. Handles camelCase, snake_case, PascalCase, and strips
 * common UI suffixes.
 * e.g. "usernameField" → ["username field", "username"]
 *      "btn_submit"    → ["btn submit", "submit"]
 *      "Click Login"   → ["click login", "login"]
 */
export function expandLocatorName(rawName: string): string[] {
  const camelExpanded = splitCamel(rawName);
  const base = normalize(camelExpanded);           // e.g. "username field", "btn submit"
  const parts = base.split(' ').filter(p => p.length > 1);
  const withoutSuffix = parts.filter(p => !UI_SUFFIXES.has(p));

  const variants: string[] = [];
  const push = (v: string) => { if (v && !variants.includes(v)) variants.push(v); };
  push(base);
  if (withoutSuffix.length && withoutSuffix.join(' ') !== base) push(withoutSuffix.join(' '));
  // Individual meaningful tokens (length > 2, not a suffix)
  for (const p of parts) if (p.length > 2 && !UI_SUFFIXES.has(p)) push(p);
  return variants;
}

export function resolveLocator(
  phrase: string,
  locatorNames: string[],
  aliasMap: Record<string, string[]>,
  originalSentence?: string,
  locatorAliasNames?: Set<string>,
): LocatorMatch | null {
  const norm = normalize(phrase);
  const normOriginal = originalSentence ? normalize(originalSentence) : null;
  if (!norm && !normOriginal) return null;

  // Pass 1: exact on stripped phrase
  if (norm) {
    for (const name of locatorNames) {
      if (normalize(name) === norm) return { name, score: 1.0 };
    }
  }

  // Pass 2: alias — exact, substring, and fuzzy matching
  // Checks both the extracted phrase AND the original sentence (verb-containing aliases).
  // Also checks if the phrase CONTAINS an alias token or vice-versa (handles compound phrases
  // like "username and password" containing alias token "password input").
  const normParts = norm ? norm.split(' ').filter(p => p.length > 2) : [];
  let bestAlias: LocatorMatch | null = null;
  for (const [locName, aliases] of Object.entries(aliasMap)) {
    for (const alias of aliases) {
      const normAlias = normalize(alias);
      if (!normAlias) continue;
      // Exact match on phrase
      if (norm && normAlias === norm) return { name: locName, score: locatorAliasNames?.has(locName) ? 0.95 : 0.9 };
      // Exact match on full original sentence
      if (normOriginal && normAlias === normOriginal) return { name: locName, score: locatorAliasNames?.has(locName) ? 0.95 : 0.9 };
      // Alias is contained in phrase (e.g. phrase="username and password", alias="password input" → contains "password")
      const aliasParts = normAlias.split(' ').filter(p => p.length > 2);
      const aliasTokenHits = aliasParts.filter(ap => normParts.includes(ap)).length;
      if (aliasParts.length > 0 && aliasTokenHits / aliasParts.length >= 0.6) {
        const score = 0.7 + 0.15 * (aliasTokenHits / aliasParts.length);
        if (!bestAlias || score > bestAlias.score) bestAlias = { name: locName, score };
      }
      // Fuzzy alias match on original sentence for near-matches
      if (normOriginal && jaroWinkler(normAlias, normOriginal) >= 0.9) return { name: locName, score: locatorAliasNames?.has(locName) ? 0.93 : 0.88 };
      // Fuzzy alias match on phrase
      if (norm) {
        const aliasScore = jaroWinkler(normAlias, norm);
        if (aliasScore >= 0.85 && (!bestAlias || aliasScore > bestAlias.score)) bestAlias = { name: locName, score: aliasScore };
      }
    }
  }
  // Apply +0.05 boost for locator-level alias matches
  if (bestAlias && locatorAliasNames?.has(bestAlias.name)) {
    bestAlias = { name: bestAlias.name, score: Math.min(1, bestAlias.score + 0.05) };
  }
  if (bestAlias && bestAlias.score >= 0.7) return bestAlias;

  // Pass 3: fuzzy (Jaro-Winkler ≥ 0.82 on name expanded variants or any alias)
  // expandLocatorName handles camelCase/PascalCase/snake_case + suffix stripping.
  // Also try suffix segments of normalized name to handle programmatic prefixes.
  let best: LocatorMatch | null = null;
  for (const name of locatorNames) {
    // OLD: only split on spaces of normalized name — missed camelCase like "usernameField"
    // const normName = normalize(name);
    // const segments = normName.split(' ');
    // const candidates = [normName];
    // for (let i = 1; i < segments.length; i++) candidates.push(segments.slice(i).join(' '));
    const candidates = expandLocatorName(name);
    // Also add suffix-segment variants of the base (e.g. "inp user name" → "user name", "name")
    const baseSegments = candidates[0].split(' ');
    for (let i = 1; i < baseSegments.length; i++) {
      const seg = baseSegments.slice(i).join(' ');
      if (!candidates.includes(seg)) candidates.push(seg);
    }

    for (const candidate of candidates) {
      const score = jaroWinkler(norm, candidate);
      // Penalize segment/suffix matches slightly so full-name matches win ties
      const adjusted = candidate === candidates[0] ? score : score * 0.95;
      if (score >= 0.82 && (!best || adjusted > best.score)) best = { name, score: adjusted };
    }

    const aliases = aliasMap[name] || [];
    for (const alias of aliases) {
      const as = jaroWinkler(norm, normalize(alias));
      if (as >= 0.82 && (!best || as > best.score)) best = { name, score: as };
    }
  }
  return best;
}

// ── Value extraction ──────────────────────────────────────────────────────────

function extractValue(sentence: string): { value: string | null; score: number } {
  // Quoted string: "foo" or 'foo'
  const quoted = sentence.match(/["']([^"']+)["']/);
  if (quoted) return { value: quoted[1], score: 1.0 };

  // After explicit value-linking preposition: "type X into field", "fill X in box", "enter X"
  // Require a preposition ("into", "in", "on", "with", "as") to separate verb from value,
  // so "add username" (no preposition) does NOT extract "username" as a value.
  const afterPrep = sentence.match(/(?:type|enter|fill|input|write|add|set|put)\s+["']?([A-Za-z0-9@._\-]+)["']?\s+(?:into|in|on|to)\b/i);
  if (afterPrep) return { value: afterPrep[1], score: 0.8 };

  // Fallback: "with X", "as X" when present
  const withAs = sentence.match(/\b(?:with|as)\s+["']?([A-Za-z0-9@._\-]+)["']?/i);
  if (withAs) return { value: withAs[1], score: 0.7 };

  return { value: null, score: 0.3 };
}

// ── Extract locator phrase from sentence ──────────────────────────────────────

function extractLocatorPhrase(sentence: string): string {
  // Pattern: VERB VALUE into/in/on LOCATOR  → extract after the preposition
  const verbValueIntoLocator = sentence.match(
    /^(?:type|enter|fill|input|write|add|set|put)\s+\S+\s+(?:into|in|on)\s+(?:the\s+)?(.+?)(?:\s+(?:field|input|box|element|area))?$/i
  );
  if (verbValueIntoLocator) {
    return verbValueIntoLocator[1].trim();
  }

  // Strip leading verb(s) — extended to match all verb patterns including add/set/put
  let s = sentence
    .replace(/^(double.?click|right.?click|context.?menu|wait for|wait until|go to|press key|hit key|navigate to|mouse over|select link)\s*/i, '')
    .replace(/^(click|tap|press|hit|type|enter|fill|input|write|add|set|put|select|choose|pick|uncheck|untick|disable|check|tick|enable|navigate|open|visit|load|verify|assert|confirm|hover|clear|empty|erase|screenshot|capture|scroll|swipe)\s*/i, '')
    .trim();
  // Strip leading prepositions left after verb removal (e.g. "click on X" → "on X" → "X")
  s = s.replace(/^(on|over|the|a|an|into|in|for)\s+/i, '').trim();
  // Strip trailing value clause: "with X", "= X"
  s = s.replace(/\s+(with|as|=|containing|equals?|saying|valued?)\s+.+$/i, '');
  // Strip trailing generic UI noise — exclude button/link/checkbox/dropdown as they appear in locator names
  s = s.replace(/\s+(field|input|element|box|area)$/i, '').trim();
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function ruleMatchSentence(
  sentence:           string,
  allowedKeywords:    string[],
  locatorNames:       string[],
  aliasMap:           Record<string, string[]>,
  locatorAliasNames?: Set<string>,
): SuggestedStep {
  // 1. Match verb
  let matchedKeyword: string | null = null;
  let verbScore = 0;
  for (const vp of VERB_PATTERNS) {
    if (vp.pattern.test(sentence) && allowedKeywords.some(k => k.toUpperCase() === vp.keyword.toUpperCase())) {
      matchedKeyword = vp.keyword;
      verbScore      = vp.verbScore;
      break;
    }
  }

  // 2. Resolve locator — pass original sentence so alias lookup can match verb-containing aliases.
  // Also try sub-phrases when "and" appears (e.g. "username and password" → try "username", "password").
  const phrase = extractLocatorPhrase(sentence);
  const phraseVariants: string[] = [phrase];
  if (/\band\b/i.test(phrase)) {
    phrase.split(/\s+and\s+/i).forEach(p => { const t = p.trim(); if (t && !phraseVariants.includes(t)) phraseVariants.push(t); });
  }
  let locMatch: ReturnType<typeof resolveLocator> = null;
  for (const pv of phraseVariants) {
    const m = resolveLocator(pv, locatorNames, aliasMap, sentence, locatorAliasNames);
    if (!locMatch || (m && m.score > locMatch.score)) locMatch = m;
  }
  const locScore = locMatch?.score ?? 0;

  // 3. Extract value
  const { value, score: valScore } = extractValue(sentence);

  // 4. Composite confidence
  const confidence = Math.min(1, Math.max(0,
    verbScore * 0.5 + locScore * 0.3 + valScore * 0.2
  ));

  const breakdown: ConfidenceBreakdown = {
    verb:    Math.min(1, Math.max(0, verbScore)),
    locator: Math.min(1, Math.max(0, locScore)),
    value:   Math.min(1, Math.max(0, valScore)),
  };

  return {
    keyword:             matchedKeyword,
    locatorName:         locMatch?.name ?? null,
    value,
    confidence,
    confidenceBreakdown: breakdown,
    matched:             confidence >= 0.4 && matchedKeyword !== null,
    source:              'rule',
    originalSentence:    sentence,
  };
}

/**
 * suggestFromText — convenience wrapper: splits a single sentence and runs
 * ruleMatchSentence against the provided keyword/locator lists.
 * The optional config param is accepted for API compatibility (unused by the
 * pure rule engine — thresholds live in ruleMatchSentence logic).
 */
export function suggestFromText(
  sentence:           string,
  keywords:           string[],
  locators:           string[],
  aliasMap:           NlAliasMap,
  _config?:           Partial<NlConfig>,
  locatorAliasNames?: Set<string>,
): SuggestedStep {
  return ruleMatchSentence(sentence, keywords, locators, aliasMap, locatorAliasNames);
}
