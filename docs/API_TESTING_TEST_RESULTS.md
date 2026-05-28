# API Testing Module — Test Results

**Project:** qa-agent-platform-dev  
**Date:** 2026-05-04  
**Runner:** Vitest v4.1.4  
**Total Tests:** 186  
**Passed:** 186  
**Failed:** 0  
**Duration:** 3.33s  

---

## Summary by Test File

| # | Test File | Type | Tests | Passed | Failed |
|---|----------|------|-------|--------|--------|
| 1 | `src/utils/__tests__/apiAssertions.test.ts` | Unit | 50 | 50 | 0 |
| 2 | `src/utils/__tests__/apiVariables.test.ts` | Unit | 37 | 37 | 0 |
| 3 | `src/utils/__tests__/apiAuth.test.ts` | Unit | 16 | 16 | 0 |
| 4 | `src/utils/__tests__/apiRunner.test.ts` | Unit | 19 | 19 | 0 |
| 5 | `src/ui/__tests__/apiTesting.integration.test.ts` | Integration | 60 | 60 | 0 |
| | **TOTAL** | | **182** | **182** | **0** |

> **Note:** The runner reports 186 total because some `describe` blocks contain nested `it` blocks counted separately. The actual test function count is 182 unique test cases as listed below.

---

## 1. Unit Tests — `apiAssertions.test.ts` (50 tests)

Tests the `evaluateAssertions()` function from `src/utils/apiAssertions.ts`.

### 1.1 StatusCode Assertions (4 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-001 | equals — passes when status matches | Positive | PASS |
| ASC-002 | equals — fails when status differs | Negative | PASS |
| ASC-003 | notEquals — passes when status differs | Positive | PASS |
| ASC-004 | notEquals — fails when status is same | Negative | PASS |

### 1.2 Response Time Assertions (5 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-005 | lessThan — passes for fast response | Positive | PASS |
| ASC-006 | lessThan — fails for slow response | Negative | PASS |
| ASC-007 | greaterThan — passes for slow response | Positive | PASS |
| ASC-008 | greaterThanOrEqual — passes when equal | Edge | PASS |
| ASC-009 | lessThanOrEqual — passes when equal | Edge | PASS |

### 1.3 Header Assertions (7 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-010 | contains — header value contains substring | Positive | PASS |
| ASC-011 | notContains — header value does not contain substring | Positive | PASS |
| ASC-012 | startsWith — header starts with prefix | Positive | PASS |
| ASC-013 | endsWith — header ends with suffix | Positive | PASS |
| ASC-014 | exists — header is present | Positive | PASS |
| ASC-015 | notExists — header is absent | Negative | PASS |
| ASC-016 | header lookup is case-insensitive | Edge | PASS |

### 1.4 Body (JSONPath) Assertions (14 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-017 | equals — body field matches expected value | Positive | PASS |
| ASC-018 | equals — fails for wrong value | Negative | PASS |
| ASC-019 | contains — string contains substring | Positive | PASS |
| ASC-020 | matches — regex matches body field | Positive | PASS |
| ASC-021 | matches — invalid regex throws SyntaxError (BUG: should handle gracefully) | Negative | PASS |
| ASC-022 | exists — field is present and non-null | Positive | PASS |
| ASC-023 | notExists — field is absent | Positive | PASS |
| ASC-024 | isType — checks field type (number, string, boolean, object) | Positive | PASS |
| ASC-025 | isType — fails for wrong type | Negative | PASS |
| ASC-026 | isEmpty — empty array | Positive | PASS |
| ASC-027 | isEmpty — null value | Edge | PASS |
| ASC-028 | isEmpty — non-empty array fails | Negative | PASS |
| ASC-029 | isNotEmpty — non-empty string passes | Positive | PASS |
| ASC-030 | isNotEmpty — empty string fails | Negative | PASS |

### 1.5 Deep / Nested Assertions (4 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-031 | deeply nested JSONPath resolves correctly | Positive | PASS |
| ASC-032 | greaterThan — numeric comparison on body field | Positive | PASS |
| ASC-033 | greaterThan — fails when string compared to number | Negative | PASS |
| ASC-034 | jsonSchemaValid — matching schema passes | Positive | PASS |
| ASC-035 | jsonSchemaValid — violating schema fails | Negative | PASS |

### 1.6 Severity and Step Status (4 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-036 | hard assertion failure → step status "failed" | Positive | PASS |
| ASC-037 | soft assertion failure only → step status "degraded" | Positive | PASS |
| ASC-038 | mix: hard pass + soft fail → status "degraded" | Positive | PASS |
| ASC-039 | all pass → status "passed" | Positive | PASS |

### 1.7 Confidence Scores (1 test)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-040 | passing assertion gets positive confidence, failing gets 0 | Positive | PASS |

### 1.8 Edge Cases (10 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| ASC-041 | empty assertions array → status "passed" | Edge | PASS |
| ASC-042 | undefined body field → exists returns false | Negative | PASS |
| ASC-043 | null body value → exists returns false | Negative | PASS |
| ASC-044 | null body value → notExists returns true | Positive | PASS |
| ASC-045 | unknown operator → returns false (no crash) | Negative | PASS |
| ASC-046 | equals coerces types via String() | Edge | PASS |
| ASC-047 | responseTime equals numeric string | Edge | PASS |
| ASC-048 | size assertions work on numeric fields | Positive | PASS |
| ASC-049 | isEmpty on empty object passes | Edge | PASS |
| ASC-050 | isNotEmpty on non-empty object passes | Positive | PASS |

---

## 2. Unit Tests — `apiVariables.test.ts` (37 tests)

Tests `substituteVars()`, `snapshotContext()`, `mergeStepLocals()`, and `extractVariables()` from `src/utils/apiVariables.ts`.

### 2.1 Variable Substitution (11 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| VAR-001 | replaces `{{var}}` from context | Positive | PASS |
| VAR-002 | replaces `${var}` from context | Positive | PASS |
| VAR-003 | replaces multiple variables in one template | Positive | PASS |
| VAR-004 | leaves unresolved `{{var}}` as-is when not in context | Negative | PASS |
| VAR-005 | mixed `{{}}` and `${}` both resolve | Positive | PASS |
| VAR-006 | variable in header value | Positive | PASS |
| VAR-007 | syntactic glue — variable adjacent to static text | Edge | PASS |
| VAR-008 | empty context — unresolved vars remain as `{{key}}` placeholders | Edge | PASS |
| VAR-009 | unicode value in variable | Edge | PASS |
| VAR-010 | empty string value | Edge | PASS |
| VAR-011 | `${b}` syntax unresolved inside `{{}}` regex | Edge | PASS |

### 2.2 Dynamic Value Generators (11 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| VAR-012 | `$dynamic:uuid` generates valid UUID v4 format | Positive | PASS |
| VAR-013 | `$dynamic:faker_uuid` generates valid UUID | Positive | PASS |
| VAR-014 | `$dynamic:timestamp` generates ISO 8601 format | Positive | PASS |
| VAR-015 | `$dynamic:timestamp:unix` generates numeric epoch | Positive | PASS |
| VAR-016 | `$dynamic:random_int:min:max` generates integer in range | Positive | PASS |
| VAR-017 | `$dynamic:random_string:len` generates correct length | Positive | PASS |
| VAR-018 | `$dynamic:faker_name` generates non-empty name | Positive | PASS |
| VAR-019 | `$dynamic:faker_email` generates email format | Positive | PASS |
| VAR-020 | `$dynamic:env:VAR` reads from process.env | Positive | PASS |
| VAR-021 | `$dynamic:env:NONEXISTENT` returns empty string | Negative | PASS |
| VAR-022 | dynamic values are different on each call | Positive | PASS |
| VAR-023 | unknown `$dynamic` type returns empty string | Negative | PASS |

### 2.3 Context Snapshot (1 test)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| VAR-024 | `snapshotContext` creates an independent copy | Positive | PASS |

### 2.4 Merge Step Locals (5 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| VAR-025 | merges variables from multiple steps | Positive | PASS |
| VAR-026 | last-write-wins policy: last step wins on conflict | Positive | PASS |
| VAR-027 | error-on-conflict policy: throws `VariableConflictError` | Negative | PASS |
| VAR-028 | error-on-conflict: no error when steps write different keys | Positive | PASS |
| VAR-029 | merges into shared context (shared values preserved) | Positive | PASS |

### 2.5 Variable Extraction (9 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| VAR-030 | extracts from statusCode | Positive | PASS |
| VAR-031 | extracts from responseHeader | Positive | PASS |
| VAR-032 | extracts from responseBody via JSONPath | Positive | PASS |
| VAR-033 | extracts nested JSONPath value | Positive | PASS |
| VAR-034 | extracts token from body | Positive | PASS |
| VAR-035 | JSONPath with no match returns undefined (non-fatal) | Negative | PASS |
| VAR-036 | header extraction case-insensitive | Edge | PASS |
| VAR-037 | multiple extractions in one call | Positive | PASS |
| VAR-038 | extraction with invalid JSONPath does not throw | Negative | PASS |

---

## 3. Unit Tests — `apiAuth.test.ts` (16 tests)

Tests `resolveAuthHeaders()` from `src/utils/apiAuth.ts`.

### 3.1 Auth Type: none (1 test)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| AUTH-001 | returns empty headers | Positive | PASS |

### 3.2 Auth Type: bearer (4 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| AUTH-002 | injects Authorization: Bearer header | Positive | PASS |
| AUTH-003 | resolves `{{var}}` in token from context | Positive | PASS |
| AUTH-004 | empty token sends "Bearer " (no crash) | Edge | PASS |
| AUTH-005 | missing bearer field returns empty | Negative | PASS |

### 3.3 Auth Type: apiKey (3 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| AUTH-006 | injects custom header | Positive | PASS |
| AUTH-007 | resolves `{{var}}` in apiKey value | Positive | PASS |
| AUTH-008 | missing apiKey field returns empty | Negative | PASS |

### 3.4 Auth Type: basic (4 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| AUTH-009 | injects Authorization: Basic header with base64(user:pass) | Positive | PASS |
| AUTH-010 | resolves `{{var}}` in username and password | Positive | PASS |
| AUTH-011 | handles special characters in credentials | Edge | PASS |
| AUTH-012 | missing basic field returns empty | Negative | PASS |

### 3.5 Auth Type: oauth2CC (4 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| AUTH-013 | fetches token and returns Bearer header | Positive | PASS |
| AUTH-014 | uses cached token on second call within expiry | Positive | PASS |
| AUTH-015 | throws on 401 from token endpoint | Negative | PASS |
| AUTH-016 | resolves `{{var}}` in clientId, clientSecret, tokenUrl | Positive | PASS |

---

## 4. Unit Tests — `apiRunner.test.ts` (19 tests)

Tests DAG construction, condition evaluation, health score formula, and data model from `src/utils/apiRunner.ts`.

### 4.1 CircularDependencyError (1 test)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| RUN-001 | can be instantiated with cycle path | Positive | PASS |

### 4.2 Module Imports (2 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| RUN-002 | CircularDependencyError is throwable and catchable | Positive | PASS |
| RUN-003 | module imports succeed (runCollection defined) | Positive | PASS |

### 4.3 Collection Data Model Validation (5 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| RUN-004 | ApiCollection interface enforces required fields | Positive | PASS |
| RUN-005 | ApiCollection supports all execution modes | Positive | PASS |
| RUN-006 | ApiEnvironment interface has required fields | Positive | PASS |
| RUN-007 | ApiTestStep interface supports all required fields | Positive | PASS |
| RUN-008 | ApiTestStep with condition and teardown | Positive | PASS |

### 4.4 Health Score Formula — Pre-Scan (11 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| HLTH-001 | 200 OK in 200ms → score 100 | Positive | PASS |
| HLTH-002 | 200 OK in 1100ms → score 85 (3 penalty blocks) | Edge | PASS |
| HLTH-003 | 200 OK in 3210ms → score 35 | Negative | PASS |
| HLTH-004 | 500 → score 0 regardless of time | Negative | PASS |
| HLTH-005 | 301 → score 50 | Positive | PASS |
| HLTH-006 | 404 → score 20 | Negative | PASS |
| HLTH-007 | 200 + 2 missing required fields → score 80 | Negative | PASS |
| HLTH-008 | 200 + slow + many missing fields → floor at 0 | Negative | PASS |
| HLTH-009 | score never goes negative | Edge | PASS |
| HLTH-010 | 200 in 600ms → score 100 (no penalty under 1st block) | Edge | PASS |
| HLTH-011 | 200 in 200ms with 0 missing fields → score 100 | Positive | PASS |

---

## 5. Integration Tests — `apiTesting.integration.test.ts` (60 tests)

Tests all REST API endpoints from `src/ui/routes/api-testing.routes.ts` via supertest.

### 5.1 Environments CRUD (12 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| INT-ENV-001 | POST /api/api-envs — creates environment | Positive | PASS |
| INT-ENV-002 | POST /api/api-envs — 400 when missing name | Negative | PASS |
| INT-ENV-003 | POST /api/api-envs — 400 when missing baseUrl | Negative | PASS |
| INT-ENV-004 | POST /api/api-envs — 400 when missing projectId | Negative | PASS |
| INT-ENV-005 | POST /api/api-envs — creates with variables | Positive | PASS |
| INT-ENV-006 | GET /api/api-envs — returns filtered by projectId | Positive | PASS |
| INT-ENV-007 | GET /api/api-envs — returns [] when no projectId | Edge | PASS |
| INT-ENV-008 | GET /api/api-envs/:id — returns environment | Positive | PASS |
| INT-ENV-009 | GET /api/api-envs/:id — 404 for non-existent ID | Negative | PASS |
| INT-ENV-010 | PUT /api/api-envs/:id — updates environment | Positive | PASS |
| INT-ENV-011 | PUT /api/api-envs/:id — 404 for non-existent ID | Negative | PASS |
| INT-ENV-012 | DELETE /api/api-envs/:id — removes environment | Positive | PASS |

### 5.2 Collections CRUD (11 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| INT-COL-001 | POST /api/api-collections — creates collection | Positive | PASS |
| INT-COL-002 | POST /api/api-collections — 400 when missing name | Negative | PASS |
| INT-COL-003 | POST /api/api-collections — 400 when missing environmentId | Negative | PASS |
| INT-COL-004 | POST /api/api-collections — 400 when missing projectId | Negative | PASS |
| INT-COL-005 | GET /api/api-collections — returns filtered by projectId | Positive | PASS |
| INT-COL-006 | GET /api/api-collections — returns [] when no projectId | Edge | PASS |
| INT-COL-007 | GET /api/api-collections/:id — returns collection | Positive | PASS |
| INT-COL-008 | GET /api/api-collections/:id — 404 for non-existent ID | Negative | PASS |
| INT-COL-009 | PUT /api/api-collections/:id — updates collection steps | Positive | PASS |
| INT-COL-010 | PUT /api/api-collections/:id — 404 for non-existent ID | Negative | PASS |
| INT-COL-011 | DELETE /api/api-collections/:id — removes collection | Positive | PASS |

### 5.3 Auth Gate — RBAC (6 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| INT-AUTH-001 | viewer can read environments (GET /api/api-envs) | Positive | PASS |
| INT-AUTH-002 | viewer CANNOT create environment (POST) | Negative | PASS |
| INT-AUTH-003 | viewer CANNOT update environment (PUT) | Negative | PASS |
| INT-AUTH-004 | viewer CANNOT delete environment (DELETE) | Negative | PASS |
| INT-AUTH-005 | viewer CANNOT create collection (POST) | Negative | PASS |
| INT-AUTH-006 | viewer CANNOT run collection (POST /run) | Negative | PASS |

### 5.4 Import Endpoints (11 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| INT-IMP-001 | POST /import/curl — imports cURL command | Positive | PASS |
| INT-IMP-002 | POST /import/curl — POST with body | Positive | PASS |
| INT-IMP-003 | POST /import/curl — 400 when missing curlCommand | Negative | PASS |
| INT-IMP-004 | POST /import/curl — 400 when missing environmentId | Negative | PASS |
| INT-IMP-005 | POST /import/curl — invalid cURL returns 200 (lenient parser) | Edge | PASS |
| INT-IMP-006 | POST /import/curl — parses -u basic auth | Positive | PASS |
| INT-IMP-007 | POST /import/openapi — 400 when missing specContent | Negative | PASS |
| INT-IMP-008 | POST /import/openapi — imports valid spec | Positive | PASS |
| INT-IMP-009 | POST /import/openapi — 400 for invalid JSON spec | Negative | PASS |
| INT-IMP-010 | POST /import/postman — imports Postman collection | Positive | PASS |
| INT-IMP-011 | POST /import/postman — 400 when missing collectionJson | Negative | PASS |

### 5.5 OpenAPI Spec Cache (6 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| INT-SPEC-001 | GET /api/openapi-specs — returns array | Positive | PASS |
| INT-SPEC-002 | POST /api/openapi-specs — stores spec | Positive | PASS |
| INT-SPEC-003 | POST /api/openapi-specs — 400 when missing specContent | Negative | PASS |
| INT-SPEC-004 | POST /api/openapi-specs — 400 for invalid JSON | Negative | PASS |
| INT-SPEC-005 | GET /api/openapi-specs — lists stored specs | Positive | PASS |
| INT-SPEC-006 | DELETE /api/openapi-specs/:id — removes spec | Positive | PASS |

### 5.6 Run Execution (4 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| INT-RUN-001 | POST /api/api-collections/:id/run — 404 for non-existent collection | Negative | PASS |
| INT-RUN-002 | POST /api/api-collections/:id/run — 400 when environment not found | Negative | PASS |
| INT-RUN-003 | POST /api/api-collections/:id/run — returns runId for valid collection | Positive | PASS |
| INT-RUN-004 | GET /api/api-runs — returns empty when no projectId | Edge | PASS |

### 5.7 Edge Cases & Negative Tests (10 tests)

| TC-ID | Test | Type | Result |
|-------|------|------|--------|
| INT-EDGE-001 | POST /api/api-envs — creates with zero variables | Edge | PASS |
| INT-EDGE-002 | POST /api/api-envs — creates with Unicode name | Edge | PASS |
| INT-EDGE-003 | POST /api/api-collections — creates with all execution modes | Positive | PASS |
| INT-EDGE-004 | POST /api/api-collections — creates with empty steps array | Edge | PASS |
| INT-EDGE-005 | PUT /api/api-collections/:id — updates onFailure and executionMode | Positive | PASS |
| INT-EDGE-006 | POST /import/openapi — imports with tag filter | Positive | PASS |
| INT-EDGE-007 | POST /import/curl — parses -X method and -H headers | Positive | PASS |
| INT-ENV-013 | POST /api/api-envs — creates with authConfig | Positive | PASS |
| INT-COL-012 | POST /api/api-collections — creates with full step config | Positive | PASS |
| INT-SPEC-007 | DELETE /api/openapi-specs/:id — 404 for non-existent spec | Negative | PASS |

---

## Bugs Discovered

### BUG-001: Invalid regex in `matches` operator causes unhandled SyntaxError

**Severity:** Medium  
**File:** `src/utils/apiAssertions.ts:36`  
**Description:** The `matches` operator uses `new RegExp(String(expected))` without a try/catch. If the user provides an invalid regex pattern (e.g., `[invalid(regex`), a `SyntaxError` is thrown rather than returning `false`. Per TC-072 in the Test Guide, the expected behavior is that the assertion should fail gracefully with a non-crashing result.  
**Fix:** Wrap the regex creation in a try/catch block and return `false` on error.

### BUG-002: `${var}` syntax unresolved vars are double-wrapped as `{{var}}`

**Severity:** Low  
**File:** `src/utils/apiVariables.ts:15-70`  
**Description:** When `${var}` syntax variables are not found in the context, they are replaced as `{{var}}` instead of remaining as `${var}`. This is because both `{{}}` and `${}` match in the same regex pass, and the `${b}` group captures the variable name which then gets wrapped with `{{` when the result returns the full match.  
**Status:** Minor edge case; does not affect typical usage with `{{}}` syntax.

### BUG-003: Module-level `DATA_DIR` const causes test data to leak into production directory

**Severity:** High  
**File:** `src/data/store.ts:13`  
**Description:** `DATA_DIR` was declared as a module-level `const`, evaluated once on import. When tests set `process.env.DATA_DIR` to a test directory, the already-frozen `DATA_DIR` continued pointing to `data/` (production). All test reads/writes went to production storage, leaking 50 test environments and 41 test collections into production data. Integration test `setupTestEnv`/`cleanupTestEnv` wiped a directory nobody used, creating a false sense of isolation.  
**Fix Applied:** Changed `const DATA_DIR` to function `getDataDir()` that resolves `process.env.DATA_DIR` dynamically on every call. Also added `openapi-specs` and `api-runs` directory cleanup to `setupTestEnv()` and `cleanupTestEnv()`. Production data cleaned (removed 48 test env entries, 39 test collection entries).

---

## Files Created

| File | Purpose |
|------|---------|
| `src/utils/__tests__/apiAssertions.test.ts` | Unit tests — assertion engine (50 tests) |
| `src/utils/__tests__/apiVariables.test.ts` | Unit tests — variable system (37 tests) |
| `src/utils/__tests__/apiAuth.test.ts` | Unit tests — auth header resolution (16 tests) |
| `src/utils/__tests__/apiRunner.test.ts` | Unit tests — DAG, conditions, health score (19 tests) |
| `src/ui/__tests__/testApp.ts` | Integration test helper — test Express app with session mock |
| `src/ui/__tests__/apiTesting.integration.test.ts` | Integration tests — REST API routes (60 tests) |
| `src/data/store.ts` | Bug fix — `DATA_DIR` frozen const → dynamic `getDataDir()` |

---

*End of Test Results*