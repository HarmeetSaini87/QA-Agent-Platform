# API Testing — Architecture Design & End-to-End User Journey

> **Status:** Draft  
> **Date:** 2026-05-02  
> **Related:** `API_TESTING_PLAN.md` (data model & specs), `COMPETITIVE_MARKET_ANALYSIS.md` (market research)

---

## 1. Market-Informed Design Decisions

Before defining architecture, here's what the market research tells us:

| Competitor | What They Do Well | What They Miss |
|-----------|-------------------|----------------|
| **Postman** | Collections, environments, scripting, 600K+ users | No self-healing, no UI testing, no flakiness detection, no defect filing |
| **Katalon** | Swagger/OpenAPI import, Postman import, full API+UI in one platform | Offline only (not browser-based), no self-healing for API endpoints, no visual diff for API responses |
| **Mabl** | Postman import, API integrated into E2E flows, low-code | No Swagger import, cloud-only, no pre-scan, no API response visual diff |
| **SwaggerHub** | OpenAPI-native, auto-generates tests from specs, contract testing | API-only (no UI testing), no self-healing, no locator management |
| **testRigor** | Plain English API tests ("POST to /login with body...") | No visual diff, no Swagger import, no response schema validation |
| **Hoppscotch** | Free, lightweight, multi-protocol, self-hosted | No test management, no collections runner, no self-healing, no CI/CD |

### Our Unique Position

We are the **only platform** that can do this:

```
┌─────────────────────────────────────────────────────────────────┐
│  QA Agent Platform                                               │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  IMPORT SPEC  │───▶│  API TESTS   │───▶│  SELF-HEALING    │  │
│  │  (Swagger/    │    │  WITH FULL    │    │  IF LOCATOR      │  │
│  │   Postman/    │    │  CHAINING &   │    │  BREAKS, AUTO-   │  │
│  │   cURL)       │    │  VALIDATION  │    │  HEAL & RE-RUN  │  │
│  └──────────────┘    └──────┬───────┘    └──────────────────┘  │
│                             │                                    │
│                    ┌────────▼─────────┐                           │
│                    │  LINK TO UI SUITE │                         │
│                    │  (API creates data │                        │
│                    │   → UI verifies it)│                       │
│                    └──────────────────┘                           │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  FLAKINESS    │    │  AUTO-FILE    │    │  PRE-SCAN API   │  │
│  │  DETECTION    │    │  JIRA DEFECT  │    │  (validate API  │  │
│  │  (API tests   │    │  (API failures │    │   health before  │  │
│  │   can be flaky│    │   auto-filed)  │    │   UI tests run) │  │
│  │   too)        │    │              │    │                  │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**No competitor links API test failures to self-healing, flakiness intelligence, or auto-defect filing.** This is our USP.

---

## 2. USPs (Unique Selling Propositions)

### USP-1: Self-Healing API Endpoints

When an API endpoint fails because the URL changed, the request body schema changed, or the auth token expired — the system can **auto-heal** the API request:

- URL path changed: `/v1/patients` → `/v2/patients` → auto-detect and update
- Auth token expired: auto-refresh OAuth2 token and retry
- Request body field renamed: auto-map from OpenAPI spec diff

**No competitor does this.** Postman, Katalon, and others treat API tests as static scripts that break.

### USP-2: API → UI Chaining

A single test flow can:
1. `POST /auth/login` → extract `token`
2. `POST /patients` with `token` → extract `patientId`
3. **UI Test**: Navigate to `/patients/{{patientId}}` → verify the patient name is displayed

This creates a **breathing test ecosystem** where API calls create real data that UI tests verify. No competitor links API and UI this tightly.

### USP-3: Pre-Scan API Health

Before running UI tests, the pre-scan engine can **validate API health** (ping critical endpoints, check status, validate schemas) alongside DOM locator validation. If the API is down, the UI test suite doesn't waste time running.

### USP-4: Smart AssertionError Messages

When an API assertion fails, instead of `"expected 200 got 404"`, the system provides:
- Why it failed (with JSONPath to the exact field)
- What the actual response was (pretty-printed)
- Suggested fix from OpenAPI spec (if available)
- Auto-file to Jira with full request/response

### USP-5: Swagger Import → Immediate Flakiness Baseline

When you import an OpenAPI spec and auto-generate 50+ API tests, each test gets a **flakiness baseline** from day one. The flakiness engine monitors which API endpoints are unreliable and auto-quarantines them — just like UI tests.

---

## 3. End-to-End User Journeys

### Journey A: Team Lead — Import Swagger Spec, Generate Tests, Run

```
1. Team Lead opens QA Agent Platform → "API Testing" tab

2. Clicks "Import" → chooses "OpenAPI / Swagger"

3. Uploads medflow-api.yaml (OpenAPI 3.0 spec, 52 endpoints)

4. System processes in < 30 seconds:
   - 52 ApiTestSteps created in a collection named "MedFlow API"
   - Each step has:
     • Method, URL, headers, params, body (from spec)
     • Assertions auto-generated:
       - statusCode equals 200/201/204 (from spec responses)
       - body JSONPath assertions for required fields
       - jsonSchemaValid for response schemas
   - Bearer auth detected from security schemes → auth config created
   - Servers[0].url → environment baseUrl
   - Path parameters → {{param}} variables

5. Team Lead reviews the collection:
   - "POST /v1/auth/login" → extracts {{authToken}} (auto-suggested)
   - "POST /v1/patients" → extracts {{patientId}} (auto-suggested)
   - "GET /v1/patients/{{patientId}}" → uses {{patientId}} from step above
   - Reorders steps: login first → CRUD operations → deletion last

6. Team Lead selects "QA" environment → clicks "Run Collection"

7. Execution:
   Step 1: POST /auth/login → 200 OK ✓ (authToken extracted)
   Step 2: POST /v1/patients → 201 Created ✓ (patientId extracted)
   Step 3: GET /v1/patients/{{patientId}} → 200 OK ✓
   Step 4: PUT /v1/patients/{{patientId}} → 200 OK ✓
   Step 5: DELETE /v1/patients/{{patientId}} → 204 No Content ✓
   Step 6: GET /v1/patients/{{patientId}} → 404 Not Found ✓
   ────────────────────────────────────────────
   6/6 passed • 0 failed • Duration: 2.3s

8. Team Lead links this collection to the MedFlow UI Regression Suite as "beforeAll":
   UI tests will now run AFTER API data is set up
```

### Journey B: QA Engineer — Manual API Test Creation

```
1. QA Engineer opens "API Testing" tab → "Collections" → "+ New Collection"

2. Names it "Patient Registration API"

3. Creates Step 1: "Login"
   - Method: POST
   - URL: /auth/login
   - Body (JSON):
     {
       "username": "${adminUser}",
       "password": "${adminPass}"
     }
   - Assertions:
     • statusCode equals 200
     • body.$.token exists
   - Extractions:
     • body.$.token → {{authToken}} (collection scope)

4. Creates Step 2: "Create Patient"
   - Method: POST
   - URL: /v1/patients
   - Headers: Authorization: Bearer {{authToken}}
   - Body (JSON):
     {
       "firstName": "John",
       "lastName": "Doe",
       "dateOfBirth": "1990-01-15"
     }
   - Assertions:
     • statusCode equals 201
     • body.$.data.id exists
     • body.$.data.firstName equals "John"
   - Extractions:
     • body.$.data.id → {{patientId}}

5. Creates Step 3: "Get Patient"
   - Method: GET
   - URL: /v1/patients/{{patientId}}
   - Headers: Authorization: Bearer {{authToken}}
   - Assertions:
     • statusCode equals 200

6. Clicks "Run" → sees results with pass/fail per assertion
   - Assertion "body.$.data.firstName equals 'John'" → PASSED (actual: "John")
   - Green checkmark on each passing assertion, red X on failures
```

### Journey C: Developer — cURL Import for Quick Testing

```
1. Developer copies a cURL command from browser DevTools:
   curl -X GET 'https://api.medflow.io/v1/patients?status=active' \
     -H 'Authorization: Bearer eyJhbGc...'

2. Pastes into "Import" → "cURL Command"

3. System parses instantly:
   - Method: GET
   - URL: https://api.medflow.io/v1/patients?status=active
   - Headers: Authorization: Bearer eyJhbGc...

4. Developer clicks "Run" → sees response immediately:
   - Status: 200 OK
   - Body: { "data": [...], "total": 47 }
   - Response time: 143ms
   - Headers: Content-Type: application/json, X-RateLimit: 98/100

5. Developer adds an assertion:
   - body.$.total greaterThanOrEqual 1
   - Clicks "Save" → step added to collection
```

### Journey D: CI/CD Pipeline — Unattended Collection Run

```
1. CI/CD pipeline (GitHub Actions / Jenkins / Azure DevOps) triggers on PR

2. Pipeline calls:
   POST http://qa-agent:3003/api/api-collections/col-abc123/run
   Authorization: Bearer <api-key>
   Body: { "environmentId": "env-qa-prod" }

3. System:
   a. Loads collection + environment
   b. Resolves all {{varName}} tokens against QA env secrets
   c. Runs each step sequentially, passing extracted variables forward
   d. Records results to data/api-runs/<id>.json
   e. Returns:
      {
        "id": "run-xyz",
        "collectionId": "col-abc123",
        "status": "completed",
        "totalSteps": 6,
        "passedSteps": 5,
        "failedSteps": 1,
        "stepResults": [
          { "stepId": "...", "name": "Login", "status": "passed", "duration": 245 },
          { "stepId": "...", "name": "Create Patient", "status": "passed", "duration": 312 },
          { "stepId": "...", "name": "Get Patient", "status": "failed", "duration": 102,
            "error": "Assertion failed: body.$.data.firstName equals 'John' (actual: 'Jonathan')" }
        ]
      }
   f. If any step failed AND auto-defect is enabled → Jira ticket auto-filed

4. Pipeline checks exit code → fails build if any step failed
```

### Journey E: Hybrid API + UI — Full E2E Flow

```
Suite: "MedFlow Full Smoke Test"
beforeAllApiCollection: "Patient API Smoke" (6 steps)

  ┌─────────────────────────────────────────────────────┐
  │  API Collection Run (beforeAll)                      │
  │                                                       │
  │  Step 1: POST /auth/login → {{authToken}}           │
  │  Step 2: POST /patients → {{patientId}}             │
  │  Step 3: GET /patients/{{patientId}} → 200 ✓        │
  │  Step 4: PUT /patients/{{patientId}} → 200 ✓        │
  │  Step 5: DELETE /patients/{{patientId}} → 204 ✓     │
  │  Step 6: GET /patients/{{patientId}} → 404 ✓       │
  └─────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │  UI Test Suite                                       │
  │                                                       │
  │  Script 1: "Patient Login"                           │
  │    → Uses Common Data ${adminUser}/${adminPass}      │
  │    → Self-heals if login button changes              │
  │                                                       │
  │  Script 2: "Create Patient via UI"                  │
  │    → Fills form, captures {{session.currentPtId}}    │
  │    → Uses CALL API to verify in backend              │
  │                                                       │
  │  Script 3: "Patient Search"                          │
  │    → Searches for patient created in step 1 API call  │
  │    → Self-heals if search field selector changes     │
  │                                                       │
  │  Script 4: "Patient Dashboard"                       │
  │    → Verifies patient appears in dashboard            │
  │    → Visual regression: screenshot comparison         │
  │    → Flakiness: if flaky → auto-quarantine           │
  │                                                       │
  │  If any UI test fails → auto-file Jira defect       │
  │  If self-healing kicks in → proposal queue            │
  └─────────────────────────────────────────────────────┘
```

---

## 4. UI Navigation & Wireframes

### Tab Structure

```
┌────────────────────────────────────────────────────────────────────┐
│  🏠 Home  │  📂 Projects  │  🔧 Admin  │  🧪 API Testing ▼      │
│                                                   ─────────────── │
│                                                   │ Collections   │
│                                                   │ Environments  │
│                                                   │ Import        │
│                                                   │ Run History   │
└────────────────────────────────────────────────────────────────────┘
```

### Collection List View

```
┌─────────────────────────────────────────────────────────────────────┐
│  API Testing > Collections                                         │
│                                                                     │
│  [+ New Collection]  [Import ▼]  [Filter: All ▼]                  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ 📁 MedFlow API Regression                           52 steps │   │
│  │    Environment: QA  │  Last Run: 6/6 passed  │  2 min ago │   │
│  │    Tags: regression, smoke                                   │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ 📁 Patient CRUD API                                 6 steps  │   │
│  │    Environment: UAT  │  Last Run: 5/6 passed  │  1 hr ago │   │
│  │    Tags: patient, crud                                       │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ 📁 Auth Token Refresh                               3 steps  │   │
│  │    Environment: PROD │  Last Run: 3/3 passed  │  4 hr ago │   │
│  │    Tags: auth, smoke                                          │   │
│  └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step Builder View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Patient CRUD API > Step 2: Create Patient                         │
│                                                                     │
│  ┌─ Request ──────────────────────────────────────────────────────┐ │
│  │ Method: [POST ▼]  URL: [/v1/patients        ]  [Send ▶]     │ │
│  │                                                                 │ │
│  │ ┌─ Params ─┬─ Headers ─┬─ Body ─┬─ Auth ─┬─ Pre-Script ──┐ │ │
│  │ │ key      │ value        │ enabled                         │ │ │
│  │ │ status   │ active        │ ☑                               │ │ │
│  │ │ limit    │ 50            │ ☑                               │ │ │
│  │ └─────────────────────────────────────────────────────────────┘ │ │
│  │                                                                 │ │
│  │ ┌─ Body (JSON) ──────────────────────────────────────────────┐ │ │
│  │ │  {                                                          │ │ │
│  │ │    "firstName": "John",                                     │ │ │
│  │ │    "lastName": "Doe",                                       │ │ │
│  │ │    "dateOfBirth": "1990-01-15"                              │ │ │
│  │ │  }                                                          │ │ │
│  │ └─────────────────────────────────────────────────────────────┘ │ │
│  │                                                                 │ │
│  │ ┌─ Auth ──────────────────────────────────────────────────────┐ │ │
│  │ │ Type: [Inherit from Collection ▼]                          │ │ │
│  │ │ Bearer Token: {{authToken}}                                │ │ │
│  │ └─────────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ Assertions ───────────────────────────────────────────────────┐ │
│  │ ☑ statusCode equals 201                                       │ │
│  │ ☑ body.$.data.id exists                                      │ │
│  │ ☑ body.$.data.firstName equals "John"                        │ │
│  │ ☑ responseTime lessThan 3000                                  │ │
│  │ ☐ body jsonSchemaValid {...}                                  │ │
│  │ [+ Add Assertion]                                             │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ Extractions ─────────────────────────────────────────────────┐ │
│  │ body.$.data.id → {{patientId}}  [collection ▼]               │ │
│  │ [+ Add Extraction]                                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ Response (after run) ────────────────────────────────────────┐ │
│  │ Status: 201 Created  │  Time: 312ms  │  Size: 1.2 KB         │ │
│  │                                                                 │ │
│  │ ┌─ Body ─┬─ Headers ─┬─ Assertions ─┐                         │ │
│  │ │ { "data": { "id": "pt-7842", "firstName": "John", ... } } │ │
│  │ │                                   ☑ 3/4 passed  🗸 201     │ │
│  │ │                                   ☸ body.$.data.id exists │ │
│  │ │                                   ☸ body.$.firstName eq "John"│ │
│  │ │                                   ☓ responseTime < 3000 (actual: 3210ms) │ │
│  │ └───────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Environment Editor View

```
┌─────────────────────────────────────────────────────────────────────┐
│  API Testing > Environments                                         │
│                                                                     │
│  ┌─ QA ───────────────────────────────────────────────────────────┐ │
│  │ Base URL: https://api.qa.medflow.io                            │ │
│  │                                                                 │ │
│  │ ┌─ Variables ──────────────────────────────────────────────┐  │ │
│  │ │ Key            │ Value                │ Sensitive │       │  │ │
│  │ │ adminUser      │ admin@medflow.io     │ ☐         │       │  │ │
│  │ │ adminPass      │ ••••••••••           │ ☑         │       │  │ │
│  │ │ authToken      │ (auto-extracted)     │ ☑         │       │  │ │
│  │ └───────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │ ┌─ Auth ────────────────────────────────────────────────────┐  │ │
│  │ │ Type: OAuth 2.0 [Client Credentials ▼]                   │  │ │
│  │ │ Token URL: https://auth.qa.medflow.io/oauth/token        │  │ │
│  │ │ Client ID: medflow-qa-test                                │  │ │
│  │ │ Client Secret: ••••••••••                                  │  │ │
│  │ │ Scopes: read write                                         │  │ │
│  │ │ [Test Connection ▶]                                       │  │ │
│  │ └───────────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ UAT ──────┐  ┌─ PROD ──────┐  [+ New Environment]             │
│  │ (collapsed)  │  │ (collapsed)  │                                   │
│  └─────────────┘  └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Import View

```
┌─────────────────────────────────────────────────────────────────────┐
│  API Testing > Import                                               │
│                                                                     │
│  ┌───────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │  📄 OpenAPI /     │  │  📮 Postman       │  │  ⌨️ cURL       │   │
│  │     Swagger       │  │     Collection    │  │    Command      │   │
│  └───────────────────┘  └──────────────────┘  └────────────────┘   │
│                                                                     │
│  └─ Selected: OpenAPI / Swagger ──────────────────────────────────┘ │
│                                                                     │
│  [Choose File...] medflow-api.yaml                                  │
│                                                                     │
│  ┌─ Preview ──────────────────────────────────────────────────────┐ │
│  │ OpenAPI Version: 3.0.3                                         │ │
│  │ Title: MedFlow Hospital Management API                          │ │
│  │ Servers: https://api.medflow.io                                │ │
│  │                                                                 │ │
│  │ Endpoints detected: 52                                           │ │
│  │   GET     /v1/patients                                  ✓      │ │
│  │   POST    /v1/patients                                  ✓      │ │
│  │   GET     /v1/patients/{id}                             ✓      │ │
│  │   PUT     /v1/patients/{id}                             ✓      │ │
│  │   DELETE  /v1/patients/{id}                             ✓      │ │
│  │   ... 47 more                                                   │ │
│  │                                                                 │ │
│  │ Auth detected: Bearer (http, BearerAuth)                       │ │
│  │ Schemas detected: 12 (Patient, Appointment, etc.)                │ │
│  │                                                                 │ │
│  │ Import Options:                                                  │ │
│  │   ☑ Generate assertions from response schemas                   │ │
│  │   ☑ Generate assertions from required fields                   │ │
│  │   ☑ Generate status code assertions (200, 201, 204, 404)       │ │
│  │   ☑ Auto-suggest variable extractions (id, token)              │ │
│  │   ☑ Chain steps: login → CRUD operations → delete               │ │
│  │   Collection name: [MedFlow API                     ]          │ │
│  │   Environment:      [QA ▼]                                    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [Import 52 Endpoints → Create Collection]                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Run Results View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Run #run-xyz • MedFlow API • QA • 2026-05-02 14:32              │
│                                                                     │
│  ┌─ Summary ─────────────────────────────────────────────────────┐ │
│  │ 6 Steps  │  ✓ 5 Passed  │  ✗ 1 Failed  │  ⏱ 2.3s            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ Step Results ──────────────────────────────────────────────────┐ │
│  │                                                                 │ │
│  │ ✓ Step 1: POST /auth/login                    200  245ms       │ │
│  │   Assertions: 1/1 passed                                       │ │
│  │   → {{authToken}} extracted (eyJhbG...)                        │ │
│  │                                                                 │ │
│  │ ✓ Step 2: POST /v1/patients                   201  312ms       │ │
│  │   Assertions: 3/3 passed                                       │ │
│  │   → {{patientId}} extracted (pt-7842)                           │ │
│  │                                                                 │ │
│  │ ✗ Step 3: GET /v1/patients/pt-7842            200  3210ms      │ │
│  │   Assertions: 3/4 passed                                       │ │
│  │   ✗ responseTime lessThan 3000 (actual: 3210ms)               │ │
│  │   ☸ statusCode equals 200 ✓                                    │ │
│  │   ☸ body.$.data.id exists ✓                                   │ │
│  │   ☸ body.$.data.firstName equals "John" ✓                      │ │
│  │   [File Defect ▶]  [Add to Flaky ▶]                          │ │
│  │                                                                 │ │
│  │ ✓ Step 4: PUT /v1/patients/pt-7842            200  189ms      │ │
│  │   Assertions: 3/3 passed                                       │ │
│  │                                                                 │ │
│  │ ✓ Step 5: DELETE /v1/patients/pt-7842          204  98ms      │ │
│  │   Assertions: 1/1 passed                                       │ │
│  │                                                                 │ │
│  │ ✓ Step 6: GET /v1/patients/pt-7842 (deleted)  404  87ms      │ │
│  │   Assertions: 1/1 passed                                       │ │
│  │                                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [Re-Run]  [Link to UI Suite ▶]  [Export Results]                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Architecture Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND                     │
│  23-api-tests.js │ 24-api-collections.js │ 25-api-envs.js        │
│  (Step builder)   (Collection manager)     (Env + auth editor)     │
├─────────────────────────────────────────────────────────────────────┤
│                         ROUTES                                      │
│  api.routes.ts                                                      │
│  ├── /api/api-envs/*        (CRUD environments)                    │
│  ├── /api/api-collections/* (CRUD + run collections)               │
│  ├── /api/api-import/*      (OpenAPI, Postman, cURL)               │
│  ├── /api/api-auth/*        (Token test, OAuth2 refresh)           │
│  └── /api/api-runs/*        (Run results)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                         ENGINE                                      │
│                                                                      │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐      │
│  │ apiRunner    │  │ apiAssertions   │  │ apiVariables       │      │
│  │ (execute    │  │ (evaluate       │  │ (resolve {{var}}   │      │
│  │  steps,     │  │  statusCode,   │  │  from env +       │      │
│  │  chain)     │  │  header, body, │  │  collection +     │      │
│  │             │  │  time, schema) │  │  extracted)        │      │
│  └──────────────┘  └────────────────┘  └────────────────────┘      │
│                                                                      │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐      │
│  │ openapiImport│  │ postmanImport  │  │ curlImport         │      │
│  │ (parse 3.x, │  │ (parse v2.1,  │  │ (parse cURL        │      │
│  │  2.0 YAML/  │  │  v3.0 → step  │  │  string → single   │      │
│  │  JSON →     │  │  + assertion  │  │  step)              │      │
│  │  collection)│  │  + extract)    │  │                     │      │
│  └──────────────┘  └────────────────┘  └────────────────────┘      │
│                                                                      │
│  ┌──────────────┐  ┌────────────────┐                               │
│  │ apiAuth      │  │ healingBridge  │                               │
│  │ (Bearer,    │  │ (link API step │                               │
│  │  API key,   │  │  failures to   │                               │
│  │  Basic,     │  │  self-healing  │                               │
│  │  OAuth2)    │  │  + flakiness)   │                               │
│  └──────────────┘  └────────────────┘                               │
├─────────────────────────────────────────────────────────────────────┤
│                         DATA                                        │
│  data/api-envs.json          (environments)                         │
│  data/api-collections.json   (collections + steps)                │
│  data/api-runs/<id>.json    (run results)                         │
│                                                                      │
│  Uses existing:                                                      │
│  data/locators.json  (shared locator repo)                         │
│  data/common-data.json (encrypted env vars — can be linked)        │
├─────────────────────────────────────────────────────────────────────┤
│                     INTEGRATION                                      │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ Flakiness Engine │  │ Auto-Defect Filer │  │ Jira Client    │   │
│  │ (API tests get   │  │ (API failures     │  │ (file defects  │   │
│  │  flakiness score)│  │  auto-filed)      │  │  for API fails)│   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │ Suite Runner      │  │ Scheduler        │                        │
│  │ (link API coll   │  │ (cron API coll   │                        │
│  │  to UI suite     │  │  runs)            │                        │
│  │  beforeAll)      │  │                   │                        │
│  └──────────────────┘  └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Self-Healing for API Tests (USP-1)

### Problem

API endpoints break too:
- URL paths change: `/v1/patients` → `/v2/patients`
- Response schemas change: `firstName` → `givenName`
- Auth flows change: Bearer token → API key in header
- Status codes change: 200 → 202 for async operations

### Solution: Three-Tier API Self-Healing

```
┌─────────────────────────────────────────────────────────────┐
│  API Self-Healing Tiers                                     │
│                                                              │
│  T1: PRIMARY ASSERTION WEIGHT                               │
│  ────────────────────────────────                             │
│  Each assertion has a weight (importance):                   │
│  • statusCode: weight 10 (most important)                   │
│  • body required field: weight 8                            │
│  • body optional field: weight 4                            │
│  • header: weight 3                                         │
│  • responseTime: weight 2                                   │
│  • size: weight 1                                           │
│                                                              │
│  If statusCode assertion fails but body assertions pass,      │
│  the test is "degraded but not failed" → not auto-quarantined│
│                                                              │
│  T2: RESPONSE SCHEMA DRIFT DETECTION                        │
│  ──────────────────────────────────────                       │
│  When a response body has new/removed/renamed fields:        │
│  • New field: auto-add assertion "exists" (weight 4)       │
│  • Removed field: flag but don't fail (weight 4 → degrade)  │
│  • Renamed field: suggest rename mapping (weight 8)         │
│                                                              │
│  T3: AUTH AUTO-RETRY                                        │
│  ──────────────────────                                       │
│  If auth fails (401):                                        │
│  • Oauth2 → auto-refresh token, retry once                 │
│  • Bearer → check if token expired, re-acquire, retry      │
│  • If still fails → fail step, auto-file defect            │
│                                                              │
│  T4: URL PATH HEALING                                        │
│  ──────────────────────                                       │
│  If 404 on a URL path:                                       │
│  • Compare against OpenAPI spec: is there a newer path?      │
│  • Suggest URL update: /v1/patients → /v2/patients         │
│  • Auto-apply if OpenAPI spec confidence > 80%             │
│  • Pending review if 50-80%                                 │
│  • Fail if < 50%                                            │
│  (USES THE SAME HEALING ENGINE AS LOCATOR SELF-HEALING!)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Flakiness Intelligence for API Tests (USP-5)

API tests can be flaky too:
- Network timeouts
- Rate limiting (429)
- Dependency ordering (database not yet written)
- External service unavailability

**Our flakiness engine extends naturally to API collections:**

```
ApiCollectionRunResult {
  ...
  // Added by flakiness engine:
  flakeScore: 0-1        // based on failure pattern across runs
  failureType: 'network' | 'rate_limit' | 'dependency' | 'assertion' | 'auth'
  autoQuarantine: boolean // if flakeScore > threshold (default 0.30)
  selfRestore: boolean     // auto-promotes when stable
}
```

A `GET /v1/reports` that fails 4/10 runs with 429 rate limiting → auto-quarantined → self-restores after 5 consecutive passes.

---

## 8. Auto-Defect Filing for API Failures (USP cont.)

When an API assertion fails:

```
Jira Ticket Auto-Generated:
┌───────────────────────────────────────────────────────┐
│ Title: [API] GET /v1/patients/{id} — responseTime exceeded  │
│                                                         │
│ Environment: QA                                         │
│ Collection: Patient CRUD API                            │
│ Step: 3 / 6                                             │
│ Priority: Medium                                        │
│                                                         │
│ Request:                                                │
│   GET https://api.qa.medflow.io/v1/patients/pt-7842  │
│   Headers: Authorization: Bearer eyJhbG...             │
│                                                         │
│ Expected: responseTime < 3000ms                         │
│ Actual: 3210ms                                          │
│                                                         │
│ Response:                                               │
│   Status: 200 OK                                        │
│   Body: { "data": { "id": "pt-7842", ... } }         │
│                                                         │
│ Screenshot: (API tests attach response body dump)       │
│ Run Link: /execution-report?run=run-xyz                 │
└───────────────────────────────────────────────────────┘
```

**No competitor auto-files Jira defects from API test failures with full request/response context.** This is a USP.

---

## 9. Pre-Scan API Health (USP-3)

```
Existing Pre-Scan (UI Locators):
  Navigate to page → __qaDomScan() → score all locators → health report

New Pre-Scan (API Endpoints):
  Ping all API endpoints → check status, schema, response time → health report
```

The Pre-Scan page gains an "API Health" tab:

```
┌──────────────────────────────────────────────────────────────────┐
│  Pre-Scan Results                                                │
│                                                                    │
│  [DOM Locators]  [API Endpoints]                                │
│                                                                    │
│  ┌─ API Health ───────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  Endpoint                              Status  Time  Score  │   │
│  │  ──────────────────────────────────── ────── ───── ────── │   │
│  │  GET  /v1/auth/login                 200     142ms  ✓ 98  │   │
│  │  POST /v1/patients                    201     267ms  ✓ 95  │   │
│  │  GET  /v1/patients/{id}               200     189ms  ✓ 97  │   │
│  │  GET  /v1/patients?status=active       200     3210ms ⚠ 72 │   │
│  │  PUT  /v1/patients/{id}               200     198ms  ✓ 96  │   │
│  │  DELETE /v1/patients/{id}              204     92ms   ✓ 99  │   │
│  │  GET  /v1/reports                     503     5000ms ✗  0   │   │
│  │  ──────────────────────────────────── ────── ───── ────── │   │
│  │                                                              │   │
│  │  Score calculation:                                         │   │
│  │  200-299 = 100 base, -10 per 100ms over 500ms             │   │
│  │  300-399 = 50 base                                        │   │
│  │  400-499 = 20 base                                        │   │
│  │  500+ = 0 base                                             │   │
│  │  Schema validation: -10 per missing required field           │   │
│  │                                                              │   │
│  │  ⚠ /v1/reports is DOWN (503) → recommend skipping        │   │
│  │     dependent UI tests                                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 10. Data Flow: End-to-End

```
USER ACTION                          SYSTEM RESPONSE
─────────────                        ─────────────────
1. Upload openapi.yaml               → openapiImport.ts parses
                                      → Creates ApiCollection (52 steps)
                                      → Creates ApiEnvironment (baseUrl from servers)
                                      → Creates ApiAuthConfig (from security schemes)
                                      → Auto-generates assertions per endpoint
                                      → Auto-suggests variable extractions

2. Select QA Environment             → Loads variables: ${adminUser}, ${adminPass}, etc.
   → Variables resolved against env

3. Click "Run Collection"            → apiRunner.ts:
                                      a. Resolves all {{varName}} tokens
                                      b. Acquires auth token (if OAuth2)
                                      c. Executes step 1: POST /auth/login
                                      d. Captures response
                                      e. Evaluates assertions → pass/fail
                                      f. Extracts variables → {{authToken}}
                                      g. Passes variables to step 2
                                      h. ... continues for each step
                                      i. Writes ApiCollectionRunResult
                                      j. Broadcasts via WebSocket

4. View Results                      → UI shows step-by-step pass/fail
                                      → Each assertion highlighted green/red
                                      → Response body + headers visible
                                      → Failed assertion: [File Defect] button

5. Link to UI Suite                  → Suite.beforeAllApiCollectionId = "col-abc123"
                                      → Before UI tests run, API collection runs first
                                      → Extracted variables available as Common Data

6. Fail API assertion                → Auto-file Jira defect (if enabled)
                                      → Add to flakiness tracker
                                      → Self-healing attempt (if URL path changed)
```

---

## 11. Security Considerations

| Concern | Solution |
|---------|----------|
| **Encrypted at rest** | Environment auth tokens and sensitive variables stored AES-256-GCM (same as Common Data) |
| **Masked in UI** | Sensitive values shown as `••••••••` in all API responses and UI |
| **API key access** | API collections can be triggered via API key (`Authorization: Bearer <key>`) for CI/CD |
| **No plain-text in URLs** | Tokens never appear in query strings; always in headers or body |
| **Audit trail** | All collection runs, imports, and auth tests are audit-logged |
| **Environment isolation** | QA variables cannot leak into PROD; environments are project-scoped |

---

## 12. Competitive Comparison — What Makes Us Different

| What | Postman | Katalon | SwaggerHub | Our Platform |
|------|---------|---------|------------|-------------|
| Self-healing UI locators | ❌ | ✅ (AI) | ❌ | ✅ (9-dim weighted) |
| Self-healing API endpoints | ❌ | ❌ | ❌ | ✅ (USP-1: URL drift, auth refresh) |
| API + UI in same flow | Plugins only | ✅ | ❌ | ✅ (linked beforeAll API collection) |
| Flakiness detection for API | ❌ | ❌ | ❌ | ✅ (USP-5: API flake scores) |
| Auto-file Jira from API failure | ❌ | ✅ (Bug Reporter) | ❌ | ✅ (duplicate detection, priority inference) |
| Swagger/OpenAPI import | ✅ | ✅ | ✅ (core) | ✅ |
| Postman import | ✅ (native) | ✅ | ❌ | ✅ |
| cURL import | ✅ | ❌ | ❌ | ✅ |
| Bearer/OAuth/API-key auth | ✅ | ✅ | ✅ | ✅ |
| JSON Schema validation | ✅ (scripts) | ✅ | ✅ (core) | ✅ (built-in assertion) |
| JSONPath assertions | ✅ (scripts) | ✅ | ❌ | ✅ (built-in assertion) |
| API response visual diff | ❌ | ❌ | ❌ | ✅ (USP: compare API responses visually) |
| Pre-scan API health | ❌ | ❌ | Contract testing | ✅ (USP-3: before UI suite runs) |

---

*End of API Testing Architecture Design*