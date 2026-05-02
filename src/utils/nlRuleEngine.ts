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

  return raw
    .map(s => s.replace(/\x00/g, '.').replace(/\x01/g, '.').trim())
    .filter(s => s.length > 2);
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

export function resolveLocator(
  phrase: string,
  locatorNames: string[],
  aliasMap: Record<string, string[]>,
  originalSentence?: string,
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

  // Pass 2: alias — try both stripped phrase AND original sentence
  // Original sentence needed when alias contains the verb (e.g. "click here to log-in!")
  for (const [locName, aliases] of Object.entries(aliasMap)) {
    for (const alias of aliases) {
      const normAlias = normalize(alias);
      if (!normAlias) continue;
      if (norm && normAlias === norm) return { name: locName, score: 0.9 };
      if (normOriginal && normAlias === normOriginal) return { name: locName, score: 0.9 };
      // Fuzzy alias match on original sentence for near-matches
      if (normOriginal && jaroWinkler(normAlias, normOriginal) >= 0.9) return { name: locName, score: 0.88 };
    }
  }

  // Pass 3: fuzzy (Jaro-Winkler ≥ 0.85 on name or any alias)
  // Also try suffix segments of normalized name to handle programmatic prefixes
  // e.g. "inp_user_name" → ["inp user name", "user name", "name"]
  let best: LocatorMatch | null = null;
  for (const name of locatorNames) {
    const normName = normalize(name);
    const segments = normName.split(' ');
    const candidates = [normName];
    for (let i = 1; i < segments.length; i++) candidates.push(segments.slice(i).join(' '));

    for (const candidate of candidates) {
      const score = jaroWinkler(norm, candidate);
      // Penalize segment matches slightly so full-name matches win ties
      const adjusted = candidate === normName ? score : score * 0.95;
      if (score >= 0.85 && (!best || adjusted > best.score)) best = { name, score: adjusted };
    }

    const aliases = aliasMap[name] || [];
    for (const alias of aliases) {
      const as = jaroWinkler(norm, normalize(alias));
      if (as >= 0.85 && (!best || as > best.score)) best = { name, score: as };
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
  sentence:        string,
  allowedKeywords: string[],
  locatorNames:    string[],
  aliasMap:        Record<string, string[]>,
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

  // 2. Resolve locator — pass original sentence so alias lookup can match verb-containing aliases
  const phrase = extractLocatorPhrase(sentence);
  const locMatch = resolveLocator(phrase, locatorNames, aliasMap, sentence);
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
  sentence:  string,
  keywords:  string[],
  locators:  string[],
  aliasMap:  NlAliasMap,
  _config?: Partial<NlConfig>,
): SuggestedStep {
  return ruleMatchSentence(sentence, keywords, locators, aliasMap);
}
