# API Testing Module — Implementation Plan Phase 4: Frontend + Integration
**Weeks 6–8 | Spec:** `docs/superpowers/specs/2026-05-02-api-testing-design.md`
**Depends on:** Phase 1–3 complete (all backend routes, engine, import engines live)

---

## Scope
Three frontend JS modules, platform integrations (flakiness, Jira, self-healing, suite runner), HAR network viewer, teardown step execution, and failure clustering. By end of Phase 4: the feature is usable end-to-end from the browser — create environments, build collections, run them, see results, and have failures auto-filed as Jira defects.

---

## Tasks

### [API] Task 4.1 — Environments UI Module (`23-api-envs.js`)
**File:** `src/ui/public/js/23-api-envs.js` (new)
**Build:** `npm run build:js` after every edit

UI panel for managing `ApiEnvironment` records.

**Features:**
- List all environments in a table (name, baseUrl, variable count, auth type)
- Create / Edit form with fields:
  - Name, Base URL
  - Variables grid: key / value / sensitive toggle (sensitive values shown as `••••` after save)
  - Auth config selector: None / Bearer / API Key / Basic / OAuth2 CC
    - Bearer: token input
    - API Key: key name, value, location (header/query)
    - Basic: username + password
    - OAuth2 CC: tokenUrl, clientId, clientSecret, scope
- Delete with confirmation dialog
- "Set as Default" button — stores `defaultApiEnvId` in `commondata`

**Sensitive variable handling:**
- On load: display `••••` for any variable with `sensitive: true`
- On save: send value as-is if unchanged (backend detects no re-encrypt needed); send new value if user typed in the field

**Tab registration:** Add `api-envs` tab to the nav. Tab label: `API Environments`. Icon: `🌐` or equivalent SVG.

**Acceptance:**
- Create env with 2 variables (one sensitive) → sensitive shows `••••` after save
- Edit env → existing values pre-populated (sensitive shows `••••`)
- Delete → removed from list
- No page reload needed (SPA pattern matching existing modules)

---

### [API] Task 4.2 — Collections Builder UI Module (`24-api-collections.js`)
**File:** `src/ui/public/js/24-api-collections.js` (new)
**Build:** `npm run build:js` after every edit

Main collection builder — the most complex frontend module.

**Left panel — Collection list:**
- List all collections (name, environment, step count, last run status badge)
- New Collection button → opens editor panel
- Import dropdown: `From OpenAPI` / `From Postman` / `From cURL`

**Import flows:**
- OpenAPI: textarea for YAML/JSON paste + file upload input + optional tag filter → POST `/api/api-collections/import/openapi` → preview step list → confirm saves collection
- Postman: file upload (JSON) → POST `/api/api-collections/import/postman` → preview → confirm saves
- cURL: single textarea → POST `/api/api-collections/import/curl` → previews one step → "Add to collection" picker

**Right panel — Collection editor:**
- Collection name, environment selector, execution mode (`auto`/`sequential`/`parallel`), `maxConcurrency`, `onFailure`, `logLevel`
- Collection-level variables table (key / value / sensitive)
- Steps list (drag-to-reorder for `order` field)

**Per-step editor (inline expand):**
- Method + URL (with `{{var}}` autocomplete based on collection variables + env variables)
- Headers table (key / value)
- Query params table (key / value)
- Body: mode selector (none / JSON / form / raw) + textarea
- Auth override: inherit from collection / override per-step
- Assertions panel: add assertion rows (field / operator / expected / weight / severity)
- Variable extraction panel: add extraction rows (name / source / JSONPath / scope)
- Execution settings: `dependsOn` multi-select, `group`, `order`, `timeoutMs`, `retryPolicy`, `onFailure`, `condition`, `teardown` toggle, `idempotent` toggle, `logLevel`

**Pre-Scan button:** POST `/api/api-collections/:id/pre-scan` → show health score table per step (colour-coded: green ≥80, amber 50–79, red <50).

**Run button:** POST `/api/api-collections/:id/run` → navigate to run result view (Task 4.3).

**Acceptance:**
- Create collection with 2 steps → saved → retrievable on reload
- Import from OpenAPI YAML → preview → confirm → collection appears in list
- Inline step editor opens/closes without full re-render
- Pre-scan shows health scores per step
- Run button triggers execution and navigates to results

---

### [API] Task 4.3 — Run Results UI Module (`25-api-runs.js`)
**File:** `src/ui/public/js/25-api-runs.js` (new)
**Build:** `npm run build:js` after every edit

Displays run results with live polling.

**Run list view:**
- List runs for selected collection (most recent 50)
- Status badge: `running` (spinner) / `passed` (green) / `failed` (red) / `error` (orange)
- Columns: run date, duration, step count, passed/failed/skipped/degraded counts

**Run detail view (click a run):**
- Run summary bar: overall status, total duration, collection name, environment
- Step results table:
  - Step name, status badge, duration
  - Expand row → assertion results table (field / operator / expected / actual / passed / confidenceScore)
  - Expand row → extracted variables (name / value)
  - Expand row → request detail (method, URL, headers, body sent)
  - Expand row → response detail (status, headers, body received — truncated indicator if `bodyTruncated`)

**Live polling:** if `status === 'running'`, poll `GET /api/api-runs/:runId` every 2s. Stop on final status. Show step rows populating in real time as each step completes.

**Network tab (HAR viewer):** per-run tab showing HAR entries (spec §17 Phase 4 promotion):
- Table: step name / method / URL / status / duration / size
- Click row → request + response headers + body panel
- Data source: `response.har` field on `ApiResponseSnapshot` (Playwright records HAR via `recordHar` option)

**Failure clustering panel** (spec §17 Phase 4 promotion):
- Groups failed steps by likely root cause
- Clustering algorithm: group steps that share the same HTTP status code + first assertion failure field
- Example display: `"4 steps failed → status 401 (auth token expired)"`
- Show at top of run detail view when `failedCount > 1`

**Acceptance:**
- Run with `status: 'running'` → spinner → auto-updates to final status without page reload
- Expand step row → assertion results visible with confidenceScore
- HAR tab shows request/response for each step
- Failure clustering groups 3 steps with same 401 error into one cluster

---

### [API] Task 4.4 — Flakiness Engine Integration
**File:** `src/utils/apiRunner.ts` (modified)

After each run completes, map `ApiStepResult[]` → `TestEvent[]` and call `scoreFlakinessForRun()` (spec §11.1).

**Mapping:**
```typescript
const events: TestEvent[] = result.stepResults.map(step => ({
  testId: 'API_' + sha256(result.collectionId + '::' + step.stepName).slice(0, 8),
  testName: step.stepName,
  suiteId: result.collectionId,
  suiteName: collection.name,
  status: step.status === 'passed' ? 'passed' : 'failed',
  durationMs: step.durationMs,
  runAt: new Date(result.startedAt).getTime(),
  source: 'api',         // new source type — add to TestEvent.source union
  confidenceScore: step.assertionResults
    .reduce((sum, a) => sum + (a.confidenceScore ?? 0), 0) / (step.assertionResults.length || 1),
}));
await scoreFlakinessForRun(events);
```

**Flakiness dashboard:** add `"API"` filter tab to existing Flakiness Intelligence panel. Filter by `source === 'api'`. No changes to `flakinessEngine.ts` itself — only the mapping + source field.

**TestEvent type change:** add `source?: 'web' | 'api'` to `TestEvent` interface in `types.ts`. Existing web events default to `'web'` (backward compatible — field is optional).

**Acceptance:**
- After API run with 1 failed step → flakiness dashboard shows that step under `API` tab
- `flakinessEngine.ts` unchanged — pure function still receives standard `TestEvent[]`

---

### [API] Task 4.5 — Jira Auto-File Defect Integration
**File:** `src/utils/adfBuilder.ts` (modified) + `src/utils/apiRunner.ts` (modified)

Add `buildApiDefectAdf()` to `adfBuilder.ts` (spec §11.2).

**Title format:** `[API] {method} {path} — {failedAssertionSummary}`
Example: `[API] POST /api/v1/patients — expected status 201, got 500`

**ADF body sections:**
- **Collection:** name + environment
- **Failed Step:** step name, method, URL, response status, duration
- **Failed Assertions:** table of field / expected / actual for each failed assertion
- **Request Sent:** method, URL, headers (redact Authorization values), body
- **Response Received:** status, headers, body (first 500 chars)

**Auto-file trigger in `apiRunner.ts`:** after run completes, for each step with `status === 'failed'`:
```typescript
if (collection.autoFileDefects) {   // new optional field on ApiCollection
  await autoFileDefect(buildApiDefectAdf(step, collection, environment));
}
```

**Dedup:** reuse existing Jira dedup logic in `defectsStore.ts` — JQL search by title prefix `[API]` + step name before filing.

**Acceptance:**
- Failed API step → Jira issue created with `[API]` prefix title
- Duplicate run → no second Jira issue created (dedup works)
- Authorization header value redacted in ADF body

---

### [API] Task 4.6 — Self-Healing T4 URL Integration
**File:** `src/utils/apiRunner.ts` (modified) + `src/utils/healingEngine.ts` (read-only reference)

On 404 response, if `step.request.openapiSpecId` is set, delegate to `healingEngine.proposeApiUrlFix()` (spec §11.3).

```typescript
if (response.status === 404 && step.request.openapiSpecId) {
  const proposal = await healingEngine.proposeApiUrlFix({
    method: step.request.method,
    url: resolvedUrl,
    specId: step.request.openapiSpecId,
  });
  if (proposal) {
    stepResult.healingProposal = proposal;  // add healingProposal?: string to ApiStepResult
  }
}
```

**`ApiRequest` addition:** add optional `openapiSpecId?: string` field to `ApiRequest` in `types.ts`.
**`ApiStepResult` addition:** add optional `healingProposal?: string` field to `ApiStepResult` in `types.ts`.

Proposals surface in existing **Locator Proposals** tab — no new UI tab needed. The healing engine's proposal format already supports URL suggestions.

**Acceptance:**
- Step returning 404 with `openapiSpecId` set → `healingProposal` field present in run result
- Proposal visible in Locator Proposals tab
- `healingEngine.ts` not modified

---

### [API] Task 4.7 — Suite Runner Linkage
**File:** `src/data/types.ts` + `src/utils/run-spawner.ts` (modified)

Allow a `TestSuite` to run an API collection before launching Playwright specs (spec §11.4).

**`TestSuite` type additions (in `types.ts`):**
```typescript
beforeAllApiCollectionId?: string;   // run this collection before suite starts
blockOnApiFailure?: boolean;          // default true — abort suite if collection fails
```

**`run-spawner.ts` changes:**
```typescript
if (suite.beforeAllApiCollectionId) {
  const env = getDefaultApiEnv();  // from commondata defaultApiEnvId
  const runResult = await runCollection(
    getById(API_COLLECTIONS, suite.beforeAllApiCollectionId),
    env,
    generateRunId()
  );
  if (suite.blockOnApiFailure !== false && runResult.status === 'failed') {
    // abort — mark suite run as failed, do not spawn Playwright
    return markSuiteRunFailed(suiteRunId, 'API pre-check failed');
  }
}
// ... existing Playwright spawn logic
```

**Suite builder UI addition (in existing suite module, not a new file):**
Add two fields to the existing suite edit form:
- `beforeAllApiCollectionId` — dropdown of API collections (or "None")
- `blockOnApiFailure` — checkbox (default checked)

**Acceptance:**
- Suite with `beforeAllApiCollectionId` set → API run fires before Playwright specs
- API run fails + `blockOnApiFailure: true` → Playwright specs do not start; suite marked failed
- API run passes → Playwright proceeds normally
- `blockOnApiFailure: false` → Playwright runs regardless of API result

---

### [API] Task 4.8 — Teardown Step Execution (Engine Fix)
**File:** `src/utils/apiRunner.ts` (modified)

Ensure steps with `execution.teardown: true` execute after ALL test steps complete, regardless of pass/fail (spec §4.6, promoted to Phase 4).

**Implementation:**
```typescript
const testSteps = collection.steps.filter(s => !s.execution?.teardown);
const teardownSteps = collection.steps.filter(s => s.execution?.teardown);

// Run normal DAG on testSteps first
const testResults = await executeWaves(buildDAG(testSteps), ...);

// Run teardown steps sequentially after, always
const teardownResults = await executeSequential(teardownSteps, ...);

result.stepResults = [...testResults, ...teardownResults];
```

Teardown steps always appear last in `stepResults`. Their `status` does not affect overall run `status` (run status computed from test steps only).

**Acceptance:**
- Collection with 1 teardown step: teardown runs even when a test step fails
- Teardown step result appears at bottom of run detail view with `[teardown]` badge
- Teardown failure does not change overall run status from `passed` to `failed`

---

## Verification Checklist

- [ ] `npm run build:js` — modules.js rebuilt, no JS errors in browser console
- [ ] `npm run build` — TypeScript compiles clean
- [ ] Create API env with sensitive variable → shows `••••` in UI after save
- [ ] Build collection with 2 steps → save → reload → steps persist
- [ ] Import OpenAPI YAML → preview step list → confirm → collection saved
- [ ] Run collection → live polling → final status displayed
- [ ] Step expand → assertion results + confidenceScore visible
- [ ] HAR network tab → request/response for each step
- [ ] Failure clustering → groups shown when >1 failure with same root
- [ ] Flakiness dashboard → `API` tab shows failed step after run
- [ ] Jira defect filed for failed step (if Jira configured)
- [ ] Suite with `beforeAllApiCollectionId` → API run fires first
- [ ] Teardown step runs after test step failure
- [ ] Port 3003 — existing features unbroken (run smoke check on Web suite)

---

## Files Created / Modified

| File | Action |
|------|--------|
| `src/ui/public/js/23-api-envs.js` | Created — environments CRUD UI |
| `src/ui/public/js/24-api-collections.js` | Created — collection builder + import UI |
| `src/ui/public/js/25-api-runs.js` | Created — run results + HAR viewer + failure clustering |
| `src/utils/apiRunner.ts` | Modified — flakiness mapping, Jira trigger, healing, teardown, suite linkage |
| `src/utils/adfBuilder.ts` | Modified — add `buildApiDefectAdf()` |
| `src/utils/run-spawner.ts` | Modified — `beforeAllApiCollectionId` pre-check |
| `src/data/types.ts` | Modified — `TestEvent.source`, `TestSuite` additions, `ApiRequest.openapiSpecId`, `ApiStepResult.healingProposal` |
| `src/ui/public/js/<suite-module>.js` | Modified — add `beforeAllApiCollectionId` + `blockOnApiFailure` fields to suite form |

**After all frontend edits:** `npm run build:js` (once at end of each task, not after every line)

---

## Not In Phase 4 Scope

- T4 URL healing engine internals → no changes to `healingEngine.ts`
- `flakinessEngine.ts` → no changes (pure function, receives standard events)
- Response snapshot/visual diff (`baselineResponse`) → Phase 5
- Contract drift detection → Phase 5
- Faker dynamic data → Phase 5
- Pre/post scripts (sandboxed via vm) → Phase 5
