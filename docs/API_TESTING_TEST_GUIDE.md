# API Testing Module — Comprehensive Test Guide

**Project:** qa-agent-platform-dev  
**Module:** API Testing — All Phases (1–5, D, E)  
**Last Updated:** 2026-05-22  
**Version:** 2.4

---

## Summary Table

| Module | TC Range | Count |
|---|---|---|
| API Environments — CRUD & Variables | TC-001 – TC-015 | 15 |
| API Environments — Auth Configuration | TC-016 – TC-025 | 10 |
| API Collections — CRUD | TC-026 – TC-038 | 13 |
| Execution Engine — Sequential | TC-039 – TC-044 | 6 |
| Execution Engine — Parallel & DAG | TC-045 – TC-055 | 11 |
| Execution Engine — Teardown & Rate Limit | TC-056 – TC-063 | 8 |
| Variable System — Substitution & Extraction | TC-064 – TC-075 | 12 |
| Variable System — Dynamic Variables | TC-076 – TC-082 | 7 |
| Assertion Engine — All 16 Operators | TC-083 – TC-105 | 23 |
| Assertion Engine — Severity & Stop-on-Fail | TC-106 – TC-111 | 6 |
| Retry Policy | TC-112 – TC-119 | 8 |
| Pre/Post Scripts | TC-120 – TC-130 | 11 |
| Import — OpenAPI/Swagger | TC-131 – TC-142 | 12 |
| Import — Postman | TC-143 – TC-152 | 10 |
| Import — cURL | TC-153 – TC-159 | 7 |
| Baseline Snapshots & Diff | TC-160 – TC-168 | 9 |
| Contract Drift Detection | TC-169 – TC-177 | 9 |
| Run Results & HAR Viewer | TC-178 – TC-186 | 9 |
| Flakiness Analytics | TC-187 – TC-198 | 12 |
| API Suite Orchestration | TC-199 – TC-213 | 15 |
| Observability & Replay | TC-214 – TC-224 | 11 |
| AI Intelligence & Recommendations | TC-225 – TC-236 | 12 |
| AI Remediation Governance | TC-237 – TC-248 | 12 |
| Defect Intelligence & Jira Filing | TC-249 – TC-258 | 10 |
| Governance, RBAC & Audit | TC-259 – TC-270 | 12 |
| Security & Secret Management | TC-271 – TC-281 | 11 |
| Graph Editor & DAG Visualization | TC-282 – TC-291 | 10 |
| Analytics & SLA Intelligence | TC-292 – TC-301 | 10 |
| Worker Pool Health | TC-302 – TC-308 | 7 |
| Pre-Scan Health Check | TC-309 – TC-314 | 6 |
| Suite Pre-Check (UI Integration) | TC-315 – TC-320 | 6 |
| End-to-End Journey Tests | TC-321 – TC-340 | 20 |
| Token Lifecycle | TC-341 – TC-350 | 10 |
| Content-Type Validation | TC-351 – TC-358 | 8 |
| Contract / Schema Validation | TC-359 – TC-368 | 10 |
| Authorization & Role Isolation | TC-369 – TC-380 | 12 |
| Idempotency | TC-381 – TC-388 | 8 |
| Business Rules | TC-389 – TC-398 | 10 |
| Boundary Value Testing | TC-399 – TC-408 | 10 |
| Unicode & Encoding | TC-409 – TC-416 | 8 |
| **Total** | **TC-001 – TC-416** | **416** |

---

## Module 1 — API Environments: CRUD & Variables

### TC-001 | Create environment with name and base URL
```
Pre-condition: Authenticated. No env named "Staging" exists.
Steps:
  1. POST /api/api-envs { "name": "Staging", "baseUrl": "https://staging.example.com" }
  2. Verify HTTP 201.
  3. Verify response has "id" field (UUID format).
  4. GET /api/api-envs/:id — verify name and baseUrl match.
Expected: Environment created. ID is UUID. Fields persisted correctly.
Type: Functional
```

### TC-002 | Create environment fails without baseUrl
```
Pre-condition: Authenticated.
Steps:
  1. POST /api/api-envs { "name": "Bad" }
Expected: HTTP 400. Error message references missing baseUrl.
Type: Validation
```

### TC-003 | Create environment fails with duplicate name in same project
```
Pre-condition: Environment "Staging" already exists for projectId P1.
Steps:
  1. POST /api/api-envs { "name": "Staging", "projectId": "P1", "baseUrl": "..." }
Expected: HTTP 409 or 400. Duplicate name rejected.
Type: Validation
```

### TC-004 | List environments scoped to project
```
Pre-condition: Project P1 has 3 environments. Project P2 has 2.
Steps:
  1. GET /api/api-envs?projectId=P1
  2. Verify response array length = 3.
  3. GET /api/api-envs?projectId=P2 — verify length = 2.
Expected: Each project returns only its own environments.
Type: Functional
```

### TC-005 | Update environment base URL
```
Pre-condition: Environment "Staging" exists with baseUrl "https://old.example.com".
Steps:
  1. PUT /api/api-envs/:id { "baseUrl": "https://new.example.com" }
  2. Verify HTTP 200.
  3. GET /api/api-envs/:id — verify baseUrl is updated.
Expected: baseUrl updated. Other fields unchanged.
Type: Functional
```

### TC-006 | Delete environment
```
Pre-condition: Environment "Staging" exists and is not referenced by any collection.
Steps:
  1. DELETE /api/api-envs/:id
  2. Verify HTTP 200.
  3. GET /api/api-envs/:id — verify HTTP 404.
Expected: Environment deleted. GET returns 404.
Type: Functional
```

### TC-007 | Add a plain-text variable to an environment
```
Pre-condition: Environment exists with no variables.
Steps:
  1. PUT /api/api-envs/:id with variables: [{ "key": "BASE_URL", "value": "https://api.example.com", "sensitive": false }]
  2. GET /api/api-envs/:id — verify variable is present with key and value in plain text.
Expected: Variable stored. Value visible in GET response.
Type: Functional
```

### TC-008 | Add a sensitive variable — value is encrypted at rest
```
Pre-condition: Environment exists.
Steps:
  1. PUT /api/api-envs/:id with variables: [{ "key": "API_SECRET", "value": "supersecret123", "sensitive": true }]
  2. GET /api/api-envs/:id — verify "API_SECRET" is present.
  3. Verify value is NOT "supersecret123" in the response (should be masked or encrypted representation).
Expected: Sensitive variable stored encrypted. Value not returned in plain text.
Type: Security
```

### TC-009 | Sensitive variable masked in UI list
```
Pre-condition: Environment has sensitive variable "API_SECRET".
Steps:
  1. Navigate to API Environments page in the UI.
  2. Open the environment.
  3. Observe the value column for "API_SECRET".
Expected: Value displayed as "••••••••" or similar mask, not plain text.
Type: Security / UI
```

### TC-010 | Multiple variables — all types in one environment
```
Pre-condition: Environment exists with no variables.
Steps:
  1. PUT /api/api-envs/:id with variables:
     - { key: "HOST", value: "https://api.example.com", sensitive: false }
     - { key: "TOKEN", value: "abc123", sensitive: true }
     - { key: "TIMEOUT", value: "5000", sensitive: false }
  2. GET /api/api-envs/:id — verify 3 variables present.
Expected: All 3 variables stored. Sensitive flag preserved per variable.
Type: Functional
```

### TC-011 | Update existing variable value
```
Pre-condition: Environment has variable { key: "HOST", value: "https://old.com" }.
Steps:
  1. PUT /api/api-envs/:id with updated variable { key: "HOST", value: "https://new.com" }.
  2. GET /api/api-envs/:id — verify HOST = "https://new.com".
Expected: Variable value updated. Other variables unchanged.
Type: Functional
```

### TC-012 | Delete a variable by omitting it from the update
```
Pre-condition: Environment has 2 variables: HOST and TOKEN.
Steps:
  1. PUT /api/api-envs/:id with variables: [{ key: "HOST", value: "..." }] (TOKEN omitted).
  2. GET /api/api-envs/:id — verify only HOST is present.
Expected: TOKEN removed. HOST preserved.
Type: Functional
```

### TC-013 | Set default environment
```
Pre-condition: 3 environments exist; none is default.
Steps:
  1. PATCH /api/api-envs/:id/set-default (or PUT with isDefault: true).
  2. GET /api/api-envs?projectId=P1 — verify only one environment has isDefault: true.
Expected: Exactly one environment marked as default.
Type: Functional
```

### TC-014 | Cannot delete environment referenced by a collection
```
Pre-condition: Collection C1 references environment E1.
Steps:
  1. DELETE /api/api-envs/E1
Expected: HTTP 400 or 409. Error message lists referencing collections.
Type: Validation / Integrity
```

### TC-015 | Environment variables available in collection run via substitution
```
Pre-condition: Environment E1 has variable BASE_URL = "https://httpbin.org".
Collection C1 uses E1 and has step with URL "/get" (relative).
Steps:
  1. POST /api/api-collections/C1/run
  2. Wait for run to complete.
  3. GET /api/api-runs/:runId — verify step URL resolved to "https://httpbin.org/get".
Expected: Variable substituted correctly at runtime.
Type: Integration
```

---

## Module 2 — API Environments: Auth Configuration

### TC-016 | Set Bearer token auth on environment
```
Pre-condition: Environment exists with authConfig: none.
Steps:
  1. PUT /api/api-envs/:id with authConfig: { type: "bearer", token: "mytoken123" }
  2. GET /api/api-envs/:id — verify authConfig.type = "bearer".
  3. Run a collection using this environment.
  4. Check HAR — verify Authorization: Bearer mytoken123 header present on requests.
Expected: Bearer token injected into all steps using this environment.
Type: Functional
```

### TC-017 | Set API Key auth on environment
```
Pre-condition: Environment exists.
Steps:
  1. PUT /api/api-envs/:id with authConfig: { type: "apiKey", headerName: "X-API-Key", keyValue: "key-abc" }
  2. Run a collection.
  3. Check HAR — verify X-API-Key: key-abc header present.
Expected: API key header injected on all requests.
Type: Functional
```

### TC-018 | Set Basic auth on environment
```
Pre-condition: Environment exists.
Steps:
  1. PUT /api/api-envs/:id with authConfig: { type: "basic", username: "admin", password: "pass123" }
  2. Run a collection.
  3. Check HAR — verify Authorization: Basic <base64(admin:pass123)> header present.
Expected: Basic auth header correct Base64 encoding injected.
Type: Functional
```

### TC-019 | OAuth2 CC — token fetched before first request
```
Pre-condition: Valid OAuth2 CC token endpoint is configured (can use mock server).
Steps:
  1. PUT /api/api-envs/:id with authConfig: { type: "oauth2cc", tokenUrl: "...", clientId: "...", clientSecret: "...", scope: "read" }
  2. Run collection.
  3. Check HAR — verify first request has Authorization: Bearer <fetched-token>.
Expected: Token fetched from tokenUrl and injected. Token not hardcoded.
Type: Functional
```

### TC-020 | OAuth2 CC — expired token refreshed automatically
```
Pre-condition: OAuth2 CC configured. First run consumed the cached token. Token has short TTL.
Steps:
  1. Wait for token to expire.
  2. Run collection again.
  3. Verify new token fetched (different from cached token in first run).
Expected: Token refreshed automatically. No auth failure.
Type: Functional
```

### TC-021 | Step-level auth overrides environment auth
```
Pre-condition: Environment uses Bearer token. One step has authConfig: { type: "apiKey", headerName: "X-Custom", keyValue: "step-key" }.
Steps:
  1. Run collection.
  2. Check HAR for the step with step-level auth.
  3. Verify X-Custom: step-key is present, NOT Authorization: Bearer.
Expected: Step auth overrides environment auth for that step only.
Type: Functional
```

### TC-022 | auth: none on step disables auth for that step
```
Pre-condition: Environment uses Bearer token. One step has authConfig: { type: "none" }.
Steps:
  1. Run collection.
  2. Check HAR for the "none" step — verify no Authorization header present.
Expected: Auth header absent for the "none" step.
Type: Functional
```

### TC-023 | Bearer token stored as sensitive variable — masked in logs
```
Pre-condition: Bearer token uses {{ENV_TOKEN}} where ENV_TOKEN is a sensitive variable.
Steps:
  1. Run collection.
  2. View run result in UI.
  3. Inspect HAR viewer for the Authorization header value.
Expected: Token value masked (not shown in plain text in UI).
Type: Security
```

### TC-024 | Invalid OAuth2 CC credentials — step fails with auth error
```
Pre-condition: OAuth2 CC configured with wrong clientSecret.
Steps:
  1. Run collection.
  2. Observe step result.
Expected: Step fails with an auth error. Error message indicates token fetch failed. No 5xx from target API.
Type: Negative / Error Handling
```

### TC-025 | Auth config persists through environment update
```
Pre-condition: Environment has Bearer authConfig and 2 variables.
Steps:
  1. PUT /api/api-envs/:id updating only the variables (not authConfig).
  2. GET /api/api-envs/:id — verify authConfig unchanged.
Expected: Partial update preserves auth config.
Type: Regression
```

---

## Module 3 — API Collections: CRUD

### TC-026 | Create collection in sequential mode
```
Pre-condition: Environment E1 exists.
Steps:
  1. POST /api/api-collections { name: "My Collection", environmentId: E1, executionMode: "sequential", onFailure: "stop" }
  2. Verify HTTP 201, response has id.
Expected: Collection created with correct executionMode.
Type: Functional
```

### TC-027 | Create collection in parallel mode with maxConcurrency
```
Steps:
  1. POST /api/api-collections { ..., executionMode: "parallel", maxConcurrency: 5 }
  2. GET /api/api-collections/:id — verify maxConcurrency = 5.
Expected: maxConcurrency stored correctly.
Type: Functional
```

### TC-028 | Create collection in DAG mode
```
Steps:
  1. POST /api/api-collections { ..., executionMode: "dag" }
  2. Verify HTTP 201.
Expected: Collection created in dag mode.
Type: Functional
```

### TC-029 | Add a GET step to a collection
```
Pre-condition: Collection C1 exists.
Steps:
  1. PUT /api/api-collections/:id with steps: [{ name: "Get Users", request: { method: "GET", url: "/users" }, assertions: [{ field: "status", operator: "equals", expected: 200 }] }]
  2. GET /api/api-collections/:id — verify step present with correct fields.
Expected: Step stored with method, url, and assertion.
Type: Functional
```

### TC-030 | Add a POST step with JSON body
```
Steps:
  1. PUT /api/api-collections/:id with step: { method: "POST", url: "/users", bodyType: "json", body: '{"name": "Test"}', assertions: [{ field: "status", operator: "equals", expected: 201 }] }
Expected: Step stored with bodyType "json" and body string.
Type: Functional
```

### TC-031 | Add multiple steps and verify order
```
Steps:
  1. PUT /api/api-collections/:id with steps: [Step-A, Step-B, Step-C] in that order.
  2. GET /api/api-collections/:id — verify steps array order matches input.
Expected: Step order preserved exactly as submitted.
Type: Functional
```

### TC-032 | Update collection name
```
Steps:
  1. PUT /api/api-collections/:id { name: "Updated Name" }
  2. GET /api/api-collections/:id — verify name = "Updated Name".
Expected: Name updated. Steps and other fields unchanged.
Type: Functional
```

### TC-033 | Update onFailure to continue
```
Steps:
  1. PUT /api/api-collections/:id { onFailure: "continue" }
  2. GET /api/api-collections/:id — verify onFailure = "continue".
Expected: onFailure updated correctly.
Type: Functional
```

### TC-034 | Delete collection
```
Steps:
  1. DELETE /api/api-collections/:id
  2. Verify HTTP 200.
  3. GET /api/api-collections/:id — verify HTTP 404.
Expected: Collection deleted. GET returns 404.
Type: Functional
```

### TC-035 | List collections scoped to project
```
Pre-condition: Project P1 has 4 collections. Project P2 has 1.
Steps:
  1. GET /api/api-collections?projectId=P1 — verify count = 4.
  2. GET /api/api-collections?projectId=P2 — verify count = 1.
Expected: Each project returns only its own collections.
Type: Functional
```

### TC-036 | Add collection-level variables
```
Steps:
  1. PUT /api/api-collections/:id with variables: [{ key: "userId", value: "42" }]
  2. GET /api/api-collections/:id — verify variable present.
Expected: Collection variable stored.
Type: Functional
```

### TC-037 | Step with query params stored and sent correctly
```
Steps:
  1. Add step with url: "/search" and queryParams: [{ key: "q", value: "test" }]
  2. Run collection.
  3. Check HAR — verify request URL contains "?q=test".
Expected: Query params appended to URL.
Type: Functional
```

### TC-038 | Step with custom headers
```
Steps:
  1. Add step with headers: [{ key: "X-Trace-Id", value: "trace-123" }]
  2. Run collection.
  3. Check HAR — verify X-Trace-Id: trace-123 present in request.
Expected: Custom header sent with request.
Type: Functional
```

---

## Module 4 — Execution Engine: Sequential Mode

### TC-039 | Sequential run — steps execute in order
```
Pre-condition: Collection with 3 steps (A, B, C) in sequential mode.
Steps:
  1. Run collection.
  2. Check run result — verify startedAt timestamps: A < B < C.
Expected: Steps executed in order A → B → C.
Type: Functional
```

### TC-040 | Sequential run — stops on first failure (onFailure: stop)
```
Pre-condition: Collection with 3 steps. Step B returns 500 (will fail status assertion). onFailure: stop.
Steps:
  1. Run collection.
  2. Check run result — verify step A passed, step B failed, step C has status "skipped".
Expected: Execution stops after B. C is skipped.
Type: Functional
```

### TC-041 | Sequential run — continues on failure (onFailure: continue)
```
Pre-condition: Collection with 3 steps. Step B will fail. onFailure: continue.
Steps:
  1. Run collection.
  2. Verify step A passed, step B failed, step C executed (passed or failed independently).
Expected: Step C executes regardless of step B failure.
Type: Functional
```

### TC-042 | Step-level onFailure: continue overrides collection onFailure: stop
```
Pre-condition: Collection onFailure: stop. Step B has execution.onFailure: continue.
Steps:
  1. Step B fails.
  2. Verify step C executes.
Expected: Step-level override wins. C executes.
Type: Functional
```

### TC-043 | Run with delayMs between steps
```
Pre-condition: Step B has delayMs: 2000.
Steps:
  1. Run collection.
  2. Check run result — verify gap between step A completedAt and step B startedAt is >= 2000ms.
Expected: At least 2-second delay before step B.
Type: Functional
```

### TC-044 | Run with timeout — step times out and fails
```
Pre-condition: Step A has timeout: 500. The endpoint takes > 500ms to respond.
Steps:
  1. Run collection.
  2. Verify step A status = failed. Error message contains "timeout".
Expected: Step fails with timeout error, not generic failure.
Type: Functional
```

---

## Module 5 — Execution Engine: Parallel & DAG

### TC-045 | Parallel mode — all steps start within same second
```
Pre-condition: Collection with 5 independent GET steps in parallel mode, maxConcurrency: 5.
Steps:
  1. Run collection.
  2. Check startedAt timestamps for all steps — verify they all started within 200ms of each other.
Expected: All steps start concurrently. Total time close to single-step time.
Type: Performance / Functional
```

### TC-046 | Parallel mode — maxConcurrency respected
```
Pre-condition: Collection with 10 steps in parallel mode, maxConcurrency: 3.
Steps:
  1. Run collection.
  2. Verify at most 3 steps were in-progress simultaneously (check timestamps).
Expected: No more than 3 concurrent requests at any time.
Type: Functional
```

### TC-047 | DAG mode — step executes only after dependency completes
```
Pre-condition: Step B has dependsOn: [StepA]. Step A has delayMs: 1000.
Steps:
  1. Run collection in dag mode.
  2. Verify step B startedAt > step A completedAt.
Expected: B starts only after A finishes.
Type: Functional
```

### TC-048 | DAG mode — independent steps run in parallel
```
Pre-condition: Steps B and C both depend only on A. A finishes, then B and C should run concurrently.
Steps:
  1. Run collection.
  2. Verify B and C start within 200ms of each other after A completes.
Expected: B and C execute in the same wave.
Type: Functional
```

### TC-049 | DAG mode — cycle detection blocks run
```
Pre-condition: Collection with steps: A depends on B, B depends on A (cycle).
Steps:
  1. POST /api/api-collections/:id/run
Expected: HTTP 400 or run immediately fails with CYCLE_DETECTED error. Steps do not execute.
Type: Validation
```

### TC-050 | DAG mode — diamond dependency resolves correctly
```
Pre-condition: A → B → D and A → C → D (diamond shape).
Steps:
  1. Run collection.
  2. Verify order: A first, then B and C in parallel, then D after both B and C complete.
Expected: Topological sort respected. D executes only after both B and C.
Type: Functional
```

### TC-051 | DAG mode — unknown dependsOn step ID is rejected
```
Pre-condition: Step B has dependsOn: ["non-existent-id"].
Steps:
  1. Run collection.
Expected: Run fails immediately with error referencing unknown step ID.
Type: Validation
```

### TC-052 | Pre-scan detects cycle before run
```
Pre-condition: Cyclic DAG collection.
Steps:
  1. POST /api/api-collections/:id/pre-scan
Expected: Pre-scan returns failure with message about cycle.
Type: Functional
```

### TC-053 | Pre-scan detects unreachable environment
```
Pre-condition: Environment baseUrl points to unreachable host.
Steps:
  1. POST /api/api-collections/:id/pre-scan
Expected: Pre-scan returns warning/failure for baseUrl reachability check.
Type: Functional
```

### TC-054 | DAG mode — failed step skips all dependent steps
```
Pre-condition: A is required by B, B is required by C. A fails. onFailure: stop.
Steps:
  1. Run collection.
  2. Verify B and C status = skipped.
Expected: Dependency cascade: A fails → B and C skipped.
Type: Functional
```

### TC-055 | Parallel mode — one failure with onFailure: continue allows others to finish
```
Pre-condition: 5 parallel steps. Step 3 will fail. onFailure: continue.
Steps:
  1. Run collection.
  2. Verify steps 1, 2, 4, 5 complete normally. Step 3 shows failure.
Expected: Failure in one step does not abort parallel siblings.
Type: Functional
```

---

## Module 6 — Execution Engine: Teardown & Rate Limit

### TC-056 | Teardown step always runs when main step passes
```
Pre-condition: Collection with Step A (main) and Step B (teardown: true). A passes.
Steps:
  1. Run collection.
  2. Verify step B executed. step B has isTeardown: true in result.
Expected: Teardown step runs. Marked as teardown in result.
Type: Functional
```

### TC-057 | Teardown step always runs when main step fails
```
Pre-condition: Collection with Step A (main — will fail) and Step B (teardown: true).
Steps:
  1. Run collection.
  2. Verify Step A = failed. Step B = passed (or executed).
Expected: Teardown step runs even though main step failed.
Type: Functional
```

### TC-058 | Multiple teardown steps all execute
```
Pre-condition: 2 teardown steps (cleanup-1, cleanup-2). 1 main step fails.
Steps:
  1. Run collection.
  2. Verify both cleanup-1 and cleanup-2 executed.
Expected: All teardown steps run regardless of failure.
Type: Functional
```

### TC-059 | Teardown step failure does not affect collection status
```
Pre-condition: Main steps all pass. One teardown step fails.
Steps:
  1. Run collection.
  2. Check collection run status.
Expected: Collection status = passed. Teardown failure reported separately but doesn't fail the collection.
Type: Functional
```

### TC-060 | Teardown steps marked isTeardown in result
```
Steps:
  1. Run collection with teardown step.
  2. GET /api/api-runs/:runId — inspect stepResults.
  3. Verify teardown step has isTeardown: true.
Expected: isTeardown flag present and true.
Type: Functional
```

### TC-061 | Rate limit — requests per second respected
```
Pre-condition: Collection with 10 steps. rateLimit: { requestsPerSecond: 2 }.
Steps:
  1. Run collection.
  2. Check run result timing — verify total duration >= 5 seconds (10 requests at 2/sec).
Expected: Engine throttles to 2 req/sec.
Type: Functional
```

### TC-062 | Rate limit 0 or omitted — no throttling applied
```
Pre-condition: Collection with no rateLimit set.
Steps:
  1. Run collection with 5 fast steps.
  2. Check total duration — should be < 2 seconds.
Expected: No artificial delay when no rate limit set.
Type: Functional
```

### TC-063 | Step condition skips step when falsy
```
Pre-condition: Step B has condition: "vars.status === 201". Step A returned status 200.
Steps:
  1. Run collection.
  2. Verify step B has status = skipped.
Expected: Step B skipped because condition evaluated false.
Type: Functional
```

---

## Module 7 — Variable System: Substitution & Extraction

### TC-064 | URL variable substitution from environment
```
Pre-condition: Environment has BASE_URL = "https://httpbin.org". Step URL = "{{BASE_URL}}/get".
Steps:
  1. Run collection.
  2. Check HAR — verify request URL = "https://httpbin.org/get".
Expected: Variable substituted in URL.
Type: Functional
```

### TC-065 | Header variable substitution
```
Pre-condition: Collection variable TOKEN = "abc123". Step header: Authorization: Bearer {{TOKEN}}.
Steps:
  1. Run collection.
  2. Check HAR — verify Authorization: Bearer abc123.
Expected: Variable substituted in header value.
Type: Functional
```

### TC-066 | Body variable substitution
```
Pre-condition: Collection variable userId = "42". Step body: {"id": "{{userId}}"}.
Steps:
  1. Run collection.
  2. Check HAR — verify request body = {"id": "42"}.
Expected: Variable substituted in body.
Type: Functional
```

### TC-067 | Extract body field and use in next step
```
Pre-condition: Step A: POST /users → response body: {"id": "99"}. Step A extracts variable userId from $.id.
Step B: GET /users/{{userId}}.
Steps:
  1. Run collection.
  2. Check run result — verify step B URL contains "99".
Expected: Extracted variable passed from step A to step B.
Type: Functional
```

### TC-068 | Extract header value
```
Pre-condition: Step A response includes header X-Request-Id: "trace-abc". Step A extracts variable traceId from header X-Request-Id.
Step B has header X-Parent-Trace: {{traceId}}.
Steps:
  1. Run collection.
  2. Check HAR for step B — verify X-Parent-Trace: trace-abc.
Expected: Header value extracted and injected into next step.
Type: Functional
```

### TC-069 | Extract status code
```
Pre-condition: Step A extracts variable lastStatus from source: "status".
Step B condition: vars.lastStatus === 201.
Steps:
  1. Run collection where step A returns 201.
  2. Verify step B executes (condition is truthy).
Expected: Status code extracted as variable and used in condition.
Type: Functional
```

### TC-070 | Variable resolution order — step-local wins over collection
```
Pre-condition: Collection variable userId = "100". Step A extracts userId = "200" from response.
Step B uses {{userId}}.
Steps:
  1. Run collection.
  2. Verify step B uses userId = "200" (step-local), not "100".
Expected: Step-local value overrides collection-level.
Type: Functional
```

### TC-071 | Variable resolution order — collection wins over environment
```
Pre-condition: Environment variable HOST = "https://env-host.com". Collection variable HOST = "https://col-host.com".
Steps:
  1. Run collection.
  2. Verify HOST resolved to "https://col-host.com".
Expected: Collection-level wins over environment-level.
Type: Functional
```

### TC-072 | Undefined variable reference leaves placeholder or fails gracefully
```
Pre-condition: Step uses {{nonExistentVar}}.
Steps:
  1. Run collection.
Expected: Step result shows error or warning about unresolved variable. Does not silently send "{{nonExistentVar}}" as literal string to API.
Type: Validation
```

### TC-073 | Multiple extractions from same response
```
Pre-condition: Step A response: { "id": "5", "token": "t1", "role": "admin" }.
Step A extracts userId, token, userRole.
Steps:
  1. Run collection.
  2. Verify all 3 variables available in step B.
Expected: All 3 extractions succeed.
Type: Functional
```

### TC-074 | JSONPath extraction with nested object
```
Pre-condition: Response body: { "data": { "user": { "id": "55" } } }. Extraction path: $.data.user.id.
Steps:
  1. Run collection.
  2. Verify extracted value = "55".
Expected: Deeply nested JSONPath extraction works.
Type: Functional
```

### TC-075 | JSONPath extraction from array — first element
```
Pre-condition: Response body: { "items": [{"id": "1"}, {"id": "2"}] }. Extraction path: $.items[0].id.
Steps:
  1. Run collection.
  2. Verify extracted value = "1".
Expected: Array index access in JSONPath works.
Type: Functional
```

---

## Module 8 — Variable System: Dynamic Variables

### TC-076 | {{$dynamic:uuid}} generates valid UUID v4
```
Pre-condition: Step body contains: {"traceId": "{{$dynamic:uuid}}"}.
Steps:
  1. Run collection twice.
  2. Check HAR for both runs — verify traceId values are valid UUIDs.
  3. Verify the two UUIDs are different.
Expected: Each run generates a unique UUID v4.
Type: Functional
```

### TC-077 | {{$dynamic:timestamp:unix}} generates current epoch
```
Pre-condition: Step body: {"ts": "{{$dynamic:timestamp:unix}}"}.
Steps:
  1. Run collection.
  2. Note current time (Unix epoch) before and after run.
  3. Verify generated ts is between the two noted times.
Expected: Unix timestamp reflects run time.
Type: Functional
```

### TC-078 | {{$dynamic:timestamp:iso}} generates ISO 8601 format
```
Steps:
  1. Run collection with body: {"createdAt": "{{$dynamic:timestamp:iso}}"}.
  2. Verify value matches ISO 8601 pattern (e.g., 2026-05-22T...).
Expected: ISO 8601 format string.
Type: Functional
```

### TC-079 | {{$dynamic:faker_email}} generates valid email format
```
Steps:
  1. Run collection with body: {"email": "{{$dynamic:faker_email}}"}.
  2. Verify generated value matches email pattern (contains @ and .).
Expected: Valid email format generated.
Type: Functional
```

### TC-080 | {{$dynamic:faker_name}} generates non-empty string
```
Steps:
  1. Run collection with body: {"name": "{{$dynamic:faker_name}}"}.
  2. Verify value is non-empty string.
Expected: Name generated successfully.
Type: Functional
```

### TC-081 | {{$dynamic:random_int:1:100}} generates integer in range
```
Steps:
  1. Run collection 10 times with body: {"score": "{{$dynamic:random_int:1:100}}"}.
  2. Verify all generated values are integers between 1 and 100 inclusive.
Expected: All values within specified range.
Type: Functional
```

### TC-082 | Dynamic variables unique per run — not cached
```
Pre-condition: Step uses {{$dynamic:uuid}}.
Steps:
  1. Run collection 3 times.
  2. Compare UUIDs across runs.
Expected: Each run produces a different UUID. Not reused from previous run.
Type: Functional
```

---

## Module 9 — Assertion Engine: All 16 Operators

### TC-083 | equals — status code match
```
Assertion: { field: "status", operator: "equals", expected: 200 }
Steps:
  1. Endpoint returns 200.
Expected: Assertion passes.
Type: Functional
```

### TC-084 | equals — fails on mismatch
```
Assertion: { field: "status", operator: "equals", expected: 200 }
Steps:
  1. Endpoint returns 404.
Expected: Assertion fails. actual = 404 shown in result.
Type: Functional
```

### TC-085 | notEquals — passes on different value
```
Assertion: { field: "status", operator: "notEquals", expected: 500 }
Steps:
  1. Endpoint returns 200.
Expected: Assertion passes.
Type: Functional
```

### TC-086 | contains — body string contains substring
```
Assertion: { field: "body.$.message", operator: "contains", expected: "success" }
Steps:
  1. Response body: { "message": "Operation success" }.
Expected: Assertion passes.
Type: Functional
```

### TC-087 | notContains — body does not contain error keyword
```
Assertion: { field: "body.$.message", operator: "notContains", expected: "error" }
Steps:
  1. Response body: { "message": "OK" }.
Expected: Assertion passes.
Type: Functional
```

### TC-088 | greaterThan — numeric body field
```
Assertion: { field: "body.$.count", operator: "greaterThan", expected: 0 }
Steps:
  1. Response body: { "count": 5 }.
Expected: Assertion passes. 5 > 0.
Type: Functional
```

### TC-089 | lessThan — response time SLA
```
Assertion: { field: "durationMs", operator: "lessThan", expected: 3000 }
Steps:
  1. Step completes in 500ms.
Expected: Assertion passes. 500 < 3000.
Type: Functional
```

### TC-090 | lessThan — fails when response too slow
```
Assertion: { field: "durationMs", operator: "lessThan", expected: 100 }
Steps:
  1. Step takes 500ms.
Expected: Assertion fails. durationMs exceeds limit.
Type: Functional
```

### TC-091 | greaterThanOrEqual — boundary value
```
Assertion: { field: "body.$.count", operator: "greaterThanOrEqual", expected: 5 }
Steps:
  1. Response: { "count": 5 }.
Expected: Assertion passes. 5 >= 5.
Type: Functional
```

### TC-092 | lessThanOrEqual — boundary value
```
Assertion: { field: "body.$.score", operator: "lessThanOrEqual", expected: 100 }
Steps:
  1. Response: { "score": 100 }.
Expected: Assertion passes. 100 <= 100.
Type: Functional
```

### TC-093 | matches — UUID format regex
```
Assertion: { field: "body.$.id", operator: "matches", expected: "^[0-9a-f-]{36}$" }
Steps:
  1. Response: { "id": "550e8400-e29b-41d4-a716-446655440000" }.
Expected: Assertion passes.
Type: Functional
```

### TC-094 | matches — fails on wrong format
```
Assertion: { field: "body.$.id", operator: "matches", expected: "^[0-9]{5}$" }
Steps:
  1. Response: { "id": "abc-123" }.
Expected: Assertion fails. Actual does not match pattern.
Type: Functional
```

### TC-095 | exists — field present in response
```
Assertion: { field: "body.$.data.id", operator: "exists" }
Steps:
  1. Response: { "data": { "id": "42" } }.
Expected: Assertion passes.
Type: Functional
```

### TC-096 | exists — fails when field absent
```
Assertion: { field: "body.$.data.token", operator: "exists" }
Steps:
  1. Response: { "data": {} }.
Expected: Assertion fails. Field absent.
Type: Functional
```

### TC-097 | notExists — field absent
```
Assertion: { field: "body.$.error", operator: "notExists" }
Steps:
  1. Response: { "status": "ok" }.
Expected: Assertion passes. "error" field not present.
Type: Functional
```

### TC-098 | jsonSchemaValid — response matches schema
```
Assertion: { field: "body.$", operator: "jsonSchemaValid", expected: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string" } } } }
Steps:
  1. Response: { "id": "1", "name": "Alice" }.
Expected: Assertion passes. Schema valid.
Type: Functional
```

### TC-099 | jsonSchemaValid — fails when required field missing
```
Assertion: same schema as TC-098.
Steps:
  1. Response: { "id": "1" } (missing "name").
Expected: Assertion fails. Schema validation error lists missing "name".
Type: Functional
```

### TC-100 | arrayLength — exact count
```
Assertion: { field: "body.$.items", operator: "arrayLength", expected: 3 }
Steps:
  1. Response: { "items": [1, 2, 3] }.
Expected: Assertion passes.
Type: Functional
```

### TC-101 | arrayLength — fails on wrong count
```
Assertion: { field: "body.$.items", operator: "arrayLength", expected: 3 }
Steps:
  1. Response: { "items": [1, 2] }.
Expected: Assertion fails. actual length = 2.
Type: Functional
```

### TC-102 | arrayLengthGreaterThan — at least one element
```
Assertion: { field: "body.$.results", operator: "arrayLengthGreaterThan", expected: 0 }
Steps:
  1. Response: { "results": [{ "id": "1" }] }.
Expected: Assertion passes.
Type: Functional
```

### TC-103 | arrayContainsObject — item with matching key present
```
Assertion: { field: "body.$.users", operator: "arrayContainsObject", expected: { "role": "admin" } }
Steps:
  1. Response: { "users": [{ "id": "1", "role": "user" }, { "id": "2", "role": "admin" }] }.
Expected: Assertion passes. At least one user has role: admin.
Type: Functional
```

### TC-104 | isOneOf — value in allowed list
```
Assertion: { field: "body.$.status", operator: "isOneOf", expected: ["active", "pending", "inactive"] }
Steps:
  1. Response: { "status": "pending" }.
Expected: Assertion passes.
Type: Functional
```

### TC-105 | isOneOf — fails when value not in list
```
Assertion: same as TC-104.
Steps:
  1. Response: { "status": "deleted" }.
Expected: Assertion fails. "deleted" not in allowed list.
Type: Functional
```

---

## Module 10 — Assertion Engine: Severity & Stop-on-Fail

### TC-106 | critical severity failure — step marked failed
```
Pre-condition: Step has assertion with severity: critical that fails.
Steps:
  1. Run collection.
  2. Check step result — verify status = failed.
  3. Verify collection run status = failed.
Expected: Critical failure propagates to collection status.
Type: Functional
```

### TC-107 | major severity failure — step marked failed but run continues
```
Pre-condition: Step B has major assertion that fails. onFailure: continue on collection.
Steps:
  1. Run collection.
  2. Verify step B fails. Step C still executes.
Expected: Major failure noted but execution continues.
Type: Functional
```

### TC-108 | minor severity failure — informational only
```
Pre-condition: Step has minor assertion that fails. Step has no other assertions.
Steps:
  1. Run collection.
  2. Verify assertion recorded as failed in result. Step status = passed (minor does not fail step).
Expected: Minor severity failure does not change step status to failed.
Type: Functional
```

### TC-109 | stopOnFail: true — stops evaluating remaining assertions
```
Pre-condition: Step has 3 assertions. First assertion has stopOnFail: true and fails.
Steps:
  1. Run collection.
  2. Verify step result shows only 1 assertion evaluated (second and third not evaluated).
Expected: Remaining assertions skipped after stopOnFail assertion fails.
Type: Functional
```

### TC-110 | stopOnFail: false — all assertions evaluated even after failure
```
Pre-condition: Step has 3 assertions. Second one fails but has stopOnFail: false.
Steps:
  1. Run collection.
  2. Verify all 3 assertions appear in the result (evaluated).
Expected: All assertions evaluated.
Type: Functional
```

### TC-111 | Multiple assertions — step passes only when all pass
```
Pre-condition: Step has 3 assertions all with severity: critical. All must pass.
Steps:
  1. Configure endpoint to satisfy all 3.
  2. Run collection — verify step passes.
  3. Modify endpoint to fail one assertion.
  4. Run again — verify step fails.
Expected: Step passes iff all critical assertions pass.
Type: Functional
```

---

## Module 11 — Retry Policy

### TC-112 | Retry on 5xx — retries specified number of times
```
Pre-condition: Step has retryPolicy: { maxAttempts: 3, backoffMs: 100, retryOn: ["5xx"] }. Endpoint returns 500 always.
Steps:
  1. Run collection.
  2. Check step result — verify retryCount = 3 (3 attempts made).
  3. Verify step status = failed.
Expected: 3 attempts made before final failure.
Type: Functional
```

### TC-113 | Retry on 5xx — succeeds on second attempt
```
Pre-condition: Endpoint returns 500 on first call, 200 on second. retryPolicy: { maxAttempts: 3, retryOn: ["5xx"] }.
Steps:
  1. Run collection.
  2. Verify step status = passed.
  3. Verify retryCount = 1 (one retry was needed).
Expected: Step passes after retry. Recovery recorded.
Type: Functional
```

### TC-114 | Retry on timeout
```
Pre-condition: Endpoint times out on first attempt. Responds on second. retryOn: ["timeout"].
Steps:
  1. Run collection.
  2. Verify step passes after 1 retry.
Expected: Timeout triggers retry.
Type: Functional
```

### TC-115 | Retry on network error
```
Pre-condition: Endpoint refuses connection on first attempt (ECONNREFUSED). Second attempt succeeds. retryOn: ["network"].
Steps:
  1. Run collection.
  2. Verify step passes after retry.
Expected: Network error triggers retry.
Type: Functional
```

### TC-116 | Exponential backoff — delays increase per retry
```
Pre-condition: backoffMs: 100. 3 retries configured. Endpoint always fails.
Steps:
  1. Run collection.
  2. Check timestamps of retry attempts.
  3. Verify delay between attempt 1 and 2 is ~100ms.
  4. Verify delay between attempt 2 and 3 is ~200ms.
Expected: Exponential backoff applied (100ms, 200ms).
Type: Functional
```

### TC-117 | No retry policy — fails immediately without retry
```
Pre-condition: Step has no retryPolicy. Endpoint returns 500.
Steps:
  1. Run collection.
  2. Verify retryCount = 0 in step result.
  3. Verify step fails immediately.
Expected: No retry without retryPolicy.
Type: Functional
```

### TC-118 | Retry only on configured conditions — does not retry 4xx
```
Pre-condition: retryOn: ["5xx"]. Endpoint returns 404.
Steps:
  1. Run collection.
  2. Verify retryCount = 0. Step fails without retry.
Expected: 4xx does not trigger retry when only "5xx" configured.
Type: Functional
```

### TC-119 | maxAttempts = 1 — single attempt only, no retry
```
Pre-condition: retryPolicy: { maxAttempts: 1, retryOn: ["5xx"] }. Endpoint returns 500.
Steps:
  1. Run collection.
  2. Verify retryCount = 0. One attempt made.
Expected: maxAttempts: 1 means no retry.
Type: Functional
```

---

## Module 12 — Pre/Post Scripts

### TC-120 | Pre-script sets variable before request
```
Pre-condition: Step has preScript: "setVar('ts', Date.now()); setVar('sig', 'sig-' + Date.now());"
Step body uses {{ts}} and {{sig}}.
Steps:
  1. Run collection.
  2. Check HAR — verify body contains numeric timestamp and "sig-<number>" signature.
Expected: Pre-script variables available in request.
Type: Functional
```

### TC-121 | Post-script extracts complex value after response
```
Pre-condition: Response body: { "result": { "nested": { "token": "abc" } } }.
Post-script: "const b = JSON.parse(response.body); setVar('deepToken', b.result.nested.token);"
Next step uses {{deepToken}}.
Steps:
  1. Run collection.
  2. Verify deepToken = "abc" in next step.
Expected: Post-script extraction works for deeply nested values.
Type: Functional
```

### TC-122 | Post-script runs after response, before assertions
```
Pre-condition: Post-script calls setVar. Assertion uses that variable.
Steps:
  1. Run collection.
  2. Verify assertion uses the post-script value (not pre-run variable).
Expected: Post-script executes before assertion evaluation.
Type: Functional
```

### TC-123 | Pre-script with conditional logic
```
Pre-condition: Pre-script: "if (vars.env === 'prod') { setVar('timeout', 5000); } else { setVar('timeout', 1000); }"
Steps:
  1. Run with env = "staging".
  2. Verify timeout variable = 1000.
Expected: Conditional logic in pre-script works correctly.
Type: Functional
```

### TC-124 | Script timeout — script exceeding 500ms fails the step
```
Pre-condition: Pre-script: "const start = Date.now(); while(Date.now() - start < 1000) {}" (1-second busy loop).
Steps:
  1. Run collection.
  2. Verify step fails with script timeout error.
Expected: Script killed after 500ms. Step fails.
Type: Functional
```

### TC-125 | Script cannot make network calls
```
Pre-condition: Pre-script attempts: "require('http').get('http://example.com', () => {});"
Steps:
  1. Run collection.
  2. Verify script fails (require not available in sandbox).
Expected: Network call blocked. Script sandboxing enforced.
Type: Security
```

### TC-126 | console.log in script captured in step logs
```
Pre-condition: Pre-script: "console.log('debug value:', vars.userId);"
Steps:
  1. Run collection.
  2. Open step result in UI.
  3. View pre-script logs section.
Expected: "debug value: <userId>" appears in step logs.
Type: Functional
```

### TC-127 | vars object is read-only in script
```
Pre-condition: Pre-script tries: "vars.userId = '999';" (should not work — vars is read-only).
Steps:
  1. Run collection.
  2. Verify userId is not changed to "999" in subsequent steps.
Expected: Direct assignment to vars does not persist. Use setVar() instead.
Type: Functional
```

### TC-128 | Post-script can access response.status
```
Pre-condition: Post-script: "setVar('responseStatus', response.status);"
Steps:
  1. Run collection. Endpoint returns 201.
  2. Verify responseStatus = 201 in next step.
Expected: response.status accessible in post-script.
Type: Functional
```

### TC-129 | Post-script can access response.headers
```
Pre-condition: Post-script: "setVar('contentType', response.headers['content-type']);"
Steps:
  1. Run collection.
  2. Verify contentType = "application/json" (or server value) in next step.
Expected: response.headers accessible in post-script.
Type: Functional
```

### TC-130 | Script syntax error fails step with clear error
```
Pre-condition: Pre-script: "const x = {" (invalid JS).
Steps:
  1. Run collection.
  2. Verify step fails. Error message references syntax error in pre-script.
Expected: Syntax error caught and reported clearly.
Type: Functional
```

---

## Module 13 — Import: OpenAPI/Swagger

### TC-131 | Import OpenAPI 3.0 JSON spec — generates steps
```
Pre-condition: Valid OpenAPI 3.0 JSON spec with 5 endpoints.
Steps:
  1. POST /api/api-collections/import/openapi with spec content.
  2. Verify response has collection with 5 steps.
Expected: One step per endpoint generated.
Type: Functional
```

### TC-132 | Import OpenAPI 3.0 YAML spec — generates steps
```
Steps:
  1. POST /api/api-collections/import/openapi with YAML spec.
Expected: Same result as JSON import. Steps generated.
Type: Functional
```

### TC-133 | Import Swagger 2.0 spec — generates steps
```
Pre-condition: Valid Swagger 2.0 JSON spec.
Steps:
  1. POST /api/api-collections/import/openapi with Swagger 2.0 spec.
  2. Verify steps generated from paths.
Expected: Swagger 2.0 parsed correctly.
Type: Functional
```

### TC-134 | Import from URL
```
Pre-condition: OpenAPI spec hosted at a reachable URL.
Steps:
  1. POST /api/api-collections/import/openapi-url { "url": "<spec-url>" }
  2. Verify collection generated.
Expected: Spec fetched server-side and imported.
Type: Functional
```

### TC-135 | Import generates status code assertions
```
Steps:
  1. Import spec with GET /users → 200 and POST /users → 201.
  2. Verify GET step has assertion: { field: "status", operator: "equals", expected: 200 }.
  3. Verify POST step has assertion: { field: "status", operator: "equals", expected: 201 }.
Expected: Status code assertions auto-generated per HTTP method + spec definition.
Type: Functional
```

### TC-136 | Import generates jsonSchemaValid assertion from response schema
```
Pre-condition: OpenAPI spec defines response schema for GET /users.
Steps:
  1. Import spec.
  2. Verify GET /users step has jsonSchemaValid assertion with the response schema.
Expected: Schema assertion included.
Type: Functional
```

### TC-137 | Import response includes importHealthScore
```
Steps:
  1. Import a clean spec with no warnings.
  2. Verify response.importHealthScore > 70.
Expected: Health score present and high for clean spec.
Type: Functional
```

### TC-138 | Import response includes warnings for problematic endpoints
```
Pre-condition: Spec has endpoint with missing operationId and another with unsupported auth type.
Steps:
  1. Import spec.
  2. Verify warnings[] array is non-empty with appropriate messages.
Expected: Warnings reported for each problematic endpoint.
Type: Functional
```

### TC-139 | Import health score low when many endpoints skipped
```
Pre-condition: Spec has 10 endpoints. 8 have critical issues.
Steps:
  1. Import spec.
  2. Verify importHealthScore < 30.
Expected: Low score reflects many skipped/critical-warning endpoints.
Type: Functional
```

### TC-140 | Import with legacy fallback flag
```
Pre-condition: USE_LEGACY_POSTMAN_IMPORTER=true not set. Default adapter used.
Steps:
  1. Import Postman collection.
  2. Verify response has warnings + importHealthScore.
Expected: New adapter used by default.
Type: Functional
```

### TC-141 | Import invalid spec returns error
```
Steps:
  1. POST /api/api-collections/import/openapi with invalid JSON.
Expected: HTTP 400. Error message about invalid spec.
Type: Validation
```

### TC-142 | Import empty spec returns error
```
Steps:
  1. POST /api/api-collections/import/openapi with empty body.
Expected: HTTP 400. Error message about missing spec.
Type: Validation
```

---

## Module 14 — Import: Postman

### TC-143 | Import Postman v2.1 collection — generates steps
```
Pre-condition: Valid Postman v2.1 collection JSON with 4 requests.
Steps:
  1. POST /api/api-collections/import/postman with Postman JSON.
  2. Verify 4 steps generated.
Expected: Steps generated from Postman requests.
Type: Functional
```

### TC-144 | Import Postman v3.0 collection
```
Steps:
  1. Import Postman v3.0 collection.
  2. Verify steps generated correctly.
Expected: v3.0 format parsed.
Type: Functional
```

### TC-145 | Import flattens nested Postman folders
```
Pre-condition: Postman collection with folder "Auth" containing 2 requests and folder "Users" containing 3.
Steps:
  1. Import collection.
  2. Verify 5 steps generated (all flattened, no nested folders).
Expected: Folders flattened into flat step list.
Type: Functional
```

### TC-146 | Import skips disabled Postman items with warning
```
Pre-condition: Collection has 3 enabled requests and 2 disabled.
Steps:
  1. Import collection.
  2. Verify 3 steps generated.
  3. Verify warnings[] contains messages about 2 skipped/disabled items.
Expected: Disabled items skipped. Warnings added.
Type: Functional
```

### TC-147 | Import converts Postman pre-request script to preScript
```
Pre-condition: Postman request has pre-request script: "pm.environment.set('ts', Date.now())".
Steps:
  1. Import collection.
  2. Open generated step — verify preScript field is populated.
Expected: Pre-request script converted.
Type: Functional
```

### TC-148 | Import Postman environment variable references
```
Pre-condition: Postman request URL: "{{BASE_URL}}/users".
Steps:
  1. Import collection.
  2. Verify generated step URL = "{{BASE_URL}}/users" (variable reference preserved).
Expected: Postman variable syntax preserved as platform variable syntax.
Type: Functional
```

### TC-149 | Import includes parity validation report
```
Steps:
  1. Import Postman collection.
  2. Verify response has compatibility field with structural comparison.
Expected: Compatibility/parity report included.
Type: Functional
```

### TC-150 | Import invalid Postman JSON returns error
```
Steps:
  1. POST /api/api-collections/import/postman with malformed JSON.
Expected: HTTP 400. Parse error message.
Type: Validation
```

### TC-151 | Import Postman collection with auth headers
```
Pre-condition: Postman request has auth type = Bearer with token "test-token".
Steps:
  1. Import collection.
  2. Verify generated step has authConfig: { type: "bearer", token: "test-token" }.
Expected: Auth type converted to platform auth config.
Type: Functional
```

### TC-152 | Legacy fallback flag reverts to original Postman importer
```
Pre-condition: Server started with USE_LEGACY_POSTMAN_IMPORTER=true.
Steps:
  1. Import Postman collection.
  2. Verify response does NOT include warnings + compatibility + importHealthScore (legacy format).
Expected: Legacy importer used. Response in legacy format.
Type: Functional
```

---

## Module 15 — Import: cURL

### TC-153 | Import simple GET cURL command
```
Steps:
  1. POST /api/api-collections/import/curl { "curl": "curl https://api.example.com/users" }
  2. Verify step generated with method: GET, url: "https://api.example.com/users".
Expected: GET step created.
Type: Functional
```

### TC-154 | Import POST cURL with -d body
```
Steps:
  1. Import: "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"Alice\"}'"
  2. Verify step: method=POST, body={"name":"Alice"}, header Content-Type=application/json.
Expected: POST step with body and header.
Type: Functional
```

### TC-155 | Import cURL with -u for Basic auth
```
Steps:
  1. Import: "curl -u admin:pass123 https://api.example.com/protected"
  2. Verify generated step has authConfig: { type: "basic", username: "admin", password: "pass123" }.
Expected: Basic auth converted correctly.
Type: Functional
```

### TC-156 | Import cURL with custom headers
```
Steps:
  1. Import: "curl -H 'X-API-Key: mykey' -H 'X-Custom: value' https://api.example.com/data"
  2. Verify 2 headers present on generated step.
Expected: All -H headers captured.
Type: Functional
```

### TC-157 | Import cURL with query params in URL
```
Steps:
  1. Import: "curl 'https://api.example.com/search?q=test&limit=10'"
  2. Verify URL preserved with query params.
Expected: Full URL including query string captured.
Type: Functional
```

### TC-158 | Import cURL with --data-binary
```
Steps:
  1. Import: "curl -X POST --data-binary @payload.json https://api.example.com/upload"
Expected: Step generated. Body noted as binary or raw reference.
Type: Functional
```

### TC-159 | Import invalid cURL syntax returns error
```
Steps:
  1. POST /api/api-collections/import/curl { "curl": "not a curl command" }
Expected: HTTP 400. Error about invalid cURL syntax.
Type: Validation
```

---

## Module 16 — Baseline Snapshots & Diff

### TC-160 | Capture baseline on first run
```
Pre-condition: Step has captureBaseline: true. No prior baseline exists.
Steps:
  1. Run collection.
  2. Verify baseline file created at data/api-baselines/<stepId>.json.
  3. Verify step result has no baselineDiff (first run, nothing to compare).
Expected: Baseline captured. No diff on first run.
Type: Functional
```

### TC-161 | Second run with matching response — no diff reported
```
Pre-condition: Baseline exists from TC-160.
Steps:
  1. Run same collection again. Endpoint returns identical response.
  2. Verify step result: baselineDiff is empty or null.
Expected: No regression detected when response unchanged.
Type: Functional
```

### TC-162 | Second run with changed field — diff reported
```
Pre-condition: Baseline captured. Endpoint now returns response with one field changed.
Steps:
  1. Run collection.
  2. Verify baselineDiff shows the changed field (field path, old value, new value).
Expected: Changed field reported in diff.
Type: Functional
```

### TC-163 | Second run with added field — diff shows addition
```
Pre-condition: Baseline captured. Response now has a new field not in baseline.
Steps:
  1. Run collection.
  2. Verify baselineDiff.added contains the new field path.
Expected: New field detected as addition.
Type: Functional
```

### TC-164 | Second run with removed field — diff shows removal
```
Pre-condition: Baseline captured. Response now missing a field that was in baseline.
Steps:
  1. Run collection.
  2. Verify baselineDiff.removed contains the missing field path.
Expected: Removed field detected.
Type: Functional
```

### TC-165 | Diff includes status code change
```
Pre-condition: Baseline captured with status 200. Endpoint now returns 201.
Steps:
  1. Run collection.
  2. Verify baselineDiff includes status change: 200 → 201.
Expected: Status code regression detected.
Type: Functional
```

### TC-166 | Accept new baseline — overwrites existing
```
Pre-condition: Baseline exists. Response changed.
Steps:
  1. Run collection — diff detected.
  2. Click Accept as New Baseline in UI (or PATCH endpoint).
  3. Run collection again.
  4. Verify no diff on next run (new baseline accepted).
Expected: Baseline updated. Next run clean.
Type: Functional
```

### TC-167 | captureBaseline: false — no baseline created
```
Pre-condition: Step has captureBaseline: false (default).
Steps:
  1. Run collection.
  2. Verify no baseline file created.
  3. Verify no baselineDiff in step result.
Expected: Baseline not captured when flag is false.
Type: Functional
```

### TC-168 | Multiple steps — each has independent baseline
```
Pre-condition: 2 steps both with captureBaseline: true.
Steps:
  1. Run collection. Two baselines created.
  2. Change response for step 1 only.
  3. Run again.
  4. Verify step 1 has diff. Step 2 has no diff.
Expected: Each step's baseline is independent.
Type: Functional
```

---

## Module 17 — Contract Drift Detection

### TC-169 | Upload OpenAPI spec to spec store
```
Steps:
  1. POST /api/openapi-specs { "name": "Patients API", "content": "<spec json>" }
  2. Verify HTTP 201. Response has spec id.
  3. GET /api/openapi-specs — verify spec appears in list.
Expected: Spec uploaded and retrievable.
Type: Functional
```

### TC-170 | Link step to spec — run validates response against schema
```
Pre-condition: Spec uploaded. Spec defines GET /users → { type: object, required: [id, name] }.
Step linked to GET /users operation.
Steps:
  1. Run collection. Endpoint returns { "id": "1", "name": "Alice" }.
  2. Verify contractViolations = [] (no violations).
Expected: No violations when response matches spec.
Type: Functional
```

### TC-171 | Contract violation detected — missing required field
```
Pre-condition: Same as TC-170 but endpoint returns { "id": "1" } (missing "name").
Steps:
  1. Run collection.
  2. Verify contractViolations contains entry for missing "name" field.
Expected: Contract violation reported.
Type: Functional
```

### TC-172 | Contract violation detected — wrong type
```
Pre-condition: Spec defines field "age" as number. Endpoint returns { "age": "thirty" } (string).
Steps:
  1. Run collection.
  2. Verify contractViolations contains type mismatch for "age".
Expected: Type violation reported.
Type: Functional
```

### TC-173 | Contract violation detected — extra field (additionalProperties: false)
```
Pre-condition: Spec defines response with additionalProperties: false. Endpoint returns extra field "debug".
Steps:
  1. Run collection.
  2. Verify contractViolations contains entry for extra "debug" field.
Expected: Additional property violation reported.
Type: Functional
```

### TC-174 | No spec linked — no contract validation performed
```
Pre-condition: Step has no openapiSpecId.
Steps:
  1. Run collection.
  2. Verify contractViolations is absent or empty in step result.
Expected: No contract check when not linked.
Type: Functional
```

### TC-175 | Delete spec from store
```
Pre-condition: Spec exists.
Steps:
  1. DELETE /api/openapi-specs/:id
  2. Verify HTTP 200.
  3. GET /api/openapi-specs/:id — verify HTTP 404.
Expected: Spec deleted.
Type: Functional
```

### TC-176 | Contract violations shown in Run Results > Contract tab
```
Steps:
  1. Run collection where contract violation exists.
  2. Open run result in UI. Click Contract tab.
  3. Verify violation entries displayed with field path, expected type, actual value.
Expected: UI surfaces contract violations clearly.
Type: UI
```

### TC-177 | Spec update — subsequent runs use new spec
```
Pre-condition: Step linked to spec. Spec updated to add new required field.
Steps:
  1. Run collection. Verify new required field flagged as violation (endpoint doesn't return it yet).
Expected: Updated spec used in validation.
Type: Functional
```

---

## Module 18 — Run Results & HAR Viewer

### TC-178 | Run result contains all step results
```
Pre-condition: Collection with 4 steps.
Steps:
  1. Run collection.
  2. GET /api/api-runs/:runId — verify stepResults array has 4 entries.
Expected: All steps present in run result.
Type: Functional
```

### TC-179 | Run result status reflects worst step status
```
Pre-condition: 3 steps pass, 1 fails.
Steps:
  1. Run collection.
  2. Verify run status = failed.
Expected: One failure = collection failure.
Type: Functional
```

### TC-180 | Run result includes duration
```
Steps:
  1. Run collection.
  2. Verify run result has startedAt, completedAt, and durationMs.
  3. Verify durationMs = completedAt - startedAt (approximately).
Expected: Timing recorded accurately.
Type: Functional
```

### TC-181 | Polling for in-progress run returns status: running
```
Steps:
  1. Start a long-running collection (3+ second steps).
  2. Immediately GET /api/api-runs/:runId.
  3. Verify status = running.
Expected: In-progress status reflected immediately.
Type: Functional
```

### TC-182 | Run list scoped to collection
```
Pre-condition: Collection A has 3 runs. Collection B has 2 runs.
Steps:
  1. GET /api/api-runs?collectionId=A — verify 3 results.
  2. GET /api/api-runs?collectionId=B — verify 2 results.
Expected: Run list scoped to collection.
Type: Functional
```

### TC-183 | HAR data present in run result
```
Steps:
  1. Run collection.
  2. GET /api/api-runs/:runId — verify stepResults each have request and response HAR data.
  3. Verify HAR includes: method, url, status, requestHeaders, responseHeaders, body.
Expected: Full HAR data captured per step.
Type: Functional
```

### TC-184 | HAR masks sensitive headers
```
Pre-condition: Step uses Bearer auth. Run completes.
Steps:
  1. View HAR in run result.
  2. Check Authorization header value.
Expected: Authorization header value masked in HAR display.
Type: Security
```

### TC-185 | Step result shows assertion detail — pass/fail per assertion
```
Steps:
  1. Run collection with step having 3 assertions (2 pass, 1 fail).
  2. Open step result in UI.
  3. Verify each assertion shows: field, operator, expected, actual, pass/fail status.
Expected: Assertion-level detail visible.
Type: UI
```

### TC-186 | Run list shows most recent 50 runs
```
Pre-condition: Collection has 60 runs.
Steps:
  1. GET /api/api-runs?collectionId=C1
  2. Verify response contains at most 50 runs.
  3. Verify the 50 most recent are returned.
Expected: API caps at 50 most recent runs.
Type: Functional
```

---

## Module 19 — Flakiness Analytics

### TC-187 | Flakiness report generated after multiple runs
```
Pre-condition: Collection has 5+ runs with varied outcomes.
Steps:
  1. POST /api/flakiness/:collectionId/recompute
  2. GET /api/flakiness/:collectionId — verify report has stepRecords, clusters, stabilityScore.
Expected: Report computed successfully.
Type: Functional
```

### TC-188 | Stability score = 1.0 when all runs pass
```
Pre-condition: Collection has 10 runs. All steps passed in all runs.
Steps:
  1. Recompute flakiness.
  2. Verify stabilityScore = 1.0.
Expected: Perfect stability score.
Type: Functional
```

### TC-189 | Stability score < 1.0 when some steps fail
```
Pre-condition: Step A fails in 3 out of 10 runs. Other steps all pass.
Steps:
  1. Recompute flakiness.
  2. Verify stabilityScore < 1.0.
Expected: Score reflects failures.
Type: Functional
```

### TC-190 | Flaky step detected when alternating pass/fail
```
Pre-condition: Step A: run 1 pass, run 2 fail, run 3 pass, run 4 fail (alternating).
Steps:
  1. Recompute flakiness.
  2. Verify stepRecords entry for Step A has high alternationIndex and is in hotspots[].
Expected: Alternating step detected as flaky hotspot.
Type: Functional
```

### TC-191 | Hotspot list sorted by instability score (highest first)
```
Pre-condition: 3 flaky steps with different instability scores.
Steps:
  1. Recompute.
  2. Verify hotspots array ordered highest instability score first.
Expected: Descending sort order.
Type: Functional
```

### TC-192 | Failure cluster by HTTP status
```
Pre-condition: 3 steps all fail with 503. Other steps fail with other errors.
Steps:
  1. Recompute.
  2. Verify clusters contains group with type "http_status" = 503 containing those 3 steps.
Expected: 503 failures grouped in a cluster.
Type: Functional
```

### TC-193 | Failure cluster by endpoint pattern
```
Pre-condition: 4 steps all fail on /api/users/* endpoints.
Steps:
  1. Recompute.
  2. Verify cluster by endpoint groups those 4 steps.
Expected: Endpoint cluster formed.
Type: Functional
```

### TC-194 | Failure cluster by transport error
```
Pre-condition: 2 steps fail with ECONNREFUSED.
Steps:
  1. Recompute.
  2. Verify cluster by transport_error = "ECONNREFUSED" groups those 2 steps.
Expected: Transport error cluster formed.
Type: Functional
```

### TC-195 | Step with 0% failure rate not in hotspots
```
Pre-condition: Step always passes across all runs.
Steps:
  1. Recompute.
  2. Verify step not in hotspots[].
Expected: Always-passing steps excluded from hotspots.
Type: Functional
```

### TC-196 | runsAnalyzed reflects actual run count
```
Pre-condition: Collection has 8 runs.
Steps:
  1. Recompute.
  2. Verify report.runsAnalyzed = 8.
Expected: Count matches actual runs.
Type: Functional
```

### TC-197 | UI Flakiness page shows overview cards correctly
```
Steps:
  1. Navigate to Flakiness Analytics page for a collection.
  2. Verify cards: Stability Score, Runs Analyzed, Flaky Steps, Failure Clusters all populated.
  3. Verify hotspot list rendered with step names and scores.
Expected: UI displays all flakiness data.
Type: UI
```

### TC-198 | Recompute button triggers fresh calculation
```
Steps:
  1. View flakiness report with old data.
  2. Add 5 new runs (all passing).
  3. Click Recompute.
  4. Verify stability score improved.
Expected: Recompute uses latest runs.
Type: Functional
```

---

## Module 20 — API Suite Orchestration

### TC-199 | Create suite with beforeAll, main, afterAll collections
```
Steps:
  1. POST /api/api-suites { name: "E2E Suite", beforeAllCollectionIds: [C1], mainCollectionIds: [C2, C3], afterAllCollectionIds: [C4] }
  2. Verify HTTP 201.
Expected: Suite created with all phase collections.
Type: Functional
```

### TC-200 | Suite CRUD — list, get, update, delete
```
Steps:
  1. GET /api/api-suites — verify suite in list.
  2. PUT /api/api-suites/:id { name: "Updated Suite" } — verify update.
  3. DELETE /api/api-suites/:id — verify 200.
  4. GET /api/api-suites/:id — verify 404.
Expected: Full CRUD works.
Type: Functional
```

### TC-201 | Run suite — phases execute in correct order
```
Pre-condition: Suite with beforeAll → main → afterAll phases.
Steps:
  1. POST /api/api-suites/:id/run
  2. GET /api/api-suite-runs/:runId — verify phase order: before_all → main → after_all.
Expected: Phases execute in lifecycle order.
Type: Functional
```

### TC-202 | beforeAll variable available in main collections
```
Pre-condition: beforeAll collection extracts variable authToken. Main collection uses {{authToken}}.
Steps:
  1. Run suite.
  2. Verify main collection step request includes authToken value.
Expected: Context propagation works across phases.
Type: Functional
```

### TC-203 | afterAll always runs even when main collection fails
```
Pre-condition: Main collection will fail. afterAll is cleanup.
Steps:
  1. Run suite.
  2. Verify main phase shows failure.
  3. Verify afterAll phase executed and shows its own status.
Expected: Teardown phase runs regardless of main failure.
Type: Functional
```

### TC-204 | beforeEach runs before each main collection
```
Pre-condition: Suite has 3 main collections and 1 beforeEach collection.
Steps:
  1. Run suite.
  2. Verify beforeEach executed 3 times (once before each main collection).
Expected: beforeEach runs N times for N main collections.
Type: Functional
```

### TC-205 | afterEach runs after each main collection
```
Pre-condition: Suite has 3 main collections and 1 afterEach collection.
Steps:
  1. Run suite.
  2. Verify afterEach executed 3 times.
Expected: afterEach runs N times for N main collections.
Type: Functional
```

### TC-206 | Suite run result has per-phase status
```
Steps:
  1. Run suite.
  2. GET /api/api-suite-runs/:runId — verify result has phase breakdown with status per phase.
Expected: Per-phase status visible in run result.
Type: Functional
```

### TC-207 | Suite run teardown step marked isTeardown in result
```
Steps:
  1. Run suite where afterAll collection has a step.
  2. Verify afterAll steps have isTeardown: true in step results.
Expected: isTeardown flag set correctly.
Type: Functional
```

### TC-208 | Suite passes when all main collections pass
```
Pre-condition: All main collections pass.
Steps:
  1. Run suite.
  2. Verify suite run status = passed.
Expected: Overall suite passes.
Type: Functional
```

### TC-209 | Suite fails when any main collection fails
```
Pre-condition: One of 3 main collections fails.
Steps:
  1. Run suite.
  2. Verify suite run status = failed.
Expected: One failure fails the suite.
Type: Functional
```

### TC-210 | Suite run stored in data/api-suite-runs/
```
Steps:
  1. Run suite.
  2. Verify file created at data/api-suite-runs/<runId>.json.
Expected: Suite run persisted atomically.
Type: Functional
```

### TC-211 | Suite with no beforeAll — runs main directly
```
Steps:
  1. Create suite with only main collections (no beforeAll/afterAll).
  2. Run suite.
  3. Verify main collections execute successfully.
Expected: Suite works without lifecycle collections.
Type: Functional
```

### TC-212 | Suite with blockOnApiFailure as UI test gate
```
Pre-condition: Suite linked to a UI suite. API main collections fail.
Steps:
  1. Trigger UI suite run.
  2. Verify UI suite blocked with API_PRECONDITION_FAILED.
Expected: UI suite does not start when API gate fails.
Type: Integration
```

### TC-213 | Multiple suite runs tracked independently
```
Steps:
  1. Run same suite 3 times.
  2. Verify each run has a unique runId.
  3. Verify all 3 are retrievable via GET /api/api-suite-runs/:runId.
Expected: Run history maintained per run.
Type: Functional
```

---

## Module 21 — Observability & Replay

### TC-214 | Observability summary for completed run
```
Steps:
  1. Complete a collection run with 5 steps, 2 assertions each, 1 retry.
  2. GET /api/api-runs/:runId/observability
  3. Verify summary: totalRequests=5, totalAssertions=10, totalRetries=1.
Expected: Summary counts correct.
Type: Functional
```

### TC-215 | Replay events generated for run
```
Steps:
  1. Complete a run.
  2. GET /api/api-runs/:runId/replay-events
  3. Verify events include step-started, step-completed for each step.
Expected: Replay events present and in chronological order.
Type: Functional
```

### TC-216 | Replay events include variable-extracted events
```
Pre-condition: Collection extracts variable from step A.
Steps:
  1. Run collection.
  2. GET /api/api-runs/:runId/replay-events
  3. Verify event of type variable-extracted with name and value present.
Expected: Variable extraction recorded in replay.
Type: Functional
```

### TC-217 | Replay events include assertion-evaluated events
```
Steps:
  1. Run collection with assertions.
  2. GET replay events.
  3. Verify assertion-evaluated events present for each assertion with result.
Expected: Every assertion evaluation recorded.
Type: Functional
```

### TC-218 | Replay events include step-retried events
```
Pre-condition: Step retried once.
Steps:
  1. Get replay events.
  2. Verify step-retried event present for the retried step.
Expected: Retry event recorded.
Type: Functional
```

### TC-219 | Replay events include teardown events
```
Pre-condition: Collection has teardown step.
Steps:
  1. Get replay events.
  2. Verify teardown-started and teardown-completed events present.
Expected: Teardown events in replay.
Type: Functional
```

### TC-220 | Replay session stored immutably
```
Steps:
  1. Get replay events for run R1.
  2. Wait 1 minute.
  3. Get replay events for run R1 again.
  4. Verify identical response.
Expected: Replay data immutable. Same result on repeated fetch.
Type: Functional
```

### TC-221 | Execution timeline endpoint returns ordered steps
```
Steps:
  1. GET /api/api-runs/:runId/timeline
  2. Verify steps ordered by startedAt ascending.
  3. Verify each entry has stepId, stepName, startedAt, durationMs, status.
Expected: Timeline correctly ordered with timing data.
Type: Functional
```

### TC-222 | Observability summary for failed run includes failure count
```
Pre-condition: Run with 2 failed steps.
Steps:
  1. GET /api/api-runs/:runId/observability
  2. Verify summary.failedSteps = 2.
Expected: Failures counted in summary.
Type: Functional
```

### TC-223 | Replay UI page loads run by ID
```
Steps:
  1. Navigate to Observability & Replay page.
  2. Enter a valid run ID.
  3. Click Load.
  4. Verify summary cards and event timeline rendered.
Expected: Run loaded and displayed.
Type: UI
```

### TC-224 | Replay page handles invalid run ID gracefully
```
Steps:
  1. Navigate to Replay page.
  2. Enter non-existent run ID.
  3. Click Load.
Expected: Error message shown. Page does not crash.
Type: UI / Error Handling
```

---

## Module 22 — AI Intelligence & Recommendations

### TC-225 | Recommendations generated for collection
```
Steps:
  1. GET /api/ai-intelligence/collections/:id/recommendations
  2. Verify response has recommendations[] array.
  3. Verify each recommendation has: category, severity, confidence, actionHint, provenance.
Expected: Recommendations returned with full structure.
Type: Functional
```

### TC-226 | Dependency analyzer recommendation present for long chains
```
Pre-condition: Collection has dependency chain of depth 5+.
Steps:
  1. GET recommendations.
  2. Verify at least one recommendation with category: "dependency".
Expected: Dependency recommendation generated.
Type: Functional
```

### TC-227 | Retry intelligence recommendation for high retry rates
```
Pre-condition: Collection has step with retryCount > 2 in recent runs.
Steps:
  1. GET recommendations.
  2. Verify recommendation with category: "retry" present.
Expected: Retry hotspot recommendation generated.
Type: Functional
```

### TC-228 | Flakiness insights recommendation for alternating steps
```
Pre-condition: Collection has flaky step (alternating pass/fail).
Steps:
  1. GET recommendations.
  2. Verify recommendation with category: "flakiness" present.
Expected: Flakiness recommendation generated.
Type: Functional
```

### TC-229 | Workflow quality recommendation present
```
Steps:
  1. GET recommendations for a collection.
  2. Verify at least one recommendation with category: "workflow-quality".
Expected: Quality assessment always included.
Type: Functional
```

### TC-230 | Recommendations sorted by severity + confidence
```
Steps:
  1. GET recommendations.
  2. Verify critical recommendations appear before warning appear before info.
  3. Within same severity, higher confidence first.
Expected: Correct sort order.
Type: Functional
```

### TC-231 | RCA hints for failed run
```
Pre-condition: Collection run with step failures.
Steps:
  1. GET /api/ai-intelligence/runs/:runId/rca-hints
  2. Verify hints array non-empty.
  3. Verify each hint has kind, stepId, message.
Expected: RCA hints generated for failure.
Type: Functional
```

### TC-232 | Graph overlay endpoint returns AI badges
```
Steps:
  1. POST /api/ai-intelligence/graph-overlay/:collectionId
  2. Verify response has badges[] with nodeId and badgeType.
Expected: Graph overlay computed with AI badges.
Type: Functional
```

### TC-233 | AI Insights tab visible in run result UI
```
Steps:
  1. Complete a collection run.
  2. Open run result.
  3. Click AI Insights tab.
  4. Verify recommendations section loaded.
Expected: AI insights displayed in UI.
Type: UI
```

### TC-234 | AI recommendations do not mutate collection
```
Steps:
  1. GET recommendations.
  2. GET /api/api-collections/:id — verify collection unchanged.
Expected: Recommendations are advisory only. Collection not modified.
Type: Regression / Safety
```

### TC-235 | Recommendation confidence in range 0–100
```
Steps:
  1. GET recommendations.
  2. Verify all confidence values are numbers between 0 and 100 inclusive.
Expected: Confidence range valid.
Type: Validation
```

### TC-236 | Recommendation provenance includes basis field
```
Steps:
  1. GET recommendations.
  2. Verify each recommendation has provenance.basis = heuristic | deterministic | replay-evidence.
Expected: Provenance basis always present.
Type: Functional
```

---

## Module 23 — AI Remediation Governance

### TC-237 | Generate remediation proposals for failed run
```
Pre-condition: Collection run with failures and AI recommendations.
Steps:
  1. POST /api/remediation/collections/:id/proposals
  2. Verify response has proposals[] array.
  3. Verify each proposal has: id, category, status: "pending-approval", confidence, proposedChange.
Expected: Proposals generated with pending-approval status.
Type: Functional
```

### TC-238 | Proposal categories cover all 6 types
```
Pre-condition: Collection with issues across all categories.
Steps:
  1. Generate proposals.
  2. Verify proposals cover: retry-tuning, url-healing, dependency-restructure, assertion-repair, flaky-stabilization, environment-correction.
Expected: All 6 categories present.
Type: Functional
```

### TC-239 | List pending proposals
```
Steps:
  1. Generate 3 proposals.
  2. GET /api/remediation/collections/:id/proposals
  3. Verify 3 proposals in response, all status: pending-approval.
Expected: List returns pending proposals.
Type: Functional
```

### TC-240 | Approve a proposal — status changes to approved
```
Steps:
  1. Generate a proposal.
  2. POST /api/remediation/proposals/:proposalId/approve
  3. GET proposal — verify status = approved.
Expected: Status updated to approved.
Type: Functional
```

### TC-241 | Reject a proposal — status changes to rejected
```
Steps:
  1. Generate a proposal.
  2. POST /api/remediation/proposals/:proposalId/reject { "reason": "Not applicable" }
  3. GET proposal — verify status = rejected.
Expected: Status updated to rejected.
Type: Functional
```

### TC-242 | Approval requires authorized role
```
Pre-condition: User has tester role (not admin/editor).
Steps:
  1. Attempt to approve a proposal as tester.
Expected: HTTP 403. Only admin/editor can approve.
Type: Authorization
```

### TC-243 | Approved proposal does NOT auto-apply changes
```
Pre-condition: Proposal approved for retry-tuning.
Steps:
  1. GET /api/api-collections/:id — verify retryPolicy unchanged.
Expected: Approval is governance record only. Collection not auto-modified.
Type: Safety / Critical
```

### TC-244 | Approval audit trail recorded
```
Steps:
  1. Approve a proposal.
  2. GET /api/remediation/approvals — verify entry with proposalId, approver, timestamp, decision: approved.
Expected: Approval recorded in audit trail.
Type: Functional
```

### TC-245 | Rejection audit trail recorded
```
Steps:
  1. Reject a proposal.
  2. GET /api/remediation/approvals — verify entry with decision: rejected and reason.
Expected: Rejection recorded.
Type: Functional
```

### TC-246 | Proposal includes diff showing before/after
```
Steps:
  1. Generate proposal.
  2. Inspect proposedChange field — verify it shows current value and proposed value.
Expected: Before/after diff in proposal.
Type: Functional
```

### TC-247 | Graph overlay annotated with proposal badges
```
Steps:
  1. Generate proposals.
  2. POST /api/ai-intelligence/graph-overlay/:id
  3. Verify overlay includes approval-pending or remediation-proposed badges on affected nodes.
Expected: Graph overlay augmented with remediation badges.
Type: Functional
```

### TC-248 | Policy restricts approval to admin for production environment
```
Pre-condition: Governance policy: production environment requires admin approver.
Steps:
  1. Editor user attempts to approve proposal for production collection.
Expected: HTTP 403 or policy violation message. Editor cannot approve production remediation.
Type: Authorization
```

---

## Module 24 — Defect Intelligence & Jira Filing

### TC-249 | Defect auto-drafted when critical assertion fails
```
Pre-condition: Jira integration configured. Step has critical severity assertion that fails.
Steps:
  1. Run collection.
  2. Check run result — verify Jira defect draft created for the failed step.
Expected: Defect auto-drafted with step context.
Type: Functional / Integration
```

### TC-250 | Draft defect includes step name, collection, run ID
```
Steps:
  1. GET /api/api-defects/by-step/:stepId
  2. Verify defect record includes stepName, collectionId, runId.
Expected: Full context in defect.
Type: Functional
```

### TC-251 | Manual defect filing via API
```
Steps:
  1. POST /api/api-defects/file { stepId, collectionId, runId }
  2. Verify HTTP 200. Jira issue created (mock or actual).
Expected: Defect filed to Jira.
Type: Functional
```

### TC-252 | Defect deduplication — second failure for same step/signature does not create new issue
```
Pre-condition: Defect already open for stepId S1 with failureSignature F1.
Steps:
  1. Run collection again. Step S1 fails with same signature F1.
  2. Verify no new Jira issue created.
  3. Verify comment added to existing issue (or duplicate flag set).
Expected: Deduplication works. No duplicate Jira issues.
Type: Functional
```

### TC-253 | Healing suggestion provided for URL format error
```
Pre-condition: Step fails because URL path param format wrong (e.g., /users/{id} → should be /users/123).
Steps:
  1. GET /api/api-defects/by-step/:stepId — check healingSuggestions[].
Expected: URL healing suggestion present with proposed fix.
Type: Functional
```

### TC-254 | Healing suggestion provided for status code change
```
Pre-condition: Assertion expects 200 but API now returns 201.
Steps:
  1. Check healing suggestions for failed step.
  2. Verify suggestion to update assertion to expect 201.
Expected: Assertion update suggestion provided.
Type: Functional
```

### TC-255 | Jira & Heal tab shows defects and suggestions in UI
```
Steps:
  1. Run collection with failures.
  2. Open run result. Click Jira & Heal tab.
  3. Verify failed steps listed with File to Jira button and healing suggestions.
Expected: UI surfaces defects and healing suggestions.
Type: UI
```

### TC-256 | Non-critical assertion failure does not auto-file defect
```
Pre-condition: Step has only minor severity assertion that fails.
Steps:
  1. Run collection.
  2. Verify no defect auto-created for minor failure.
Expected: Only critical failures trigger auto-filing.
Type: Functional
```

### TC-257 | Defect record stored in api-defects.json
```
Steps:
  1. File a defect.
  2. Check data/api-defects.json — verify entry added.
Expected: Defect persisted locally.
Type: Functional
```

### TC-258 | Heal advisor does not modify collection automatically
```
Steps:
  1. Receive healing suggestion.
  2. GET /api/api-collections/:id — verify step URL unchanged.
Expected: Healing is advisory. No auto-modification.
Type: Safety
```

---

## Module 25 — Governance, RBAC & Audit

### TC-259 | Admin role has full access
```
Pre-condition: User with admin role.
Steps:
  1. Create, read, update, delete environments and collections.
  2. Run collections.
  3. Approve remediation proposals.
  4. Manage policies.
Expected: All operations succeed.
Type: Authorization
```

### TC-260 | Editor cannot delete collections
```
Pre-condition: User with editor role.
Steps:
  1. Attempt DELETE /api/api-collections/:id as editor.
Expected: HTTP 403. Delete rejected.
Type: Authorization
```

### TC-261 | Tester can run but not create collections
```
Pre-condition: User with tester role.
Steps:
  1. POST /api/api-collections — verify HTTP 403.
  2. POST /api/api-collections/:id/run — verify success.
Expected: Tester can run, not create.
Type: Authorization
```

### TC-262 | Viewer cannot run collections
```
Pre-condition: User with viewer role.
Steps:
  1. POST /api/api-collections/:id/run as viewer.
Expected: HTTP 403.
Type: Authorization
```

### TC-263 | All mutation operations logged to audit log
```
Steps:
  1. Create environment, update collection, run collection, delete environment.
  2. GET /api/governance/audit
  3. Verify all 4 actions appear in audit log with timestamp, user, action, resource ID.
Expected: Complete audit trail of all mutations.
Type: Functional
```

### TC-264 | Audit log filterable by action type
```
Steps:
  1. GET /api/governance/audit?action=api:collection:run
  2. Verify only run actions returned.
Expected: Filter by action type works.
Type: Functional
```

### TC-265 | Audit log filterable by date range
```
Steps:
  1. GET /api/governance/audit?from=<yesterday>&to=<today>
  2. Verify only entries within range returned.
Expected: Date filter works.
Type: Functional
```

### TC-266 | Create governance policy
```
Steps:
  1. POST /api/governance/policies { name: "Prod Restriction", restrictedEnvs: ["prod-env-id"], requiredRole: "admin" }
  2. Verify HTTP 200 or 201.
  3. GET /api/governance/policies — verify policy in list.
Expected: Policy created and retrievable.
Type: Functional
```

### TC-267 | Policy enforcement — non-admin blocked from running production collection
```
Pre-condition: Policy restricts production environment to admin role.
Steps:
  1. Editor user attempts to run collection using production environment.
Expected: HTTP 403. Policy violation message.
Type: Authorization / Integration
```

### TC-268 | Tenant context endpoint returns mode
```
Steps:
  1. GET /api/governance/tenant
  2. Verify response has tenantMode: "single-tenant" or "multi-tenant".
Expected: Tenant mode returned.
Type: Functional
```

### TC-269 | Import action logged to audit
```
Steps:
  1. Import an OpenAPI spec.
  2. GET /api/governance/audit — verify IMPORT_OPENAPI action logged.
Expected: Import action audited.
Type: Functional
```

### TC-270 | Remediation approval logged to audit
```
Steps:
  1. Approve a remediation proposal.
  2. GET /api/governance/audit — verify api:remediation:approved action logged.
Expected: Approval audited.
Type: Functional
```

---

## Module 26 — Security & Secret Management

### TC-271 | Secret classification — token key classified as Critical
```
Steps:
  1. POST /api/security/secret-scan { record: { "apiToken": "secret123" } }
  2. Verify classification: Critical for "apiToken" key.
Expected: Token classified as critical.
Type: Functional
```

### TC-272 | Secret scan — detects accidental secret in request body
```
Steps:
  1. POST /api/security/secret-scan with payload containing: { "password": "plaintext123" }
  2. Verify violations[] non-empty. Violation references "password" field.
Expected: Secret exposure detected.
Type: Security
```

### TC-273 | Sensitive variable never returned in plain text via API
```
Pre-condition: Sensitive variable API_SECRET stored in environment.
Steps:
  1. GET /api/api-envs/:id
  2. Inspect variables[].value for API_SECRET.
Expected: Value masked or encrypted. Not returned as plain text.
Type: Security
```

### TC-274 | Masking policy masks Authorization header in HAR
```
Pre-condition: Step uses Bearer auth.
Steps:
  1. Run collection.
  2. View HAR in run result.
  3. Inspect Authorization header.
Expected: Authorization value masked in HAR.
Type: Security
```

### TC-275 | Masking policy masks X-API-Key header
```
Pre-condition: Step uses API Key auth.
Steps:
  1. Run collection.
  2. View HAR.
  3. Inspect X-API-Key header.
Expected: Key value masked.
Type: Security
```

### TC-276 | Compliance audit export generated with integrity hash
```
Steps:
  1. GET /api/security/compliance/audit-export?from=...&to=...
  2. Verify response has events[] and integrityHash (SHA-256).
Expected: Export generated with integrity hash.
Type: Functional
```

### TC-277 | Compliance export integrity hash verifiable
```
Steps:
  1. Export compliance data.
  2. POST /api/security/compliance/verify with exported data.
  3. Verify response: verified: true.
Expected: Hash verification passes for unmodified export.
Type: Functional / Security
```

### TC-278 | Tampered compliance export fails verification
```
Steps:
  1. Export compliance data.
  2. Modify one event in the exported data.
  3. POST /api/security/compliance/verify with tampered data.
Expected: verified: false. Tamper detected.
Type: Security
```

### TC-279 | Environment security guard blocks non-admin from production
```
Pre-condition: Production environment security policy: allowedRoles = [admin].
Steps:
  1. GET /api/security/environment/prod-env-id/access as editor.
Expected: AccessDecision.permitted = false. Reason: role-insufficient.
Type: Authorization
```

### TC-280 | Secret scan clean payload — no violations
```
Steps:
  1. POST /api/security/secret-scan with payload: { "userId": "123", "action": "view" }
  2. Verify violations = [].
Expected: No violations for non-secret keys.
Type: Functional
```

### TC-281 | Masking policy GET returns active patterns
```
Steps:
  1. GET /api/security/masking-policy
  2. Verify response lists masked header patterns: authorization, x-api-key, cookie, etc.
Expected: Active masking policy returned.
Type: Functional
```

---

## Module 27 — Graph Editor & DAG Visualization

### TC-282 | Graph editor loads for DAG collection
```
Steps:
  1. Navigate to collection with executionMode: dag.
  2. Click View Graph.
  3. Verify step nodes rendered. Dependency edges shown.
Expected: Graph rendered correctly.
Type: UI
```

### TC-283 | Add dependency edge via UI
```
Steps:
  1. Open graph editor.
  2. Drag from Step A node to Step B node.
  3. Verify edge created.
  4. Save layout.
Expected: Dependency edge added.
Type: UI
```

### TC-284 | Add dependency edge triggers cycle check
```
Steps:
  1. Open graph editor with A → B.
  2. Attempt to drag B → A (creating cycle).
  3. Verify edge rejected. Error message about cycle.
Expected: Cycle prevented in real time.
Type: Validation / UI
```

### TC-285 | Remove dependency edge
```
Steps:
  1. Open graph editor with existing A → B edge.
  2. Click edge. Press Delete.
  3. Verify edge removed.
Expected: Dependency removed.
Type: UI
```

### TC-286 | Layout saved and restored on revisit
```
Steps:
  1. Open graph editor. Drag nodes to custom positions.
  2. Click Save Layout.
  3. Close and reopen graph editor.
  4. Verify nodes at same positions.
Expected: Layout persisted.
Type: Functional / UI
```

### TC-287 | Lock layout prevents node movement
```
Steps:
  1. Save layout.
  2. Click Lock Layout.
  3. Attempt to drag a node.
  4. Verify node does not move.
Expected: Layout locked. No drag allowed.
Type: UI
```

### TC-288 | Validate DAG endpoint — valid DAG returns OK
```
Steps:
  1. POST /api/graph-editor/:collectionId/validate-dag
  2. Verify response: valid: true.
Expected: Valid DAG confirmed.
Type: Functional
```

### TC-289 | Validate DAG endpoint — cyclic graph returns error
```
Pre-condition: Collection has cycle.
Steps:
  1. POST /api/graph-editor/:collectionId/validate-dag
Expected: valid: false. cycleFound: true. Cycle path listed.
Type: Functional
```

### TC-290 | Graph snapshot endpoint returns current state
```
Steps:
  1. GET /api/graph-editor/:collectionId/snapshot
  2. Verify response has nodes, edges, layoutSnapshot.
Expected: Snapshot contains full graph state.
Type: Functional
```

### TC-291 | AI badges visible on graph nodes after intelligence run
```
Pre-condition: AI recommendations generated. retry-hotspot badge expected for a step.
Steps:
  1. Open graph editor.
  2. Verify retry-hotspot badge visible on the relevant step node.
Expected: AI overlay badges rendered on graph.
Type: UI / Integration
```

---

## Module 28 — Analytics & SLA Intelligence

### TC-292 | Record trend sample
```
Steps:
  1. POST /api/analytics/trends/record { collectionId, passRate: 0.9, avgDurationMs: 500, flakinessScore: 0.1 }
  2. Verify HTTP 200.
Expected: Sample recorded.
Type: Functional
```

### TC-293 | Get trends for collection
```
Pre-condition: 5 trend samples recorded over last hour.
Steps:
  1. GET /api/analytics/trends/:collectionId
  2. Verify aggregated metrics: avgPassRate, avgDurationMs, p95DurationMs, flakinessScore.
Expected: Aggregated trend data returned.
Type: Functional
```

### TC-294 | SLA evaluate — all dimensions pass
```
Pre-condition: SLA policy: maxLatencyMs=2000, minPassRate=0.9. Collection metrics within thresholds.
Steps:
  1. POST /api/analytics/sla/evaluate with passing metrics.
  2. Verify scorecard: all dimensions = pass.
Expected: No SLA breach.
Type: Functional
```

### TC-295 | SLA evaluate — latency breach detected
```
Pre-condition: Collection p95 latency = 3000ms. SLA maxLatencyMs = 2000.
Steps:
  1. POST /api/analytics/sla/evaluate.
  2. Verify latency dimension = breach.
Expected: Latency SLA breach flagged.
Type: Functional
```

### TC-296 | SLA evaluate — pass rate breach detected
```
Pre-condition: Pass rate = 0.7. SLA minPassRate = 0.9.
Steps:
  1. Evaluate.
  2. Verify pass-rate dimension = breach.
Expected: Pass rate breach flagged.
Type: Functional
```

### TC-297 | RCA failure trends — escalating pattern detected
```
Pre-condition: Collection failure rate increasing over time (1%, 5%, 10%, 20%).
Steps:
  1. POST /api/analytics/rca/failure-trends.
  2. Verify trend = escalating.
Expected: Escalating pattern identified.
Type: Functional
```

### TC-298 | RCA failure trends — isolated pattern detected
```
Pre-condition: 1 failure in 20 runs.
Steps:
  1. Evaluate failure trends.
  2. Verify trend = isolated.
Expected: Isolated failure identified.
Type: Functional
```

### TC-299 | RCA retry hotspots
```
Pre-condition: Step A has retry rate > 0.5.
Steps:
  1. POST /api/analytics/rca/retry-hotspots { collectionId }
  2. Verify Step A in hotspots.
Expected: Retry hotspot identified.
Type: Functional
```

### TC-300 | Graph analytics overlay — retry-hotspot badge
```
Pre-condition: Step with high retry rate.
Steps:
  1. POST /api/analytics/graph-overlay/:collectionId
  2. Verify badge retry-hotspot present for that step node.
Expected: Analytics badge on graph.
Type: Functional
```

### TC-301 | Graph analytics overlay — sla-breach badge
```
Pre-condition: Step with duration exceeding SLA threshold.
Steps:
  1. Generate graph overlay.
  2. Verify sla-breach badge on slow step.
Expected: SLA badge present.
Type: Functional
```

---

## Module 29 — Worker Pool Health

### TC-302 | Worker health endpoint returns status
```
Steps:
  1. GET /api/worker-pool/health
  2. Verify response has: status (healthy/unhealthy), activeWorkers, activeLeases.
Expected: Health endpoint responds.
Type: Functional
```

### TC-303 | Worker healthy when no stuck runs
```
Pre-condition: No stuck runs. Workers responding normally.
Steps:
  1. GET /api/worker-pool/health
  2. Verify status = healthy.
Expected: Healthy status when no issues.
Type: Functional
```

### TC-304 | Stuck run detected after lease TTL expires
```
Pre-condition: Run started but never completed. Lease TTL has passed.
Steps:
  1. GET /api/worker-pool/health or GET /api/worker-pool/stuck-runs
  2. Verify stuck run appears in list.
Expected: Stuck run detected.
Type: Functional
```

### TC-305 | Force release clears stuck run lease
```
Steps:
  1. Identify stuck run ID.
  2. POST /api/orchestration/leases/:runId/force-release
  3. Verify stuck run no longer in stuck-runs list.
Expected: Lease cleared.
Type: Functional
```

### TC-306 | Worker health UI page displays cards
```
Steps:
  1. Navigate to Worker Health page.
  2. Verify: status card, active workers, active leases, stuck runs table.
Expected: UI renders correctly.
Type: UI
```

### TC-307 | Active leases count reflects in-progress runs
```
Pre-condition: 2 collections running concurrently.
Steps:
  1. Start 2 runs.
  2. GET /api/worker-pool/health immediately.
  3. Verify activeLeases >= 2.
Expected: In-progress runs reflected as active leases.
Type: Functional
```

### TC-308 | Queue snapshot shows pending runs
```
Steps:
  1. Submit 3 runs quickly.
  2. GET /api/orchestration/queue/snapshot
  3. Verify pending count reflects queued runs.
Expected: Queue state visible.
Type: Functional
```

---

## Module 30 — Pre-Scan Health Check

### TC-309 | Pre-scan passes for valid collection
```
Pre-condition: Collection with valid environment, no missing variables, reachable base URL.
Steps:
  1. POST /api/api-collections/:id/pre-scan
  2. Verify all checks pass.
Expected: Pre-scan returns all-clear.
Type: Functional
```

### TC-310 | Pre-scan fails for missing variable
```
Pre-condition: Step references {{missingVar}} not defined anywhere.
Steps:
  1. POST /api/api-collections/:id/pre-scan
  2. Verify pre-scan fails with message about missing variable.
Expected: Unresolved variable detected.
Type: Functional
```

### TC-311 | Pre-scan detects DAG cycle
```
Pre-condition: Collection has cyclic dependency.
Steps:
  1. POST /api/api-collections/:id/pre-scan
Expected: Pre-scan fails with CYCLE_DETECTED.
Type: Functional
```

### TC-312 | Pre-scan reports unreachable base URL
```
Pre-condition: Environment baseUrl = "https://unreachable.invalid".
Steps:
  1. POST /api/api-collections/:id/pre-scan
Expected: Pre-scan fails or warns on baseUrl connectivity check.
Type: Functional
```

### TC-313 | Pre-scan checks auth token resolvability
```
Pre-condition: OAuth2 CC configured with invalid credentials.
Steps:
  1. POST /api/api-collections/:id/pre-scan
Expected: Pre-scan warns about auth token fetch failure.
Type: Functional
```

### TC-314 | Pre-scan returns summary per check
```
Steps:
  1. POST /api/api-collections/:id/pre-scan
  2. Verify response has structured results: list of checks, each with name and pass/fail.
Expected: Structured per-check result returned.
Type: Functional
```

---

## Module 31 — Suite Pre-Check (UI Integration)

### TC-315 | API collection linked to UI suite as pre-check
```
Steps:
  1. Configure UI suite with API pre-check pointing to collection C1.
  2. Enable blockOnApiFailure: true.
Expected: Configuration saved successfully.
Type: Functional
```

### TC-316 | UI suite blocked when API pre-check fails
```
Pre-condition: API collection C1 fails. UI suite has blockOnApiFailure: true.
Steps:
  1. Trigger UI suite run.
  2. Verify UI suite does not execute Playwright tests.
  3. Verify suite result has status API_PRECONDITION_FAILED.
Expected: UI suite blocked by failed API gate.
Type: Integration
```

### TC-317 | UI suite runs when API pre-check passes
```
Pre-condition: API collection C1 passes. UI suite configured with pre-check.
Steps:
  1. Trigger UI suite run.
  2. Verify API pre-check passes.
  3. Verify Playwright tests execute normally.
Expected: UI suite proceeds when API gate passes.
Type: Integration
```

### TC-318 | API pre-check result shown in suite result
```
Steps:
  1. Run UI suite with API pre-check.
  2. View suite run result.
  3. Verify API run result shown as first item with link to full API run.
Expected: API pre-check result visible in suite result.
Type: UI / Integration
```

### TC-319 | blockOnApiFailure: false allows suite to run despite API failure
```
Pre-condition: API pre-check fails. blockOnApiFailure: false.
Steps:
  1. Trigger UI suite run.
  2. Verify UI suite executes regardless of API failure.
  3. Verify API failure noted as warning in result.
Expected: Suite runs but flags API failure as warning.
Type: Functional
```

### TC-320 | UI suite with no API pre-check runs normally
```
Steps:
  1. Configure UI suite with no API pre-check.
  2. Run suite.
  3. Verify suite runs without API pre-check step.
Expected: No API pre-check when not configured.
Type: Functional
```

---

## Module 32 — End-to-End Journey Tests

### TC-321 | E2E: Create env → Create collection → Add steps → Run → Verify results
```
Steps:
  1. Create environment "Test-E2E" with base URL https://httpbin.org.
  2. Create collection "HTTP Tests" using Test-E2E.
  3. Add step: GET /get, assert status=200.
  4. Add step: POST /post with body {"test": "data"}, assert status=200.
  5. Run collection.
  6. Verify both steps pass.
Expected: Full create-to-run workflow works end to end.
Type: E2E
```

### TC-322 | E2E: Login → Extract token → Use token in subsequent requests (chaining)
```
Steps:
  1. Create collection with:
     - Step A: POST /api/login, extract body.$.token → authToken
     - Step B: GET /api/profile, header: Authorization: Bearer {{authToken}}, assert status=200
  2. Run collection.
  3. Verify step B uses token from step A.
Expected: Token chaining works across steps.
Type: E2E
```

### TC-323 | E2E: Import OpenAPI → Run → Verify generated steps execute
```
Steps:
  1. Import a real OpenAPI spec (petstore or similar).
  2. Verify collection generated with multiple steps.
  3. Run collection.
  4. Verify at least the GET endpoints return 200.
Expected: Import-to-run workflow complete.
Type: E2E
```

### TC-324 | E2E: CRUD flow — Create → Read → Update → Delete → Verify deleted
```
Steps:
  1. Step A: POST /users with dynamic UUID body → extract id.
  2. Step B: GET /users/{{id}} → assert status=200.
  3. Step C: PUT /users/{{id}} with updated body → assert status=200.
  4. Step D: DELETE /users/{{id}} → assert status=200.
  5. Step E (teardown): GET /users/{{id}} → assert status=404.
  6. Run sequential collection.
Expected: Full CRUD lifecycle with variable chaining works.
Type: E2E
```

### TC-325 | E2E: Baseline capture → regression detection
```
Steps:
  1. Set up collection with baseline capture on Step A.
  2. Run collection → baseline captured.
  3. Simulate API response change (add field to response).
  4. Run again → verify diff detected.
Expected: Baseline diff detection works end to end.
Type: E2E
```

### TC-326 | E2E: Flakiness build-up → hotspot detection → AI recommendation
```
Steps:
  1. Run collection 10 times where Step B randomly fails 4 times.
  2. Recompute flakiness.
  3. Verify Step B in hotspots.
  4. GET AI recommendations → verify flakiness recommendation for Step B.
Expected: Flakiness pipeline from run to recommendation works end to end.
Type: E2E
```

### TC-327 | E2E: Suite lifecycle — beforeAll login → main tests → afterAll cleanup
```
Steps:
  1. Create suite: beforeAll=LoginCollection, main=[UsersTest, OrdersTest], afterAll=LogoutCollection.
  2. Run suite.
  3. Verify: login ran first, both tests ran with auth token, logout ran last.
Expected: Full lifecycle suite execution.
Type: E2E
```

### TC-328 | E2E: Failed collection → auto-file Jira → dedup on second failure
```
Steps:
  1. Configure Jira. Run collection with critical failure.
  2. Verify Jira issue created.
  3. Run again with same failure.
  4. Verify no new Jira issue. Comment added instead.
Expected: Jira filing and dedup work end to end.
Type: E2E
```

### TC-329 | E2E: Generate AI remediation → approve → verify audit trail
```
Steps:
  1. Run collection with failures.
  2. Generate remediation proposals.
  3. Approve one proposal.
  4. Check audit trail — verify approval recorded.
  5. Check collection — verify collection unchanged (approval is advisory).
Expected: Remediation governance workflow complete.
Type: E2E
```

### TC-330 | E2E: Observability replay — failed run reconstructed
```
Steps:
  1. Run collection that fails at step 3.
  2. GET /api/api-runs/:runId/replay-events.
  3. Replay events in order — verify step 3 failure event has correct assertion details.
  4. GET /api/api-runs/:runId/observability — verify summary matches run.
Expected: Failed run fully reconstructable from replay events.
Type: E2E
```

### TC-331 | E2E: DAG collection — parallel execution verified
```
Steps:
  1. Create DAG collection: A → B, A → C, B → D, C → D (diamond).
  2. Run collection.
  3. Verify execution order: A first, B+C in parallel, D last.
  4. Verify total time close to A + max(B,C) + D (not A+B+C+D serial time).
Expected: DAG parallel execution reduces total time.
Type: E2E
```

### TC-332 | E2E: Contract drift detected after API change
```
Steps:
  1. Upload OpenAPI spec defining response with field "id" as string.
  2. Link step to spec. Run collection → no violations.
  3. Simulate API now returning "id" as integer.
  4. Run again → verify contractViolations[0] references "id" type mismatch.
Expected: Contract drift detected after API schema change.
Type: E2E
```

### TC-333 | E2E: OAuth2 CC auth flow in collection
```
Steps:
  1. Configure environment with OAuth2 CC pointing to test token endpoint.
  2. Run collection with protected endpoints.
  3. Verify steps all authenticate and return 200.
  4. Let token expire. Run again.
  5. Verify auto-refresh and success.
Expected: Full OAuth2 lifecycle managed automatically.
Type: E2E
```

### TC-334 | E2E: Pre-scan catches issue → fix → re-scan passes → run succeeds
```
Steps:
  1. Create collection with missing variable.
  2. Pre-scan — verify failure.
  3. Add variable to environment.
  4. Pre-scan again — verify all pass.
  5. Run collection — verify success.
Expected: Pre-scan → fix → run workflow works.
Type: E2E
```

### TC-335 | E2E: Postman import → review warnings → run → verify
```
Steps:
  1. Import Postman collection.
  2. Review warnings. Fix or remove flagged steps.
  3. Run collection.
  4. Verify passing steps produce results.
Expected: Postman import → fix → run workflow complete.
Type: E2E
```

### TC-336 | E2E: Governance policy enforced in run workflow
```
Steps:
  1. Create governance policy restricting production environment to admin.
  2. Log in as editor. Attempt to run production collection.
  3. Verify blocked.
  4. Log in as admin. Run succeeds.
Expected: RBAC governance enforced in production run.
Type: E2E
```

### TC-337 | E2E: Retry storm detection → recommendation → proposal generated
```
Steps:
  1. Run collection with step hitting retries 3/3 times across 5 runs.
  2. Check flakiness — verify hotspot.
  3. Get AI recommendations — verify retry recommendation.
  4. Generate remediation — verify retry-tuning proposal generated.
Expected: Full retry storm detection pipeline.
Type: E2E
```

### TC-338 | E2E: cURL import → add assertions → run
```
Steps:
  1. Import cURL: "curl https://httpbin.org/get"
  2. Add assertion: status equals 200.
  3. Run collection.
  4. Verify step passes.
Expected: cURL import → assertion → run workflow.
Type: E2E
```

### TC-339 | E2E: Dynamic data in CRUD flow — no ID conflicts between runs
```
Steps:
  1. Collection: POST /users with body {"id": "{{$dynamic:uuid}}", "email": "{{$dynamic:faker_email}}"}.
  2. Run collection 5 times.
  3. Verify all 5 runs succeeded (no duplicate ID errors).
Expected: Dynamic data prevents conflicts across runs.
Type: E2E
```

### TC-340 | E2E: Full platform workflow — Import → Run → Flakiness → AI → Remediation → Audit
```
Steps:
  1. Import OpenAPI spec → generate collection.
  2. Run collection 5+ times with mixed outcomes.
  3. Recompute flakiness → verify hotspots.
  4. Get AI recommendations → verify categories present.
  5. Generate remediation proposals → approve one.
  6. Check audit log → verify all actions recorded.
Expected: Full platform workflow from import to governance visible in audit trail.
Type: E2E / Full Smoke
```

---

## Module 33 — Token Lifecycle

### TC-341 | API call with missing Bearer prefix in Authorization header
```
Pre-condition: Valid JWT token available.
Steps:
  1. GET /api/api-envs — Authorization: "{{token}}" (no "Bearer " prefix).
  2. Verify HTTP 401.
Expected: Server rejects token without Bearer prefix.
Type: Token Lifecycle
```

### TC-342 | API call with lowercase "bearer" prefix
```
Pre-condition: Valid JWT token available.
Steps:
  1. GET /api/api-envs — Authorization: "bearer {{token}}".
  2. Verify HTTP 200 or 401 (document actual server behaviour).
Expected: Server response consistent with configured token validation strictness.
Type: Token Lifecycle
```

### TC-343 | API call with completely malformed JWT (not 3-segment)
```
Steps:
  1. GET /api/api-envs — Authorization: "Bearer not.a.valid.jwt.here".
  2. Verify HTTP 401.
Expected: Malformed token rejected.
Type: Token Lifecycle
```

### TC-344 | API call with expired session token
```
Pre-condition: Obtain a valid token. Wait for expiry (or manually expire).
Steps:
  1. GET /api/api-envs with expired token.
  2. Verify HTTP 401.
Expected: Expired token rejected with 401.
Type: Token Lifecycle
```

### TC-345 | API call with empty string token value
```
Steps:
  1. GET /api/api-envs — Authorization: "Bearer ".
  2. Verify HTTP 401.
Expected: Empty token rejected.
Type: Token Lifecycle
```

### TC-346 | API call with no Authorization header at all
```
Steps:
  1. GET /api/api-collections — no Authorization header.
  2. Verify HTTP 401.
Expected: Unauthenticated request returns 401.
Type: Token Lifecycle
```

### TC-347 | oauth2cc environment — expired client secret returns 401 on run
```
Pre-condition: Environment configured with oauth2cc pointing to token endpoint. Client secret invalid/expired.
Steps:
  1. POST /api/api-collections/:id/run using that environment.
  2. Verify run fails with auth resolution error.
  3. Verify error message references token fetch failure.
Expected: Token fetch failure surfaced as auth error, not silent crash.
Type: Token Lifecycle
```

### TC-348 | oauth2cc environment — auto token refresh succeeds and run proceeds
```
Pre-condition: oauth2cc env configured with valid credentials. Token expired mid-test.
Steps:
  1. POST /api/api-collections/:id/run.
  2. Verify token auto-refreshed before step execution.
  3. Verify all steps return 200.
Expected: Token lifecycle managed automatically, no manual intervention needed.
Type: Token Lifecycle
```

### TC-349 | Concurrent runs with the same token do not interfere
```
Steps:
  1. Trigger 3 collection runs simultaneously with the same Bearer token.
  2. Verify all 3 runs complete successfully and independently.
  3. Verify run results are separate (distinct runIds).
Expected: Token shared across concurrent runs without collision.
Type: Token Lifecycle
```

### TC-350 | Rapid repeated login attempts — rate limit or lockout behaviour documented
```
Steps:
  1. POST /api/auth/login with wrong password 10 times rapidly.
  2. Observe HTTP responses on each attempt.
  3. Document: does server return 429 (rate limit) or 401 consistently?
Expected: Server handles brute force gracefully — either rate limits or rejects consistently.
Type: Token Lifecycle
```

---

## Module 34 — Content-Type Validation

### TC-351 | POST /api/api-collections without Content-Type header
```
Steps:
  1. POST /api/api-collections — omit Content-Type header. Body: valid JSON.
  2. Verify HTTP 400 or 415.
Expected: Server requires Content-Type on POST with body.
Type: Content-Type
```

### TC-352 | POST /api/api-collections with text/plain Content-Type
```
Steps:
  1. POST /api/api-collections — Content-Type: text/plain. Body: JSON string.
  2. Verify HTTP 400 or 415.
Expected: Wrong MIME type rejected.
Type: Content-Type
```

### TC-353 | POST /api/api-collections with multipart/form-data Content-Type
```
Steps:
  1. POST /api/api-collections — Content-Type: multipart/form-data.
  2. Verify HTTP 400 or 415.
Expected: Multipart rejected on JSON endpoint.
Type: Content-Type
```

### TC-354 | POST /api/api-collections/:id/run without Content-Type (no body required)
```
Steps:
  1. POST /api/api-collections/:id/run — no Content-Type, no body.
  2. Verify HTTP 200 or 202 — run triggered successfully.
Expected: Trigger endpoints with no body work without Content-Type header.
Type: Content-Type
```

### TC-355 | PUT /api/api-envs/:id without Content-Type header
```
Steps:
  1. PUT /api/api-envs/:id — valid JSON body, no Content-Type.
  2. Verify HTTP 400 or 415.
Expected: PUT with body requires Content-Type.
Type: Content-Type
```

### TC-356 | POST /api/api-collections (step create) with application/xml Content-Type
```
Steps:
  1. POST a new step with Content-Type: application/xml.
  2. Verify HTTP 400 or 415.
Expected: XML MIME type rejected.
Type: Content-Type
```

### TC-357 | POST import endpoint with text/plain instead of application/json
```
Steps:
  1. POST /api/import/openapi — Content-Type: text/plain.
  2. Verify HTTP 400 or 415.
Expected: Import endpoint requires application/json or multipart/form-data.
Type: Content-Type
```

### TC-358 | POST /api/api-suites/:id/run without Content-Type
```
Steps:
  1. POST /api/api-suites/:id/run — no Content-Type, no body.
  2. Verify HTTP 200 or 202.
Expected: Suite run trigger (no body needed) works without Content-Type.
Type: Content-Type
```

---

## Module 35 — Contract / Schema Validation

### TC-359 | GET /api/api-envs response has all required fields
```
Steps:
  1. GET /api/api-envs.
  2. Verify each item has: id (UUID), name (string), baseUrl (string), createdAt.
Expected: Every environment object conforms to contract.
Type: Contract
```

### TC-360 | POST /api/api-collections response has id, name, steps
```
Steps:
  1. POST /api/api-collections with valid payload.
  2. Verify response has: id (UUID), name, steps (array), createdAt.
Expected: Collection create response conforms to contract.
Type: Contract
```

### TC-361 | POST /api/api-collections/:id/run response has runId
```
Steps:
  1. POST /api/api-collections/:id/run.
  2. Verify response has: runId (UUID), status, startedAt.
Expected: Run trigger response conforms to contract.
Type: Contract
```

### TC-362 | GET /api/api-runs/:runId response has status, steps, startedAt
```
Steps:
  1. Run a collection. GET /api/api-runs/:runId.
  2. Verify: status (string), stepResults (array), startedAt (ISO timestamp), duration (number).
Expected: Run result conforms to contract.
Type: Contract
```

### TC-363 | GET /api/api-runs/:runId/observability has timeline and snapshot
```
Steps:
  1. Run collection. GET /api/api-runs/:runId/observability.
  2. Verify response has: timeline (array), snapshot (object or null), replaySessionId.
Expected: Observability endpoint conforms to contract.
Type: Contract
```

### TC-364 | GET /api/worker-pool/health has status and workerCount
```
Steps:
  1. GET /api/worker-pool/health.
  2. Verify response has: status (string), workerCount (number), activeLeases (number), stuckRuns (array).
Expected: Health endpoint conforms to contract.
Type: Contract
```

### TC-365 | GET /api/api-flakiness/:collectionId has score and hotspots
```
Steps:
  1. Run collection 5+ times. GET /api/api-flakiness/:collectionId.
  2. Verify response has: stabilityScore (0–1), stepRecords (array), hotspots (array), clusters (array).
Expected: Flakiness report conforms to contract.
Type: Contract
```

### TC-366 | POST /api/ai-intelligence/collections/:id/recommendations has recommendations array
```
Steps:
  1. POST /api/ai-intelligence/collections/:id/recommendations.
  2. Verify response has: recommendations (array), each with: severity, confidence, category, actionHint.
Expected: AI recommendations response conforms to contract.
Type: Contract
```

### TC-367 | GET /api/governance/audit has entries array with action and timestamp
```
Steps:
  1. Perform several auditable actions. GET /api/governance/audit.
  2. Verify response has: entries (array), each with: action (string), timestamp (ISO), userId.
Expected: Audit log response conforms to contract.
Type: Contract
```

### TC-368 | POST /api/remediation/collections/:id/proposals has proposals with pending-approval status
```
Steps:
  1. Run collection with failures. POST /api/remediation/collections/:id/proposals.
  2. Verify response has: proposals (array), each with: id, category, status = "pending-approval", diff.
Expected: Remediation proposals conform to contract and are never auto-applied.
Type: Contract
```

---

## Module 36 — Authorization & Role Isolation

### TC-369 | viewer role cannot trigger collection run
```
Pre-condition: User logged in with viewer role.
Steps:
  1. POST /api/api-collections/:id/run.
  2. Verify HTTP 403.
Expected: Viewer cannot execute runs.
Type: Authorization
```

### TC-370 | viewer role cannot create environment
```
Pre-condition: User logged in with viewer role.
Steps:
  1. POST /api/api-envs with valid payload.
  2. Verify HTTP 403.
Expected: Viewer has read-only access.
Type: Authorization
```

### TC-371 | tester role cannot approve remediation proposal
```
Pre-condition: User logged in with tester role. A pending remediation proposal exists.
Steps:
  1. POST /api/remediation/proposals/:id/approve.
  2. Verify HTTP 403.
Expected: Tester cannot approve governance proposals.
Type: Authorization
```

### TC-372 | tester role cannot create governance policy
```
Pre-condition: User logged in with tester role.
Steps:
  1. POST /api/governance/policies with valid payload.
  2. Verify HTTP 403.
Expected: Governance policy creation restricted to admin/editor.
Type: Authorization
```

### TC-373 | editor role can trigger collection run
```
Pre-condition: User logged in with editor role.
Steps:
  1. POST /api/api-collections/:id/run.
  2. Verify HTTP 200 or 202.
Expected: Editor has run permission.
Type: Authorization
```

### TC-374 | editor cannot approve remediation on restricted environment
```
Pre-condition: Governance policy restricts production environment to admin. Editor has proposal for prod collection.
Steps:
  1. POST /api/remediation/proposals/:id/approve (proposal targets prod env).
  2. Verify HTTP 403.
Expected: Environment restriction enforced even for editor role.
Type: Authorization
```

### TC-375 | admin can access all governance audit entries
```
Pre-condition: Audit entries from multiple users exist.
Steps:
  1. Log in as admin. GET /api/governance/audit.
  2. Verify all entries visible regardless of originating user.
Expected: Admin has full audit visibility.
Type: Authorization
```

### TC-376 | non-admin cannot delete environment with active collections
```
Pre-condition: User logged in as editor. Environment has 2 active collections.
Steps:
  1. DELETE /api/api-envs/:id.
  2. Verify HTTP 403 or 409.
Expected: Environment with active collections cannot be deleted by non-admin.
Type: Authorization
```

### TC-377 | unauthenticated request to /api/api-collections returns 401
```
Steps:
  1. GET /api/api-collections — no Authorization header.
  2. Verify HTTP 401.
Expected: All API routes require authentication.
Type: Authorization
```

### TC-378 | expired session token on protected route returns 401
```
Steps:
  1. GET /api/api-runs with expired token.
  2. Verify HTTP 401.
Expected: Expired session rejected consistently.
Type: Authorization
```

### TC-379 | cross-tenant: environment from tenant A not accessible by tenant B token
```
Pre-condition: Multi-tenant setup. Env created under tenant A.
Steps:
  1. Log in as tenant B user. GET /api/api-envs/:envId (tenant A env).
  2. Verify HTTP 403 or 404.
Expected: Tenant isolation enforced — no cross-tenant data leakage.
Type: Authorization
```

### TC-380 | cross-tenant: run result from tenant A not accessible by tenant B
```
Pre-condition: Run created under tenant A.
Steps:
  1. Log in as tenant B user. GET /api/api-runs/:runId (tenant A run).
  2. Verify HTTP 403 or 404.
Expected: Run results scoped to originating tenant.
Type: Authorization
```

---

## Module 37 — Idempotency

### TC-381 | Duplicate environment create with same name returns 409 or deduplicates
```
Steps:
  1. POST /api/api-envs { name: "Production", baseUrl: "..." }.
  2. POST /api/api-envs with identical payload.
  3. Verify HTTP 409 or second response references existing env ID.
Expected: Duplicate environment prevented or deduplicated.
Type: Idempotency
```

### TC-382 | Triggering same collection run twice rapidly — each gets unique runId
```
Steps:
  1. POST /api/api-collections/:id/run.
  2. Immediately POST /api/api-collections/:id/run again.
  3. Verify both responses have distinct runId values.
  4. Verify both runs complete independently.
Expected: Each trigger produces a new independent run — no dedup.
Type: Idempotency
```

### TC-383 | Duplicate remediation proposal approve — second approve returns error
```
Pre-condition: Proposal exists, already approved.
Steps:
  1. POST /api/remediation/proposals/:id/approve (second time).
  2. Verify HTTP 400 with message "already approved" or similar.
Expected: Double-approve blocked.
Type: Idempotency
```

### TC-384 | Reject already-approved remediation proposal — returns error
```
Pre-condition: Proposal status = approved.
Steps:
  1. POST /api/remediation/proposals/:id/reject.
  2. Verify HTTP 400.
Expected: Cannot reject an already-approved proposal.
Type: Idempotency
```

### TC-385 | File Jira defect twice for same step + failure signature — dedup, returns existing
```
Pre-condition: Defect already filed for step X with signature Y.
Steps:
  1. POST /api/api-defects/file for same step + same failure.
  2. Verify no new Jira issue created.
  3. Verify response references existing issue key.
Expected: Jira dedup prevents duplicate tickets.
Type: Idempotency
```

### TC-386 | Duplicate baseline capture for same collection — overwrites cleanly
```
Steps:
  1. POST /api/api-collections/:id/baseline/capture.
  2. POST /api/api-collections/:id/baseline/capture again.
  3. Verify HTTP 200 both times.
  4. Verify only one baseline file exists (overwritten).
Expected: Baseline capture is idempotent — overwrites without error.
Type: Idempotency
```

### TC-387 | Duplicate suite run trigger produces independent suiteRunIds
```
Steps:
  1. POST /api/api-suites/:id/run.
  2. POST /api/api-suites/:id/run again immediately.
  3. Verify two distinct suiteRunId values returned.
Expected: Each suite trigger is independent.
Type: Idempotency
```

### TC-388 | Register same governance policy name twice — 409 or update
```
Steps:
  1. POST /api/governance/policies { name: "ProductionPolicy", ... }.
  2. POST /api/governance/policies with same name.
  3. Verify HTTP 409 or update behaviour.
Expected: Duplicate policy name handled gracefully.
Type: Idempotency
```

---

## Module 38 — Business Rules

### TC-389 | Collection with DAG cycle in dependsOn rejected at run time
```
Steps:
  1. Create collection: Step A dependsOn=[B], Step B dependsOn=[A].
  2. POST /api/api-collections/:id/run.
  3. Verify run fails with CircularDependencyError.
  4. Verify error message names the cycle steps.
Expected: Cycles detected and rejected before execution begins.
Type: Business Rules
```

### TC-390 | Step dependsOn referencing non-existent step ID returns validation error
```
Steps:
  1. Create step with dependsOn: ["non-existent-step-id"].
  2. Run collection.
  3. Verify error referencing unknown dependency.
Expected: Unknown dependency ID surfaced as clear error.
Type: Business Rules
```

### TC-391 | Assertion with operator not in the 16 valid operators returns 400
```
Steps:
  1. POST a step with assertion: { operator: "invalidOperator", field: "status", expected: 200 }.
  2. Verify HTTP 400 with message about invalid operator.
Expected: Invalid operators rejected at step creation or run time.
Type: Business Rules
```

### TC-392 | Variable extraction with invalid JSONPath — step fails with extraction error
```
Steps:
  1. Create step with variable extraction: JSONPath = "$.[[invalid".
  2. Run collection.
  3. Verify step fails with JSONPath parse error (not silent empty value).
Expected: Invalid JSONPath surfaces as actionable error.
Type: Business Rules
```

### TC-393 | oauth2cc environment with missing tokenUrl — auth resolution error on run
```
Steps:
  1. Create environment: auth type = oauth2cc, tokenUrl = "" (empty).
  2. Run collection using that environment.
  3. Verify run fails with auth config error referencing missing tokenUrl.
Expected: Missing required oauth2cc fields surface before HTTP call.
Type: Business Rules
```

### TC-394 | Collection maxConcurrency: 0 in parallel mode returns 400
```
Steps:
  1. POST /api/api-collections with executionMode: "parallel", maxConcurrency: 0.
  2. Verify HTTP 400.
Expected: Zero concurrency rejected as invalid configuration.
Type: Business Rules
```

### TC-395 | Suite with failing beforeAll — subsequent main collections skipped
```
Steps:
  1. Create suite: beforeAll = CollectionThatFails, main = [CollA, CollB].
  2. Run suite.
  3. Verify CollA and CollB skipped (not run).
  4. Verify suite run result reflects beforeAll failure.
Expected: beforeAll failure halts suite; main collections not executed.
Type: Business Rules
```

### TC-396 | Retry policy maxAttempts: 0 treated as no retry
```
Steps:
  1. Create step with retryPolicy: { maxAttempts: 0 }.
  2. Run collection. Step fails on first attempt.
  3. Verify no retry occurred (stepResult retryCount = 0).
Expected: maxAttempts=0 means no retry — not an error.
Type: Business Rules
```

### TC-397 | Pre/post script exceeding 500ms sandbox timeout — step fails with timeout
```
Steps:
  1. Create step with postScript: "while(true){}" (infinite loop).
  2. Run collection.
  3. Verify step fails with script timeout error within ~500ms.
Expected: Sandbox enforces 500ms max execution time.
Type: Business Rules
```

### TC-398 | Import with OpenAPI spec missing paths section — import error with message
```
Steps:
  1. POST /api/import/openapi with a spec body that has no "paths" key.
  2. Verify HTTP 400.
  3. Verify error message says "paths missing" or equivalent.
Expected: Invalid OpenAPI spec produces clear error, not silent empty import.
Type: Business Rules
```

---

## Module 39 — Boundary Value Testing

### TC-399 | Collection with exactly 1 step runs successfully
```
Steps:
  1. Create collection with 1 step (GET /health → assert status 200).
  2. Run collection.
  3. Verify run completes with status passed.
Expected: Single-step collection works without issue.
Type: Boundary
```

### TC-400 | Collection with 200 steps completes without timeout
```
Pre-condition: 200 steps each doing GET /health (fast endpoint).
Steps:
  1. Run collection.
  2. Verify all 200 steps complete.
  3. Verify no timeout error.
Expected: Large collection handles without server timeout.
Type: Boundary
```

### TC-401 | Environment variable value as empty string — stored and substituted correctly
```
Steps:
  1. Create env variable: key="prefix", value="" (empty).
  2. Create step URL: "/api/{{prefix}}users".
  3. Run collection.
  4. Verify URL resolved as "/api/users" (empty string substituted).
Expected: Empty string variable substitution works correctly.
Type: Boundary
```

### TC-402 | Environment variable name at 255 characters — accepted
```
Steps:
  1. POST /api/api-envs with variable key = "a" * 255.
  2. Verify HTTP 200/201.
  3. GET environment — verify variable stored.
Expected: Max-length variable name accepted.
Type: Boundary
```

### TC-403 | Step URL at maximum length (2048 characters) — executed
```
Steps:
  1. Create step with URL = base URL + query string totalling 2048 chars.
  2. Run collection.
  3. Verify HTTP request sent (regardless of server response).
Expected: Max-length URL constructed and sent without truncation.
Type: Boundary
```

### TC-404 | Assertion expected value as empty string — evaluates correctly
```
Steps:
  1. Create assertion: field="$.message", operator="equals", expected="".
  2. Run against endpoint that returns { "message": "" }.
  3. Verify assertion passes.
Expected: Empty string expected value in assertion handled correctly.
Type: Boundary
```

### TC-405 | maxConcurrency: 1 in parallel mode behaves like sequential
```
Steps:
  1. Create collection: executionMode=parallel, maxConcurrency=1, 5 steps.
  2. Run collection.
  3. Verify steps executed one at a time (only 1 active simultaneously).
Expected: maxConcurrency=1 serialises parallel mode correctly.
Type: Boundary
```

### TC-406 | maxConcurrency: 50 in parallel mode accepted and capped by worker pool
```
Steps:
  1. Create collection: executionMode=parallel, maxConcurrency=50, 10 steps.
  2. Run collection.
  3. Verify all 10 steps complete (worker pool handles cap gracefully).
Expected: High concurrency value accepted; worker pool manages load.
Type: Boundary
```

### TC-407 | Step timeout of 1ms — step times out immediately, run marked failed
```
Steps:
  1. Create step with timeout: 1 (1ms) targeting any slow endpoint.
  2. Run collection.
  3. Verify step fails with timeout error.
  4. Verify run status = failed.
Expected: 1ms timeout triggers immediately; clean failure recorded.
Type: Boundary
```

### TC-408 | GET /api/api-runs with page: 0 — returns 400 or treated as page 1
```
Steps:
  1. GET /api/api-runs?collectionId=X&page=0.
  2. Verify HTTP 400 or HTTP 200 returning first page.
  3. Document actual behaviour.
Expected: page=0 handled gracefully — no server crash.
Type: Boundary
```

---

## Module 40 — Unicode & Encoding

### TC-409 | Emoji in collection name — stored and retrieved correctly
```
Steps:
  1. POST /api/api-collections { name: "Patient API 🚀" }.
  2. GET /api/api-collections/:id.
  3. Verify name = "Patient API 🚀" (emoji preserved).
Expected: Emoji in names stored and returned without corruption.
Type: Unicode
```

### TC-410 | Arabic characters in environment name — stored and retrieved correctly
```
Steps:
  1. POST /api/api-envs { name: "بيئة الإنتاج", baseUrl: "..." }.
  2. GET /api/api-envs/:id.
  3. Verify name returned as "بيئة الإنتاج".
Expected: RTL Unicode stored correctly.
Type: Unicode
```

### TC-411 | Chinese characters in step name — stored and retrieved correctly
```
Steps:
  1. Create step with name: "获取用户列表".
  2. GET collection — find step by ID.
  3. Verify stepName = "获取用户列表".
Expected: CJK Unicode stored without corruption.
Type: Unicode
```

### TC-412 | XSS string in variable value — stored as plain text, never executed
```
Steps:
  1. POST /api/api-envs with variable value: "<script>alert('xss')</script>".
  2. GET /api/api-envs/:id.
  3. Verify value returned as literal string (not HTML-decoded or executed).
  4. Verify value is HTML-escaped in any UI rendering context.
Expected: XSS strings stored and displayed safely as plain text.
Type: Unicode
```

### TC-413 | Unicode in request body JSON — sent as-is and asserted correctly
```
Steps:
  1. Create step: POST /echo body = { "name": "Ünïcödé Tëst 日本語" }.
  2. Run collection.
  3. Assert response body contains exact Unicode string.
Expected: Unicode in request body transmitted and asserted correctly.
Type: Unicode
```

### TC-414 | Emoji in Jira defect comment — filed without encoding error
```
Pre-condition: Jira configured.
Steps:
  1. Create step failure with message containing "🔥 Critical failure in prod 💥".
  2. POST /api/api-defects/file.
  3. Verify HTTP 200. Verify Jira issue created.
  4. Verify Jira comment body contains emoji.
Expected: Emoji in defect comment filed without ADF encoding error.
Type: Unicode
```

### TC-415 | Unicode in governance policy name — stored and listed correctly
```
Steps:
  1. POST /api/governance/policies { name: "Règle de Production 🏭" }.
  2. GET /api/governance/policies.
  3. Verify policy name returned with accented characters and emoji intact.
Expected: Unicode policy names stored and retrieved without corruption.
Type: Unicode
```

### TC-416 | SQL injection string in variable value — stored safely, not executed
```
Steps:
  1. POST /api/api-envs with variable value: "' OR '1'='1".
  2. GET /api/api-envs/:id.
  3. Verify value returned as literal string.
  4. Run collection using that variable — verify no injection occurs.
Expected: SQL injection strings treated as plain text values throughout.
Type: Unicode
```

---

## Module 41 — Debugger Engine & AI Features UI

### TC-417 | Timeline tab renders events for a completed run
```
Steps:
  1. Open API Runs history, click View on a completed run.
  2. Click the ⏱ Timeline tab.
  3. Verify panel loads without error.
  4. Verify events are listed with timestamps, type badges, and duration bars.
Expected: Timeline events rendered; no JS console error.
Type: Functional
```

### TC-418 | Timeline tab — no events recorded shows informational message
```
Steps:
  1. Open a run that has no timeline data (GET /api/api-runs/:runId/timeline returns empty events[]).
  2. Click ⏱ Timeline tab.
  3. Verify message "No timeline events recorded." is displayed.
Expected: Empty-state message shown; no crash.
Type: Functional
```

### TC-419 | Timeline tab — API error shows error message
```
Steps:
  1. Mock GET /api/api-runs/:runId/timeline to return HTTP 500.
  2. Open run detail, click ⏱ Timeline tab.
  3. Verify error message "Timeline not available for this run." is displayed.
Expected: Graceful error message; no unhandled exception.
Type: Error Handling
```

### TC-420 | Variable Trace tab renders mutations table
```
Steps:
  1. Open a completed run.
  2. Click 📊 Var Trace tab.
  3. Verify "Variable Mutations by Node" table shows step IDs and extracted variables.
  4. Verify "Final Variable State" table shows all resolved variables.
Expected: Both tables rendered; variable names/values visible.
Type: Functional
```

### TC-421 | Var Trace tab — re-opening same run uses cached content (no refetch)
```
Steps:
  1. Open run detail, click Var Trace tab — panel loads.
  2. Switch to Steps tab, then back to Var Trace.
  3. Monitor network — verify no second GET /api/api-runs/:runId/variable-trace request.
Expected: Lazy-load flag prevents duplicate fetch.
Type: Performance
```

### TC-422 | Opening a new run resets Timeline and Var Trace panels
```
Steps:
  1. Open run A — load Timeline tab.
  2. Close modal, open run B — check Timeline panel.
  3. Verify panel is blank and fetches timeline for run B (not run A).
Expected: Panel reset on new run open; no stale data shown.
Type: Functional
```

### TC-423 | Suggest Assertions tab — renders suggestions for a step
```
Steps:
  1. Open run detail, expand a step.
  2. Click 💡 Suggest tab for the step.
  3. Verify advisory banner "AI suggestions are advisory only" is displayed.
  4. Verify table with columns Type, Field, Operator, Expected, Rationale is shown.
Expected: Advisory banner + suggestion rows rendered.
Type: Functional
```

### TC-424 | Suggest Assertions — API error shows inline error message
```
Steps:
  1. Mock POST /api/ai-intelligence/steps/:stepId/suggest-assertions to return HTTP 500.
  2. Click 💡 Suggest for a step.
  3. Verify inline error message shown inside the Suggest panel.
Expected: Error message rendered; no modal crash.
Type: Error Handling
```

### TC-425 | Suggest Assertions — zero suggestions shows empty message
```
Steps:
  1. Mock response to return { suggestions: [] }.
  2. Click 💡 Suggest for a step.
  3. Verify message "No assertion suggestions available for this step." displayed.
Expected: Empty-state message; no blank panel.
Type: Functional
```

### TC-426 | Generate Negative Tests button visible in collection list
```
Steps:
  1. Navigate to API Collections tab.
  2. Verify each row has a 🧪 Neg Tests button.
  3. Verify button has title tooltip "Generate negative test suggestions".
Expected: Button visible in every collection row.
Type: UI
```

### TC-427 | Negative Tests modal — opens with advisory banner
```
Steps:
  1. Click 🧪 Neg Tests for a collection.
  2. Verify modal opens with title "Generate Negative Tests — <collection name>".
  3. Verify advisory banner with "These are AI-generated suggestions" is present.
Expected: Modal opens; advisory banner visible before generation.
Type: Functional
```

### TC-428 | Negative Tests modal — shows strategy-colored results table
```
Steps:
  1. Open Negative Tests modal, click Generate.
  2. Mock POST /api/ai-intelligence/collections/:id/generate-negative-tests to return 3 tests across 3 strategies.
  3. Verify table with columns Strategy, Step, Title, Expected Status.
  4. Verify strategy badges are color-coded.
Expected: Table renders all results; strategy color coding applied.
Type: Functional
```

### TC-429 | Negative Tests modal — API error shows inline error
```
Steps:
  1. Mock POST to return HTTP 500.
  2. Open modal and click Generate.
  3. Verify inline error "Failed to generate negative tests." shown in result area.
Expected: Error message visible; modal remains open.
Type: Error Handling
```

### TC-430 | Plugins nav item visible in top navigation
```
Steps:
  1. Log in and navigate to main UI.
  2. Verify "🧩 Plugins" nav item exists in the sidebar/nav bar.
  3. Click it — verify panel-api-plugins becomes active.
Expected: Plugins tab renders without error.
Type: UI
```

---

## Module 42 — Plugin Ecosystem Page

### TC-431 | Plugin list loads registered plugins
```
Steps:
  1. Navigate to Plugins tab.
  2. Verify GET /api/plugins is called.
  3. Verify table rows rendered with columns: Name, Version, Capabilities, Status, Actions.
Expected: Registered plugins listed; no JS error.
Type: Functional
```

### TC-432 | Enable / Disable plugin updates status in table
```
Steps:
  1. Navigate to Plugins tab — find a disabled plugin.
  2. Click Enable — verify POST /api/plugins/:id/enable called.
  3. Verify row status changes to "Enabled" without full page reload.
  4. Click Disable — verify status reverts to "Disabled".
Expected: Optimistic status update reflected immediately in table.
Type: Functional
```

### TC-433 | Example plugins section renders cards
```
Steps:
  1. Navigate to Plugins tab.
  2. Verify GET /api/plugins/examples is called.
  3. Verify example cards show: name, description, capabilities, advisory banner, Register button.
Expected: Example cards rendered with advisory notice.
Type: Functional
```

### TC-434 | Register example plugin adds it to plugin list
```
Steps:
  1. Click Register on an example plugin card.
  2. Verify POST /api/plugins called with example manifest.
  3. Verify new row appears in plugin table.
  4. Verify success message displayed.
Expected: Plugin registered and list updated without page reload.
Type: Functional
```

---

---

## Module 43 — Graph Editor UI

### TC-435 | Graph Editor nav item visible and panel loads
Steps:
  1. Log in, navigate to main UI.
  2. Verify "🗺️ Graph Editor" nav item exists.
  3. Click it — verify panel-api-graph renders without error.
Expected: Panel loads; collection selector visible.
Type: UI

### TC-436 | Graph Editor — selecting a collection renders SVG
Steps:
  1. Navigate to Graph Editor tab.
  2. Select a collection with at least 2 steps.
  3. Verify SVG canvas renders with node rectangles and step labels.
  4. Verify dependency edges are drawn as lines with arrowheads.
Expected: SVG renders nodes + edges; no JS error.
Type: Functional

### TC-437 | Graph Editor — auto-layout assigns layered positions
Steps:
  1. Select a collection with a chain: A → B → C (B depends on A, C depends on B).
  2. Verify A is in column 0, B in column 1, C in column 2.
Expected: Layer positions reflect dependency depth.
Type: Functional

### TC-438 | Graph Editor — saved layout is used when all positions exist
Steps:
  1. Mock GET /api/graph-editor/:id/layout to return positions for all steps.
  2. Select collection in Graph Editor.
  3. Verify nodes are rendered at the saved positions, not auto-layout positions.
Expected: Saved positions override auto-layout.
Type: Functional

### TC-439 | Graph Editor — Save Layout calls POST endpoint
Steps:
  1. Select a collection and drag a node to a new position.
  2. Click 💾 Save Layout.
  3. Verify POST /api/graph-editor/:id/layout was called with updated positions.
  4. Verify success message displayed.
Expected: Layout saved; success message shown.
Type: Functional

### TC-440 | Graph Editor — Validate DAG shows valid result
Steps:
  1. Select a collection with no cycles.
  2. Click ✓ Validate DAG.
  3. Verify "DAG is valid" message displayed.
  4. Verify topological order shown in the message (if returned by API).
Expected: Validation passes; order displayed.
Type: Functional

### TC-441 | Graph Editor — Validate DAG shows cycle violation
Steps:
  1. Mock POST /api/graph-editor/:id/validate-dag to return { valid: false, violations: [{type:'cycle', fromStepId:'A', toStepId:'B'}] }.
  2. Click ✓ Validate DAG.
  3. Verify violation message displayed: "cycle: A→B".
Expected: Violation details shown; no crash.
Type: Functional

### TC-442 | Graph Editor — Add Dep with exactly 2 selected nodes
Steps:
  1. Select a collection with 2 unconnected steps.
  2. Click node A (first selection), then click node B (second selection).
  3. Verify both nodes show highlighted border.
  4. Click + Add Dep.
  5. Verify POST /api/graph-editor/:id/dependency called with operation:'add', fromStepId:A, toStepId:B.
  6. Verify new edge rendered from A to B.
Expected: Dependency added; edge visible in SVG.
Type: Functional

### TC-443 | Graph Editor — Add Dep with 0 or 1 nodes selected shows error
Steps:
  1. Click + Add Dep with no nodes selected.
  2. Verify error message "Select exactly 2 nodes first."
  3. Click only one node, then click + Add Dep.
  4. Verify same error message.
Expected: Error message; no API call made.
Type: Error Handling

### TC-444 | Graph Editor — Remove Dep removes the edge
Steps:
  1. Select a collection with step B that depends on A.
  2. Click node A then node B.
  3. Click − Remove Dep.
  4. Verify POST /api/graph-editor/:id/dependency called with operation:'remove'.
  5. Verify edge from A to B is no longer rendered.
Expected: Edge removed from SVG; success message.
Type: Functional

---

## Module 44 — Collaboration UI

### TC-445 | Collaboration nav item visible and panel loads
Steps:
  1. Navigate to main UI.
  2. Verify "💬 Collaboration" nav item exists.
  3. Click it — verify panel-api-collab renders with 3 sub-tabs.
Expected: Panel loads; Revisions, Comments, Templates tabs visible.
Type: UI

### TC-446 | Collaboration — Revisions tab lists revisions
Steps:
  1. Navigate to Collaboration tab, select a collection.
  2. Verify GET /api/collaboration/:id/revisions called.
  3. Verify table shows revisionNumber, status, authorId, description, createdAt.
Expected: Revisions listed; no JS error.
Type: Functional

### TC-447 | Collaboration — Save Revision creates new revision
Steps:
  1. Select a collection.
  2. Click + Save Revision, enter description.
  3. Verify POST /api/collaboration/:id/revisions called.
  4. Verify table reloads and new revision appears.
Expected: Revision saved; table updated.
Type: Functional

### TC-448 | Collaboration — Rollback updates status
Steps:
  1. With at least 2 revisions, click Rollback on the oldest.
  2. Confirm the dialog.
  3. Verify POST /api/collaboration/:id/revisions/rollback called.
  4. Verify success message shown.
Expected: Rollback called; success confirmed.
Type: Functional

### TC-449 | Collaboration — Diff shows step additions and removals
Steps:
  1. With at least 2 revisions, click Diff on any revision.
  2. Verify POST /api/collaboration/:id/revisions/diff called.
  3. Verify diff message shows Added/Removed/Dependency change counts.
Expected: Diff summary displayed in info message.
Type: Functional

### TC-450 | Collaboration — Comments tab: post and list comments
Steps:
  1. Switch to Comments tab, select a collection.
  2. Type a comment, select targetType 'collection', click Post.
  3. Verify POST /api/collaboration/:id/comments called.
  4. Verify comment appears in list with author, body, status 'open'.
Expected: Comment posted and listed.
Type: Functional

### TC-451 | Collaboration — Resolve comment updates status
Steps:
  1. With an open comment visible, click Resolve.
  2. Verify POST /api/collaboration/comments/:id/resolve called.
  3. Verify comment shows green "✓ Resolved".
Expected: Comment resolved; status updated in UI.
Type: Functional

### TC-452 | Collaboration — Templates tab lists templates with advisory banner
Steps:
  1. Switch to Templates tab.
  2. Verify GET /api/collaboration/templates called.
  3. Verify each template card shows name, description, category, advisory banner, Instantiate button.
Expected: Templates listed; advisory banner present on each card.
Type: Functional

### TC-453 | Collaboration — Instantiate template shows advisory scaffold
Steps:
  1. Click Instantiate on any template.
  2. Verify POST /api/collaboration/templates/:id/instantiate called.
  3. Verify alert/message shows advisory scaffold summary.
Expected: Scaffold returned; no collection created automatically.
Type: Functional

---

## Module 45 — Copilot & Predictive UI

### TC-454 | Copilot nav item visible and panel loads
Steps:
  1. Verify "🤖 Copilot" nav item exists.
  2. Click it — verify panel-api-copilot renders with advisory banner and 3 sub-tabs.
Expected: Panel loads; advisory banner visible before any interaction.
Type: UI

### TC-455 | Copilot — Guidance query returns items table
Steps:
  1. Navigate to Copilot, select a collection.
  2. Select queryType 'workflow-guidance', click 💡 Get Guidance.
  3. Verify POST /api/copilot/guide called with correct body.
  4. Verify results table shows Severity, Title, Guidance, Confidence, Action Hint columns.
Expected: Guidance items rendered; confidence percentages shown.
Type: Functional

### TC-456 | Copilot — Guidance without collection selected shows error
Steps:
  1. On Copilot tab with no collection selected, click 💡 Get Guidance.
  2. Verify error message "Select a collection first."
  3. Verify no API call made.
Expected: Inline error; no fetch triggered.
Type: Error Handling

### TC-457 | Copilot — Guidance zero items shows empty message
Steps:
  1. Mock POST /api/copilot/guide to return { items: [] }.
  2. Click Get Guidance.
  3. Verify "No guidance items returned." message shown.
Expected: Empty-state message; no crash.
Type: Functional

### TC-458 | Copilot — Flakiness Forecast renders per-step table
Steps:
  1. Select a collection, switch to Predictions tab.
  2. Click 🧪 Flakiness Forecast.
  3. Verify POST /api/copilot/predict/flakiness called.
  4. Verify table with Step ID, Predicted Score (color-coded), Confidence, Contributing Factors.
Expected: Forecast table rendered; high scores in red.
Type: Functional

### TC-459 | Copilot — Retry Storm shows risk level and affected steps
Steps:
  1. Select a collection, click ⚡ Retry Storm Risk.
  2. Verify POST /api/copilot/predict/retry-storm called.
  3. Verify risk level (low/medium/high) shown with color.
  4. Verify affected step IDs listed.
Expected: Storm risk displayed; color matches severity.
Type: Functional

### TC-460 | Copilot — SLA Breach forecast requires metric name
Steps:
  1. Leave SLA metric input blank, click SLA Breach?.
  2. Verify error "Enter SLA metric name."
  3. Fill metric name + value, click again.
  4. Verify POST /api/copilot/predict/sla-breach called.
  5. Verify breach likelihood shown as percentage with color.
Expected: Validation enforced; forecast rendered on valid input.
Type: Functional

### TC-461 | Copilot — History tab shows past guidance queries
Steps:
  1. Select a collection, switch to History tab.
  2. Verify GET /api/copilot/history/:collectionId called.
  3. Verify table shows queryType, items count, generatedAt.
Expected: History listed; no JS error.
Type: Functional

---

## Module 46 — Performance Dashboard UI

### TC-462 | Performance nav item visible and panel loads
Steps:
  1. Verify "⚡ Performance" nav item exists.
  2. Click it — verify panel-perf-dashboard renders with all 3 sections.
  3. Verify GET /api/performance/safeguards, /cache/stats, /profile called on load.
Expected: Panel loads; all 3 sections populated.
Type: UI

### TC-463 | Performance — Safeguards shows healthy when no violations
Steps:
  1. Mock GET /api/performance/safeguards to return { result: { healthy: true, violations: [] } }.
  2. Navigate to Performance tab.
  3. Verify "✓ All safeguard checks passed." shown in green.
Expected: Healthy state displayed without a violations table.
Type: Functional

### TC-464 | Performance — Safeguards shows violation table when unhealthy
Steps:
  1. Mock GET /api/performance/safeguards to return { result: { healthy: false, violations: [{code:'RETRY_STORM_DETECTED', severity:'critical', measuredValue:0.8, threshold:0.5}] } }.
  2. Navigate to Performance tab.
  3. Verify violations table shows Code, Severity (color-coded), Measured, Threshold, Note.
Expected: Violation row visible; critical shown in red.
Type: Functional

### TC-465 | Performance — Cache Stats shows hit/miss/eviction/hitRate cards
Steps:
  1. Mock GET /api/performance/cache/stats to return { stats: { hits:120, misses:30, evictions:5, hitRate:0.8 } }.
  2. Navigate to Performance tab.
  3. Verify 4 stat cards: 120 Hits (green), 30 Misses (amber), 5 Evictions (grey), 80.0% Hit Rate (blue).
Expected: Stat cards rendered with correct values and colors.
Type: Functional

### TC-466 | Performance — Cache Invalidate calls POST and refreshes stats
Steps:
  1. Enter a collection ID in the invalidate input.
  2. Click Invalidate.
  3. Verify POST /api/performance/cache/invalidate/:id called.
  4. Verify success message shown.
  5. Verify GET /api/performance/cache/stats called again after invalidation.
Expected: Cache cleared; stats refreshed; success message.
Type: Functional

### TC-467 | Performance — Cache Invalidate with empty input shows error
Steps:
  1. Leave the collection ID input blank.
  2. Click Invalidate.
  3. Verify error "Enter a Collection ID to invalidate."
  4. Verify no POST call made.
Expected: Validation enforced; no unnecessary API call.
Type: Error Handling

### TC-468 | Performance — Profiling Spans table shows recent spans
Steps:
  1. Mock GET /api/performance/profile to return { snapshot: { recentSpans: [{phase:'dag-projection', label:'build', durationMs:42, startMs:<timestamp>}] } }.
  2. Navigate to Performance tab.
  3. Verify spans table shows Phase, Label, Duration, Start columns.
  4. Verify spans shown in reverse chronological order (newest first).
Expected: Span table rendered; most recent span first.
Type: Functional

### TC-469 | Performance — Refresh button reloads all 3 sections
Steps:
  1. Navigate to Performance tab.
  2. Wait for initial load.
  3. Click ↻ Refresh.
  4. Verify GET /api/performance/safeguards, /cache/stats, /profile all called again.
Expected: All 3 sections refreshed simultaneously.
Type: Functional

### TC-470 | Graph Editor — empty collection (no steps) shows message
Steps:
  1. Select a collection with 0 steps.
  2. Verify "No steps in this collection." shown in canvas.
  3. Verify no SVG element rendered.
Expected: Empty-state message; no SVG crash.
Type: Edge Case

### TC-471 | Collaboration — empty collection (no revisions) shows empty state
Steps:
  1. Select a collection with no revisions.
  2. Verify "No revisions yet." shown in table.
Expected: Empty-state; no crash.
Type: Edge Case

### TC-472 | Copilot — API error on guidance shows inline error
Steps:
  1. Mock POST /api/copilot/guide to return HTTP 500.
  2. Click Get Guidance.
  3. Verify "Copilot request failed." shown in result area.
Expected: Graceful error; no unhandled exception.
Type: Error Handling

### TC-473 | Performance — API error on safeguards shows error message
Steps:
  1. Mock GET /api/performance/safeguards to return HTTP 500.
  2. Navigate to Performance tab.
  3. Verify "Failed to load safeguard status." in safeguards section.
Expected: Error message per section; other sections still load independently.
Type: Error Handling

### TC-474 | All 4 new nav tabs are hidden when the API Testing section is not present
Steps:
  1. Verify the 4 new nav items (api-graph, api-collab, api-copilot, perf-dashboard) are rendered inside the API Testing nav section.
  2. Log in as a user with no API testing access — verify tabs are not accessible without a project selected.
Expected: Tabs present in API Testing nav group; project-scoping rules apply.
Type: UI / Access Control

---

## Module 47: Toast Notifications

| TC | Scenario | Pre-conditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-475 | QA engineer exports plugins and sees success feedback | Plugin Ecosystem page loaded with 3 plugins | Click **↓ Export CSV** | Green toast "Plugins exported to plugins.csv" appears bottom-right; file downloads; toast auto-dismisses in ~3.5 seconds |
| TC-476 | QA engineer clicks export before data loads | Navigate to Collaboration Revisions tab, do NOT select a collection | Click **↓ Export CSV** | Red toast "No revisions to export." appears; no file download triggered |
| TC-477 | QA engineer enables a plugin and gets feedback | Plugin Ecosystem with one disabled plugin | Click **Enable** on a disabled plugin | Green toast "Plugin enabled." appears; plugin row status updates to Enabled |
| TC-478 | Multiple toasts appear without blocking UI | Any page with async actions | Trigger two exports in rapid succession | Both toasts stack vertically; each dismisses independently; UI remains responsive throughout |
| TC-479 | Toast disappears automatically | Any successful export | Click **↓ Export CSV**, wait 4 seconds | Toast is fully gone after ~3.5 seconds; no manual dismissal needed |

## Module 48: CSV Export

| TC | Scenario | Pre-conditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-480 | QA team lead exports plugin inventory before release | Plugin Ecosystem loaded, 5 plugins registered | Click **↓ Export CSV** | `plugins.csv` downloads; opens in Excel with columns: Name, Plugin ID, Version, Capabilities, Status; all 5 rows present |
| TC-481 | QA engineer saves revision history before rollback | Collaboration page, collection with 4 revisions loaded | Click **↓ Export CSV** in Revisions toolbar | `revisions.csv` downloads; contains 4 rows with Revision #, Status, Author, Description, Created At |
| TC-482 | Team manager reviews copilot usage across sprint | Copilot → History tab, collection with guidance history loaded | Click **↓ Export CSV** | `copilot-history.csv` downloads with columns: Query Type, Items, Generated At |
| TC-483 | DevOps engineer investigates performance regression | Performance Dashboard refreshed after deployment | Click **↓ Export CSV** next to Recent Profiling Spans | `perf-spans.csv` downloads; contains Phase, Label, Duration (ms), Start columns; all spans included (not just the 20 shown in UI) |
| TC-484 | QA engineer clicks export without loading data first | Performance Dashboard — page just opened, Refresh not clicked | Click **↓ Export CSV** | Red toast "No spans to export. Load the dashboard first." appears; no file download |
| TC-485 | Export CSV contains correct data types | Collaboration Revisions, collection with revision number 3 | Export and open `revisions.csv` | Revision # column is numeric; Created At is a formatted date string; Description is properly quoted if it contains commas |

## Module 49: Graph Editor Zoom

| TC | Scenario | Pre-conditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-486 | QA engineer zooms out to review large workflow | Graph Editor, collection with 8 steps loaded | Click **−** button three times | Zoom label shows 40%; all 8 nodes visible in the canvas without scrolling |
| TC-487 | QA engineer zooms in to read step labels | Graph Editor, collection loaded | Click **+** button twice | Zoom label shows 140%; node label text appears larger |
| TC-488 | QA engineer resets zoom after navigating | Graph Editor, zoomed to 60% | Click **⊡ Fit** | Zoom resets to 100%; label shows "100%" |
| TC-489 | Zoom resets automatically when switching collections | Graph Editor, zoomed to 200%, switch collection dropdown | Select a different collection | Zoom label resets to 100% without manually clicking Fit |
| TC-490 | Node/edge count updates after adding dependency | Graph Editor, collection with 3 nodes and 1 edge, 2 nodes selected | Click **+ Add Dep** | Badge updates from "3 nodes · 1 edges" to "3 nodes · 2 edges" immediately |
| TC-491 | Node count shows correct values on load | Graph Editor, select collection with 5 steps and 4 dependency edges | Collection loads | Badge shows "5 nodes · 4 edges" |

---

*End of Test Guide — v2.4 | 2026-05-22 | 491 test cases*
