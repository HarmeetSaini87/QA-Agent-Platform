# API Testing Module — Complete User Guide

**Audience:** SDETs, QA Engineers, Tech Leads, DevOps  
**Platform:** QA Agent Platform — All Phases (1–5, D, E)  
**Last Updated:** 2026-05-22  
**Version:** 2.3

---

## Table of Contents

1. [Overview](#1-overview)
2. [Navigation & UI Layout](#2-navigation--ui-layout)
3. [API Environments](#3-api-environments)
4. [API Collections & Steps](#4-api-collections--steps)
5. [Execution Engine](#5-execution-engine)
6. [Variable System](#6-variable-system)
7. [Auth Configuration](#7-auth-configuration)
8. [Assertion Engine](#8-assertion-engine)
9. [Import Engines](#9-import-engines)
10. [Pre/Post Scripts](#10-prepost-scripts)
11. [Baseline Snapshots & Diff](#11-baseline-snapshots--diff)
12. [Contract Drift Detection](#12-contract-drift-detection)
13. [Run Results & Analysis](#13-run-results--analysis)
14. [Flakiness Analytics](#14-flakiness-analytics)
15. [API Suite Orchestration](#15-api-suite-orchestration)
16. [Observability & Replay](#16-observability--replay)
17. [AI Intelligence & Recommendations](#17-ai-intelligence--recommendations)
18. [AI Remediation Governance](#18-ai-remediation-governance)
19. [Defect Intelligence & Jira Filing](#19-defect-intelligence--jira-filing)
20. [Governance, RBAC & Audit](#20-governance-rbac--audit)
21. [Security & Secret Management](#21-security--secret-management)
22. [Graph Editor & DAG Visualization](#22-graph-editor--dag-visualization)
23. [Analytics & SLA Intelligence](#23-analytics--sla-intelligence)
24. [Worker Pool Health](#24-worker-pool-health)
25. [Advanced Enterprise Modules](#25-advanced-enterprise-modules)
26. [Integration with UI Test Suites](#26-integration-with-ui-test-suites)
27. [Tips & Best Practices](#27-tips--best-practices)
28. [Debugger Engine — Timeline & Variable Trace](#28-debugger-engine--timeline--variable-trace)
29. [AI Assertion Suggester](#29-ai-assertion-suggester)
30. [AI Negative Test Generator](#30-ai-negative-test-generator)
31. [Plugin Ecosystem](#31-plugin-ecosystem)
32. [Graph Editor — Visual DAG Visualizer](#32-graph-editor--visual-dag-visualizer)
33. [Collaboration — Revision History, Comments & Templates](#33-collaboration--revision-history-comments--templates)
34. [Copilot — AI Guidance & Predictive Intelligence](#34-copilot--ai-guidance--predictive-intelligence)
35. [Performance Dashboard](#35-performance-dashboard)

---

## 1. Overview

The API Testing Module is a **first-class, independent** testing platform for HTTP APIs. It is not keywords bolted onto UI scripts — it has its own data model, execution engine, UI, and result store.

### What You Can Do

| Capability | How |
|---|---|
| Import 50–200 endpoints from OpenAPI/Swagger | One-click spec import |
| Chain requests: login → extract token → use in next step | Variable extraction + substitution |
| Validate status codes, headers, body fields, JSON schemas | 16 assertion operators |
| Manage Bearer, API Key, Basic, OAuth 2.0 auth | Environment-level auth config |
| Switch environments (DEV/QA/UAT/PROD) with zero changes | Environment scoping |
| Run API collections standalone or as a gate before UI suites | Suite pre-check integration |
| Detect breaking API changes against an OpenAPI spec | Contract drift detection |
| Analyze test flakiness, hotspots, and stability trends | Flakiness Analytics module |
| Replay any past run deterministically | Observability & Replay module |
| Get AI-driven recommendations for optimization | AI Intelligence module |
| Generate AI remediation proposals with approval workflow | AI Remediation module |
| Auto-file Jira bugs on failure | Defect Intelligence module |

---

## 2. Navigation & UI Layout

### Sidebar Sections

Navigate via the left sidebar. All API Testing sections appear under the **API Testing** group:

| Menu Item | Page | Purpose |
|---|---|---|
| API Environments | `#api-envs` | Manage base URLs, variables, and default auth per environment |
| API Collections | `#api-collections` | Build, import, and edit request collections |
| API Runs | `#api-runs` | View execution history, step-by-step results, HAR data, AI insights |
| Flakiness Analytics | `#api-flakiness` | Stability scores, hotspots, failure clusters |
| API Suites | `#api-suites` | Orchestrate multi-collection suites with lifecycle hooks |
| Observability & Replay | `#api-replay` | Deterministic replay of any past run |
| Worker Health | `#worker-health` | Worker pool metrics, active leases, stuck runs |
| Governance | `#governance` | RBAC policies, audit log, tenant context |

---

## 3. API Environments

An **Environment** holds the base URL, global variables, and default auth config for a group of collections. You switch environments without changing any test logic.

### 3.1 Create an Environment

1. Navigate to **API Testing > API Environments**.
2. Click **New Environment**.
3. Fill in:
   - **Name** — e.g., `QA`, `UAT`, `Production`
   - **Base URL** — e.g., `https://api.medflow.io`
4. Click **Save**.

### 3.2 Add Variables

Variables declared at the environment level are available in all collections using that environment as `{{variableName}}`.

1. Open an environment and click **Add Variable**.
2. Enter **Key** and **Value**.
3. Toggle **Sensitive** if the value is a secret (API key, password). Sensitive values are AES-256-GCM encrypted at rest and masked in all UI displays.
4. Click **Save Variables**.

### 3.3 Configure Default Auth

Each environment can have a default auth config that applies to all steps unless overridden at the step level.

1. Open an environment, scroll to **Auth Configuration**.
2. Select auth type:

| Type | Fields Required |
|---|---|
| `none` | — |
| `bearer` | Token value |
| `apiKey` | Header name + key value |
| `basic` | Username + password |
| `oauth2cc` | Token URL, Client ID, Client Secret, Scope |

3. Click **Save Auth**.

For `oauth2cc`, the platform automatically fetches and caches the access token. It refreshes the token before expiry — no manual intervention needed.

### 3.4 Set Default Environment

Click the **Set as Default** button on any environment. The default environment is pre-selected when creating new collections.

### 3.5 Delete an Environment

Click the trash icon. You will be warned if collections are still referencing the environment.

---

## 4. API Collections & Steps

A **Collection** is an ordered (or graph-structured) set of HTTP request steps that execute together as a test run.

### 4.1 Create a Collection

1. Navigate to **API Testing > API Collections**.
2. Click **New Collection**.
3. Fill in:
   - **Name** — descriptive name, e.g., `Patient API — Full CRUD`
   - **Environment** — select from dropdown
   - **Execution Mode** — `sequential`, `parallel`, or `dag`
   - **On Failure** — `stop` (default) or `continue`
   - **Max Concurrency** — (parallel/dag mode) max simultaneous HTTP requests
4. Click **Save**.

### 4.2 Add a Test Step

Each step is one HTTP request with optional assertions and variable extraction.

1. Inside a collection, click **Add Step**.
2. Fill in the **Request** tab:

| Field | Description |
|---|---|
| Step Name | Human-readable label |
| Method | GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS |
| URL | Relative path (e.g., `/patients/{{patientId}}`) or full URL |
| Headers | Key-value pairs; supports `{{variable}}` substitution |
| Query Params | Appended to URL automatically |
| Body Type | `none`, `json`, `form`, `text`, `binary` |
| Body | JSON body; supports `{{variable}}` and `{{$dynamic:...}}` |

3. Fill in the **Assertions** tab (see [Section 8](#8-assertion-engine)).
4. Fill in the **Variables** tab to extract values from the response (see [Section 6](#6-variable-system)).
5. Fill in the **Execution** tab for advanced controls:

| Setting | Description |
|---|---|
| `dependsOn` | Step IDs this step waits for (DAG mode) |
| `condition` | JS expression; step skipped if falsy (e.g., `vars.statusCode === 200`) |
| `retryPolicy` | `{ maxAttempts, backoffMs, retryOn: ['5xx','timeout','network'] }` |
| `timeout` | Per-step HTTP timeout in ms (default 30 000) |
| `delayMs` | Fixed delay before step executes |
| `teardown` | `true` — step runs after all tests even on failure |
| `onFailure` | `stop` or `continue` (overrides collection-level) |

6. Click **Save Step**.

### 4.3 Reorder Steps

Drag-and-drop step rows to reorder. In DAG mode, step order in the list is overridden by `dependsOn` declarations.

### 4.4 Collection-Level Variables

Variables defined on the collection are available across all steps and can be overridden by step-extracted values.

1. Open a collection, click **Variables** tab.
2. Add key-value pairs.
3. These merge with environment variables (step-extracted values win on conflict).

### 4.5 Run a Collection

1. From the collection list, click **Run** on any collection.
2. Or open the collection detail and click **Run Now**.
3. A `runId` is returned immediately; the run executes asynchronously.
4. Navigate to **API Runs** to see live results (auto-polls every 3 seconds until complete).

### 4.6 Pre-Scan Health Check

Before running, click **Pre-Scan** to validate:
- All referenced environment variables exist
- Auth tokens are resolvable
- Base URL is reachable (HEAD request)
- DAG has no cycles

A pass/fail summary is shown per check. Fix issues before executing.

---

## 5. Execution Engine

### 5.1 Sequential Mode

Steps execute one at a time in list order. If a step fails and `onFailure: stop`, execution halts. Use for dependent flows (login → create → validate → delete).

### 5.2 Parallel Mode

All steps execute concurrently up to `maxConcurrency`. Use for independent endpoint smoke tests to minimize run time.

### 5.3 DAG Mode

Steps declare `dependsOn: ['stepId1', 'stepId2']`. The engine builds a Directed Acyclic Graph (DAG), performs topological sort, and executes in dependency waves. Steps in the same wave run in parallel.

Cycle detection: if a cycle is detected during DAG construction, the run is rejected with a `CYCLE_DETECTED` error listing the offending steps.

### 5.4 Teardown Steps

Steps with `execution.teardown: true` are collected separately and always execute after all non-teardown steps finish — regardless of pass/fail. Use for cleanup (delete test data, revoke tokens).

### 5.5 Rate Limiting

Set `rateLimit: { requestsPerSecond: 10 }` on a collection to throttle execution. The engine inserts calculated delays between requests to stay within the limit.

### 5.6 Retry Policy

Per step:
```json
{
  "retryPolicy": {
    "maxAttempts": 3,
    "backoffMs": 500,
    "retryOn": ["5xx", "timeout", "network"]
  }
}
```
Retries use exponential backoff: `backoffMs * 2^attempt`. The step result records total attempts, final status, and whether the step recovered.

---

## 6. Variable System

### 6.1 Variable Scopes (Resolution Order)

Variables are resolved in this priority order (highest wins):

1. **Step-local** — extracted from previous step responses
2. **Collection-level** — defined on the collection
3. **Environment-level** — defined on the environment

### 6.2 Substitution Syntax

Use `{{variableName}}` anywhere in: URL, headers, query params, body, auth fields.

Examples:
```
URL:     /api/patients/{{patientId}}
Header:  Authorization: Bearer {{accessToken}}
Body:    { "doctorId": "{{doctorId}}", "note": "{{$dynamic:faker_sentence}}" }
```

### 6.3 Extracting Variables from Responses

In a step's **Variables** tab, define extraction rules:

| Field | Description |
|---|---|
| Variable Name | Name to store the extracted value as |
| Source | `body`, `header`, `status` |
| Path | JSONPath for body (e.g., `$.data.id`), or header name |

Example — extract `id` from `POST /patients` response:
```
Variable Name: patientId
Source:        body
Path:          $.data.id
```
Use `{{patientId}}` in all subsequent steps.

### 6.4 Dynamic Variables

Use `{{$dynamic:TYPE}}` to generate values at run time:

| Syntax | Generated Value |
|---|---|
| `{{$dynamic:uuid}}` | Random UUID v4 |
| `{{$dynamic:timestamp:unix}}` | Unix epoch in seconds |
| `{{$dynamic:timestamp:iso}}` | ISO 8601 timestamp |
| `{{$dynamic:faker_email}}` | Random email address |
| `{{$dynamic:faker_name}}` | Random full name |
| `{{$dynamic:faker_phone}}` | Random phone number |
| `{{$dynamic:faker_sentence}}` | Random sentence |
| `{{$dynamic:faker_word}}` | Random word |
| `{{$dynamic:random_int:1:100}}` | Random integer between 1 and 100 |

---

## 7. Auth Configuration

Auth can be configured at two levels:
- **Environment level** — default for all collections using this environment
- **Step level** — overrides the environment auth for that specific step

### Auth Types

#### Bearer Token
```json
{ "type": "bearer", "token": "{{accessToken}}" }
```
Injects `Authorization: Bearer <token>` header.

#### API Key
```json
{ "type": "apiKey", "headerName": "X-API-Key", "keyValue": "{{apiKey}}" }
```
Injects the specified header.

#### Basic Auth
```json
{ "type": "basic", "username": "{{username}}", "password": "{{password}}" }
```
Encodes as Base64 and injects `Authorization: Basic <encoded>`.

#### OAuth 2.0 Client Credentials
```json
{
  "type": "oauth2cc",
  "tokenUrl": "https://auth.example.com/oauth/token",
  "clientId": "{{clientId}}",
  "clientSecret": "{{clientSecret}}",
  "scope": "read:patients write:records"
}
```
The engine fetches the token before the first request and caches it. Token is refreshed automatically when it expires.

---

## 8. Assertion Engine

Each step can have multiple assertions. All assertions must pass for the step to be marked `passed`.

### 8.1 Assertion Structure

```json
{
  "field": "status",
  "operator": "equals",
  "expected": 200,
  "severity": "critical",
  "stopOnFail": true
}
```

| Property | Values | Description |
|---|---|---|
| `field` | `status`, `header.<name>`, `body.<jsonpath>`, `durationMs`, `bodySize` | What to assert on |
| `operator` | See table below | Comparison type |
| `expected` | Any value | Expected value |
| `severity` | `critical`, `major`, `minor` | Impact on run status |
| `stopOnFail` | `true`/`false` | Stop step on this assertion failure |

### 8.2 Supported Operators

| Operator | Use Case |
|---|---|
| `equals` | Exact value match |
| `notEquals` | Value must differ |
| `contains` | String/array contains substring or element |
| `notContains` | Inverse of contains |
| `greaterThan` | Numeric comparison |
| `lessThan` | Numeric comparison |
| `greaterThanOrEqual` | Numeric comparison |
| `lessThanOrEqual` | Numeric comparison |
| `matches` | Regex match (e.g., `^[0-9a-f-]{36}$`) |
| `exists` | Field is present and non-null |
| `notExists` | Field is absent or null |
| `jsonSchemaValid` | Body validates against inline JSON Schema |
| `arrayLength` | Array has exact length |
| `arrayLengthGreaterThan` | Array has more than N elements |
| `arrayContainsObject` | Array contains an object with matching keys |
| `isOneOf` | Value is in a provided list |

### 8.3 Assertion on Response Fields

| Field Syntax | Example | Description |
|---|---|---|
| `status` | `equals 200` | HTTP status code |
| `header.content-type` | `contains application/json` | Response header value |
| `body.$.data.id` | `exists` | JSONPath into response body |
| `body.$.items` | `arrayLengthGreaterThan 0` | Array check |
| `durationMs` | `lessThan 2000` | Response time SLA |
| `bodySize` | `lessThan 102400` | Response size in bytes |

### 8.4 Severity Levels

- **critical** — failure marks the step as `failed`, propagates to collection status
- **major** — failure is logged and flagged but does not stop execution
- **minor** — informational; recorded in results but does not affect status

---

## 9. Import Engines

Import an existing API definition to auto-generate a collection with steps and assertions.

### 9.1 Import from OpenAPI / Swagger

1. Navigate to **API Collections**.
2. Click **Import > OpenAPI/Swagger**.
3. Choose:
   - **Upload File** — paste or upload a `.json` or `.yaml` spec
   - **Import from URL** — enter the spec URL (fetched server-side)
4. Click **Import**.

The engine generates:
- One step per endpoint (`GET /patients`, `POST /patients`, etc.)
- Status code assertion (`equals 200` or `201` per HTTP method)
- JSON schema assertion from the response schema in the spec
- Variable extraction for common response patterns (`id`, `token`)

Post-import review: the response includes:
- `importHealthScore` (0–100) — higher is cleaner; lower means skipped endpoints or critical warnings
- `warnings[]` — list of issues (severity: `critical`, `warning`, `info`)
- `compatibility` — structural compatibility with the platform's workflow model

### 9.2 Import from Postman

1. Click **Import > Postman Collection**.
2. Upload a Postman Collection **v2.1** or **v3.0** JSON file.
3. Click **Import**.

Supports: nested folders (flattened to steps), disabled items (skipped with warning), pre-request scripts (converted to `preScript`), test scripts (converted to assertions where possible), environment variable references.

### 9.3 Import from cURL

1. Click **Import > cURL Command**.
2. Paste one or more `curl` commands.
3. Click **Import**.

Supports: `-X METHOD`, `-H "header"`, `-d "body"`, `--data-binary`, `-u user:pass` (converts to Basic auth), `-b "cookie"`, query params in URL.

Each `curl` command becomes one step.

### 9.4 Legacy Importer Fallback

Set environment variable `USE_LEGACY_POSTMAN_IMPORTER=true` to fall back to the original Postman importer. This flag applies to Postman imports only.

---

## 10. Pre/Post Scripts

Steps can run JavaScript snippets before the request (pre-script) or after the response (post-script).

### 10.1 Pre-Script

Runs before the HTTP request is sent. Use to compute dynamic variables, build signatures, or conditionally modify request data.

```javascript
const ts = Date.now();
setVar('requestTimestamp', ts);
setVar('signature', 'sha256-' + ts);
```

### 10.2 Post-Script

Runs after the response is received but before assertions. Use to perform custom validation or extract complex values.

```javascript
const body = JSON.parse(response.body);
if (body.items.length > 0) {
  setVar('firstItemId', body.items[0].id);
}
```

### 10.3 Sandbox API

Both scripts run in a Node.js `vm` sandbox with a 500ms timeout. Available globals:

| Global | Description |
|---|---|
| `setVar(key, value)` | Set a collection-scoped variable |
| `request` | The outgoing request (method, url, headers, body) |
| `response` | The received response (status, headers, body string) — post-script only |
| `vars` | Read-only snapshot of current variables at script start |
| `console.log(...)` | Output captured in step result logs |

Scripts cannot make network calls, access the filesystem, or import modules.

---

## 11. Baseline Snapshots & Diff

Capture a known-good response state and detect regressions in future runs.

### 11.1 Capture a Baseline

1. Open a collection step.
2. In the **Execution** tab, enable **Capture Baseline**.
3. Run the collection. The first run stores response body, status, headers, and key fields as the baseline in `data/api-baselines/<stepId>.json`.

### 11.2 Compare Against Baseline

On subsequent runs with the same step, if a baseline exists:
- Response is compared field-by-field against the baseline
- Differences are reported as `baselineDiff` in the step result
- A diff summary shows added fields, removed fields, and changed values

### 11.3 Refresh a Baseline

1. Open the step result.
2. Click **Accept as New Baseline**.
3. Confirm. The baseline file is overwritten atomically.

---

## 12. Contract Drift Detection

Validate that API responses conform to an OpenAPI specification.

### 12.1 Upload an OpenAPI Spec

1. Navigate to **API Collections > Manage Specs** (top-right).
2. Upload a `.json` or `.yaml` OpenAPI 3.x or Swagger 2.0 spec.
3. The spec is stored in `data/openapi-specs/<specId>.json` and available platform-wide.

### 12.2 Link a Step to a Spec

1. Open a collection step.
2. In the **Request** tab, select **OpenAPI Spec** from the dropdown.
3. Select the matching operation (e.g., `GET /patients/{id}`).

### 12.3 Contract Violation Reporting

When a run completes, each linked step reports:
- `contractViolations[]` — list of schema mismatches between the actual response and the spec
- Each violation includes: field path, expected type/schema, actual value, severity

Contract violations are shown in the **Run Results > Contract** tab.

---

## 13. Run Results & Analysis

### 13.1 Run List

Navigate to **API Testing > API Runs**. Shows:
- Run ID, collection name, status (`passed`/`failed`/`running`/`error`)
- Started at, duration
- Step pass/fail summary (e.g., `8/10 passed`)
- Flakiness badge if the collection has flaky steps

Click any run to open the run detail view.

### 13.2 Run Detail View

The detail view has tabs:

| Tab | Content |
|---|---|
| **Steps** | Per-step results: status, duration, assertions breakdown, extracted variables, retry count |
| **Contract** | Contract violations per step |
| **Baselines** | Baseline diffs per step |
| **HAR** | Full HTTP Archive (request + response headers, body, timing) |
| **AI Insights** | AI recommendations for the run (dependency, retry, flakiness, quality) |
| **Jira & Heal** | Filed defects and healing suggestions per failed step |
| **Remediation** | AI remediation proposals awaiting approval |

### 13.3 Step Result Details

Click a step row to expand:
- Request URL, method, headers, body
- Response status, headers, body (truncated for large payloads)
- Each assertion: operator, expected, actual, pass/fail
- Variable extractions: name, extracted value
- Retry history: attempt 1, 2, 3 with individual statuses
- Pre/post script logs
- Contract violations (if spec linked)
- Baseline diff (if baseline captured)

### 13.4 AI Insights Tab

Displays `AiRecommendation[]` generated for the run:
- **Dependency** — suggests reordering steps to reduce dependency chain depth
- **Retry** — identifies retry hotspots and suggests backoff tuning
- **Flakiness** — highlights steps with alternating pass/fail patterns
- **Workflow Quality** — overall quality score with specific improvement hints

Each recommendation shows: category, severity, confidence score, action hint, and evidence references.

---

## 14. Flakiness Analytics

Navigate to **API Testing > Flakiness Analytics**.

### 14.1 Overview Cards

| Card | Description |
|---|---|
| Stability Score | `1 - avgFailRate` across all steps (0.0–1.0) |
| Runs Analyzed | Total run count used for computation |
| Flaky Steps | Count of steps exceeding the flakiness threshold (default 0.3) |
| Failure Clusters | Number of distinct failure clusters detected |

### 14.2 Hotspot List

Steps sorted by instability score (highest first). Each row shows:
- Step name, endpoint, flakiness score
- Failure rate, alternation index (how often pass/fail alternates)
- Recovery rate (% of retries that succeeded)

### 14.3 Failure Clusters

Groups of steps with the same failure signature, clustered by:
- **By Endpoint** — same URL path pattern
- **By HTTP Status** — e.g., all `503` failures grouped
- **By Assertion Type** — e.g., all `jsonSchemaValid` failures
- **By Transport Error** — e.g., all `ECONNREFUSED` errors
- **By Dependency Chain** — steps that fail together due to shared dependencies

### 14.4 Trigger Recompute

Click **Recompute** to refresh the flakiness report using all available runs.

---

## 15. API Suite Orchestration

Suites organize multiple collections with lifecycle hooks for complex test scenarios.

### 15.1 Create a Suite

1. Navigate to **API Testing > API Suites**.
2. Click **New Suite**.
3. Fill in:
   - **Name** — e.g., `Full Patient Journey`
   - **beforeAll Collections** — setup collections (run once before everything)
   - **Main Collections** — primary test collections (run in order)
   - **afterAll Collections** — teardown collections (always run, even on failure)
   - **beforeEach / afterEach Collections** — run before/after each main collection
4. Click **Save**.

### 15.2 Shared Context Propagation

Variables extracted in `beforeAll` collections are automatically available to all main collections. If `beforeAll` logs in and extracts `{{authToken}}`, all main collections can use `{{authToken}}` without re-authenticating.

### 15.3 Run a Suite

1. Click **Run** on the suite.
2. The suite run result shows:
   - Phase-by-phase execution: `before_all → before_each → main → after_each → after_all`
   - Per-collection pass/fail
   - Teardown status (always reported separately so cleanup issues are visible)

### 15.4 Suite as a UI Test Gate

Link a suite to a UI test suite via **Test Management > Suite Settings > API Pre-Check**. The UI suite will only start if all API suite main collections pass.

---

## 16. Observability & Replay

Navigate to **API Testing > Observability & Replay**.

### 16.1 Load a Run

Enter a **Run ID** and click **Load**. The page shows:
- **Observability Summary**: total requests, assertions run, retries, teardown steps, failures
- **Execution Timeline**: ordered list of steps with start time, duration, status
- **Replay Events**: full deterministic event log for the run

### 16.2 Replay Events

Each replay event captures a point-in-time snapshot of execution state:
- `step-started`, `step-completed`, `step-failed`, `step-retried`
- `teardown-started`, `teardown-completed`
- `variable-extracted` (name + value at the moment of extraction)
- `assertion-evaluated` (operator, expected, actual, result)

Events are immutable and can be replayed in order to reconstruct exactly what happened.

### 16.3 Execution Diff

When viewing a run, click **Compare with Previous Run** to see:
- Steps added in this run
- Steps removed compared to the previous run
- Dependency changes
- Timeline reconstruction (where delays changed)

---

## 17. AI Intelligence & Recommendations

### 17.1 Collection Recommendations

From any collection's **AI Insights** button, get recommendations:

| Category | What It Analyzes |
|---|---|
| `dependency` | Suggests step reordering to reduce chain depth and improve parallelism |
| `retry` | Identifies retry hotspots; suggests lower backoff or better retry conditions |
| `flakiness` | Highlights steps with alternating outcomes; suggests stabilization |
| `workflow-quality` | Overall quality score; specific hints for assertions, variable coverage, etc. |

Each recommendation includes:
- **Severity**: `info`, `warning`, `critical`
- **Confidence**: 0–100 score
- **Action Hint**: specific, actionable text
- **Provenance**: basis (`heuristic`, `deterministic`, `replay-evidence`), evidence references

### 17.2 Run-Level RCA Hints

In **API Runs > AI Insights tab**, root-cause analysis hints for failed runs:
- Why specific steps failed (dependency cascade, environment instability, transient failure)
- Which steps are retry hotspots
- Anomaly signals from replay data

### 17.3 Graph Overlay Badges

In **Graph Editor** view, AI badges appear on step nodes:
- `unstable-dependency` — step depends on a flaky step
- `retry-hotspot` — step retried more than threshold
- `optimization-hint` — reordering opportunity
- `healing-confidence` — healing suggestion available
- `replay-anomaly` — unusual pattern in replay data

---

## 18. AI Remediation Governance

AI remediation proposals are suggestions for fixing test issues. They are **never auto-applied** — all proposals require human approval.

### 18.1 Generate Proposals

1. Open a collection run with failures.
2. In the **Remediation** tab, click **Generate Proposals**.

Proposal categories:
- `retry-tuning` — adjust `maxAttempts` or `backoffMs`
- `url-healing` — correct a URL pattern (e.g., path param format)
- `dependency-restructure` — reorder `dependsOn` declarations
- `assertion-repair` — loosen an assertion that is too strict
- `flaky-stabilization` — add retry or condition to a flaky step
- `environment-correction` — fix a variable or base URL issue

### 18.2 Review & Approve

Each proposal shows:
- Proposed change (before/after diff)
- Confidence score
- Supporting evidence (run IDs, step IDs)
- Policy constraints (if restricted environment, shows required approver role)

Click **Approve** to mark for application, **Reject** to dismiss.

### 18.3 Approval Audit Trail

Navigate to **Remediation > Approvals** to see all approval decisions with timestamp, approver, and outcome.

---

## 19. Defect Intelligence & Jira Filing

### 19.1 Automatic Jira Filing

When a step with `severity: critical` assertions fails, a Jira defect is automatically drafted if Jira integration is configured.

The defect includes:
- Step name, collection, run ID
- Failure type and signature
- Request URL, method, expected vs actual response
- Link to the run result
- AI healing suggestions in the description body

### 19.2 Manual Defect Filing

1. Open a failed run.
2. Go to **Jira & Heal** tab.
3. Click **File to Jira** on any failed step.
4. Review the auto-populated fields.
5. Click **Submit**.

### 19.3 Deduplication

The defect engine checks `data/api-defects.json` before filing. If an open defect already exists for the same `stepId + failureSignature`, a new Jira issue is NOT created — instead, a comment is added to the existing issue.

### 19.4 Healing Suggestions

For each failed step, the Heal Advisor proposes:
- URL corrections (e.g., wrong path param format)
- Assertion updates (e.g., status code changed from 200 to 201 in new API version)

Suggestions appear in the **Jira & Heal** tab and in the Jira issue body.

---

## 20. Governance, RBAC & Audit

### 20.1 Roles

| Role | Permissions |
|---|---|
| `admin` | Full access: create, edit, delete, run, approve remediations, manage policies |
| `editor` | Create, edit, and run collections/environments; cannot delete or approve remediations |
| `tester` | Run collections and view results; cannot create or edit |
| `viewer` | Read-only access to all resources |

### 20.2 Governance Policies

Navigate to **Governance > Policies**:
1. Click **New Policy**.
2. Define:
   - **Policy Name**
   - **Environment Restrictions** — e.g., Production requires admin role to run
   - **Approval Requirements** — remediation proposals for Production require `admin` approver
3. Click **Save Policy**.

### 20.3 Audit Log

Navigate to **Governance > Audit Log**:
- Every create, update, delete, run, import, and approve action is logged
- Filter by: action type, user, resource type, date range
- Each entry: timestamp, user, action, resource ID, details

### 20.4 Tenant Context

The **Governance** page shows whether the platform is running in **single-tenant** or **multi-tenant** mode. In multi-tenant mode, all data is tenant-scoped and cross-tenant access is blocked at the API layer.

---

## 21. Security & Secret Management

### 21.1 Secret Classification

The secret governance engine classifies variable keys into risk tiers:
- **Critical** — keys matching `token`, `secret`, `password`, `credential`, `apikey`
- **High** — keys matching `auth`, `key`, `cookie`, `session`
- **Standard** — all other keys

### 21.2 Sensitive Variable Masking

Variables marked **Sensitive** are:
- Encrypted at rest with AES-256-GCM
- Masked in all UI displays (`••••••••`)
- Masked in run result logs, HAR output, and Jira defect descriptions
- Never returned in plain text via API responses

### 21.3 Secret Scan

Navigate to **Security > Secret Scan** to run a manual scan on any payload. Violations are reported and block execution in restricted environments.

### 21.4 Compliance Audit Export

Navigate to **Security > Compliance Export**:
1. Select date range.
2. Click **Export**.
3. Downloads a JSON file with all security-relevant events, each with a SHA-256 integrity hash.

---

## 22. Graph Editor & DAG Visualization

### 22.1 Open the Graph Editor

From any collection with `executionMode: dag`, click **View Graph**.

The editor shows:
- Nodes: one per step, color-coded by status (green = pass, red = fail, yellow = skipped, grey = not run)
- Edges: dependency arrows (`dependsOn` relationships)
- AI badges overlaid on nodes

### 22.2 Edit Dependencies

1. In the graph editor, drag from one step node to another to add a `dependsOn` edge.
2. Click an edge and press Delete to remove it.
3. The editor validates the DAG in real time — cycle detection prevents invalid connections.

### 22.3 Layout Persistence

Pan and zoom to arrange nodes. Click **Save Layout** to persist positions. The layout is restored every time you open the graph.

### 22.4 Lock Layout

Click **Lock Layout** to prevent accidental drag-moves. Useful for reviewing a complex DAG with many nodes.

---

## 23. Analytics & SLA Intelligence

### 23.1 Execution Trends

Navigate to a collection and click **Analytics**:
- Pass rate, fail rate, retry rate over time (daily/weekly/monthly)
- Average duration and P95 duration
- Flakiness score trend

### 23.2 SLA Policies

Define SLA thresholds per collection:
- `maxLatencyMs` — P95 response time limit
- `maxRetryRate` — max acceptable retry rate (0.0–1.0)
- `minPassRate` — minimum pass rate to avoid SLA breach

SLA scorecard shows: `pass`, `at-risk`, or `breach` per dimension.

### 23.3 RCA Failure Trends

The analytics engine categorizes failure trends:
- **Escalating** — failure rate increasing over time
- **Periodic** — failures occur on a schedule (e.g., daily at deployment time)
- **Stable** — consistent, not worsening
- **Isolated** — one-off failure, not recurring

---

## 24. Worker Pool Health

Navigate to **API Testing > Worker Health**.

| Card | Description |
|---|---|
| Status | `healthy` / `unhealthy` |
| Active Workers | Count of workers processing runs |
| Active Leases | Count of in-progress run leases |
| Stuck Runs | Runs whose lease TTL expired without completion |

Stuck runs appear in a table with Run ID, collection, started time, and a **Force Release** button to manually clear the lease.

---

## 25. Advanced Enterprise Modules

These modules provide enterprise-grade capabilities accessed primarily via API endpoints.

### 25.1 Collaboration & Versioning

- **Revisions** — every save of a collection creates a revision (`draft → review → published`)
- **Review Comments** — inline comments per collection with thread/resolve support
- **Templates** — org-wide templates for common workflow patterns
- **Rollback** — revert to any prior published revision

Access via: `GET /api/collaboration/:collectionId/revisions`

### 25.2 AI Copilot

Predictive intelligence for your collections:
- **Flakiness forecast** — probability that a step will become flaky in the next 10 runs
- **Retry-storm risk** — `low/medium/high` risk of hitting retry concurrency limits
- **SLA breach likelihood** — probability of SLA violation based on current trends
- **Guidance** — advisory answers to questions about performance and stability

Access via: AI Insights tab → Copilot Guidance section

### 25.3 Plugin Ecosystem

Register custom plugins that hook into execution lifecycle:
- `before-request` — modify request before sending
- `after-response` — inspect/enrich response
- `assertion` — add custom assertion operators
- `analytics-enricher` — add custom analytics dimensions

Plugins are read-only; they cannot mutate DAG structure or retry policies.

### 25.4 Distributed Execution (Cloud-Native)

For enterprise deployments:
- **Worker Pool** — configurable pool of isolated workers
- **Kubernetes Pod Manifests** — auto-generated K8s specs for cloud workers
- **Elastic Scaling** — policy-driven scale-up/down based on queue depth
- **Resource Governance** — per-tenant worker quotas and burst allowances

---

## 26. Integration with UI Test Suites

### 26.1 Suite Pre-Check (API Gate)

Link an API collection to a Playwright UI suite as a pre-check:
1. Open a Playwright suite in **Test Management**.
2. Go to **Settings > API Pre-Check**.
3. Select an API collection.
4. Enable **Block on API Failure**.

When the suite runs, the API collection executes first. If it fails, the Playwright suite is blocked and reports `API_PRECONDITION_FAILED`.

### 26.2 API Test in Suite Results

The suite result shows the API pre-check result as the first item, with a link to the full API run detail.

---

## 27. Tips & Best Practices

### Variable Naming
- Use descriptive names: `authToken` not `token1`
- Prefix environment-level secrets: `env_clientSecret`
- Use `{{$dynamic:uuid}}` for IDs in POST requests to avoid conflicts between runs

### Dependency Design
- Keep dependency chains shallow (3 levels or fewer) for better parallelism and debuggability
- Use teardown steps for all resource cleanup — they run even on failure
- Do not depend on steps that are optional (`condition`-gated)

### Assertion Strategy
- Always assert status code first with `severity: critical, stopOnFail: true`
- Use `jsonSchemaValid` for response shape; use `equals`/`contains` for specific field values
- Avoid overly strict assertions on timestamps, UUIDs, and generated IDs — use `exists` or `matches` instead

### Import Workflow
- After importing from OpenAPI, review warnings and remove steps with critical warnings before running
- After importing from Postman, manually review extracted variable paths
- Check `importHealthScore` — below 70 indicates many skipped endpoints

### Performance
- Use `parallel` mode for independent smoke tests — can cut suite time by 70%
- Set `maxConcurrency` to match the API server's capacity (start with 5)
- Use `rateLimit` when testing rate-limited APIs to avoid 429 responses masking real failures

### CI/CD Integration
- Use the `POST /api/api-collections/:id/run` endpoint in your pipeline
- Poll `GET /api/api-runs/:runId` until status is not `running`
- Exit non-zero on `failed` or `error` status

---

---

## 28. Debugger Engine — Timeline & Variable Trace

The Debugger Engine surfaces two new tabs inside the **Run Detail** modal, giving you low-level execution visibility without leaving the UI.

### ⏱ Timeline Tab

| What it shows | Detail |
|---|---|
| Execution events | node-started, node-completed, node-failed, variable-extracted, assertion-failed, failure-propagated |
| Timestamps | Wall-clock time for each event |
| Duration bars | Proportional bar chart — longest node fills 100% width |
| Type badge | Color-coded by event type (green = complete, red = failed, amber = retrying, purple = variable) |

**How to use:**
1. Open a run from API Runs history.
2. Click the **⏱ Timeline** tab in the run detail modal.
3. Events load once and are cached — switching away and back does not re-fetch.

### 📊 Variable Trace Tab

| What it shows | Detail |
|---|---|
| Mutations by node | Each step that extracted or mutated a variable, with before/after values |
| Final state | The resolved value of every variable at run completion |

**How to use:**
1. In the same run detail modal, click **📊 Var Trace**.
2. Use this to debug assertion failures caused by wrong variable values.

> **Note:** Both tabs call read-only debugger endpoints. No changes are made to the run or collection.

---

## 29. AI Assertion Suggester

The AI Assertion Suggester analyzes a completed step's response and suggests assertions you can add to strengthen coverage.

### How to access
1. In the run detail modal, expand any step.
2. Click the **💡 Suggest** sub-tab.

### What you get
A table with suggested assertions:

| Column | Description |
|---|---|
| Type | Assertion type (e.g. `equals`, `exists`, `jsonSchemaValid`) |
| Field | JSONPath or header name to assert on |
| Operator | Comparison method |
| Expected | Suggested expected value |
| Rationale | Why this assertion is valuable |

> ⚠️ **Advisory only.** These are AI-generated suggestions. Review each before adding it to your collection. Suggestions are never applied automatically.

---

## 30. AI Negative Test Generator

The Negative Test Generator produces a set of adversarial test scenarios for a collection — edge cases that your happy-path tests typically miss.

### How to access
1. Navigate to **API Collections**.
2. Click the **🧪 Neg Tests** button on any collection row.

### Strategies used

| Strategy | What it tests |
|---|---|
| missing-required-field | Omit each required body field |
| invalid-type | Send wrong data type for key fields |
| boundary-value | Values at integer/string length limits |
| auth-bypass | Expired/missing auth tokens |
| sql-injection | Common injection payloads in string fields |

### Reading the results
The modal shows a table with Strategy, Step, Title, and Expected Status for each generated scenario. Use these as a checklist to add negative cases to your collection.

> ⚠️ **Advisory only.** Generated tests are suggestions. No steps are added to your collection automatically.

---

## 31. Plugin Ecosystem

The Plugin Ecosystem page (`🧩 Plugins` nav item) lets you register, enable, and disable extension plugins that hook into the platform's request/response lifecycle.

### Plugin list
Displays all registered plugins with their status (Enabled / Disabled) and declared capabilities. Use the **Enable** / **Disable** buttons to toggle a plugin without unregistering it.

### Example plugins
The page includes a built-in examples section with pre-built plugin manifests:

| Example | Purpose |
|---|---|
| custom-bearer-auth | Injects a custom `Authorization` header before each request |
| custom-json-assertion | Adds a JSON deep-equality assertion type |

Click **Register** on any example to add it to your plugin list.

### What plugins can do
- Annotate or enrich request/response data
- Add custom assertion types
- Add custom auth injection patterns

### What plugins cannot do
- Alter the execution DAG, retry order, or WorkflowEnvelope
- Access unmasked secrets
- Auto-execute without user registration and enablement

> ℹ️ All plugin operations are advisory and non-destructive. Enabling a plugin adds extension behavior only — existing collection runs are unaffected until the plugin is exercised in a new run.

---

---

## 32. Graph Editor — Visual DAG Visualizer

The Graph Editor tab (🗺️ Graph Editor) lets you visually explore and edit the dependency graph of any API collection — no API calls required.

### How to use
1. Navigate to **🗺️ Graph Editor** in the sidebar.
2. Select a collection from the dropdown.
3. The SVG canvas renders all steps as nodes with arrows showing dependencies.

### Interacting with the graph

| Action | How |
|---|---|
| Select a node | Click it (blue border = selected) |
| Select 2 nodes | Click first, then second (max 2 at once) |
| Reposition a node | Drag it to a new location |
| Save layout | Click **💾 Save Layout** — positions are persisted via the graph editor API |
| Add a dependency | Select 2 nodes (source → target), click **+ Add Dep** |
| Remove a dependency | Select 2 nodes, click **− Remove Dep** |
| Validate DAG | Click **✓ Validate DAG** — checks for cycles, shows topological order |

### What "Add Dep" means
Select node **A** first, then node **B**. Clicking **+ Add Dep** means "B now depends on A" — A must complete before B runs.

### Notes
- Layout is saved per collection and loaded on next visit.
- Dependency edits update the collection's `dependsOn` map via the backend — the DAG is enforced at runtime.
- The validator catches cycles before they reach the execution engine.

---

## 33. Collaboration — Revision History, Comments & Templates

The Collaboration tab (💬 Collaboration) provides version control, peer review, and workflow templates for your API collections.

### Revisions
A **revision** is a snapshot of a collection's step list at a point in time.

| Action | How |
|---|---|
| Save a revision | Select collection → click **+ Save Revision** → enter description |
| Rollback | Click **Rollback** on any revision row — creates a new revision marked `rolled-back` |
| Diff | Click **Diff** on a revision — compares it against the previous revision, shows added/removed steps and dependency changes |

### Review Comments
Comments are threaded annotations attached to a collection, step, dependency, or replay.

| Action | How |
|---|---|
| Post a comment | Type body → select target type → optionally enter target ID → click **Post** |
| Resolve a comment | Click **Resolve** on any open comment |

### Workflow Templates
Templates are pre-built scaffold definitions. **Instantiating** a template returns an advisory scaffold (step structure) that you can use as a starting point — it does not create a collection automatically.

---

## 34. Copilot — AI Guidance & Predictive Intelligence

The Copilot tab (🤖 Copilot) surfaces AI-powered workflow guidance and predictive forecasts for your collections.

> ⚠️ **Advisory only.** All results are AI-generated suggestions. Nothing is applied automatically.

### Guidance tab
Submit a natural-language-style query about your collection:

| Query Type | What it answers |
|---|---|
| `workflow-guidance` | General best-practice recommendations for the collection |
| `orchestration-recommendation` | DAG restructuring, parallelism, dependency tuning |
| `replay-debug` | Explains a failed run from replay data |
| `flakiness-investigation` | Why certain steps keep failing intermittently |
| `dependency-optimization` | Which dependencies can be removed or restructured |
| `retry-tuning` | Whether retry configuration is appropriate |
| `environment-anomaly` | Env variables or auth issues causing failures |

Results show: Severity, Title, Guidance body, Confidence %, and an Action Hint.

### Predictions tab

| Prediction | What it tells you |
|---|---|
| **🧪 Flakiness Forecast** | Per-step predicted flakiness score (0–100) with contributing factors |
| **⚡ Retry Storm Risk** | Overall storm risk (low/medium/high) and estimated retry rate |
| **SLA Breach** | Enter a metric name + current value → breach likelihood % |

### History tab
Shows all previous Copilot queries for the selected collection — queryType, number of guidance items, and timestamp.

---

## 35. Performance Dashboard

The Performance Dashboard tab (⚡ Performance) surfaces platform-level health metrics for API testing execution.

### Safeguards
Threshold checks that detect performance problems before they become failures:

| Code | What it detects |
|---|---|
| `LARGE_GRAPH_NODE_COUNT` | Collection has too many steps for efficient projection |
| `RETRY_STORM_DETECTED` | Retry rate exceeds safe threshold |
| `POLLING_OVERLOAD` | UI polling rate is too high |
| `REPLAY_EVENT_GROWTH` | Replay event store growing too fast |
| `MEMORY_PRESSURE` | Server memory approaching limits |
| `PROJECTION_CACHE_MISS_RATE` | Cache is not effective — too many misses |

### Cache Stats
Shows hit/miss/eviction counts and overall hit rate for the graph projection cache. Use **Invalidate** to evict a specific collection's cached projection (forces a fresh rebuild on next access).

### Profiling Spans
Recent execution spans with phase name, label, and duration in milliseconds — newest first. Useful for identifying slow projection, replay synthesis, or overlay build phases.

Click **↻ Refresh** to reload all three sections simultaneously.

---

## 36. Toast Notifications

All async operations in the platform now provide non-blocking toast feedback. Toasts appear in the bottom-right corner and auto-dismiss after 3.5 seconds — no need to click or acknowledge.

| Type | Colour | When it appears |
|---|---|---|
| Success | Green | Operation completed (export downloaded, plugin enabled, etc.) |
| Error | Red | Operation failed (empty dataset, request error) |
| Info | Blue | Informational message |

Toasts do not interrupt your workflow. If an export fails (e.g. you click Export CSV before any data is loaded), the error toast tells you exactly what to do next.

## 37. CSV Export

Every major data table in the API Testing section has a one-click **↓ Export CSV** button. Use this to take data out of the platform for offline analysis, audit trails, or sharing with team members who don't have platform access.

| Page | What is exported | Typical use case |
|---|---|---|
| Plugin Ecosystem | All registered plugins (name, ID, version, capabilities, status) | Audit which plugins are enabled before a release |
| Collaboration → Revisions | All loaded revisions for the selected collection (number, status, author, description, timestamp) | Save a snapshot of revision history before a rollback |
| Copilot → History | All guidance sessions for the selected collection (query type, item count, timestamp) | Review how the copilot has been used across a sprint |
| Performance → Profiling Spans | All profiling spans from the last dashboard load (phase, label, duration, start time) | Investigate performance regression after a deployment |

**How to export:**
1. Navigate to the page and load data (select a collection, or click Refresh)
2. Click **↓ Export CSV**
3. The file downloads instantly — no server round-trip

If you click Export CSV before data is loaded, you'll see an error toast explaining the next step.

## 38. Graph Editor — Zoom Controls

The Graph Editor toolbar now includes zoom controls to help you navigate large workflow DAGs:

| Control | Action |
|---|---|
| **−** | Zoom out by 20% (minimum 30%) |
| **+** | Zoom in by 20% (maximum 300%) |
| **⊡ Fit** | Reset to 100% |
| Percentage label | Shows current zoom level |

The node/edge count badge (e.g. **5 nodes · 7 edges**) appears beside the hint text and updates whenever you add or remove a dependency.

**Tip:** Zoom out to 50–60% when working with collections that have 10+ steps — it gives you a full overview of the DAG structure. Zoom resets to 100% automatically whenever you switch to a different collection.

---

*End of User Guide — v2.3 | 2026-05-22*
