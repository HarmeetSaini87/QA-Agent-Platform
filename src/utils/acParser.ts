/**
 * acParser.ts
 * Breaks Acceptance Criteria text into individual test scenario outlines.
 *
 * Input:  Raw AC text (from Jira field, PRD section, or manual entry)
 * Output: Array of ScenarioOutline — one per testable criterion
 *
 * Supports:
 *   - BDD format:      Given/When/Then blocks
 *   - Bullet lists:    • or - or * prefixed lines
 *   - Numbered lists:  1. 2. 3. prefixed lines
 *   - Plain sentences: split on line breaks / periods
 */

export interface ScenarioOutline {
  index: number;
  rawText: string;
  suggestedTitle: string;
  suggestedPriority: 'high' | 'medium' | 'low';
  isBDD: boolean;
  given?: string;
  when?: string;
  then?: string;
}

// ── BDD parser ────────────────────────────────────────────────────────────────

const BDD_BLOCK = /(?:^|\n)\s*(?:scenario[:\s]+)?given\s+([\s\S]+?)(?=\n\s*(?:given|scenario)\s|$)/gi;
const WHEN_RE   = /\bwhen\b\s+([\s\S]+?)(?=\s*\bthen\b)/i;
const THEN_RE   = /\bthen\b\s+([\s\S]+?)(?=\s*\band\b\s|\s*\bbut\b\s|$)/i;

function parseBddBlock(block: string): Partial<ScenarioOutline> {
  const given = block.match(/^given\s+(.*)/im)?.[1]?.trim();
  const when  = block.match(WHEN_RE)?.[1]?.trim();
  const then  = block.match(THEN_RE)?.[1]?.trim();
  return { given, when, then, isBDD: true };
}

// ── Title generator ───────────────────────────────────────────────────────────

function generateTitle(text: string, index: number): string {
  // Clean up BDD keywords and bullet markers
  let title = text
    .replace(/^(given|when|then|and|but)\s+/gi, '')
    .replace(/^[-•*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Capitalise first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Truncate long titles
  if (title.length > 80) {
    title = title.slice(0, 77) + '...';
  }

  return title || `Scenario ${index + 1}`;
}

// ── Priority inference ────────────────────────────────────────────────────────

function inferPriority(text: string): 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase();
  if (/\b(must|critical|required|mandatory|always|p0|p1|high)\b/.test(lower)) return 'high';
  if (/\b(should|important|p2|medium)\b/.test(lower)) return 'medium';
  if (/\b(could|nice.to.have|optional|p3|low)\b/.test(lower)) return 'low';
  return 'medium';
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseAcceptanceCriteria(acText: string): ScenarioOutline[] {
  if (!acText?.trim()) return [];

  const scenarios: ScenarioOutline[] = [];

  // Strategy 1: BDD blocks (Given/When/Then)
  const bddMatches = [...acText.matchAll(BDD_BLOCK)];
  if (bddMatches.length > 0) {
    for (const match of bddMatches) {
      const block = match[0].trim();
      const bdd = parseBddBlock(block);
      const fullText = [bdd.given, bdd.when, bdd.then].filter(Boolean).join(' → ');
      scenarios.push({
        index: scenarios.length,
        rawText: block,
        suggestedTitle: generateTitle(bdd.then ?? bdd.when ?? bdd.given ?? block, scenarios.length),
        suggestedPriority: inferPriority(block),
        isBDD: true,
        given: bdd.given,
        when: bdd.when,
        then: bdd.then,
      });
    }
    return scenarios;
  }

  // Strategy 2: Bullet / numbered list items
  const listItemRe = /^[\s]*(?:[-•*]|\d+[.):])\s+(.+)/gm;
  const listMatches = [...acText.matchAll(listItemRe)];
  if (listMatches.length > 0) {
    for (const match of listMatches) {
      const text = match[1].trim();
      if (text.length < 5) continue;
      scenarios.push({
        index: scenarios.length,
        rawText: text,
        suggestedTitle: generateTitle(text, scenarios.length),
        suggestedPriority: inferPriority(text),
        isBDD: false,
      });
    }
    return scenarios;
  }

  // Strategy 3: Split on line breaks / sentences
  const lines = acText
    .split(/\n+/)
    .map(l => l.trim())
    .filter(l => l.length > 10);

  for (const line of lines) {
    scenarios.push({
      index: scenarios.length,
      rawText: line,
      suggestedTitle: generateTitle(line, scenarios.length),
      suggestedPriority: inferPriority(line),
      isBDD: false,
    });
  }

  return scenarios;
}
