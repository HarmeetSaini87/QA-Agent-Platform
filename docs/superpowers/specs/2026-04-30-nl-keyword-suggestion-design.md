# NL → Keyword Suggestion (AI Assist) — Design Spec

**Feature:** Priority 6 — NL → Keyword Suggestion  
**Status:** Approved for implementation  
**Date:** 2026-04-30  
**Audience:** SDETs, QA Engineers, Admins

---

## Goal

Allow testers to type a plain-English description of what a test should do — directly inside the script editor — and have the platform automatically suggest the matching keyword steps, locators, and values. A hybrid engine runs rule-based matching first (always, zero cost, works offline), then optionally enhances results with any customer-configured LLM provider.

---

## Scope

**In v1:**
- NL textarea inline in script editor (above step builder)
- Rule-based engine (`nlRuleEngine.ts`) — verb patterns, alias map, fuzzy matching
- AI layer via existing `nlProvider.ts` — any OpenAI-compatible endpoint + Anthropic, Groq, Gemini, Ollama
- Admin config panel for NL provider (encrypted API key at rest)
- `POST /api/nl/suggest`, `GET/PUT /api/nl/config`, `POST /api/nl/test` endpoints
- Unmatched steps flagged red with "No match found — review manually"
- Source badge per step: `AI` / `Rule`
- "Apply all" + "Apply only matched" buttons
- Short-TTL server-side cache (60s per session)
- Observability log `data/nl-log.ndjson`

**Out of v1:**
- Learning loop (store accepted corrections → enrich alias map)
- "Regenerate with AI" per sentence
- "Why this?" tooltip
- Batch multi-sentence AI calls (micro-batching)
- Webhook / streaming response

---

## Data Types

```typescript
// ── Confidence decomposition ──────────────────────────────────────────────────

export interface ConfidenceBreakdown {
  verb:    number;   // 0–1: how well the verb matched a keyword pattern
  locator: number;   // 0–1: locator match score (1=exact, 0.9=alias, 0.85+=fuzzy)
  value:   number;   // 0–1: value extraction confidence
}

// ── Per-step suggestion ───────────────────────────────────────────────────────

export interface SuggestedStep {
  keyword:              string;               // validated against allowedKeywords
  locatorName:          string | null;        // validated against locator registry
  value:                string | null;
  confidence:           number;               // 0–1, clamped
  confidenceBreakdown:  ConfidenceBreakdown;
  matched:              boolean;              // false → flagged red in UI
  source:               'rule' | 'ai';
  originalSentence:     string;               // sentence that produced this step
}

// ── API response envelope ─────────────────────────────────────────────────────

export interface NlSuggestResponse {
  version:  'v1';
  steps:    SuggestedStep[];
  meta: {
    provider?:   string;   // e.g. 'openai/gpt-4o-mini', absent if rule-only
    durationMs:  number;
    cached:      boolean;
    aiTimedOut?: boolean;  // true if AI fallback triggered
  };
}

// ── NL provider config (persisted to data/nl-config.json) ─────────────────────

// NlProviderType is imported from src/utils/nlProvider.ts — do NOT redefine

export interface NlConfig {
  enabled:          boolean;
  provider:         NlProviderType;  // import from nlProvider.ts
  model:            string;
  baseUrl:          string;
  apiKeyEncrypted:  string;   // AES-GCM via crypto.ts, empty string if not set
  confidenceThreshold: number;  // default 0.5 — AI overrides rule above this
  timeoutMs:        number;     // default 3000
}
```

---

## Architecture

```
Script Editor (index.html + modules.js)
        │
        │  POST /api/nl/suggest  { text: string }
        ▼
server.ts  ──► input guard (max 3000 chars, max 20 sentences)
        │
        ├─► cache lookup (SHA-256 of text+locatorVersion+keywordVersion, TTL 60s)
        │       hit → return cached NlSuggestResponse
        │
        ▼
nlRuleEngine.ts  ──► sentence split ──► per-sentence rule match
        │                                 (verb pattern, alias map, fuzzy)
        │
        ├─ AI disabled ──► validate + return rule results
        │
        └─ AI enabled ──► pLimit(3) parallel AI calls per sentence
                              Promise.race([aiCall, timeout(3000)])
                              on timeout → source='rule', meta.aiTimedOut=true
                          ──► per-field merge (see Merge Strategy)
                          ──► validate all steps
                          ──► logNL() to nl-log.ndjson
                          ──► cache store
                          ──► return NlSuggestResponse
```

---

## Rule Engine (`nlRuleEngine.ts`)

Pure stateless function — no DB, no HTTP, no side effects.

### Sentence Splitting

Regex-based splitter with exceptions:
- Split on `.`, `!`, `?`, `;`
- Exceptions: decimal numbers (`3.5`), quoted periods (`'Save.'`), common abbreviations (`e.g.`, `i.e.`, `vs.`)
- Split on `then` / `and then` chains (optional, configurable)
- Trim + deduplicate empty sentences
- Fallback: if splitter yields 0 or 1 very long sentence (>500 chars), process as-is

### Verb Pattern Map

```typescript
const VERB_PATTERNS: Array<{ pattern: RegExp; keyword: string; verbScore: number }> = [
  { pattern: /\b(click|tap|press|hit|select link)\b/i,     keyword: 'Click Element',     verbScore: 1.0 },
  { pattern: /\b(type|enter|fill|input|write)\b/i,         keyword: 'Fill',              verbScore: 1.0 },
  { pattern: /\b(select|choose|pick)\b/i,                  keyword: 'Select Option',     verbScore: 1.0 },
  { pattern: /\b(check|tick|enable)\b/i,                   keyword: 'Check',             verbScore: 1.0 },
  { pattern: /\b(uncheck|untick|disable)\b/i,              keyword: 'Uncheck',           verbScore: 1.0 },
  { pattern: /\b(navigate|go to|open|visit|load)\b/i,      keyword: 'Navigate To',       verbScore: 1.0 },
  { pattern: /\b(verify|assert|check that|confirm)\b/i,    keyword: 'Assert Text',       verbScore: 0.8 },
  { pattern: /\b(wait for|wait until)\b/i,                 keyword: 'Wait For Element',  verbScore: 1.0 },
  { pattern: /\b(hover|mouse over)\b/i,                    keyword: 'Hover',             verbScore: 1.0 },
  { pattern: /\b(clear|empty|erase)\b/i,                   keyword: 'Clear',             verbScore: 1.0 },
  { pattern: /\b(screenshot|capture)\b/i,                  keyword: 'Screenshot',        verbScore: 1.0 },
  { pattern: /\b(scroll|swipe)\b/i,                        keyword: 'Scroll',            verbScore: 1.0 },
  { pattern: /\b(double.?click|dblclick)\b/i,              keyword: 'Double Click',      verbScore: 1.0 },
  { pattern: /\b(right.?click|context menu)\b/i,           keyword: 'Right Click',       verbScore: 1.0 },
  { pattern: /\b(press key|hit key|keyboard)\b/i,          keyword: 'Press Key',         verbScore: 1.0 },
];
```

Keyword must exist in `keywords.json` — list derived at runtime (single source of truth).

### Locator Resolution (three-pass)

1. **Exact match** on `locator.name` → locatorConfidence = 1.0
2. **Alias map** lookup in `data/nl-locator-aliases.json` (normalized: lowercase, trimmed, stopwords removed) → locatorConfidence = 0.9
3. **Fuzzy match** (Jaro-Winkler) on locator name and alias values → accept if score ≥ 0.85, locatorConfidence = JW score

Alias map constraints:
- Max 10 aliases per locator
- Admin-editable via Admin panel
- Admin "test alias" lookup: type a phrase → shows which locator it resolves to

### Confidence Computation

```typescript
confidence = (verbScore * 0.5) + (locatorScore * 0.3) + (valueScore * 0.2);
// clamped to [0, 1]
confidenceBreakdown = { verb: verbScore, locator: locatorScore, value: valueScore };
matched = confidence >= 0.4 && keyword !== null;
```

---

## AI Layer

Uses existing `nlProvider.ts`. Called only when `nlConfig.enabled = true`.

### Prompt (per sentence)

```
You are a test automation assistant. Map the tester's plain-English sentence to exactly ONE keyword test step.

## Allowed Keywords (use ONLY these exact values)
${allowedKeywords.join(', ')}

## Known Locator Names for this project
${locatorNames.join(', ')}

## Rules
- keyword: must be one of the allowed keywords above, or null if no match
- locatorName: must be one of the known locator names above, or null if none fits
- value: the text to type, assert, or URL to navigate to, or null
- confidence: your confidence 0.0–1.0
- matched: false if you are not confident; true otherwise
- If unsure, set matched=false and confidence below 0.5
- Return ONLY valid JSON. No explanation, no markdown, no code fences.

## Sentence
${sentence}
```

### Concurrency + Timeout

- `pLimit(3)` — max 3 parallel LLM calls
- `Promise.race([aiCall, timeout(cfg.timeoutMs)])` per sentence
- On timeout or error: use rule result, set `source: 'rule'`, `meta.aiTimedOut: true`

---

## Merge Strategy (per-field, deterministic)

```typescript
const aiOverride = ai.confidence >= cfg.confidenceThreshold && ai.matched;

final = {
  keyword:             aiOverride && ai.keyword     ? ai.keyword     : rule.keyword,
  locatorName:         aiOverride && ai.locatorName ? ai.locatorName : rule.locatorName,
  value:               aiOverride && ai.value       ? ai.value       : rule.value,
  confidence:          Math.max(rule.confidence, ai.confidence),
  confidenceBreakdown: aiOverride ? ai.confidenceBreakdown : rule.confidenceBreakdown,
  matched:             aiOverride ? ai.matched : rule.matched,
  source:              aiOverride ? 'ai' : 'rule',
  originalSentence:    sentence,
};
```

Per-field override prevents AI wiping a good locator or value found by rules.

---

## Validation (server-side, before return)

```typescript
function validateStep(step: SuggestedStep, allowedKeywords: string[], knownLocators: string[]): SuggestedStep {
  // 1. Keyword must be in allowedKeywords (derived from keywords.json)
  if (!allowedKeywords.includes(step.keyword)) {
    step.keyword  = null as any;  // null = unmatched; UI shows red
    step.matched  = false;
    step.source   = 'rule';
  }
  // 2. locatorName must exist in registry (or null)
  if (step.locatorName && !knownLocators.includes(step.locatorName)) {
    step.locatorName = null;
    step.confidenceBreakdown.locator = 0;
  }
  // 3. Clamp confidence
  step.confidence = Math.min(1, Math.max(0, step.confidence));
  step.confidenceBreakdown.verb    = Math.min(1, Math.max(0, step.confidenceBreakdown.verb));
  step.confidenceBreakdown.locator = Math.min(1, Math.max(0, step.confidenceBreakdown.locator));
  step.confidenceBreakdown.value   = Math.min(1, Math.max(0, step.confidenceBreakdown.value));
  return step;
}
```

---

## Input Guards

| Guard | Limit |
|---|---|
| Max input length | 3000 characters |
| Max sentences after split | 20 |
| Per-session rate limit | 10 requests/min |
| Global rate limit | 100 requests/min (token bucket) |

Exceed limit → `429 Too Many Requests` with `Retry-After` header.

---

## Caching

```typescript
const cacheKey = sha256(text + '|' + locatorVersion + '|' + keywordVersion);
// locatorVersion = SHA-256 of sorted locator name list for the project (recomputed server-side per request)
// keywordVersion = SHA-256 of keywords.json content (recomputed once on server start, cached in-process)
// TTL: 60 seconds, in-memory Map<string, { result: NlSuggestResponse, expiresAt: number }>
// Cache is per-server-process (lost on restart — acceptable, TTL is short)
```

Cache hit → `meta.cached: true`, no LLM call.

---

## Observability

`logNL()` appends to `data/nl-log.ndjson` (rotated at 10 MB):

```json
{
  "ts": "2026-04-30T10:00:00Z",
  "sentence": "click the login button",
  "rule": { "keyword": "Click Element", "locatorName": "loginBtn", "confidence": 0.85 },
  "ai": { "keyword": "Click Element", "locatorName": "loginBtn", "confidence": 0.92 },
  "final": { "keyword": "Click Element", "locatorName": "loginBtn", "source": "ai" },
  "durationMs": 412,
  "provider": "openai/gpt-4o-mini",
  "aiTimedOut": false
}
```

PII redaction: values matching email pattern or token pattern (sk-…, Bearer …) replaced with `[REDACTED]` before logging.

Log file capped at 10 MB — rotate by rename + truncate on server start.

---

## API Endpoints

### `POST /api/nl/suggest`

Auth: `requireAuthOrApiKey`

Request:
```json
{ "text": "Login as admin and go to the Patients tab" }
```

Response `200`:
```json
{
  "version": "v1",
  "steps": [
    {
      "keyword": "Fill",
      "locatorName": "usernameField",
      "value": "admin",
      "confidence": 0.82,
      "confidenceBreakdown": { "verb": 1.0, "locator": 0.9, "value": 0.8 },
      "matched": true,
      "source": "ai",
      "originalSentence": "Login as admin"
    },
    {
      "keyword": "Click Element",
      "locatorName": "patientsTab",
      "value": null,
      "confidence": 0.91,
      "confidenceBreakdown": { "verb": 1.0, "locator": 0.9, "value": 0.5 },
      "matched": true,
      "source": "ai",
      "originalSentence": "go to the Patients tab"
    }
  ],
  "meta": {
    "provider": "openai/gpt-4o-mini",
    "durationMs": 820,
    "cached": false
  }
}
```

Errors:
- `400` — text missing / too long / too many sentences
- `429` — rate limit exceeded
- `503` — AI provider unreachable (rule results still returned with `meta.aiTimedOut: true`)

---

### `GET /api/nl/config`

Auth: `requireAdmin`

Returns current config. `apiKeyEncrypted` field never returned — replaced with `apiKeySet: boolean`.

---

### `PUT /api/nl/config`

Auth: `requireAdmin`

Validates:
- `provider` is a known `NlProviderType`
- `baseUrl` parses as valid URL (when required for provider)
- `model` non-empty
- `confidenceThreshold` in `[0,1]`
- `timeoutMs` in `[500, 30000]`
- Runs `POST /api/nl/test` internally before saving — rejects if provider unreachable

---

### `POST /api/nl/test`

Auth: `requireAdmin`

Sends a single fixed test sentence to the configured provider, returns:
```json
{ "ok": true, "latencyMs": 312, "model": "gpt-4o-mini", "echo": "Click Element" }
```

---

## NL Config Storage (`data/nl-config.json`)

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

API key encrypted via `crypto.ts` (AES-GCM, same pattern as Jira config). Empty string = no key set.

---

## Alias Map (`data/nl-locator-aliases.json`)

```json
{
  "loginBtn":   ["login button", "sign in button", "submit login"],
  "usernameField": ["username", "email field", "user name", "email input"],
  "patientsTab": ["patients tab", "patient list", "patients"]
}
```

Constraints:
- Max 10 aliases per locator
- Normalized on write: lowercase, trimmed, common stopwords removed (`the`, `a`, `an`)
- Admin UI: add/remove aliases per locator, "test alias" lookup field

---

## UI — Script Editor NL Panel

Location: directly above the step builder table, inside the existing script editor panel.

```
┌─────────────────────────────────────────────────────────────────┐
│ 🧠 Describe what this test should do (optional)                  │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Login as admin, go to Patients tab, search for John Smith  │   │
│ │ and verify his status is Active                            │   │
│ └───────────────────────────────────────────────────────────┘   │
│  [Suggest Steps ▶]  [Apply All]  [Apply Matched Only]           │
│                                                                   │
│  ℹ️  Configure AI in Admin → NL Settings for better suggestions  │
│     (shown only when AI not configured)                          │
└─────────────────────────────────────────────────────────────────┘
```

After suggestion:

Each suggested step shows:
- Step row with keyword, locator, value pre-filled
- Source badge: `AI` (blue pill) or `Rule` (grey pill)
- Confidence bar (thin, colour-coded: green ≥ 0.7, amber 0.4–0.69, red < 0.4)
- Unmatched steps: red background + "⚠ No match found — review manually" label, inline editable

Buttons:
- **Suggest Steps** — triggers `POST /api/nl/suggest`
- **Apply All** — inserts all suggested steps into step builder (including red unmatched)
- **Apply Matched Only** — inserts only `matched: true` steps

---

## Admin Panel — NL Settings

Location: Admin → AI Settings → NL Keyword Suggestion (new section, below Jira Integration)

Fields: Provider dropdown, Model, Base URL (conditional), API Key (password input), Confidence Threshold slider, Timeout (ms), Enable/Disable toggle

Actions: **Test Connection** → calls `POST /api/nl/test`, shows latency + model echo. **Save** → validates then persists.

Alias Map sub-section: list of locators with their aliases, add/remove alias, test alias lookup field.

---

## File Map

| File | Change |
|---|---|
| `src/data/types.ts` | Add `SuggestedStep`, `ConfidenceBreakdown`, `NlSuggestResponse`, `NlConfig` |
| `src/utils/nlRuleEngine.ts` | **New** — pure rule-based engine |
| `src/utils/nlProvider.ts` | Already exists — no changes needed in v1 |
| `src/ui/server.ts` | Add `POST /api/nl/suggest`, `GET/PUT /api/nl/config`, `POST /api/nl/test`; in-memory cache; `logNL()`; input guards; rate limiter |
| `data/nl-config.json` | **New** — initial `{ enabled: false, ... }` |
| `data/nl-locator-aliases.json` | **New** — initial `{}` |
| `src/ui/public/index.html` | NL panel in script editor; Admin NL Settings panel |
| `src/ui/public/modules.js` | `nlSuggestSteps()`, `nlApplyAll()`, `nlApplyMatched()`, `nlConfigLoad/Save/Test()`, `nlAliasLoad/Save/Test()` |

---

## Security

- API key never returned to browser (replaced with `apiKeySet: boolean` in GET)
- API key encrypted at rest (AES-GCM via `crypto.ts`)
- NL log redacts email/token patterns before write
- Path traversal: no file paths in request body
- Rate limiting on `/api/nl/suggest` prevents abuse

---

## What's NOT in v1

- Learning loop (accepted corrections → alias map enrichment)
- "Regenerate with AI" per sentence
- "Why this?" confidence tooltip breakdown in UI
- Micro-batching multiple sentences per LLM call
- Streaming response
- NL suggestion from Execution Report or Flaky Tests tab
