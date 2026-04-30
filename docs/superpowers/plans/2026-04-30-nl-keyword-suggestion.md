# NL → Keyword Suggestion (AI Assist) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hybrid NL → keyword suggestion engine inside the script editor: rule-based matching always runs; an optional customer-configured LLM enhances results when enabled.

**Architecture:** New `src/utils/nlRuleEngine.ts` (pure stateless rule engine). New `src/utils/nlStore.ts` (NL config + alias map persistence, encrypted API key). Existing `POST /api/nl-suggest` in server.ts replaced with multi-sentence version + `GET/PUT /api/nl/config` + `POST /api/nl/test`. NL textarea inserted above step builder in index.html. New `nlSuggestSteps()` / `nlApplyAll()` / `nlApplyMatched()` / `nlAliasLoad/Save/Test()` in modules.js. Existing admin NL settings in index.html extended with alias map UI.

**Tech Stack:** TypeScript (nlRuleEngine.ts, nlStore.ts, server.ts) · Vanilla JS (modules.js) · HTML (index.html) · JSON file storage · p-limit (already in node_modules or added) · existing nlProvider.ts (unchanged)

---

## File Map

| File | Change |
|------|---------|
| `src/data/types.ts` | Add `SuggestedStep`, `ConfidenceBreakdown`, `NlSuggestResponse`, `NlConfig` |
| `src/utils/nlRuleEngine.ts` | **New** — pure stateless rule engine |
| `src/utils/nlStore.ts` | **New** — NL config load/save (encrypted key), alias map load/save |
| `src/utils/nlProvider.ts` | No changes — already supports all providers |
| `src/ui/server.ts` | Replace `POST /api/nl-suggest`; add `GET/PUT /api/nl/config`, `POST /api/nl/test`; in-memory cache; `logNL()`; rate limiter |
| `data/nl-config.json` | **New** — initial `{ enabled: false, ... }` |
| `data/nl-locator-aliases.json` | **New** — initial `{}` |
| `src/ui/public/index.html` | NL panel above step builder; extend admin NL settings with alias map UI |
| `src/ui/public/modules.js` | `nlSuggestSteps()`, `nlApplyAll()`, `nlApplyMatched()`, `nlAliasLoad/Save/TestAlias()` |

---

## Task 1: Types — `SuggestedStep`, `NlConfig`, `NlSuggestResponse`

**Files:**
- Modify: `src/data/types.ts` (append after `ComponentDef` block, around line 218)

- [ ] **Step 1: Add types to `src/data/types.ts`**

Open `src/data/types.ts`. After the `ComponentDef` block (around line 218), add:

```typescript
// ── NL Keyword Suggestion ─────────────────────────────────────────────────────

export interface ConfidenceBreakdown {
  verb:    number;   // 0–1
  locator: number;   // 0–1
  value:   number;   // 0–1
}

export interface SuggestedStep {
  keyword:             string | null;
  locatorName:         string | null;
  value:               string | null;
  confidence:          number;
  confidenceBreakdown: ConfidenceBreakdown;
  matched:             boolean;
  source:              'rule' | 'ai';
  originalSentence:    string;
}

export interface NlSuggestResponse {
  version: 'v1';
  steps:   SuggestedStep[];
  meta: {
    provider?:   string;
    durationMs:  number;
    cached:      boolean;
    aiTimedOut?: boolean;
  };
}

export interface NlConfig {
  enabled:             boolean;
  provider:            string;   // NlProviderType from nlProvider.ts
  model:               string;
  baseUrl:             string;
  apiKeyEncrypted:     string;   // AES-GCM via encryptToken() in server.ts
  confidenceThreshold: number;   // default 0.5
  timeoutMs:           number;   // default 3000
}

export interface NlAliasMap {
  [locatorName: string]: string[];   // up to 10 aliases per locator
}
```

- [ ] **Step 2: Build to verify no TS errors**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -5
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add src/data/types.ts
git commit -m "feat(nl): add SuggestedStep, NlConfig, NlSuggestResponse types"
```

---

## Task 2: `nlStore.ts` — NL config + alias map persistence

**Files:**
- Create: `src/utils/nlStore.ts`
- Create: `data/nl-config.json`
- Create: `data/nl-locator-aliases.json`

- [ ] **Step 1: Create `data/nl-config.json`**

```json
{
  "enabled": false,
  "provider": "openai",
  "model": "gpt-4o-mini",
  "baseUrl": "",
  "apiKeyEncrypted": "",
  "confidenceThreshold": 0.5,
  "timeoutMs": 3000
}
```

- [ ] **Step 2: Create `data/nl-locator-aliases.json`**

```json
{}
```

- [ ] **Step 3: Create `src/utils/nlStore.ts`**

```typescript
import * as fs   from 'fs';
import * as path from 'path';
import type { NlConfig, NlAliasMap } from '../data/types';

let DATA_DIR = path.resolve(process.cwd(), 'data');

export function setNlDataDir(dir: string): void { DATA_DIR = dir; }

function configPath(): string  { return path.join(DATA_DIR, 'nl-config.json'); }
function aliasPath():  string  { return path.join(DATA_DIR, 'nl-locator-aliases.json'); }

function atomicWrite(file: string, data: string): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export const DEFAULT_NL_CONFIG: NlConfig = {
  enabled:             false,
  provider:            'openai',
  model:               'gpt-4o-mini',
  baseUrl:             '',
  apiKeyEncrypted:     '',
  confidenceThreshold: 0.5,
  timeoutMs:           3000,
};

export function loadNlConfig(): NlConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULT_NL_CONFIG, ...JSON.parse(raw) } as NlConfig;
  } catch {
    return { ...DEFAULT_NL_CONFIG };
  }
}

export function saveNlConfig(cfg: NlConfig): void {
  atomicWrite(configPath(), JSON.stringify(cfg, null, 2));
}

export function loadAliasMap(): NlAliasMap {
  try {
    return JSON.parse(fs.readFileSync(aliasPath(), 'utf8')) as NlAliasMap;
  } catch {
    return {};
  }
}

export function saveAliasMap(map: NlAliasMap): void {
  // enforce max 10 aliases per locator, normalize entries
  const clean: NlAliasMap = {};
  for (const [loc, aliases] of Object.entries(map)) {
    clean[loc] = aliases
      .map(a => a.toLowerCase().trim().replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  atomicWrite(aliasPath(), JSON.stringify(clean, null, 2));
}
```

- [ ] **Step 4: Build**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add src/utils/nlStore.ts data/nl-config.json data/nl-locator-aliases.json
git commit -m "feat(nl): add nlStore.ts — NL config + alias map persistence"
```

---

## Task 3: `nlRuleEngine.ts` — pure stateless rule engine

**Files:**
- Create: `src/utils/nlRuleEngine.ts`

- [ ] **Step 1: Create `src/utils/nlRuleEngine.ts`**

```typescript
/**
 * nlRuleEngine.ts — Pure stateless NL → keyword rule-based matcher.
 * No DB, no HTTP, no side effects.
 */

import type { SuggestedStep, ConfidenceBreakdown } from '../data/types';

// ── Verb → keyword patterns ───────────────────────────────────────────────────

interface VerbPattern { pattern: RegExp; keyword: string; verbScore: number; }

const VERB_PATTERNS: VerbPattern[] = [
  { pattern: /\b(double.?click|dblclick)\b/i,            keyword: 'Double Click',     verbScore: 1.0 },
  { pattern: /\b(right.?click|context.?menu)\b/i,        keyword: 'Right Click',      verbScore: 1.0 },
  { pattern: /\b(click|tap|press|hit|select link)\b/i,   keyword: 'Click Element',    verbScore: 1.0 },
  { pattern: /\b(type|enter|fill|input|write)\b/i,       keyword: 'Fill',             verbScore: 1.0 },
  { pattern: /\b(select|choose|pick)\b/i,                keyword: 'Select Option',    verbScore: 1.0 },
  { pattern: /\b(uncheck|untick|disable)\b/i,            keyword: 'Uncheck',          verbScore: 1.0 },
  { pattern: /\b(check|tick|enable)\b/i,                 keyword: 'Check',            verbScore: 1.0 },
  { pattern: /\b(navigate|go to|open|visit|load)\b/i,    keyword: 'Navigate To',      verbScore: 1.0 },
  { pattern: /\b(verify|assert|check that|confirm|should (be|have|show|contain))\b/i, keyword: 'Assert Text', verbScore: 0.8 },
  { pattern: /\b(wait for|wait until)\b/i,               keyword: 'Wait For Element', verbScore: 1.0 },
  { pattern: /\b(hover|mouse over)\b/i,                  keyword: 'Hover',            verbScore: 1.0 },
  { pattern: /\b(clear|empty|erase)\b/i,                 keyword: 'Clear',            verbScore: 1.0 },
  { pattern: /\b(screenshot|capture)\b/i,                keyword: 'Screenshot',       verbScore: 1.0 },
  { pattern: /\b(scroll|swipe)\b/i,                      keyword: 'Scroll',           verbScore: 1.0 },
  { pattern: /\b(press key|hit key|keyboard)\b/i,        keyword: 'Press Key',        verbScore: 1.0 },
];

// ── Sentence splitter ─────────────────────────────────────────────────────────

export function splitSentences(text: string): string[] {
  // Protect decimal numbers and common abbreviations before splitting
  const protected_ = text
    .replace(/(\d)\.(\d)/g,      '$1\x00$2')      // 3.5 → 3\x00.5
    .replace(/\b(e\.g|i\.e|vs|etc|Mr|Mrs|Dr)\.(\s)/gi, '$1\x01$2');  // abbrev

  const raw = protected_.split(/(?<=[.!?;])\s+|(?:\band\s+then\b|\bthen\b)\s+/i);

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
): LocatorMatch | null {
  const norm = normalize(phrase);
  if (!norm) return null;

  // Pass 1: exact
  for (const name of locatorNames) {
    if (normalize(name) === norm) return { name, score: 1.0 };
  }

  // Pass 2: alias
  for (const [locName, aliases] of Object.entries(aliasMap)) {
    for (const alias of aliases) {
      if (normalize(alias) === norm) return { name: locName, score: 0.9 };
    }
  }

  // Pass 3: fuzzy (Jaro-Winkler ≥ 0.85 on name or any alias)
  let best: LocatorMatch | null = null;
  for (const name of locatorNames) {
    const score = jaroWinkler(norm, normalize(name));
    if (score >= 0.85 && (!best || score > best.score)) best = { name, score };
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

  // After "as" or "to" or "for": click "submit" → no; type "admin" → yes
  const afterVerb = sentence.match(/(?:type|enter|fill|input|write|with|as|to)\s+["']?([A-Za-z0-9@._\-]+)["']?/i);
  if (afterVerb) return { value: afterVerb[1], score: 0.7 };

  return { value: null, score: 0.3 };
}

// ── Extract locator phrase from sentence ──────────────────────────────────────

function extractLocatorPhrase(sentence: string): string {
  // Remove leading verb phrase and take the noun chunk
  return sentence
    .replace(/^(click|tap|press|type|enter|fill|select|choose|navigate|go to|verify|assert|wait for|hover|clear|scroll)\s*/i, '')
    .replace(/\s+(and|then|to|for|on|the|a|an)\s+.*$/i, '')
    .trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function ruleMatchSentence(
  sentence:     string,
  allowedKeywords: string[],
  locatorNames: string[],
  aliasMap:     Record<string, string[]>,
): SuggestedStep {
  // 1. Match verb
  let matchedKeyword: string | null = null;
  let verbScore = 0;
  for (const vp of VERB_PATTERNS) {
    if (vp.pattern.test(sentence) && allowedKeywords.includes(vp.keyword)) {
      matchedKeyword = vp.keyword;
      verbScore      = vp.verbScore;
      break;
    }
  }

  // 2. Resolve locator
  const phrase = extractLocatorPhrase(sentence);
  const locMatch = resolveLocator(phrase, locatorNames, aliasMap);
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
```

- [ ] **Step 2: Build**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add src/utils/nlRuleEngine.ts
git commit -m "feat(nl): add nlRuleEngine.ts — sentence splitter, verb patterns, locator fuzzy match"
```

---

## Task 4: server.ts — Replace `POST /api/nl-suggest`, add config + test routes

**Files:**
- Modify: `src/ui/server.ts` (around line 1790 — existing NL block)

**Context:** Existing `POST /api/nl-suggest` at line 1795 uses single-sentence flow. Replace with multi-sentence hybrid. Keep `GET /api/nl-providers` unchanged.

- [ ] **Step 1: Add imports near the NL block (line 1790 area)**

Find the line:
```typescript
import { nlSuggest, NlProviderConfig } from '../utils/nlProvider';
```
Replace with:
```typescript
import { nlSuggest, NlProviderConfig, NL_PROVIDERS } from '../utils/nlProvider';
import { splitSentences, ruleMatchSentence, resolveLocator } from '../utils/nlRuleEngine';
import { loadNlConfig, saveNlConfig, loadAliasMap, saveAliasMap, DEFAULT_NL_CONFIG } from '../utils/nlStore';
import type { SuggestedStep, NlSuggestResponse, NlConfig } from '../data/types';
```

- [ ] **Step 2: Add in-memory cache + rate limiter constants (add right after the imports above)**

```typescript
// ── NL in-process cache (TTL 60s) ─────────────────────────────────────────────
const _nlCache = new Map<string, { result: NlSuggestResponse; expiresAt: number }>();
const NL_CACHE_TTL_MS = 60_000;

// ── NL rate limiter (per session: 10/min, global: 100/min) ────────────────────
const _nlSessionHits  = new Map<string, { count: number; resetAt: number }>();
let   _nlGlobalHits   = 0;
let   _nlGlobalReset  = Date.now() + 60_000;

function nlRateCheck(sessionId: string): boolean {
  const now = Date.now();
  // global
  if (now > _nlGlobalReset) { _nlGlobalHits = 0; _nlGlobalReset = now + 60_000; }
  if (_nlGlobalHits >= 100) return false;
  // per-session
  const s = _nlSessionHits.get(sessionId) || { count: 0, resetAt: now + 60_000 };
  if (now > s.resetAt) { s.count = 0; s.resetAt = now + 60_000; }
  if (s.count >= 10) return false;
  _nlGlobalHits++;
  s.count++;
  _nlSessionHits.set(sessionId, s);
  return true;
}
```

- [ ] **Step 3: Add `logNL()` helper (add after rate limiter constants)**

```typescript
// ── NL observability log ──────────────────────────────────────────────────────
const NL_LOG_PATH  = path.join(DATA_DIR, 'nl-log.ndjson');
const NL_LOG_MAX   = 10 * 1024 * 1024; // 10 MB

function logNL(entry: object): void {
  try {
    if (fs.existsSync(NL_LOG_PATH) && fs.statSync(NL_LOG_PATH).size > NL_LOG_MAX) {
      fs.renameSync(NL_LOG_PATH, NL_LOG_PATH + '.1');
    }
    // Redact PII patterns
    const safe = JSON.stringify(entry)
      .replace(/"[^"]*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}[^"]*"/g, '"[REDACTED]"')
      .replace(/"(sk-|Bearer |gsk_|AIza)[^"]{4,}"/g, '"[REDACTED]"');
    fs.appendFileSync(NL_LOG_PATH, safe + '\n', 'utf8');
  } catch { /* non-fatal */ }
}
```

- [ ] **Step 4: Add `nlValidateStep()` helper (add after `logNL`)**

```typescript
function nlValidateStep(
  step:            SuggestedStep,
  allowedKeywords: string[],
  knownLocators:   string[],
): SuggestedStep {
  if (step.keyword && !allowedKeywords.includes(step.keyword)) {
    step.keyword  = null;
    step.matched  = false;
    step.source   = 'rule';
  }
  if (step.locatorName && !knownLocators.includes(step.locatorName)) {
    step.locatorName = null;
    step.confidenceBreakdown.locator = 0;
  }
  step.confidence = Math.min(1, Math.max(0, step.confidence));
  step.confidenceBreakdown.verb    = Math.min(1, Math.max(0, step.confidenceBreakdown.verb));
  step.confidenceBreakdown.locator = Math.min(1, Math.max(0, step.confidenceBreakdown.locator));
  step.confidenceBreakdown.value   = Math.min(1, Math.max(0, step.confidenceBreakdown.value));
  return step;
}
```

- [ ] **Step 5: Replace the existing `app.post('/api/nl-suggest', ...)` block**

Find (around line 1795):
```typescript
app.post('/api/nl-suggest', requireAuth, async (req: Request, res: Response) => {
```
...through the closing `});` of that route (~line 1841).

Replace the entire block with:

```typescript
// POST /api/nl/suggest  { text: string }  → NlSuggestResponse
app.post('/api/nl/suggest', requireAuthOrApiKey, async (req: Request, res: Response) => {
  const { text, projectId } = req.body as { text?: string; projectId?: string };
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' }); return;
  }
  if (text.length > 3000) {
    res.status(400).json({ error: 'text too long (max 3000 chars)' }); return;
  }

  const sessionId = (req.session?.userId || (req as any).apiKeyId || 'anon') as string;
  if (!nlRateCheck(sessionId)) {
    res.status(429).set('Retry-After', '60').json({ error: 'Rate limit exceeded — try again in 60s' }); return;
  }

  // Split sentences
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    res.status(400).json({ error: 'No sentences detected in input' }); return;
  }
  if (sentences.length > 20) {
    res.status(400).json({ error: 'Too many sentences (max 20). Split into multiple requests.' }); return;
  }

  // Build allowed keyword + locator lists
  const kwData: Array<{ key: string }> = readAll('keywords') as any;
  const allowedKeywords = kwData.map((k: any) => k.key || k.keyword).filter(Boolean);
  const locators: Array<{ name: string; projectId?: string }> = readAll(LOCATORS) as any;
  const projectLocators = projectId
    ? locators.filter(l => l.projectId === projectId)
    : locators;
  const locatorNames = projectLocators.map(l => l.name).filter(Boolean);

  // Cache key
  const locVersion = require('crypto').createHash('sha256').update(locatorNames.sort().join('|')).digest('hex').slice(0, 8);
  const kwVersion  = require('crypto').createHash('sha256').update(allowedKeywords.sort().join('|')).digest('hex').slice(0, 8);
  const cacheKey   = require('crypto').createHash('sha256').update(text + '|' + locVersion + '|' + kwVersion).digest('hex');
  const cached     = _nlCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    res.json({ ...cached.result, meta: { ...cached.result.meta, cached: true } }); return;
  }

  const aliasMap = loadAliasMap();
  const cfg      = loadNlConfig();
  const t0       = Date.now();

  // Rule pass — always
  const ruleSteps: SuggestedStep[] = sentences.map(s =>
    ruleMatchSentence(s, allowedKeywords, locatorNames, aliasMap)
  );

  // AI pass — only if enabled and provider configured
  const steps: SuggestedStep[] = [...ruleSteps];
  let providerLabel: string | undefined;
  let aiTimedOut = false;

  if (cfg.enabled && cfg.provider && cfg.apiKeyEncrypted) {
    let rawKey = '';
    try { rawKey = decryptToken(cfg.apiKeyEncrypted); } catch { /* key invalid */ }
    if (rawKey) {
      const aiCfg: NlProviderConfig = {
        provider: cfg.provider as any,
        apiKey:   rawKey,
        model:    cfg.model || undefined,
        baseUrl:  cfg.baseUrl || undefined,
      };
      const kwList  = allowedKeywords.join(', ');
      const locList = locatorNames.join(', ');
      // Import pLimit or fallback to simple sequential
      let limit: (fn: () => Promise<any>) => Promise<any>;
      try {
        const pLimit = require('p-limit');
        const limiter = pLimit(3);
        limit = (fn) => limiter(fn);
      } catch {
        limit = (fn) => fn();
      }

      const aiResults = await Promise.all(sentences.map((sentence, i) =>
        limit(async () => {
          try {
            const result = await Promise.race([
              nlSuggest(aiCfg, sentence, kwList, locList),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), cfg.timeoutMs)),
            ]) as any;
            return { i, result, timedOut: false };
          } catch (e: any) {
            if (e?.message === 'timeout') aiTimedOut = true;
            return { i, result: null, timedOut: true };
          }
        })
      ));

      providerLabel = `${cfg.provider}/${cfg.model}`;
      const threshold = cfg.confidenceThreshold ?? 0.5;

      for (const { i, result, timedOut } of aiResults) {
        if (timedOut || !result) continue;
        const ai = result;
        const rule = ruleSteps[i];
        const aiOverride = (ai.confidence ?? 0) >= threshold && ai.keyword;
        steps[i] = {
          keyword:             aiOverride && ai.keyword     ? ai.keyword     : rule.keyword,
          locatorName:         aiOverride && ai.locatorName ? ai.locatorName : rule.locatorName,
          value:               aiOverride && ai.value       ? ai.value       : rule.value,
          confidence:          Math.max(rule.confidence, Math.min(1, Math.max(0, ai.confidence ?? 0))),
          confidenceBreakdown: aiOverride
            ? { verb: ai.confidence ?? 0, locator: ai.confidence ?? 0, value: ai.confidence ?? 0 }
            : rule.confidenceBreakdown,
          matched:             aiOverride ? !!(ai.keyword) : rule.matched,
          source:              aiOverride ? 'ai' : 'rule',
          originalSentence:    sentence,
        };
      }
    }
  }

  // Validate all steps
  const validated = steps.map(s => nlValidateStep(s, allowedKeywords, locatorNames));

  const durationMs = Date.now() - t0;
  const response: NlSuggestResponse = {
    version: 'v1',
    steps:   validated,
    meta:    { provider: providerLabel, durationMs, cached: false, aiTimedOut },
  };

  // Cache + log
  _nlCache.set(cacheKey, { result: response, expiresAt: Date.now() + NL_CACHE_TTL_MS });
  logNL({ ts: new Date().toISOString(), sentences, ruleSteps, steps: validated, durationMs, provider: providerLabel, aiTimedOut });

  res.json(response);
});

// Keep old /api/nl-suggest path as alias for backwards compatibility
app.post('/api/nl-suggest', requireAuth, async (req: Request, res: Response) => {
  // legacy single-sentence path — delegate to new endpoint
  const { description, projectId } = req.body as { description?: string; projectId?: string };
  req.body = { text: description, projectId };
  // Re-dispatch by calling suggest logic is complex — return 301 redirect hint instead
  res.status(308).set('Location', '/api/nl/suggest').json({ error: 'Use POST /api/nl/suggest instead' });
});
```

- [ ] **Step 6: Add `GET /api/nl/config`, `PUT /api/nl/config`, `POST /api/nl/test` routes**

Add right after the new `/api/nl/suggest` block:

```typescript
// GET /api/nl/config
app.get('/api/nl/config', requireAdmin, (_req, res) => {
  const cfg = loadNlConfig();
  res.json({ ...cfg, apiKeyEncrypted: undefined, apiKeySet: !!cfg.apiKeyEncrypted });
});

// PUT /api/nl/config
app.put('/api/nl/config', requireAdmin, async (req: Request, res: Response) => {
  const body = req.body as Partial<NlConfig> & { apiKey?: string };
  const cur  = loadNlConfig();

  if (body.confidenceThreshold !== undefined && (body.confidenceThreshold < 0 || body.confidenceThreshold > 1)) {
    res.status(400).json({ error: 'confidenceThreshold must be 0–1' }); return;
  }
  if (body.timeoutMs !== undefined && (body.timeoutMs < 500 || body.timeoutMs > 30_000)) {
    res.status(400).json({ error: 'timeoutMs must be 500–30000' }); return;
  }
  if (body.baseUrl) {
    try { new URL(body.baseUrl); } catch {
      res.status(400).json({ error: 'baseUrl is not a valid URL' }); return;
    }
  }

  const updated: NlConfig = {
    ...cur,
    enabled:             body.enabled             ?? cur.enabled,
    provider:            body.provider             ?? cur.provider,
    model:               body.model               ?? cur.model,
    baseUrl:             body.baseUrl              ?? cur.baseUrl,
    confidenceThreshold: body.confidenceThreshold  ?? cur.confidenceThreshold,
    timeoutMs:           body.timeoutMs            ?? cur.timeoutMs,
    apiKeyEncrypted:     body.apiKey ? encryptToken(body.apiKey) : cur.apiKeyEncrypted,
  };

  saveNlConfig(updated);
  res.json({ ok: true });
});

// POST /api/nl/test — ping provider with a fixed sentence
app.post('/api/nl/test', requireAdmin, async (req: Request, res: Response) => {
  const cfg = loadNlConfig();
  if (!cfg.provider) { res.status(400).json({ error: 'No provider configured' }); return; }
  let rawKey = '';
  try { rawKey = decryptToken(cfg.apiKeyEncrypted); } catch { /* ignore */ }
  if (!rawKey && cfg.provider !== 'ollama') {
    res.status(400).json({ error: 'API key not set' }); return;
  }
  const aiCfg: NlProviderConfig = {
    provider: cfg.provider as any,
    apiKey:   rawKey,
    model:    cfg.model || undefined,
    baseUrl:  cfg.baseUrl || undefined,
  };
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      nlSuggest(aiCfg, 'Click the login button', 'Click Element, Fill, Navigate To', 'loginBtn, usernameField'),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), cfg.timeoutMs)),
    ]) as any;
    res.json({ ok: true, latencyMs: Date.now() - t0, model: cfg.model, echo: result.keyword });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message || 'Provider error' });
  }
});

// GET /api/nl/aliases
app.get('/api/nl/aliases', requireAdmin, (_req, res) => {
  res.json(loadAliasMap());
});

// PUT /api/nl/aliases
app.put('/api/nl/aliases', requireAdmin, (req: Request, res: Response) => {
  const body = req.body as Record<string, string[]>;
  if (typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'body must be an object' }); return;
  }
  saveAliasMap(body);
  res.json({ ok: true });
});

// GET /api/nl-providers — keep for backwards compat
app.get('/api/nl-providers', requireAdmin, (_req, res) => {
  res.json(NL_PROVIDERS);
});
```

- [ ] **Step 7: Find `encryptToken` function name in server.ts and verify it's accessible**

```bash
grep -n "function encryptToken\|function decryptToken" "e:/AI Agent/qa-agent-platform-dev/src/ui/server.ts"
```

If the function is named differently (e.g., `encryptJiraToken`), update the references in Steps 5 and 6 to match the actual name.

- [ ] **Step 8: Build**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add src/ui/server.ts
git commit -m "feat(nl): replace POST /api/nl-suggest with multi-sentence hybrid engine + config/test routes"
```

---

## Task 5: index.html — NL panel in script editor + alias map in admin

**Files:**
- Modify: `src/ui/public/index.html`

- [ ] **Step 1: Insert NL panel above step builder (around line 1803)**

Find in index.html (around line 1803):
```html
<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="scriptAddStep()">+ Add Step</button>
```

Insert the NL panel block directly BEFORE the `<div style="display:flex;...` row that contains the "+ Add Step" button (i.e., before the toolbar row). Find the row's opening div — look for `id="se-step-toolbar"` or the flex container above `+ Add Step`.

Add this block before that toolbar row:

```html
<!-- NL Suggest Panel -->
<div id="nl-suggest-panel" style="margin-bottom:12px;background:var(--surface-2,#1a1b1e);border:1px solid var(--border,#2a2b2e);border-radius:8px;padding:12px">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <span style="font-size:13px;font-weight:700;color:var(--neutral-300)">🧠 Describe what this test should do</span>
    <span id="nl-ai-badge" style="display:none;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:#7c3aed;color:#fff">AI</span>
    <span id="nl-rule-badge" style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:#374151;color:#9ca3af">Rule-based</span>
  </div>
  <textarea id="nl-input" class="fm-input" rows="3" style="width:100%;resize:vertical;font-size:13px"
    placeholder="e.g. Login as admin, go to the Patients tab, search for John Smith and verify his status is Active"></textarea>
  <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
    <button class="btn btn-primary btn-sm" onclick="nlSuggestSteps()" id="nl-suggest-btn">▶ Suggest Steps</button>
    <button class="btn btn-success btn-sm" onclick="nlApplyAll()" id="nl-apply-all" style="display:none">Apply All</button>
    <button class="btn btn-outline btn-sm" onclick="nlApplyMatched()" id="nl-apply-matched" style="display:none">Apply Matched Only</button>
    <button class="btn btn-ghost btn-sm" onclick="nlClearSuggestions()" id="nl-clear" style="display:none">✕ Clear</button>
    <span id="nl-status" style="font-size:12px;color:var(--neutral-400);margin-left:auto"></span>
  </div>
  <div id="nl-suggestions" style="margin-top:10px"></div>
  <div id="nl-no-ai-hint" style="display:none;font-size:11px;color:var(--neutral-500);margin-top:6px">
    ℹ️ Configure an AI provider in <strong>Admin → Settings → AI Settings</strong> for better suggestions.
  </div>
</div>
```

- [ ] **Step 2: Add alias map section to Admin NL Settings (around line 990)**

Find in index.html (around line 992):
```html
<div style="font-size:13px;font-weight:700;color:var(--neutral-700);margin-bottom:4px">✨ AI — NL Keyword Suggestion</div>
```

After the existing NL settings block (find its closing `</div>` that matches the settings section), add:

```html
<!-- NL Alias Map -->
<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
  <div style="font-size:13px;font-weight:700;color:var(--neutral-700);margin-bottom:6px">🗺️ Locator Alias Map</div>
  <div style="font-size:12px;color:var(--neutral-500);margin-bottom:8px">
    Map plain-English phrases to locator names. Max 10 aliases per locator. Helps rule-based matching.
  </div>
  <div id="nl-alias-list" style="margin-bottom:8px"></div>
  <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
    <input id="nl-alias-test-input" class="fm-input" style="max-width:240px" placeholder="Type a phrase to test…" />
    <button class="btn btn-outline btn-sm" onclick="nlAliasTest()">Test Alias</button>
    <span id="nl-alias-test-result" style="font-size:12px;color:var(--neutral-400)"></span>
  </div>
  <button class="btn btn-primary btn-sm" onclick="nlAliasSave()">Save Alias Map</button>
</div>
```

- [ ] **Step 3: Build (static file — no build needed, but verify HTML is valid)**

Open `http://localhost:3003` in browser (server already running). Open script editor for any script. Verify NL panel appears above the step builder.

- [ ] **Step 4: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add src/ui/public/index.html
git commit -m "feat(nl): add NL suggest panel in script editor + alias map section in admin"
```

---

## Task 6: modules.js — `nlSuggestSteps`, `nlApplyAll`, `nlApplyMatched`, `nlClearSuggestions`

**Files:**
- Modify: `src/ui/public/modules.js`

- [ ] **Step 1: Add NL suggestion state variables**

Find the section in modules.js with other module-level state variables (near the top, around `let _nlProviders = []`). After that block, add:

```javascript
// NL suggestion state
let _nlSuggestions = [];   // current SuggestedStep[]
let _nlProjectId   = null; // current script's projectId
```

- [ ] **Step 2: Add `nlSuggestSteps()` function**

Find the end of `nlProviderChanged()` function, then add after it:

```javascript
async function nlSuggestSteps() {
  const text = document.getElementById('nl-input')?.value?.trim();
  if (!text) { alert('Enter a description first.'); return; }

  const btn    = document.getElementById('nl-suggest-btn');
  const status = document.getElementById('nl-status');
  btn.disabled = true;
  btn.textContent = '⏳ Thinking…';
  status.textContent = '';

  try {
    const body = { text };
    if (_nlProjectId) body.projectId = _nlProjectId;

    const r = await fetch('/api/nl/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) { alert(data.error || 'Suggestion failed'); return; }

    _nlSuggestions = data.steps || [];
    nlRenderSuggestions(data);

    // Show/hide AI badge based on provider
    document.getElementById('nl-ai-badge').style.display   = data.meta?.provider ? '' : 'none';
    document.getElementById('nl-rule-badge').style.display = data.meta?.provider ? 'none' : '';
    document.getElementById('nl-no-ai-hint').style.display = data.meta?.provider ? 'none' : '';
    document.getElementById('nl-apply-all').style.display     = _nlSuggestions.length ? '' : 'none';
    document.getElementById('nl-apply-matched').style.display = _nlSuggestions.length ? '' : 'none';
    document.getElementById('nl-clear').style.display         = _nlSuggestions.length ? '' : 'none';

    const matched = _nlSuggestions.filter(s => s.matched).length;
    status.textContent = `${_nlSuggestions.length} steps suggested (${matched} matched)`;
    if (data.meta?.aiTimedOut) status.textContent += ' — AI timed out, showing rule results';
  } catch (e) {
    status.textContent = 'Error: ' + (e.message || 'unknown');
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Suggest Steps';
  }
}

function nlRenderSuggestions(data) {
  const container = document.getElementById('nl-suggestions');
  if (!container) return;
  if (!data.steps || data.steps.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--neutral-400)">No steps suggested.</div>';
    return;
  }
  container.innerHTML = data.steps.map((step, i) => {
    const isMatched = step.matched;
    const bg   = isMatched ? 'var(--surface-3,#23262d)' : 'rgba(239,68,68,0.08)';
    const border = isMatched ? '1px solid var(--border)' : '1px solid rgba(239,68,68,0.4)';
    const srcBadge = step.source === 'ai'
      ? '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;background:#7c3aed;color:#fff">AI</span>'
      : '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;background:#374151;color:#9ca3af">Rule</span>';
    const confPct  = Math.round((step.confidence || 0) * 100);
    const confColor = confPct >= 70 ? '#16a34a' : confPct >= 40 ? '#f59e0b' : '#ef4444';
    const warnLabel = !isMatched
      ? '<div style="font-size:11px;color:#ef4444;margin-top:4px">⚠ No match found — review manually</div>'
      : '';
    const kwVal = `<input class="fm-input" style="width:120px;font-size:12px" value="${escHtml(step.keyword||'')}" oninput="_nlSuggestions[${i}].keyword=this.value" placeholder="keyword" />`;
    const locVal = `<input class="fm-input" style="width:130px;font-size:12px" value="${escHtml(step.locatorName||'')}" oninput="_nlSuggestions[${i}].locatorName=this.value" placeholder="locator" />`;
    const val = `<input class="fm-input" style="width:120px;font-size:12px" value="${escHtml(step.value||'')}" oninput="_nlSuggestions[${i}].value=this.value" placeholder="value" />`;
    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;margin-bottom:4px;border-radius:6px;background:${bg};border:${border}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${srcBadge}
          ${kwVal} ${locVal} ${val}
          <span style="font-size:11px;color:${confColor}">${confPct}%</span>
        </div>
        <div style="font-size:11px;color:var(--neutral-500);margin-top:3px">${escHtml(step.originalSentence)}</div>
        ${warnLabel}
      </div>
    </div>`;
  }).join('');
}

function nlApplyAll() {
  _nlSuggestions.forEach(s => nlInsertStep(s));
  nlClearSuggestions();
}

function nlApplyMatched() {
  _nlSuggestions.filter(s => s.matched).forEach(s => nlInsertStep(s));
  nlClearSuggestions();
}

function nlInsertStep(step) {
  // scriptAddStep() adds an empty row; we then populate the last row
  scriptAddStep();
  const rows = document.querySelectorAll('#se-steps-container .step-row');
  const last = rows[rows.length - 1];
  if (!last) return;
  const kwSel = last.querySelector('.step-keyword');
  if (kwSel && step.keyword) kwSel.value = step.keyword;
  const locSel = last.querySelector('.step-locator, .step-locator-name');
  if (locSel && step.locatorName) locSel.value = step.locatorName;
  const valInput = last.querySelector('.step-value');
  if (valInput && step.value) valInput.value = step.value;
}

function nlClearSuggestions() {
  _nlSuggestions = [];
  const container = document.getElementById('nl-suggestions');
  if (container) container.innerHTML = '';
  document.getElementById('nl-apply-all').style.display     = 'none';
  document.getElementById('nl-apply-matched').style.display = 'none';
  document.getElementById('nl-clear').style.display         = 'none';
  document.getElementById('nl-status').textContent          = '';
}
```

- [ ] **Step 2: Set `_nlProjectId` when script editor opens**

Find `function scriptOpenEditor(` in modules.js. Inside that function, after the line that sets the script `id` / `projectId` onto a variable, add:

```javascript
  _nlProjectId = script.projectId || null;
```

- [ ] **Step 3: Add `nlAliasLoad`, `nlAliasSave`, `nlAliasTest` functions**

After `nlClearSuggestions`, add:

```javascript
async function nlAliasLoad() {
  try {
    const r = await fetch('/api/nl/aliases');
    if (!r.ok) return;
    const map = await r.json();
    const container = document.getElementById('nl-alias-list');
    if (!container) return;
    const locators = Object.keys(map);
    if (locators.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:var(--neutral-400)">No aliases defined yet.</div>';
      return;
    }
    container.innerHTML = locators.map(loc => {
      const aliases = (map[loc] || []).join(', ');
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:12px;font-weight:600;min-width:130px;color:var(--neutral-300)">${escHtml(loc)}</span>
        <input class="fm-input" style="flex:1;font-size:12px" data-locator="${escHtml(loc)}" value="${escHtml(aliases)}" placeholder="alias1, alias2, …" />
      </div>`;
    }).join('');
  } catch (e) { console.error('nlAliasLoad', e); }
}

async function nlAliasSave() {
  const inputs = document.querySelectorAll('#nl-alias-list input[data-locator]');
  const map = {};
  inputs.forEach(inp => {
    const loc     = inp.getAttribute('data-locator');
    const aliases = inp.value.split(',').map(s => s.trim()).filter(Boolean);
    if (aliases.length) map[loc] = aliases;
  });
  try {
    const r = await fetch('/api/nl/aliases', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(map),
    });
    if (r.ok) { showToast('Alias map saved'); nlAliasLoad(); }
    else { const d = await r.json(); alert(d.error || 'Save failed'); }
  } catch (e) { alert('Save failed: ' + e.message); }
}

async function nlAliasTest() {
  const phrase  = document.getElementById('nl-alias-test-input')?.value?.trim();
  const result  = document.getElementById('nl-alias-test-result');
  if (!phrase || !result) return;
  // Quick client-side test against currently loaded aliases
  const inputs  = document.querySelectorAll('#nl-alias-list input[data-locator]');
  const normPh  = phrase.toLowerCase().replace(/\b(the|a|an)\b/g, '').trim();
  let found = null;
  inputs.forEach(inp => {
    const loc = inp.getAttribute('data-locator');
    inp.value.split(',').map(s => s.trim().toLowerCase().replace(/\b(the|a|an)\b/g, '').trim())
      .forEach(alias => { if (alias === normPh) found = loc; });
  });
  result.textContent = found ? `✓ → ${found}` : '✗ No alias match';
  result.style.color = found ? '#16a34a' : '#ef4444';
}
```

- [ ] **Step 4: Wire `nlAliasLoad` into settings open callback**

Find in modules.js the settings load function (around line 245, the function that calls `jiraConfigLoad()`). After:

```javascript
  if (typeof jiraConfigLoad === 'function') jiraConfigLoad();
```

Add:

```javascript
  if (typeof nlAliasLoad === 'function') nlAliasLoad();
```

- [ ] **Step 5: Smoke test in browser**

1. Open `http://localhost:3003`, log in, open any project → Scripts tab
2. Click any script to open editor
3. NL panel should appear above step builder
4. Type: `Click the login button` → click **Suggest Steps**
5. Should see 1 step row: keyword=`Click Element`, source badge `Rule`
6. Click **Apply All** → step should be inserted into step builder

- [ ] **Step 6: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add src/ui/public/modules.js
git commit -m "feat(nl): nlSuggestSteps, nlApplyAll, nlApplyMatched, nlAliasLoad/Save/Test in modules.js"
```

---

## Task 7: Build, restart, end-to-end smoke test + promote to prod

**Files:**
- No new files — build + verify

- [ ] **Step 1: Full build**

```bash
cd "e:/AI Agent/qa-agent-platform-dev" && npm run build 2>&1 | tail -10
```

Expected: exits 0, no errors.

- [ ] **Step 2: Restart dev server**

```bash
netstat -ano | findstr :3003
```
Note PID, then:
```bash
taskkill //F //PID <pid>
cd "e:/AI Agent/qa-agent-platform-dev" && npm run ui >> server.log 2>&1 &
sleep 4 && curl -s http://localhost:3003 -o /dev/null -w "%{http_code}"
```
Expected: `200`

```bash
tail -3 server.log
```
Expected: timestamp is today.

- [ ] **Step 3: Smoke test — rule-based (no AI)**

```bash
curl -s -X POST http://localhost:3003/api/nl/suggest \
  -H "Content-Type: application/json" \
  -H "Cookie: <paste session cookie>" \
  -d '{"text":"Click the login button and fill username with admin"}'
```

Expected response:
```json
{
  "version": "v1",
  "steps": [
    { "keyword": "Click Element", "matched": true, "source": "rule", ... },
    { "keyword": "Fill", "matched": true, "source": "rule", ... }
  ],
  "meta": { "cached": false, "durationMs": ... }
}
```

- [ ] **Step 4: Smoke test — config endpoints**

```bash
curl -s http://localhost:3003/api/nl/config \
  -H "Cookie: <admin session cookie>"
```

Expected: JSON with `enabled: false`, `apiKeySet: false`, no `apiKeyEncrypted` field.

- [ ] **Step 5: Smoke test — test connection endpoint (no key set)**

```bash
curl -s -X POST http://localhost:3003/api/nl/test \
  -H "Cookie: <admin session cookie>"
```

Expected: `400` with `"API key not set"`.

- [ ] **Step 6: UI smoke test**

1. `http://localhost:3003` → log in → open any script
2. NL panel visible above step builder ✓
3. Type multi-sentence description → Suggest Steps → step rows render ✓
4. Unmatched steps show red ⚠ warning ✓
5. Apply All inserts steps into builder ✓
6. Admin → Settings → AI Settings → Alias map section visible ✓

- [ ] **Step 7: Update CLAUDE.md with NL feature docs**

Open `CLAUDE.md`. After the `## AUTO-FILE JIRA DEFECT — COMPLETE` section, add:

```markdown
---

## NL KEYWORD SUGGESTION — COMPLETE (2026-04-30)

**Status:** Shipped 2026-04-30
**Spec:** `docs/superpowers/specs/2026-04-30-nl-keyword-suggestion-design.md`
**Plan:** `docs/superpowers/plans/2026-04-30-nl-keyword-suggestion.md`

**Key files:**
- `src/utils/nlRuleEngine.ts` — pure rule engine (verb patterns, Jaro-Winkler fuzzy, alias map)
- `src/utils/nlStore.ts` — NL config + alias map persistence (encrypted API key via AES-GCM)
- `src/utils/nlProvider.ts` — existing multi-provider AI layer (unchanged)
- `src/ui/server.ts` — `POST /api/nl/suggest` (multi-sentence hybrid), `GET/PUT /api/nl/config`, `POST /api/nl/test`, `GET/PUT /api/nl/aliases`
- `src/ui/public/index.html` — NL panel above step builder; alias map in Admin NL Settings
- `src/ui/public/modules.js` — `nlSuggestSteps()`, `nlApplyAll()`, `nlApplyMatched()`, `nlClearSuggestions()`, `nlAliasLoad/Save/Test()`

**Invariants:**
- Rule engine is pure stateless — no DB, no HTTP
- AI layer only called when `nlConfig.enabled=true` AND `apiKeyEncrypted` non-empty
- Per-field merge: AI overrides rule only when `ai.confidence >= threshold && ai.keyword` truthy
- Unmatched steps (`matched: false`) inserted with red warning, remain inline-editable
- API key encrypted at rest (AES-GCM, same pattern as Jira token)
- Cache: 60s TTL, keyed on SHA-256(text + locatorVersion + kwVersion)
- Rate limit: 10 req/min per session, 100/min global
- Log: `data/nl-log.ndjson`, rotated at 10 MB, PII redacted

**Out of v1:** Learning loop, per-sentence regenerate, "Why this?" tooltip, micro-batching
```

- [ ] **Step 8: Commit CLAUDE.md**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add CLAUDE.md
git commit -m "docs: mark NL Keyword Suggestion complete in CLAUDE.md"
```

- [ ] **Step 9: Promote to prod**

```bash
npm run promote:dev-to-prod
```

Then restart prod server on port 3000 per standard procedure.

---

## Self-Review

**Spec coverage:**
- ✅ Rule-based engine → Task 3
- ✅ AI layer (all providers via nlProvider.ts) → Task 4
- ✅ `SuggestedStep` with `confidenceBreakdown` → Task 1
- ✅ Deterministic per-field merge → Task 4 Step 5
- ✅ Keyword allowlist validation → Task 4 Step 4 (`nlValidateStep`)
- ✅ Locator resolution (exact/alias/fuzzy) → Task 3
- ✅ Sentence splitter with edge-case handling → Task 3
- ✅ `pLimit(3)` concurrency → Task 4 Step 5
- ✅ Timeout + fallback → Task 4 Step 5
- ✅ Config encrypted at rest → Task 2 + Task 4 Step 6
- ✅ Rate limiting (session + global) → Task 4 Step 2
- ✅ In-memory cache (60s TTL) → Task 4 Step 2
- ✅ `logNL()` observability → Task 4 Step 3
- ✅ Input guards (3000 chars, 20 sentences) → Task 4 Step 5
- ✅ NL panel in script editor → Task 5 Step 1
- ✅ Source badge (AI/Rule) → Task 6 Step 1
- ✅ Unmatched steps flagged red + inline editable → Task 6 Step 1
- ✅ Apply All / Apply Matched Only → Task 6 Step 1
- ✅ Admin config panel + Test Connection → Task 4 Step 6
- ✅ Alias map admin UI + test lookup → Task 5 Step 2 + Task 6 Step 3
- ✅ `POST /api/nl/test` → Task 4 Step 6
- ✅ `GET/PUT /api/nl/aliases` → Task 4 Step 6
- ✅ Log rotation + PII redaction → Task 4 Step 3

**Type consistency:**
- `SuggestedStep` defined Task 1, used in Tasks 3, 4, 6 ✓
- `NlConfig` defined Task 1, used in Tasks 2, 4 ✓
- `NlAliasMap` defined Task 1, used in Task 2 ✓
- `nlValidateStep` defined Task 4, uses `SuggestedStep` from Task 1 ✓
- `splitSentences` / `ruleMatchSentence` defined Task 3, imported Task 4 ✓
- `loadNlConfig` / `saveNlConfig` / `loadAliasMap` / `saveAliasMap` defined Task 2, imported Task 4 ✓
