# API Testing Module — Implementation Plan Phase 2: Engine Core
**Weeks 3–4 | Spec:** `docs/superpowers/specs/2026-05-02-api-testing-design.md`
**Depends on:** Phase 1 complete (`types.ts` interfaces, store constants, CRUD routes)

---

## Scope
Build the execution brain: variable resolution, assertion evaluation, auth token management, DAG construction, and the HTTP runner. By end of Phase 2: a collection can be triggered via API, execute against a live server, and persist a run result file with per-step assertion outcomes.

---

## Tasks

### [API] Task 2.1 — Variable Resolution Engine (`apiVariables.ts`)
**File:** `src/utils/apiVariables.ts` (new)

Implements the two-syntax variable substitution and scope resolution (spec §5, §5.1).

**Priority order (highest wins):**
1. Runtime-extracted (from prior step results in current wave)
2. Collection-level variables
3. Environment variables
4. Common Data (`{{$varName}}`)

**Key functions:**
```typescript
// Substitute {{varName}} and ${varName} in a string
export function substituteVars(template: string, context: VariableContext): string

// Deep-clone context before a wave (immutable snapshot model)
export function snapshotContext(ctx: VariableContext): VariableContext

// Merge stepLocalContexts back into shared context after wave completes
// Throws VariableConflictError on collection-scope collision when policy = 'error-on-conflict'
export function mergeStepLocals(
  shared: VariableContext,
  stepLocals: Record<string, VariableContext>,
  policy: 'last-write-wins' | 'error-on-conflict'
): VariableContext

// Extract variables from a response per ApiVariableExtraction[]
export function extractVariables(
  extractions: ApiVariableExtraction[],
  response: ApiResponseSnapshot
): Record<string, string>
```

**Extraction sources:** `body` (JSONPath via `jsonpath-plus`), `header`, `status`.

**VariableConflictError:** extend `Error`, include `key`, `stepA`, `stepB` fields.

**Acceptance:** Unit-testable pure functions. No HTTP calls inside this file.

---

### [API] Task 2.2 — Assertion Engine (`apiAssertions.ts`)
**File:** `src/utils/apiAssertions.ts` (new)

Evaluates `ApiAssertion[]` against an `ApiResponseSnapshot`. Returns `ApiAssertionResult[]` (spec §8).

**Supported operators (16):**
`equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`,
`greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual`,
`matches` (regex), `exists`, `notExists`, `isEmpty`, `isType`, `jsonSchemaValid`

**Field sources:** `status`, `body` (JSONPath), `header.<name>`, `responseTime`

**confidenceScore formula (spec §4.9):**
```typescript
const maxWeight = Math.max(...assertions.map(a => a.weight ?? 1));
confidenceScore = (assertion.weight ?? 1) / maxWeight * (passed ? 100 : 0);
```

**Hard vs soft assertions:**
- `severity: 'hard'` → step status = `failed` if assertion fails
- `severity: 'soft'` → step status = `degraded` if all hard pass but soft fail

**Key function:**
```typescript
export function evaluateAssertions(
  assertions: ApiAssertion[],
  response: ApiResponseSnapshot
): { results: ApiAssertionResult[]; stepStatus: 'passed' | 'failed' | 'degraded' }
```

**Dependencies:** `jsonpath-plus`, `ajv` (already in spec §15 dependencies).

**Acceptance:** Each operator tested with a fixture response. `confidenceScore` always 0–100.

---

### [API] Task 2.3 — Auth Engine (`apiAuth.ts`)
**File:** `src/utils/apiAuth.ts` (new)

Resolves auth config into HTTP headers for a step request (spec §9).

**Supported types:**
- `bearer` → `Authorization: Bearer <token>`
- `apiKey` → header or query param injection
- `basic` → `Authorization: Basic <base64>`
- `oauth2_client_credentials` → POST token endpoint, cache with `_tokenExpiresAt`, refresh within 60s of expiry

**Key function:**
```typescript
export async function resolveAuthHeaders(
  auth: ApiAuthConfig,
  context: VariableContext
): Promise<Record<string, string>>
```

Token cache: module-level `Map<string, { token: string; expiresAt: number }>` keyed by `clientId + tokenUrl`.

**Decrypt** sensitive vars via `apiSecrets.decryptSensitiveVars()` before using credentials.

**Acceptance:** OAuth2 CC token acquired once, reused on second call, refreshed when within 60s of expiry.

---

### [API] Task 2.4 — DAG Construction + Conditional Execution (`apiRunner.ts` — part 1)
**File:** `src/utils/apiRunner.ts` (new, partial)

Build the dependency graph and wave scheduler (spec §6.1, §6.5).

**DAG build algorithm:**
1. Scan each step's `request` fields for `{{varName}}` references
2. Find which steps extract that variable → those steps are implicit `dependsOn`
3. Merge with explicit `step.dependsOn[]` array
4. Add `step.group` edges (steps in same group run sequentially by `order`)
5. **Topological sort** → produces ordered wave list
6. If cycle detected → throw `CircularDependencyError` with cycle path (e.g. `"Step A → Step B → Step A"`) **before any HTTP request fires**

**Condition evaluation (spec §6.5) — vm module, NOT Function constructor:**
```typescript
import vm from 'node:vm';

function evaluateCondition(condition: string, variables: Record<string, string>): boolean {
  try {
    const sandbox = Object.freeze({ ...variables });
    const ctx = vm.createContext(sandbox);
    return !!vm.runInContext(condition, ctx, { timeout: 100 });
  } catch {
    return false; // broken condition = skip step, not crash
  }
}
```

**Acceptance:** Cycle in test fixture → `CircularDependencyError` thrown. Linear chain → correct wave order. Broken condition → step skipped (not errored).

---

### [API] Task 2.5 — HTTP Execution Layer (`apiRunner.ts` — part 2)
**File:** `src/utils/apiRunner.ts` (continued)

Execute waves using `playwright.request.newContext()` as the HTTP client (spec §3).

**Per-step execution flow:**
1. Check `step.execution.condition` → skip if false
2. Snapshot variable context (immutable read)
3. Resolve auth headers via `apiAuth.resolveAuthHeaders()`
4. Substitute variables in URL, headers, body via `apiVariables.substituteVars()`
5. Fire HTTP request with `timeoutMs` (default 30000) as Playwright context timeout
6. Capture response → `ApiResponseSnapshot` (body capped at 50KB, set `bodyTruncated` flag)
7. Run `apiAssertions.evaluateAssertions()` → `ApiAssertionResult[]`
8. Run `apiVariables.extractVariables()` → write to `stepLocalContexts[stepId]`
9. Apply `onFailure` strategy if step failed:
   - `continue` → keep going
   - `abort` → cancel remaining steps
   - `abort-group` → cancel sibling steps in same group
   - `skip-dependents` → mark all DAG children as `skipped`
10. Apply `teardown: true` steps last, regardless of pass/fail

**Rate limiting:** token-bucket, default 10 req/s burst 20. Use simple in-memory counter per run.

**Retry policy:** exponential backoff on `network`, `5xx`, `429`. Never retry if `idempotent: false` and method is `POST`/`PUT`/`PATCH`.

**maxConcurrency:** cap simultaneous requests per wave (default 5). Use `Promise.all` with chunking.

**Main entry:**
```typescript
export async function runCollection(
  collection: ApiCollection,
  environment: ApiEnvironment,
  runId: string
): Promise<ApiCollectionRunResult>
```

**Acceptance:** Single-step collection runs and returns `passed`/`failed`. Multi-step with `dependsOn` runs in correct order. Retry fires on 500 response. POST not retried when `idempotent: false`.

---

### [API] Task 2.6 — Run Persistence
**File:** `src/utils/apiRunner.ts` + `src/ui/routes/api-testing.routes.ts`

**Save run result:**
```typescript
// Write to data/api-runs/<runId>.json
await fs.writeFile(`data/api-runs/${runId}.json`, JSON.stringify(result, null, 2));
```

**New run endpoints in `api-testing.routes.ts`:**
```
POST   /api/api-collections/:id/run          → trigger run, return { runId }
GET    /api/api-runs/:runId                  → poll run result
GET    /api/api-runs?collectionId=<id>       → list runs for a collection (most recent 50)
```

Run status during execution: write partial result to file with `status: 'running'`, update to `passed`/`failed`/`error` on completion. Frontend polls `GET /api/api-runs/:runId` until status != `running`.

**Acceptance:** POST run returns `runId` immediately (async). GET poll returns `running` then final status. Run file exists at `data/api-runs/<runId>.json`.

---

### [API] Task 2.7 — Pre-Scan Health Check Endpoint
**File:** `src/ui/routes/api-testing.routes.ts`

```
POST   /api/api-collections/:id/pre-scan     → run all steps, score health, return summary
```

Health score per step (spec §10):
```
base:  2xx=100, 3xx=50, 4xx=20, 5xx=0
time penalty:  -5 per 200ms over 500ms
schema penalty: -10 per missing required field (if jsonSchemaValid assertion present)
```

Returns: `{ stepId, stepName, healthScore, status, durationMs }[]`

Pre-scan does NOT persist a run result file — result returned inline only.

**Acceptance:** Pre-scan on a collection with a slow endpoint scores lower than a fast endpoint. Returns within the sum of step timeouts.

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero TypeScript errors
- [ ] `npm run build` — clean compile
- [ ] Circular dependency test → `CircularDependencyError` thrown, no HTTP fired
- [ ] Single-step GET collection → `passed` result, response captured
- [ ] Assertion failure → step `failed`, `confidenceScore: 0`
- [ ] Soft assertion failure only → step `degraded`
- [ ] OAuth2 CC token cached across two consecutive runs
- [ ] Sensitive env variable decrypted before use in request
- [ ] `POST /run` returns `runId` immediately; `GET /run/:id` returns final result
- [ ] `data/api-runs/<runId>.json` file exists after run
- [ ] Port 3003 — no regression to existing routes

---

## Files Created / Modified

| File | Action |
|------|--------|
| `src/utils/apiVariables.ts` | Created — variable substitution, snapshot, merge, extract |
| `src/utils/apiAssertions.ts` | Created — 16-operator assertion evaluator |
| `src/utils/apiAuth.ts` | Created — auth resolver + OAuth2 CC token cache |
| `src/utils/apiRunner.ts` | Created — DAG builder, wave executor, run persistence |
| `src/ui/routes/api-testing.routes.ts` | Modified — add run + pre-scan endpoints |
| `data/api-runs/` | Used — run files written here |

---

## Dependencies to Install
```bash
npm install jsonpath-plus ajv
npm install --save-dev openapi-types
```
(`js-yaml` likely already present — verify before installing)

---

## Not In Phase 2 Scope

- Import engines (OpenAPI, Postman, cURL) → Phase 3
- Frontend UI modules → Phase 4
- Flakiness engine integration → Phase 4
- Jira defect auto-file integration → Phase 4
- Self-healing T4 URL integration → Phase 4
- Suite runner linkage (`beforeAllApiCollectionId`) → Phase 4
