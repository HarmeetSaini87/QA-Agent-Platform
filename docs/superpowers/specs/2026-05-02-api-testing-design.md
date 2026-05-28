# API Testing Module — Design Spec

> **Status:** Draft  
> **Date:** 2026-05-02  
> **Author:** Harmeet Saini  
> **Priority:** P0 — #1 competitive gap  
> **Target:** v2.0 milestone  
> **Related:** `docs/API_TESTING_ARCHITECTURE.md`, `docs/API_TESTING_PLAN.md`

---

## 1. Problem Statement

The platform has 6 API-related keywords (`CALL API`, `MOCK RESPONSE`, `GET NETWORK RESPONSE`, `ASSERT RESPONSE OK`, `WAIT RESPONSE`, `EVALUATE`) bolted onto UI test scripts. This is not a dedicated API testing solution.

Competitors (Katalon, Postman, mabl, SwaggerHub) offer full API testing modules. We are behind on this capability, but can leapfrog by combining API testing with our existing self-healing, flakiness intelligence, Jira auto-filing, and UI test chaining — none of which any competitor does.

---

## 2. Goals

| Goal | Metric |
|------|--------|
| Import OpenAPI 3.x spec → auto-generate collection | < 30s for 50-endpoint spec |
| Full response validation (body, headers, status, schema) | 100% assertion operator coverage |
| API chaining with variable extraction | Pass any field from response N to request N+1 |
| Smart parallel execution (auto-DAG + group overrides) | Independent steps run concurrently |
| Auth management (Bearer, API key, Basic, OAuth2 CC) | 4 auth types at launch |
| Environment-scoped base URLs + variables | DEV/QA/UAT/PROD switching with zero changes |
| Run API collections independently or as suite beforeAll | Both modes supported |
| Integrate with flakiness engine, Jira, self-healing | Zero duplicate infrastructure |

---

## 3. HTTP Execution Layer — Playwright Native

**Decision:** Use `playwright.request.newContext()` as the HTTP client. Playwright is already a dependency. This eliminates `node-fetch`, `axios`, and custom HTTP client code entirely.

```typescript
// One context per collection run
const context = await playwright.request.newContext({
  baseURL: env.baseUrl,
  extraHTTPHeaders: resolvedDefaultHeaders,
  ignoreHTTPSErrors: true,          // test environments with self-signed certs
  recordHar: { path: `data/api-runs/${runId}.har` }  // free HAR for response diff
});

// Per step
const response = await context[step.method.toLowerCase()](resolvedUrl, {
  data:    resolvedBody,
  headers: resolvedHeaders,
  params:  resolvedParams
});

await context.dispose();
```

**What Playwright gives for free:** SSL, cookies, redirects, multipart, keep-alive, proxy support, HAR recording.

**What still needs custom code:** assertion evaluation, variable resolution, import parsers, auth token acquisition.

---

## 4. Data Model

### 4.1 ApiEnvironment

```typescript
interface ApiEnvironment {
  id:          string;
  projectId:   string;
  name:        string;           // "QA", "UAT", "PROD"
  baseUrl:     string;
  variables:   ApiVariable[];
  auth:        ApiAuthConfig;
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

interface ApiVariable {
  key:       string;
  value:     string | ApiDynamicValue;  // supports faker expressions
  sensitive: boolean;                   // stored AES-256-GCM, masked in UI
}

// Dynamic test data generation (Phase 5+)
interface ApiDynamicValue {
  type:       'faker';
  expression: string;  // e.g. "name.firstName", "internet.email"
}
```

### 4.2 ApiAuthConfig

```typescript
type ApiAuthType = 'none' | 'bearer' | 'apikey' | 'basic' | 'oauth2_cc';
// Note: oauth2_authorization_code is NOT in scope for v2.0 (requires browser redirect/PKCE).

interface ApiAuthConfig {
  type:          ApiAuthType;
  // bearer
  token?:        string;       // literal or {{varName}}
  // apikey
  headerName?:   string;       // "X-API-Key"
  headerValue?:  string;
  // basic
  username?:     string;
  password?:     string;
  // oauth2_cc (client_credentials only)
  tokenUrl?:     string;
  clientId?:     string;
  clientSecret?: string;
  scopes?:       string;
  // runtime state (not persisted to disk)
  _cachedToken?:    string;
  _tokenExpiresAt?: number;    // epoch ms — enables auto-refresh
  autoRefresh?:     boolean;   // default true for oauth2_cc
}
```

### 4.3 ApiRequest

```typescript
interface ApiRequest {
  id:          string;
  name:        string;
  method:      'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url:         string;              // relative to env.baseUrl or absolute
  headers:     ApiHeader[];
  params:      ApiParam[];
  pathParams:  ApiParam[];
  bodyType:    'none' | 'json' | 'form-data' | 'urlencoded' | 'xml' | 'raw' | 'graphql';
  body:        string | null;
  formData:    ApiFormDataEntry[];
  auth:        ApiAuthConfig | 'inherit' | 'none';
  description: string;
}
```

### 4.4 ApiAssertion

```typescript
type ApiAssertionSource   = 'statusCode' | 'header' | 'body' | 'responseTime' | 'size';
type ApiAssertionOperator =
  | 'equals' | 'notEquals' | 'contains' | 'notContains'
  | 'startsWith' | 'endsWith' | 'matchesRegex'
  | 'lessThan' | 'greaterThan' | 'lessThanOrEqual' | 'greaterThanOrEqual'
  | 'exists' | 'notExists' | 'isEmpty' | 'isNotEmpty'
  | 'isType' | 'jsonSchemaValid';

interface ApiAssertion {
  id:       string;
  source:   ApiAssertionSource;
  path:     string;             // JSONPath for body; header name for header; empty for others
  operator: ApiAssertionOperator;
  expected: string;
  enabled:  boolean;
  // Assertion quality
  weight:   number;             // 1–10; drives "degraded" vs "failed" classification
  severity: 'critical' | 'major' | 'minor';
  mode:     'hard' | 'soft';   // hard = fail step; soft = warn only, step still passes
}
```

**Assertion weight defaults:**

| Source | Default weight |
|--------|---------------|
| statusCode | 10 |
| body required field | 8 |
| body optional field | 4 |
| header | 3 |
| responseTime | 2 |
| size | 1 |

### 4.5 ApiVariableExtraction

```typescript
interface ApiVariableExtraction {
  id:       string;
  source:   'body' | 'header' | 'statusCode' | 'responseTime';
  path:     string;       // JSONPath for body; header name for header
  variable: string;       // name stored into context (e.g. "authToken")
  scope:    'request' | 'collection';
}
```

### 4.6 ApiStepExecution (execution config, embedded in ApiTestStep)

```typescript
interface ApiStepExecution {
  // Retry policy
  retryPolicy: {
    maxRetries:   number;                          // 0–3
    strategy:     'fixed' | 'exponential';
    retryDelayMs: number;                          // base delay ms
    retryOn:      ('network' | '5xx' | '429')[];
    idempotent?:  boolean;  // default false — if false, POST/PUT/PATCH NOT retried even if in retryOn
  };
  // Execution graph
  dependsOn?:  string[];    // step IDs — manual override for hidden dependencies
  group?:      string;      // steps in same group run sequentially (by `order`); groups run in parallel
  // Timeouts
  timeoutMs?:  number;      // default 30000 (30s) — Playwright context timeout per step
  // Rate / pacing
  delayAfterMs?: number;    // explicit pause after step completes (before next step in wave)
  // Variable conflict
  variableWritePolicy?: 'last-write-wins' | 'error-on-conflict';
  // 'last-write-wins' = default for request-scope vars
  // 'error-on-conflict' = default for collection-scope vars extracted in parallel waves
  // Failure strategy (overrides collection-level onFailure for this step)
  onFailure?: 'continue' | 'abort' | 'abort-group' | 'skip-dependents';
  // continue        = proceed regardless
  // abort           = halt entire collection run
  // abort-group     = halt steps in same group, continue other groups
  // skip-dependents = mark all DAG children as skipped
  // Idempotency / cleanup
  teardown?:   boolean;     // if true, step runs during teardown phase (after all test steps)
  logLevel?:   'minimal' | 'normal' | 'debug';  // overrides collection logLevel for this step
}
```

### 4.7 ApiTestStep

```typescript
interface ApiTestStep {
  id:         string;
  order:      number;
  name:       string;
  request:    ApiRequest;
  assertions: ApiAssertion[];
  extractions: ApiVariableExtraction[];
  execution:  ApiStepExecution;
  // Conditional execution
  condition?: string;  // JS expression evaluated against current variable context
                       // e.g. "{{loginStatus}} === 200"
                       // Evaluated in a sandboxed scope (no external access)
  // Response snapshot (API visual diff — Phase 5+)
  baselineResponse?: {
    statusCode: number;
    body:       any;
    capturedAt: string;
  };
  compareMode?: 'strict' | 'loose';  // strict = exact match; loose = schema match only
}
```

### 4.8 ApiCollection

```typescript
interface ApiCollection {
  id:            string;
  projectId:     string;
  name:          string;
  description:   string;
  environmentId: string | null;
  auth:          ApiAuthConfig | 'none';
  steps:         ApiTestStep[];
  variables:     ApiVariable[];
  tags:          string[];
  // Execution
  executionMode: 'auto' | 'sequential' | 'parallel';
  // 'auto'       = build DAG from variable refs + dependsOn + group hints (default)
  // 'sequential' = force linear by `order` field, ignore DAG (escape hatch / debug mode)
  // 'parallel'   = fire all steps concurrently in one wave, no variable chaining
  onFailure:      'continue' | 'abort' | 'abort-group' | 'skip-dependents';
  // Step-level onFailure (in ApiStepExecution) overrides this collection-level default
  maxConcurrency?: number;  // max steps executing simultaneously in a wave (default 5)
  rateLimit?: {
    maxRequestsPerSecond: number;
    burstLimit?:          number;
  };
  logLevel?:   'minimal' | 'normal' | 'debug';  // default 'normal'
  // Versioning
  version:            number;           // starts at 1, increments on save
  previousVersionId?: string;
  // Audit
  createdBy:  string;
  createdAt:  string;
  updatedAt:  string;
}
```

### 4.9 ApiCollectionRunResult

```typescript
interface ApiCollectionRunResult {
  id:            string;
  collectionId:  string;
  collectionVersion: number;            // snapshot of version at run time
  environmentId: string;
  startedAt:     string;
  completedAt:   string | null;
  status:        'running' | 'completed' | 'failed' | 'cancelled';
  totalSteps:    number;
  passedSteps:   number;
  failedSteps:   number;
  skippedSteps:  number;
  stepResults:   ApiStepResult[];
  triggeredBy:   string;
  triggeredVia:  'ui' | 'api' | 'scheduler' | 'suite-link';
  // Flakiness (populated post-run by flakinessEngine)
  flakeScores?:  Record<string, number>;  // stepId → flakeScore
}

interface ApiStepResult {
  stepId:             string;
  stepName:           string;
  request:            ApiRequest;
  response:           ApiResponseSnapshot;
  assertionResults:   ApiAssertionResult[];
  extractedVariables: Record<string, any>;
  status:             'passed' | 'failed' | 'skipped' | 'degraded';
  // 'degraded' = hard assertions pass, soft assertions warn
  duration:           number;
  error:              string | null;
  retried:            boolean;
  retryCount:         number;
}

interface ApiResponseSnapshot {
  statusCode:   number;
  statusText:   string;
  headers:      Record<string, string>;
  body:         any;
  rawBody:      string;    // truncated at MAX_BODY_STORE_BYTES (50KB)
  bodyTruncated: boolean;  // true if rawBody was truncated
  responseTime: number;
  size:         number;
}

interface ApiAssertionResult {
  assertionId:     string;
  source:          ApiAssertionSource;
  path:            string;
  operator:        ApiAssertionOperator;
  expected:        string;
  actual:          string;
  passed:          boolean;
  mode:            'hard' | 'soft';
  message:         string;
  confidenceScore: number;  // 0–100: weight-normalised contribution to step health
                            // = (assertion.weight / maxWeight) * (passed ? 100 : 0)
                            // feeds flakiness engine + UI health indicators
}
```

---

## 5. Variable Resolution — Two Syntaxes

The platform uses two variable syntaxes from different origins. Both are resolved in a single pass by `apiVariables.ts`:

| Syntax | Source | Example |
|--------|--------|---------|
| `{{varName}}` | API environment + collection + extracted | `{{authToken}}`, `{{patientId}}` |
| `${varName}` | Common Data (`data/common_data.json`) | `${adminUser}`, `${adminPass}` |

**Resolution order (highest → lowest priority):**
1. Extracted variables from previous steps (runtime)
2. Collection-level variables
3. Environment variables
4. Common Data (`${}` syntax)

Both syntaxes are resolved before each step executes. `apiVariables.ts` handles both in the same substitution pass.

### 5.1 Variable Context Immutability + Merge Policy

**Problem:** In parallel waves, two steps may both extract into the same `{{varName}}` (e.g. both produce `{{token}}`). Shared mutable context = race condition.

**Solution — immutable snapshot + post-wave merge:**

```
Before each wave:
  snapshot = deep-clone of current variableContext  ← each step reads from this
  stepLocalContexts = {}

During wave (parallel):
  each step reads from snapshot (immutable)
  each step writes extractions into stepLocalContexts[stepId]

After wave completes:
  merge stepLocalContexts into variableContext:
    for collection-scope vars:
      if two steps wrote the same key → apply variableWritePolicy
    for request-scope vars:
      discard (never merged into shared context)
```

**`variableWritePolicy` (per collection, default `'error-on-conflict'` for collection-scope):**

| Policy | Behaviour |
|--------|-----------|
| `last-write-wins` | Last step to finish wins. Non-deterministic — use only for independent health checks |
| `error-on-conflict` | If two parallel steps write the same collection-scope var → run fails with `VariableConflictError`, naming both steps and the key |

`request`-scope extractions are always step-local and never enter the shared context — no conflict possible.

---

## 6. Execution Engine — DAG-Based Parallel Runner

### 6.1 Dependency Graph Construction

For `executionMode: 'auto'` (default), the runner builds a DAG before execution:

```
1. For each step, scan: URL, headers, body, params for {{varName}} references
2. For each {{varName}} reference:
   - Find which step produces it (via ApiVariableExtraction)
   - Add edge: producer → consumer (consumer depends on producer)
3. Apply manual overrides:
   - step.execution.dependsOn → add explicit edges
   - step.execution.group → steps in same group are sequential (chain within group)
4. Topological sort → execution waves
5. **Cycle detection:** if topological sort fails (cycle found) → throw `CircularDependencyError`
   with the cycle path (e.g. "Step A → Step B → Step A") before any HTTP request fires
6. Steps in the same wave execute in parallel (capped by `maxConcurrency`, subject to `rateLimit`)
```

**Example:**
```
Step 1: POST /auth/login   → produces {{authToken}}
Step 2: POST /patients     → consumes {{authToken}} → produces {{patientId}}
Step 3: GET /patients      → consumes {{authToken}}
Step 4: GET /appointments  → consumes {{authToken}}
Step 5: GET /reports       → no dependencies

Wave 1: [Step 1]                              → sequential (dependency chain start)
Wave 2: [Step 2, Step 3, Step 4, Step 5]      → parallel (all depend only on Step 1)
                                                 capped at maxConcurrency (default 5)
```

### 6.2 Execution Modes

| Mode | Behaviour |
|------|-----------|
| `auto` | Build DAG, parallel waves, respect groups + dependsOn |
| `sequential` | Ignore DAG, execute steps in `order` field, one at a time |
| `parallel` | Fire all steps concurrently in one wave, no variable chaining |

### 6.3 Rate Limiting

Token-bucket implementation in `apiRunner.ts`:

```typescript
// Per collection run
const limiter = new TokenBucket({
  maxRequestsPerSecond: collection.rateLimit?.maxRequestsPerSecond ?? 10,
  burstLimit:           collection.rateLimit?.burstLimit ?? 20
});
await limiter.acquire();  // before each HTTP request
```

### 6.4 Retry Policy

```typescript
// Per step, before marking as failed:
for (let attempt = 0; attempt <= step.execution.retryPolicy.maxRetries; attempt++) {
  const result = await executeStep(step, context, variables);
  if (result.status === 'passed') break;
  const shouldRetry = step.execution.retryPolicy.retryOn.some(condition =>
    (condition === 'network' && result.error?.includes('network')) ||
    (condition === '5xx'     && result.response?.statusCode >= 500) ||
    (condition === '429'     && result.response?.statusCode === 429)
  );
  if (!shouldRetry || attempt === step.execution.retryPolicy.maxRetries) break;
  const delay = step.execution.retryPolicy.strategy === 'exponential'
    ? step.execution.retryPolicy.retryDelayMs * Math.pow(2, attempt)
    : step.execution.retryPolicy.retryDelayMs;
  await sleep(delay);
}
```

### 6.5 Conditional Execution

```typescript
// Before executing a step:
if (step.condition) {
  const result = evaluateCondition(step.condition, currentVariables);
  if (!result) {
    stepResult.status = 'skipped';
    continue;
  }
}
```

**Condition evaluation — security design:**

`Function constructor` is NOT used. It allows `this.constructor.constructor("return process")()` prototype-chain escapes even in strict mode.

Instead, conditions are evaluated using Node's built-in `vm` module with a fully frozen context:

```typescript
import vm from 'vm';

function evaluateCondition(expression: string, variables: Record<string, any>): boolean {
  // Only inject the variable map — no prototype chain, no globals
  const sandbox = vm.createContext(Object.freeze({ ...variables }));
  try {
    return Boolean(vm.runInContext(expression, sandbox, { timeout: 100 }));
  } catch {
    return false;  // any evaluation error → treat as false (step skipped, not errored)
  }
}
```

**Constraints enforced:**
- 100ms timeout — prevents infinite loops
- `Object.freeze` — no sandbox mutation
- No `require`, no `process`, no `global` in scope
- Condition expressions must be simple boolean expressions (e.g. `"{{loginStatus}} === 200"`) — variables are pre-substituted as literals before `vm.runInContext` is called, so no variable can inject code

---

## 7. Pre-Scan API Health Score Formula

The architecture doc's score formula has a bug. Corrected formula:

```
base score:
  2xx response  → 100
  3xx response  → 50
  4xx response  → 20
  5xx response  → 0
  network error → 0

time penalty (applied to 2xx only):
  -5 per 200ms over 500ms, floored at 20
  (i.e. a 2xx at 3210ms = 100 - floor((3210-500)/200) * 5 = 100 - 13*5 = 35)

schema penalty:
  -10 per missing required field (floor at 0, applied after time penalty)

final score = max(0, base + time_penalty + schema_penalty)
```

This produces the `⚠ 72` reading from the architecture doc example approximately (interpretation: 3210ms endpoint was intended as a warning, not a pass — the formula was aspirational). The corrected formula makes 3210ms score ~35, which is a stronger warning. UX threshold: < 50 = amber, < 20 = red.

---

## 8. Import Engines

### 8.1 OpenAPI / Swagger Import (`openapiImport.ts`)

- Input: OpenAPI 3.0.x / 3.1.x / Swagger 2.0 (JSON or YAML)
- Parser: `js-yaml` (already in `package.json`) for YAML; native `JSON.parse` for JSON
- Types: `openapi-types` (dev dependency)
- Output: `ApiCollection` with all steps, assertions, extractions, and an `ApiEnvironment`

Key mappings:

| OpenAPI field | Target |
|---------------|--------|
| `servers[0].url` | `ApiEnvironment.baseUrl` |
| `paths[path][method]` | `ApiTestStep` |
| `operationId` or `summary` | `ApiTestStep.name` |
| `parameters[in=query]` | `ApiRequest.params[]` |
| `parameters[in=path]` | `ApiRequest.pathParams[]` as `{{paramName}}` |
| `parameters[in=header]` | `ApiRequest.headers[]` |
| `requestBody.content[application/json].schema` | `ApiRequest.body` (example) + `jsonSchemaValid` assertion |
| `responses[2xx]` | `ApiAssertion: statusCode equals 200/201/204` |
| `security` schemes | `ApiAuthConfig` |
| `components/schemas` | Referenced in `jsonSchemaValid` assertions |

Auto-suggestions after import:
- Field named `id`, `*Id`, `*_id` in response body → suggest extraction to `{{resourceId}}`
- Field named `token`, `access_token`, `accessToken` → suggest extraction to `{{authToken}}`

### 8.2 Postman Collection Import (`postmanImport.ts`)

- Input: Postman Collection JSON v2.1 or v3.0
- Convert `pm.response.to.have.status(N)` test scripts → `ApiAssertion`
- Convert `pm.environment.set(key, val)` → `ApiVariableExtraction`
- Nested folders → step groups (maps to `step.execution.group`)

### 8.3 cURL Import (`curlImport.ts`)

- Input: cURL command string
- Parse: method, URL, headers (`-H`), body (`-d`, `--data-raw`), auth (`-u`)
- Output: single `ApiTestStep` (added to collection or as scratch pad)

---

## 9. Auth Engine (`apiAuth.ts`)

```
Bearer:    inject 'Authorization: Bearer <token>' header
API Key:   inject header by headerName (e.g. 'X-API-Key: <value>')
Basic:     inject 'Authorization: Basic <base64(user:pass)>'
OAuth2 CC: POST tokenUrl with client_credentials grant
           → cache token + expiresAt
           → on next request: if (now > expiresAt - 60s) → re-acquire
           → implemented via playwright.request (same context)
```

**Not in scope for v2.0:** `oauth2_authorization_code` (requires browser redirect + PKCE). The type field accepts the string but the engine throws `NotImplementedError` if selected, with a clear UI message.

---

## 10. Assertion Engine (`apiAssertions.ts`)

**Dependencies:**
- `jsonpath-plus` — JSONPath evaluation for body assertions
- `ajv` — JSON Schema validation for `jsonSchemaValid` operator

**JSONPath performance note:** For large response bodies (> 100KB), parsed JSONPath expressions are cached in a `Map<string, CompiledPath>` per run to avoid re-parsing the same path across multiple assertions.

**Soft assertion handling:**
- `mode: 'hard'` assertions: failure → step status = `failed`
- `mode: 'soft'` assertions: failure → recorded as warning, step status = `degraded` (not `failed`)
- Step only gets `failed` status if at least one `hard` assertion fails

---

## 11. Integrations with Existing Platform Features

### 11.1 Flakiness Engine

`flakinessEngine.ts` is stateless — takes `TestEvent[]`. After each collection run, map step results:

```typescript
const events: TestEvent[] = stepResults.map(r => ({
  testId:    'ATID_' + sha256(collectionId + '::' + r.stepName).slice(0, 8),
  suiteId:   collectionId,
  testName:  r.stepName,
  status:    r.status === 'passed' ? 'passed' : 'failed',
  duration:  r.duration,
  timestamp: new Date().toISOString()
}));
scoreFlakinessForRun(events);
```

API step flake scores appear in the existing Flakiness dashboard under a new "API" filter tab.

### 11.2 Auto-File Jira Defect

When a step fails and auto-defect is enabled, call `jiraClient.ts` using existing infrastructure. Add one new ADF template function in `adfBuilder.ts` for API request/response formatting:

```typescript
buildApiDefectAdf(stepResult: ApiStepResult, env: ApiEnvironment): AdfDoc
```

Title format: `[API] {method} {path} — {failedAssertionSummary}`

### 11.3 Self-Healing (T4 URL Path)

When a step returns 404 and the collection has an associated OpenAPI spec:

```typescript
// In apiRunner.ts, on 404:
if (response.statusCode === 404 && collection.openapiSpecId) {
  healingEngine.proposeApiUrlFix(step.request.url, loadedSpec);
  // Proposal appears in existing Locator Proposals tab (no new UI for MVP)
}
```

T1 (assertion weights), T2 (schema drift), T3 (auth auto-retry) are implemented inline in `apiRunner.ts` and `apiAssertions.ts`. T4 delegates to `healingEngine.ts`.

### 11.4 Suite Runner Linkage (`beforeAllApiCollectionId`)

In `run-spawner.ts`, before spawning Playwright spec:

```typescript
if (suite.beforeAllApiCollectionId) {
  const apiResult = await runApiCollection(
    suite.beforeAllApiCollectionId,
    suite.environmentId ?? env.defaultApiEnvId,
    user, 'suite-link'
  );
  if (apiResult.failedSteps > 0 && suite.blockOnApiFailure) {
    return abortSuiteRun('API pre-run failed', apiResult);
  }
  // Merge extracted variables into run's common data scope
  mergeApiVarsIntoCommonData(apiResult, suiteRunId);
}
```

Add to `TestSuite` type: `beforeAllApiCollectionId?: string` and `blockOnApiFailure?: boolean`.

---

## 12. Storage

| File | Content | Notes |
|------|---------|-------|
| `data/api-envs.json` | `ApiEnvironment[]` | standard `store.ts` pattern |
| `data/api-collections.json` | `ApiCollection[]` | standard `store.ts` pattern |
| `data/api-runs/<id>.json` | `ApiCollectionRunResult` | one file per run (same pattern as trace results) |

**Body size cap:** `ApiResponseSnapshot.rawBody` is truncated at `MAX_BODY_STORE_BYTES = 51200` (50KB). `bodyTruncated: true` is set when truncation occurs. This prevents single run files from becoming multi-MB.

**Scale note:** JSON flat files are sufficient for v2.0 (< 1000 runs). When run count exceeds threshold (configurable, default 5000), the platform should migrate to SQLite using `better-sqlite3`. This is a Phase 6+ concern and not in scope here.

**Store constants to add to `store.ts`:**
```typescript
export const API_ENVS        = 'api-envs';
export const API_COLLECTIONS = 'api-collections';
// API_RUNS uses directory-based storage (data/api-runs/<id>.json), not the store helpers
```

No `API_TESTS` constant — steps are embedded in collections only. There is no standalone request store.

---

## 13. Security

| Concern | Solution |
|---------|----------|
| Sensitive env vars | AES-256-GCM via `src/auth/crypto.ts` (same as Common Data) |
| Masked in UI | Sensitive values shown as `••••••••` |
| CI/CD access | `requireAuthOrApiKey` middleware on collection run endpoint |
| No tokens in URLs | Auth always in headers, never query strings |
| Condition expressions | Evaluated via Node `vm` module with frozen context + 100ms timeout. `Function` constructor NOT used (prototype-chain escape risk). See section 6.5. |
| Pre/post scripts (Phase 5) | Same `vm` sandbox as conditions. Variables pre-substituted before eval. No `require`, `process`, `fs`, or prototype access in scope. |
| Audit trail | All collection runs, imports, and auth tests logged via `logAudit()` |

---

## 14. New Files

### Engine (new)
- `src/utils/apiRunner.ts` — DAG builder, parallel executor, rate limiter, retry, Playwright context
- `src/utils/apiAssertions.ts` — all assertion operators, JSONPath eval, schema validation, soft/hard mode
- `src/utils/apiVariables.ts` — `{{}}` + `${}` resolution, faker integration stub
- `src/utils/apiAuth.ts` — Bearer/APIkey/Basic/OAuth2-CC token management
- `src/utils/openapiImport.ts` — OpenAPI 3.x / Swagger 2.0 → ApiCollection
- `src/utils/postmanImport.ts` — Postman v2.1/v3.0 → ApiCollection
- `src/utils/curlImport.ts` — cURL string → ApiRequest

### Routes (new)
- `src/ui/routes/api.routes.ts` — all REST endpoints (envs, collections, steps, import, runs, auth-test)

### Frontend (new)
- `src/ui/public/js/23-api-tests.js` — step builder, assertion editor, variable extraction UI
- `src/ui/public/js/24-api-collections.js` — collection manager, DAG visualiser (simple), run results
- `src/ui/public/js/25-api-envs.js` — environment editor, variable editor, auth config

### Modified (existing)
- `src/data/types.ts` — add 10 new interfaces
- `src/data/store.ts` — add `API_ENVS`, `API_COLLECTIONS` constants
- `src/ui/server.ts` — `registerApiRoutes(app)`
- `src/ui/public/js/10-suites.js` — `beforeAllApiCollectionId` + `blockOnApiFailure` fields
- `src/ui/public/js/11-execution.js` — show API pre-run results inline
- `index.html` — add "API Testing" nav tab; add API Health tab to Pre-Scan modal

---

## 15. New Dependencies

| Package | Purpose | Size | Already present? |
|---------|---------|------|-----------------|
| `jsonpath-plus` | JSONPath evaluation | ~30KB | No |
| `ajv` | JSON Schema validation | ~80KB | No |
| `openapi-types` | TypeScript types for OpenAPI | ~20KB dev | No |
| `js-yaml` | YAML parsing | ~18KB | Check `package.json` — likely yes |
| `playwright` (request API) | HTTP client | 0 extra | Yes |

---

## 16. API Routes

### Environments
| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/api/api-envs?projectId=` | requireAuth |
| POST | `/api/api-envs` | requireEditor |
| PUT | `/api/api-envs/:id` | requireEditor |
| DELETE | `/api/api-envs/:id` | requireEditor |
| POST | `/api/api-envs/:id/resolve` | requireAuth |

### Collections + Steps
| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/api/api-collections?projectId=` | requireAuth |
| GET | `/api/api-collections/:id` | requireAuth |
| POST | `/api/api-collections` | requireEditor |
| PUT | `/api/api-collections/:id` | requireEditor |
| DELETE | `/api/api-collections/:id` | requireEditor |
| POST | `/api/api-collections/:id/duplicate` | requireEditor |
| PATCH | `/api/api-collections/:id/steps/reorder` | requireEditor |
| POST | `/api/api-collections/:id/steps` | requireEditor |
| PUT | `/api/api-collections/:id/steps/:stepId` | requireEditor |
| DELETE | `/api/api-collections/:id/steps/:stepId` | requireEditor |

### Import
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/api/api-import/openapi` | requireEditor |
| POST | `/api/api-import/postman` | requireEditor |
| POST | `/api/api-import/curl` | requireEditor |

### Execution
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/api/api-collections/:id/run` | requireAuthOrApiKey |
| POST | `/api/api-collections/:id/steps/:stepId/run` | requireAuth |
| GET | `/api/api-runs?collectionId=` | requireAuth |
| GET | `/api/api-runs/:id` | requireAuth |
| DELETE | `/api/api-runs/:id` | requireEditor |

### Auth Helpers
| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/api/api-auth/test` | requireAuth |
| POST | `/api/api-auth/oauth2-token` | requireAuth |

### Pre-Scan
| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/api/prescan/api-health?projectId=` | requireAuth |

---

## 17. Implementation Phases

### Phase 1 — Foundations (Weeks 1–2)
- `types.ts` new interfaces
- `store.ts` constants
- `api.routes.ts` CRUD skeleton (envs, collections, steps)
- `apiVariables.ts` — variable resolution (both syntaxes)
- `apiAuth.ts` — Bearer, API key, Basic (OAuth2 in Phase 2)

### Phase 2 — Engine Core (Weeks 3–4)
- `apiAssertions.ts` — full operator set, JSONPath, schema validation, soft/hard mode
- `apiRunner.ts` — DAG builder, parallel waves, rate limiter, retry policy, conditional execution
- OAuth2 client_credentials in `apiAuth.ts`
- Single-step run endpoint

### Phase 3 — Import (Week 5)
- `curlImport.ts`
- `postmanImport.ts`
- `openapiImport.ts`
- Collection run endpoint + run result storage

### Phase 4 — Frontend + Integration (Weeks 6–8)
- `25-api-envs.js`
- `24-api-collections.js`
- `23-api-tests.js`
- Suite linkage (`10-suites.js`, `run-spawner.ts`)
- Flakiness integration (`confidenceScore` fed to flakiness engine)
- Jira auto-file integration (`adfBuilder.ts` new template)
- Pre-scan API health tab
- **HAR viewer in run results UI** — Playwright already records `.har` per run; Phase 4 exposes it as a "Network" tab in the run results view (same as browser DevTools). Enables response diff, debugging, failure replay. Moved from Phase 5.
- **Failure clustering** — group step failures by root cause in run results (e.g. "4 steps failed → auth token expired"). Moved from Phase 5 — high CI value, low implementation cost (pure result post-processing).
- Teardown steps — steps with `execution.teardown: true` run after all test steps regardless of pass/fail

### Phase 5 — Advanced (Weeks 9–11)
- T4 URL path healing (healingEngine bridge)
- Response snapshot / visual diff (baseline capture + compare via `baselineResponse`)
- Contract drift detection (OpenAPI spec vs runtime response schema diff)
- Faker dynamic data generation in `ApiDynamicValue`
- Pre/post request scripts (sandboxed via `vm`)

### Phase 6 — Scale (Future)
- SQLite migration for run storage when > 5000 runs
- Intelligent test generation from OpenAPI (happy path + edge cases + invalid inputs)
- API analytics dashboard

---

## 18. Deferred / Out of Scope for v2.0

| Item | Reason |
|------|--------|
| `oauth2_authorization_code` grant | Requires browser redirect/PKCE — separate feature |
| GraphQL body type | Low demand vs REST; adds AST complexity |
| Pre/post JS scripts (Phase 5) | Sandboxing needs careful design; deferred |
| SQLite migration | Not needed until > 5000 runs |
| Faker dynamic data | Phase 5+ |
| API analytics dashboard | Phase 6 |

---

*End of API Testing Module Design Spec*
