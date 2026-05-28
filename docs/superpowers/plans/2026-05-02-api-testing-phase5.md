# API Testing Module — Implementation Plan Phase 5: Advanced Features
**Weeks 9–11 | Spec:** `docs/superpowers/specs/2026-05-02-api-testing-design.md`
**Depends on:** Phase 4 complete (full UI, all integrations live, suite runner linkage working)

---

## Scope
Advanced engine capabilities: response baseline snapshots, contract drift detection, Faker dynamic data, and sandboxed pre/post scripts. By end of Phase 5: the platform supports regression testing via response diffs, schema contract monitoring, and dynamic test data generation.

---

## Tasks

### [API] Task 5.1 — Response Baseline Snapshots (`baselineResponse`)
**Files:** `src/utils/apiRunner.ts` (modified), `src/utils/apiAssertions.ts` (modified), `src/data/types.ts` (modified)

Enables "record once, assert forever" response diffing (spec §18 promoted feature).

**`ApiTestStep` addition:**
```typescript
captureBaseline?: boolean;   // if true, save this run's response as the baseline
baselineRunId?: string;      // reference to the run whose response is the baseline
```

**`ApiResponseSnapshot` addition:**
```typescript
baselineDiff?: {
  statusChanged: boolean;
  headersAdded: string[];
  headersRemoved: string[];
  bodyDiff: JsonDiff[];      // array of { path, expected, actual }
}
```

**Runner logic:**
- If `captureBaseline: true` → save `ApiResponseSnapshot` to `data/api-baselines/<stepId>.json`
- If `baselineRunId` set → load baseline snapshot, diff against current response
- Diff algorithm: deep JSON diff for body (recursive key comparison), header set diff
- Diff result stored in `stepResult.response.baselineDiff`
- Step status: `degraded` if diff exists but all hard assertions pass; `failed` if hard assertion fails

**UI addition (in `25-api-runs.js`):**
- "Set as Baseline" button per step in run results
- "Diff" tab in step expand view — shows `baselineDiff` as colour-coded JSON diff (green=added, red=removed, amber=changed)

**Acceptance:**
- Capture baseline → `data/api-baselines/<stepId>.json` created
- Second run with same endpoint → `baselineDiff` shows changed fields
- No change in response → `baselineDiff` empty, step `passed`

---

### [API] Task 5.2 — Contract Drift Detection
**Files:** `src/utils/apiRunner.ts` (modified), `src/utils/openapiImport.ts` (modified)

Detects when a live API response no longer matches its OpenAPI schema (spec §18 promoted feature).

**How it works:**
- If `step.request.openapiSpecId` set → load spec from `data/api-envs.json` or a new `data/openapi-specs/` store
- After response received → validate response body against the operation's `responses[statusCode].content[*].schema` using `ajv`
- Schema violations → stored as `contractViolations: string[]` on `ApiStepResult`
- Step status: `degraded` if violations exist but no hard assertion failures

**New store:**
```
data/openapi-specs/<specId>.json   — cached parsed OpenAPI spec
```

**New endpoint:**
```
POST   /api/openapi-specs           → upload + cache a spec for drift detection
GET    /api/openapi-specs           → list cached specs
DELETE /api/openapi-specs/:id       → remove cached spec
```

**UI addition (in `25-api-runs.js`):**
- "Contract" column in step results table — shows violation count badge
- Expand → list of violations (`missing required field: $.data.id`, `type mismatch: $.count expected integer got string`)

**Acceptance:**
- Step with `openapiSpecId` + response missing required field → `contractViolations` populated
- Step with response matching schema exactly → no violations, `passed`
- Drift visible in run detail view

---

### [API] Task 5.3 — Faker Dynamic Data (`ApiDynamicValue`)
**Files:** `src/utils/apiVariables.ts` (modified), `src/data/types.ts` (reference only)

`ApiDynamicValue` type already defined in Phase 1. Phase 5 implements the runtime generators.

**Supported types:**
| `type` | Generated value | `format` option |
|--------|----------------|-----------------|
| `uuid` | `crypto.randomUUID()` | — |
| `timestamp` | current UTC ISO string | `'unix'` → epoch seconds |
| `env` | `process.env[format]` | env var name |
| `random_int` | random integer | `'min:max'` range string |
| `random_string` | random alphanumeric | length as number string |
| `faker_name` | random full name | — |
| `faker_email` | random email | — |
| `faker_uuid` | alias for `uuid` | — |

**No `faker` npm package** — implement `faker_name` and `faker_email` with small hardcoded name/domain arrays (20 first names × 20 last names × 5 domains = 2000 combinations). No new dependency.

**Integration in `substituteVars()`:**
```typescript
// Syntax: {{$dynamic:uuid}}, {{$dynamic:faker_email}}, {{$dynamic:timestamp:unix}}
// Detected by prefix $dynamic: in variable name
```

**Acceptance:**
- `{{$dynamic:uuid}}` in request body → unique UUID per run
- `{{$dynamic:faker_email}}` → valid email format each run
- `{{$dynamic:timestamp:unix}}` → integer epoch timestamp
- No faker npm package installed

---

### [API] Task 5.4 — Sandboxed Pre/Post Scripts
**Files:** `src/utils/apiRunner.ts` (modified)

Adds optional per-step JS scripts that run before/after the HTTP request, in the same `vm` sandbox as condition evaluation (spec §6.5 extension, §18).

**`ApiStepExecution` additions:**
```typescript
preScript?: string;    // JS string, runs before HTTP request; can set variables
postScript?: string;   // JS string, runs after response; can read response, set variables
```

**Sandbox for both pre and post:**
```typescript
import vm from 'node:vm';

function runScript(
  script: string,
  variables: Record<string, string>,
  response?: ApiResponseSnapshot  // undefined for preScript
): Record<string, string> {       // returns variable mutations
  const mutations: Record<string, string> = {};
  const sandbox = vm.createContext({
    ...Object.freeze({ ...variables }),
    response: response ? Object.freeze(response) : undefined,
    setVar: (key: string, val: string) => { mutations[key] = val; },
  });
  vm.runInContext(script, sandbox, { timeout: 500 });
  return mutations;
}
```

**Security constraints (same as §6.5):**
- No `require`, `process`, `fs`, `global` in scope
- `response` object is frozen — read-only
- `setVar()` is the only write mechanism — mutations returned and merged into step locals
- 500ms timeout (longer than condition eval's 100ms — scripts do more work)
- Errors → log warning, continue execution (script failure ≠ step failure)

**UI addition (in `24-api-collections.js`):**
- Pre-script and Post-script code editors in step execution settings panel (simple `<textarea>` with monospace font — no full code editor dependency)
- Helper text: "Use `setVar('key', 'value')` to set variables. Use `response.status`, `response.body` in post-script."

**Acceptance:**
- Pre-script `setVar('token', 'abc')` → variable available in request body substitution
- Post-script reads `response.status` → can set variable based on response
- Script with `process.exit(0)` → throws, step continues, warning logged
- Script exceeding 500ms → timeout error, step continues

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero TypeScript errors
- [ ] `npm run build` + `npm run build:js` — clean compile
- [ ] Baseline capture → file saved at `data/api-baselines/<stepId>.json`
- [ ] Second run → `baselineDiff` populated when response changed
- [ ] Diff tab in step expand shows colour-coded changes
- [ ] OpenAPI spec upload → spec cached, drift detection fires on matching step
- [ ] Response missing required field → `contractViolations` populated, step `degraded`
- [ ] `{{$dynamic:uuid}}` → unique UUID each run
- [ ] `{{$dynamic:faker_email}}` → valid email format
- [ ] Pre-script `setVar` → variable available in request
- [ ] Post-script `process.exit` attempt → caught, step continues
- [ ] Port 3003 — no regression to Phase 1–4 features

---

## Files Created / Modified

| File | Action |
|------|--------|
| `src/utils/apiRunner.ts` | Modified — baseline diff, contract check, pre/post scripts, teardown |
| `src/utils/apiVariables.ts` | Modified — `$dynamic:*` generator support |
| `src/utils/apiAssertions.ts` | Modified — baseline diff status logic |
| `src/utils/openapiImport.ts` | Modified — schema extraction for drift detection |
| `src/ui/routes/api-testing.routes.ts` | Modified — openapi-specs store endpoints |
| `src/ui/public/js/24-api-collections.js` | Modified — pre/post script editors |
| `src/ui/public/js/25-api-runs.js` | Modified — diff tab, contract violations column |
| `src/data/types.ts` | Modified — `captureBaseline`, `baselineRunId`, `baselineDiff`, `contractViolations`, `preScript`, `postScript` |
| `data/api-baselines/` | Created — baseline snapshot directory |
| `data/openapi-specs/` | Created — cached spec directory |

---

## v2.0 Deferred Feature Roadmap

Items below were explicitly out-of-scope for Phase 5 (spec §18). Each requires a dedicated design spec before any implementation begins. No code should be written against these until the corresponding spec is approved.

---

### GraphQL Body Type
**Why deferred:** GraphQL requests use a structured `{ query, variables, operationName }` body with introspection-driven field validation — fundamentally different from REST JSON/form bodies. The current `ApiRequestBody` union type has no `graphql` variant, and the runner has no introspection or query-parse logic.
**Prerequisites:** New design spec required. Spec must cover: `ApiRequestBody` type extension, introspection fetch + schema caching, variable binding into GraphQL variables object, assertion strategy against `data` / `errors` response envelope, and UI query editor (syntax highlighting or at minimum a dedicated textarea with `operationName` field).
**Effort:** L

---

### `oauth2_authorization_code` (PKCE Browser Flow)
**Why deferred:** Authorization Code + PKCE requires a browser redirect loop — the user agent must visit the IdP, authenticate interactively, receive an auth code, and exchange it for tokens. This cannot be done inside a headless Node.js HTTP runner without either launching a real browser (Playwright) or standing up a local redirect-catch server, both of which add significant complexity and security surface area.
**Prerequisites:** New design spec required. Spec must cover: local loopback redirect server (or Playwright-assisted flow), PKCE code_verifier/code_challenge generation, token storage and refresh lifecycle, and whether the platform caches tokens across runs or re-authenticates each time. Security review of token storage in JSON files (or switch to OS keychain) required before implementation.
**Effort:** XL

---

### SQLite Migration (Trigger: >5000 Runs)
**Why deferred:** Current JSON file storage (flat files per run in `data/`) is adequate for typical workloads. At >5000 run records the directory scan, filter, and sort operations on the runs list become noticeably slow, and the risk of file corruption under concurrent writes increases. Migrating to SQLite is the planned remedy but requires a full data-layer rewrite.
**Prerequisites:** New design spec required. Spec must cover: migration script (JSON → SQLite, one-time + incremental), updated `store.ts` abstractions so all callers stay interface-compatible, index strategy (suiteId, status, createdAt), WAL mode for concurrent access, and a feature-flag or threshold trigger so the platform auto-migrates when run count crosses 5000. All existing store helpers (`apiRunsStore`, `resultsStore`) must remain API-compatible post-migration.
**Effort:** XL

---

### gRPC / WebSocket Protocols
**Why deferred:** Both protocols require persistent connections and binary/streaming framing that are incompatible with the current single-shot HTTP request model in `apiRunner.ts`. gRPC needs protobuf schema parsing and stub generation; WebSocket needs a stateful connection lifecycle (connect → send frames → receive frames → close) with an assertion model across multiple messages.
**Prerequisites:** New design spec required. Spec must cover each protocol separately: (a) gRPC — proto file upload/caching, reflection API support, unary vs. streaming RPC support, protobuf encode/decode in runner; (b) WebSocket — connection lifecycle model, multi-frame send/receive sequencing, timeout/idle handling, assertion strategy per received message. Given scope, these may each warrant their own spec and phase.
**Effort:** XL (each)

---

### Postman `pm.test` / Pre-Request Script Conversion
**Why deferred:** Postman collections use the `pm.*` sandbox API (`pm.test`, `pm.expect`, `pm.environment.set`, `pm.response.json()`, etc.) which has no direct equivalent in the platform's sandboxed `vm` script model. The Phase 3 Postman importer (`openapiImport.ts`) silently drops `pm.test` blocks and pre-request scripts rather than attempting lossy conversion.
**Prerequisites:** New design spec required. Spec must cover: a `pm` shim object that translates `pm.test` → platform assertions, `pm.environment.set/get` → `setVar`/variable scope, and `pm.response.*` → `ApiResponseSnapshot` accessors. Spec must also define the conversion fidelity contract (what is fully supported, partially supported, and explicitly unsupported) and how the importer surfaces warnings for unconverted scripts. Requires survey of the most commonly used `pm.*` methods in real Postman collections to prioritise shim coverage.
**Effort:** L
