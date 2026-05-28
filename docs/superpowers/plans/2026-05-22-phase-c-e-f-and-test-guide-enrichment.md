# Plan: Phase C, E, F Gaps + Test Guide Enrichment
# Created: 2026-05-22 | Status: APPROVED — Ready for Execution

---

## Context

Phase audit against the TestForge API Runtime Re-Architecture Plan (Phases A–F) revealed:
- **Phase A, B, D** — COMPLETE
- **Phase C** — Architecture + contracts complete; live coordinator and worker lifecycle still stubs
- **Phase E** — AI/RCA infrastructure present; `debugger-engine/` not created; negative test generator and assertion suggester missing
- **Phase F** — Mostly complete; health endpoint path mismatch; no runnable example plugins

Additionally, the `API_TESTING_TEST_GUIDE.md` covers only 4 test categories (Positive, Negative, Security, Edge).
The `api-test-suite` project uses 12 categories. 8 are missing from the guide.

---

## Track 1 — Phase C: Live Execution Coordinator

**Gap:** `ExecutionCoordinator.dispatchRun()` and worker lifecycle are stubs. Contracts exist, nothing runs.

**Risk:** MEDIUM — routes stay unchanged externally; internal execution path changes behind feature flag

### Steps

- [ ] 1. Implement `dispatchRun()` in `src/execution-coordinator/coordinator.ts`
  - Spawns child_process worker per run
  - Returns `RunHandle` with `runId`

- [ ] 2. Implement `getRunState(runId)`
  - Reads `ExecutionSnapshot` from `src/api-runtime/artifact-engine/execution-store.ts`

- [ ] 3. Implement `cancelRun(runId)`
  - Sends SIGTERM to child process
  - Marks run `cancelled` in store

- [ ] 4. Implement `replayNode(runId, nodeId)`
  - Loads snapshot for `runId`
  - Re-executes single node with captured variable state

- [ ] 5. Wire worker bridge: `src/execution-coordinator/worker-bridge.ts`
  - Serialize `WorkflowEnvelope` + env → child process via IPC
  - Deserialize result back

- [ ] 6. Upgrade `api-testing.routes.ts`
  - `POST /api/api-collections/:id/run` calls coordinator instead of `runCollection` directly
  - Feature flag: `USE_COORDINATOR=true` → coordinator path; `false` → legacy `runCollection` fallback

- [ ] 7. Persist `ExecutionSnapshot` after each node
  - Variable state + node status
  - Write to `data/execution-snapshots/<runId>.json` (atomic write)

- [ ] 8. Unit tests
  - Coordinator lifecycle: dispatch → running → completed / failed / cancelled
  - Snapshot capture and retrieval
  - Node replay with restored variable state
  - Prod smoke test passes

---

## Track 2 — Phase E: Debugger Engine + AI Generators

**Gap:** `debugger-engine/` not created. No negative test generator. No assertion suggester endpoint.

**Risk:** LOW — all additive, no existing code touched

### 2a — Debugger Engine

- [ ] 1. Create `src/api-runtime/debugger-engine/` with:
  - `timeline-capture.ts` — captures request lifecycle events per node with timestamps
    - Events: `queued → started → retrying → completed`
    - Writes to `data/execution-timelines/<runId>.timeline.json`
  - `variable-snapshot-viewer.ts` — reads `ExecutionSnapshot`, produces variable mutation trace per step
    - Tracks: created / overridden / propagated
  - `node-replay.ts` — thin wrapper; loads snapshot, calls `replayNode()` from coordinator
  - `workflow-replay.ts` — full re-run from snapshot; restores variable state to T=0, re-executes all nodes

- [ ] 2. Expose routes in `api-testing.routes.ts`:
  - `GET /api/api-runs/:runId/timeline` — returns timeline events
  - `GET /api/api-runs/:runId/variable-trace` — returns variable mutation trace
  - `POST /api/api-runs/:runId/replay-node` body `{ nodeId }` — replays single node
  - `POST /api/api-runs/:runId/replay-workflow` — full re-run from snapshot

### 2b — AI Negative Test Generator

- [ ] 1. Create `src/api-intelligence/engines/negative-test-generator.ts`
  - Pure function: `ApiCollection` → `NegativeTestSuite[]` per step
  - Generates:
    - Missing required fields (derived from request body schema)
    - Wrong types (string where number expected)
    - Boundary violations (0, -1, empty string, 9999999)
    - Auth stripping (remove auth header)
    - Wrong HTTP method
  - ADVISORY ONLY — never modifies collection

- [ ] 2. Route: `POST /api/ai-intelligence/collections/:id/generate-negative-tests`
  - Returns `NegativeTestSuite[]`
  - Audit: `api:intelligence:negative-tests:generated` via `logApiAudit`

### 2c — AI Assertion Suggester

- [ ] 1. Create `src/api-intelligence/engines/assertion-suggester.ts`
  - Pure function: `ApiStepResult` (actual response) → `SuggestedAssertion[]`
  - Suggests:
    - Status code assertion (current actual status)
    - JSONPath `exists` for each top-level key in response body
    - Response time SLA (actual duration × 2)
    - Content-type header assertion
  - ADVISORY ONLY — never modifies step

- [ ] 2. Route: `POST /api/ai-intelligence/steps/:stepId/suggest-assertions` body `{ runId }`
  - Returns `SuggestedAssertion[]`
  - Audit: `api:intelligence:assertions:suggested` via `logApiAudit`

- [ ] 3. Unit tests for all Phase E additions
  - Debugger engine: timeline capture, variable trace, node replay, workflow replay
  - Negative test generator: all 5 generation strategies
  - Assertion suggester: all 4 suggestion types
  - Graceful degradation when snapshot missing

---

## Track 3 — Phase F: Health Route + Example Plugins

**Gap:** Health endpoint is at `/api/worker-pool/health` not `/api/api-runtime/health`. No runnable example plugins.

**Risk:** LOW — purely additive

### Steps

- [ ] 1. Add alias route `GET /api/api-runtime/health`
  - In `src/api-runtime/worker-health/routes/worker-health.routes.ts`
  - Same handler as `/api/worker-pool/health`
  - Returns `{ status, workerCount, activeLeases, stuckRuns, uptimeMs }`

- [ ] 2. Create `src/api-plugins/examples/custom-bearer-auth.plugin.ts`
  - `ApiRuntimePlugin` of type `auth`
  - Reads custom header `X-Custom-Auth`
  - Exchanges for Bearer token via configurable endpoint
  - Demonstrates `register()` hook pattern

- [ ] 3. Create `src/api-plugins/examples/custom-json-assertion.plugin.ts`
  - `ApiRuntimePlugin` of type `assertion`
  - Adds `jsonPathCount` operator: assert array length at JSONPath equals expected value
  - Registers via `HookRegistry`

- [ ] 4. Add `loadExamplePlugins()` export in `src/api-plugins/plugin-registry.ts`
  - Not auto-loaded — explicit call only
  - Documents both example plugins

- [ ] 5. Add `GET /api/plugins/examples` route
  - Lists available example plugins with usage documentation

- [ ] 6. Unit tests
  - Health route returns correct shape
  - Bearer auth plugin: token exchange flow
  - JSON assertion plugin: `jsonPathCount` operator evaluation
  - `loadExamplePlugins()` registers both without error

---

## Track 4 — Test Guide Enrichment (8 New Categories)

**Gap:** `API_TESTING_TEST_GUIDE.md` has 4 categories (Positive, Negative, Security, Edge).
`api-test-suite` project uses 12 categories. 8 are missing.

**Risk:** ZERO — docs only, no code changes

### New Categories to Add (TC-341 onward)

| Category | Scope | TC Range |
|---|---|---|
| Token Lifecycle | Auth token format variations, brute force, refresh | TC-341 – TC-350 |
| Content-Type | Missing/wrong MIME type on POST endpoints | TC-351 – TC-358 |
| Contract | Response schema field presence validation | TC-359 – TC-368 |
| Authorization | Role isolation, cross-tenant access blocked | TC-369 – TC-380 |
| Idempotency | Duplicate requests, replay protection | TC-381 – TC-388 |
| Business Rules | Domain constraints: DAG cycles, invalid operators | TC-389 – TC-398 |
| Boundary | Min/max values: 0 steps, max-length names | TC-399 – TC-408 |
| Unicode | Emoji, Arabic, XSS strings in text fields | TC-409 – TC-416 |

### Steps

- [ ] 1. Append **Token Lifecycle** section (TC-341–TC-350)
  - Expired JWT on `/api/api-collections/:id/run`
  - Token without `Bearer` prefix
  - Lowercase `bearer` prefix
  - Malformed JWT (not 3-segment)
  - oauth2cc: expired client_secret → 401
  - oauth2cc: auto-refresh succeeds and run proceeds
  - Concurrent runs with same token
  - Token revoked mid-run
  - Missing `Authorization` header on protected route
  - Empty string token value

- [ ] 2. Append **Content-Type** section (TC-351–TC-358)
  - POST `/api/api-collections` without Content-Type
  - POST with `text/plain` Content-Type
  - POST with `multipart/form-data` Content-Type
  - POST step create with `application/xml`
  - PUT environment update without Content-Type
  - POST run trigger with no body and no Content-Type
  - POST import with `text/plain` instead of `application/json`
  - POST suite run without Content-Type

- [ ] 3. Append **Contract** section (TC-359–TC-368)
  - `GET /api/api-envs` response has `id`, `name`, `baseUrl`
  - `POST /api/api-collections` response has `id`, `name`, `steps`
  - `POST /api/api-collections/:id/run` response has `runId`
  - `GET /api/api-runs/:runId` response has `status`, `steps`, `startedAt`
  - `GET /api/api-runs/:runId/observability` has `timeline`, `snapshot`
  - `GET /api/worker-pool/health` has `status`, `workerCount`
  - `GET /api/api-flakiness/:id` has `score`, `hotspots`
  - `POST /api/ai-intelligence/collections/:id/recommendations` has `recommendations[]`
  - `GET /api/governance/audit` has `entries[]` with `action`, `timestamp`
  - `POST /api/remediation/collections/:id/proposals` has `proposals[]` with `status: pending-approval`

- [ ] 4. Append **Authorization** section (TC-369–TC-380)
  - `viewer` role cannot trigger `POST /api/api-collections/:id/run` → 403
  - `viewer` role cannot create environment → 403
  - `tester` role cannot approve remediation proposal → 403
  - `tester` role cannot create governance policy → 403
  - `editor` can run collection → 200/202
  - `editor` cannot approve remediation if env is restricted → 403
  - Cross-tenant: env from tenant A not visible to tenant B token
  - Cross-tenant: collection run result from tenant A not accessible by tenant B
  - `admin` can access all governance audit entries
  - Non-admin cannot `DELETE` environment with active collections → 403
  - Unauthenticated request to any `/api/` route → 401
  - Expired session token on protected route → 401

- [ ] 5. Append **Idempotency** section (TC-381–TC-388)
  - Duplicate `POST /api/api-envs` with same name in same project → 409 or dedup
  - Trigger same collection run twice rapidly — second run gets new `runId` (not duplicate)
  - Duplicate `POST /api/remediation/proposals/:id/approve` → 400 (already approved)
  - Duplicate `POST /api/remediation/proposals/:id/reject` after approve → 400
  - File Jira defect twice for same step + failure signature → dedup, returns existing
  - Duplicate baseline capture for same collection → overwrites, no error
  - Duplicate suite run trigger → new `suiteRunId` each time
  - Duplicate governance policy register with same name → 409 or update

- [ ] 6. Append **Business Rules** section (TC-389–TC-398)
  - Collection with DAG cycle in `dependsOn` → rejected at run time with `CircularDependencyError`
  - Step `dependsOn` referencing non-existent step ID → validation error
  - Assertion with operator not in the 16 valid operators → 400
  - Variable extraction with invalid JSONPath → step fails with extraction error
  - oauth2cc env with missing `tokenUrl` → auth resolution error
  - Collection `maxConcurrency: 0` in parallel mode → 400
  - Suite with `beforeAll` collection that fails → subsequent collections skipped
  - Retry policy `maxAttempts: 0` → treated as no retry (not error)
  - Pre/post script exceeding 500ms sandbox timeout → step fails with timeout error
  - Import with OpenAPI spec missing `paths` → import error with meaningful message

- [ ] 7. Append **Boundary** section (TC-399–TC-408)
  - Collection with exactly 1 step — runs successfully
  - Collection with 200 steps — runs without timeout
  - Environment variable value at 0 characters (empty string) — stored and substituted correctly
  - Environment variable name at 255 characters — accepted
  - Step URL at maximum length (2048 chars) — executed
  - Assertion with empty expected value string — evaluates correctly
  - `maxConcurrency: 1` in parallel mode — behaves like sequential
  - `maxConcurrency: 50` in parallel mode — accepted, capped by worker pool
  - Run timeout of 1ms — step times out immediately, run marked failed
  - `page: 0` on paginated run history endpoint → 400 or treated as page 1

- [ ] 8. Append **Unicode** section (TC-409–TC-416)
  - Emoji in collection name (e.g., `Patient API 🚀`) — stored and displayed correctly
  - Arabic characters in environment name — stored and retrieved correctly
  - Chinese characters in step name — stored and retrieved correctly
  - XSS string `<script>alert('xss')</script>` in variable value — stored as plain text, never executed
  - Unicode in request body JSON — sent as-is, response asserted correctly
  - Emoji in Jira defect comment — filed without encoding error
  - Unicode in governance policy name — stored and listed correctly
  - RTL text in suite name — stored and displayed correctly

- [ ] 9. Update Summary Table in `API_TESTING_TEST_GUIDE.md`
  - Add 8 new rows for TC-341–TC-416
  - Update **Total** row to TC-001–TC-416 (416 test cases)

---

## Execution Order

| Order | Track | Risk | Depends On |
|---|---|---|---|
| 1 | Track 4 — Test Guide enrichment | ZERO | Nothing |
| 2 | Track 2b — AI negative test generator | LOW | Nothing |
| 3 | Track 2c — AI assertion suggester | LOW | Nothing |
| 4 | Track 3 — Phase F health route + plugins | LOW | Nothing |
| 5 | Track 2a — Debugger engine | LOW-MEDIUM | Track 1 (snapshot store) |
| 6 | Track 1 — Phase C live coordinator | MEDIUM | All above complete |

---

## Backlog (Not in Scope — Future Phase)

| Item | Description | Priority |
|---|---|---|
| `USE_COORDINATOR` UI toggle | Add on/off switch in **Admin → Settings** for the `USE_COORDINATOR` flag. Writes flag to server config and restarts. Only becomes valuable when child-process isolation is implemented (Phase C Step 6+). Currently execution is identical whether flag is on or off (still in-process). | LOW — implement alongside child-process worker |

---

## Non-Negotiables

1. `api-testing.routes.ts` — zero route regressions; all existing routes continue to work
2. Feature flag `USE_COORDINATOR=true` required before Phase C coordinator goes live
3. All AI engines (negative generator, assertion suggester) are pure functions — no DB/HTTP calls
4. Debugger engine imports ONLY from `data/types`, `shared-core/contracts`, own contracts — zero runtime calls
5. Example plugins are opt-in only — `loadExamplePlugins()` never called automatically
6. Existing TC-001–TC-340 in test guide untouched — new TCs append from TC-341
7. Port 3003 server restart only via Admin → Settings → Reset Server button
