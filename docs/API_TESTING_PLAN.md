# API Testing Feature — Plan & Specification

> **Status:** Draft  
> **Date:** 2026-05-02  
> **Priority:** P0 — #1 competitive gap  
> **Target:** v2.0 milestone

---

## 1. Problem Statement

Our platform has 6 API-related keywords (CALL API, MOCK RESPONSE, GET NETWORK RESPONSE, ASSERT RESPONSE OK, WAIT RESPONSE, EVALUATE) bolted onto UI test scripts. This is **not** a dedicated API testing solution. Competitors (Katalon, Postman, mabl, SwaggerHub) offer full API testing modules with Swagger/OpenAPI import, response validation, auth management, API chaining, and collections.

Teams consuming APIs need to:
1. Import an OpenAPI/Swagger spec and get 50-200+ tests instantly
2. Chain requests: `POST /login → extract token → GET /patients?token=...`
3. Validate response bodies, headers, and status codes per endpoint
4. Manage auth (Bearer tokens, API keys, OAuth) across environments
5. Run API test collections separately from UI test suites

---

## 2. Goals

| Goal | Metric |
|------|--------|
| Import OpenAPI 3.x spec → auto-generate API test collection | < 30 seconds for a 50-endpoint spec |
| Full response validation (body, headers, status, schema) | 100% coverage of response assertions |
| API chaining with variable extraction | Pass any field from response N to request N+1 |
| Auth management (Bearer, API key, Basic, OAuth 2.0) | 4 auth types at launch |
| Environment-scoped base URLs + variables | DEV/QA/UAT/PROD switching with zero changes |
| Run API collections independently or as part of a UI suite | Both modes supported |
| Postman collection import | v2.1 and v3.0 |

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Frontend (UI)                      │
│  api-tests.js  │  api-collections.js  │  api-env.js │
├──────────────────────────────────────────────────────┤
│                    API Routes                         │
│  api-test.routes.ts  │  api-collection.routes.ts     │
├──────────────────────────────────────────────────────┤
│                    Engine Layer                       │
│  apiRunner.ts │ openapiImport.ts │ postmanImport.ts │
│  apiAssertions.ts │ apiAuth.ts    │ apiVariables.ts  │
├──────────────────────────────────────────────────────┤
│                    Data Layer                         │
│  data/api-tests.json  │  data/api-collections.json   │
│  data/api-environments.json                           │
└──────────────────────────────────────────────────────┘
```

**Key principle:** API tests are a **first-class citizen**, not keywords inside UI scripts. They have their own data model, UI, routes, and runner — but can be **linked** to UI suites.

---

## 4. Data Model

### 4.1 ApiEnvironment

```typescript
interface ApiEnvironment {
  id:          string;
  projectId:   string;
  name:        string;           // "QA", "UAT", "PROD"
  baseUrl:     string;           // "https://api.medflow.io"
  variables:   ApiVariable[];   // key-value pairs scoped to this environment
  auth:        ApiAuthConfig;   // default auth for all requests
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

interface ApiVariable {
  key:        string;
  value:      string;
  sensitive:  boolean;   // if true, stored encrypted, masked in UI
}

type ApiAuthType = 'none' | 'bearer' | 'apikey' | 'basic' | 'oauth2';

interface ApiAuthConfig {
  type:       ApiAuthType;
  // Bearer
  token?:     string;          // or {{varName}} reference
  // API Key
  headerName?: string;         // "X-API-Key", "Authorization"
  headerValue?: string;
  // Basic
  username?:  string;
  password?:  string;
  // OAuth2
  grantType?: 'client_credentials' | 'password' | 'authorization_code';
  tokenUrl?:  string;
  clientId?:  string;
  clientSecret?: string;
  scopes?:    string;
}
```

### 4.2 ApiRequest

```typescript
interface ApiRequest {
  id:            string;
  name:          string;              // "Create Patient"
  method:        'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url:           string;              // "/v1/patients" (relative to env baseUrl) or absolute
  headers:       ApiHeader[];         // [{ key: "Content-Type", value: "application/json" }]
  params:        ApiParam[];          // query parameters
  pathParams:    ApiParam[];           // /patients/{{patientId}}/records
  bodyType:      'none' | 'json' | 'form-data' | 'urlencoded' | 'xml' | 'raw' | 'graphql';
  body:          string | null;        // raw body content (JSON string, XML, etc.)
  formData:      ApiFormDataEntry[];   // for form-data body type
  auth:          ApiAuthConfig | 'inherit' | 'none';  // 'inherit' = use collection/env auth
  preScript:    string | null;         // JavaScript pre-request script (optional)
  postScript:   string | null;         // JavaScript post-response script (optional)
  description:  string;
}

interface ApiHeader {
  key:    string;
  value:  string;
  enabled: boolean;
}

interface ApiParam {
  key:    string;
  value:  string;
  enabled: boolean;
}

interface ApiFormDataEntry {
  key:      string;
  value:    string;
  type:     'text' | 'file';
  enabled:  boolean;
}
```

### 4.3 ApiResponse (execution result, not stored)

```typescript
interface ApiResponse {
  statusCode:    number;
  statusText:   string;
  headers:       Record<string, string>;
  body:          any;              // parsed JSON or raw string
  rawBody:       string;           // unparsed body text
  responseTime:  number;           // ms
  size:          number;           // bytes
}
```

### 4.4 ApiAssertion

```typescript
type ApiAssertionSource = 'statusCode' | 'header' | 'body' | 'responseTime' | 'size';
type ApiAssertionOperator =
  | 'equals'           | 'notEquals'
  | 'contains'        | 'notContains'
  | 'startsWith'       | 'endsWith'
  | 'matchesRegex'
  | 'lessThan'         | 'greaterThan'
  | 'lessThanOrEqual'  | 'greaterThanOrEqual'
  | 'exists'           | 'notExists'
  | 'isEmpty'          | 'isNotEmpty'
  | 'isType'           // string, number, boolean, array, object, null
  | 'jsonSchemaValid';

interface ApiAssertion {
  id:         string;
  source:     ApiAssertionSource;
  // For 'header': header name. For 'body': JSONPath expression. For 'statusCode'/'responseTime'/'size': not needed.
  path:       string;
  operator:   ApiAssertionOperator;
  expected:   string;          // expected value (string; will be type-coerced)
  enabled:    boolean;
}
```

### 4.5 ApiVariableExtraction

```typescript
interface ApiVariableExtraction {
  id:       string;
  source:   'body' | 'header' | 'statusCode' | 'responseTime';
  path:     string;           // JSONPath for body, header name for header
  variable: string;           // name to store (e.g., "authToken", "patientId")
  scope:    'request' | 'collection';  // request = next step only, collection = shared across collection
}
```

### 4.6 ApiTestStep

```typescript
interface ApiTestStep {
  id:               string;
  order:            number;
  request:          ApiRequest;
  assertions:       ApiAssertion[];
  extractions:      ApiVariableExtraction[];
  retryCount:       number;          // 0-3: retry on failure
  retryDelay:       number;          // ms between retries (default 1000)
}
```

### 4.7 ApiCollection

```typescript
interface ApiCollection {
  id:            string;
  projectId:     string;
  name:          string;              // "Patient API Regression"
  description:   string;
  environmentId: string | null;       // selected environment for runs
  auth:          ApiAuthConfig | 'none';  // collection-level default auth
  steps:         ApiTestStep[];       // ordered list of request steps
  variables:     ApiVariable[];       // collection-level variables
  tags:          string[];
  createdBy:     string;
  createdAt:     string;
  updatedAt:     string;
}
```

### 4.8 ApiCollectionRunResult

```typescript
interface ApiCollectionRunResult {
  id:              string;
  collectionId:    string;
  environmentId:   string;
  startedAt:       string;
  completedAt:      string | null;
  status:          'running' | 'completed' | 'failed' | 'cancelled';
  totalSteps:      number;
  passedSteps:     number;
  failedSteps:     number;
  skippedSteps:    number;
  stepResults:     ApiStepResult[];
  triggeredBy:     string;           // username or 'api-key:<prefix>'
  triggeredVia:    'ui' | 'api' | 'scheduler' | 'suite-link';
}

interface ApiStepResult {
  stepId:              string;
  stepName:            string;
  request:             ApiRequest;
  response:            ApiResponse;
  assertionResults:    ApiAssertionResult[];
  extractedVariables:  Record<string, any>;
  status:              'passed' | 'failed' | 'skipped';
  duration:            number;           // ms
  error:               string | null;
  retried:             boolean;
  retryCount:          number;
}

interface ApiAssertionResult {
  assertionId: string;
  source:      ApiAssertionSource;
  path:        string;
  operator:    ApiAssertionOperator;
  expected:    string;
  actual:      string;
  passed:      boolean;
  message:     string;
}
```

---

## 5. API Routes

### 5.1 Environment Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/api-envs` | requireAuth | List environments for a project |
| POST | `/api/api-envs` | requireEditor | Create environment |
| PUT | `/api/api-envs/:id` | requireEditor | Update environment |
| DELETE | `/api/api-envs/:id` | requireEditor | Delete environment |
| POST | `/api/api-envs/:id/resolve` | requireAuth | Resolve all `{{varName}}` tokens in a request for a given environment |

### 5.2 Collection Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/api-collections` | requireAuth | List collections (filter by projectId) |
| GET | `/api/api-collections/:id` | requireAuth | Get collection with steps, assertions, extractions |
| POST | `/api/api-collections` | requireEditor | Create collection |
| PUT | `/api/api-collections/:id` | requireEditor | Update collection |
| DELETE | `/api/api-collections/:id` | requireEditor | Delete collection |
| POST | `/api/api-collections/:id/duplicate` | requireEditor | Duplicate collection |
| PATCH | `/api/api-collections/:id/steps/reorder` | requireEditor | Reorder steps |

### 5.3 Step Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/api-collections/:id/steps` | requireEditor | Add step to collection |
| PUT | `/api/api-collections/:id/steps/:stepId` | requireEditor | Update step |
| DELETE | `/api/api-collections/:id/steps/:stepId` | requireEditor | Delete step |

### 5.4 Import

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/api-import/openapi` | requireEditor | Import OpenAPI 3.0/3.1 spec (JSON or YAML) → create collection |
| POST | `/api/api-import/postman` | requireEditor | Import Postman collection v2.1/v3.0 → create collection |
| POST | `/api/api-import/curl` | requireEditor | Import cURL command → create single step |

### 5.5 Execution

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/api-collections/:id/run` | requireAuthOrApiKey | Run entire collection |
| POST | `/api/api-collections/:id/steps/:stepId/run` | requireAuth | Run single step (with variable context) |
| GET | `/api/api-runs` | requireAuth | List run results (filter by collectionId) |
| GET | `/api/api-runs/:id` | requireAuth | Get run result with step details |
| DELETE | `/api/api-runs/:id` | requireEditor | Delete run result |

### 5.6 Auth Helpers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/api-auth/test` | requireAuth | Test auth config → returns token/headers |
| POST | `/api/api-auth/oauth2-token` | requireAuth | Obtain OAuth2 token using client_credentials flow |

---

## 6. Import Specifications

### 6.1 OpenAPI / Swagger Import

**Input:** OpenAPI 3.0.x or 3.1.x document (JSON or YAML), or Swagger 2.0

**Processing:**

```
For each path in the spec:
  For each method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS):
    Create ApiTestStep:
      - name = operationId or "{method} {path}"
      - method = HTTP method
      - url = servers[0].url + path (path params as {{paramName}})
      - headers = from parameters with in: "header"
      - params = from parameters with in: "query"
      - pathParams = from parameters with in: "path"
      - body = from requestBody content (application/json schema → example)
      - assertions = generate from responses:
          • statusCode equals {status code} for each 2xx response
          • header "Content-Type" contains "json" (if response mime includes json)
          • jsonSchemaValid for each response schema (if provided)
      - extractions = suggest from common patterns:
          • If response has "id" → extract to {{resourceId}}
          • If response has "token" or "access_token" → extract to {{authToken}}
```

**Example:** A 50-endpoint Swagger spec produces a collection with 50+ steps, each with pre-populated URL, method, params, and assertions.

### 6.2 Postman Collection Import

**Input:** Postman Collection JSON v2.1 or v3.0

**Processing:**

```
For each item in the collection:
  Create ApiTestStep:
    - name = item.name
    - method = item.request.method
    - url = item.request.url.raw (resolve host + path)
    - headers = item.request.header[] (key, value, disabled)
    - params = item.request.url.query[] (key, value, disabled)
    - body = item.request.body.mode → raw/multipart/formdata/urlencoded
    - auth = item.request.auth or inherit from collection-level auth
    - assertions = convert item.event[] with "test" scripts:
        • pm.response.to.have.status(200) → statusCode equals 200
        • pm.response.json().id → extract to {{id}}
        • json-sidebar assertions → ApiAssertion objects
```

### 6.3 cURL Import

**Input:** cURL command string (e.g., `curl -X POST https://api.example.com/v1/patients -H "Content-Type: application/json" -d '{"name":"John"}'`)

**Processing:** Parse into a single `ApiTestStep` with method, URL, headers, and body extracted.

---

## 7. Assertion Examples

```typescript
// Status code assertion
{ source: 'statusCode', path: '', operator: 'equals', expected: '200' }

// Response time assertion
{ source: 'responseTime', path: '', operator: 'lessThan', expected: '2000' }

// Header assertion
{ source: 'header', path: 'Content-Type', operator: 'contains', expected: 'application/json' }

// Body JSONPath assertion — exact value
{ source: 'body', path: '$.status', operator: 'equals', expected: 'active' }

// Body JSONPath assertion — contains
{ source: 'body', path: '$.message', operator: 'contains', expected: 'Patient created' }

// Body JSONPath assertion — array length
{ source: 'body', path: '$.patients.length', operator: 'lessThanOrEqual', expected: '50' }

// Body JSONPath assertion — nested object
{ source: 'body', path: '$.data.patient.id', operator: 'exists', expected: '' }

// Body JSONPath assertion — type check
{ source: 'body', path: '$.data.patient.age', operator: 'isType', expected: 'number' }

// JSON Schema validation
{ source: 'body', path: '', operator: 'jsonSchemaValid', expected: '{"type":"object","required":["id","name"]}' }

// Response size assertion
{ source: 'size', path: '', operator: 'lessThan', expected: '10240' }

// Set-Cookie header is present
{ source: 'header', path: 'Set-Cookie', operator: 'exists', expected: '' }
```

---

## 8. Variable Extraction Examples

```typescript
// Extract Bearer token from login response
{ source: 'body', path: '$.access_token', variable: 'authToken', scope: 'collection' }

// Extract patient ID from POST response
{ source: 'body', path: '$.data.id', variable: 'patientId', scope: 'collection' }

// Extract location header from 201 response
{ source: 'header', path: 'Location', variable: 'newResourceUrl', scope: 'collection' }

// Extract response time for logging
{ source: 'responseTime', path: '', variable: 'loginResponseTime', scope: 'request' }

// Extract status code for conditional logic
{ source: 'statusCode', path: '', variable: 'loginStatus', scope: 'request' }
```

Extracted variables are available in subsequent steps as `{{authToken}}`, `{{patientId}}`, etc.

---

## 9. API Chaining — End-to-End Example

```
Collection: "Patient API E2E"
Environment: QA (baseUrl: https://api.qa.medflow.io)

Step 1: LOGIN
  POST /auth/login
  Body: { "username": "${adminUser}", "password": "${adminPass}" }
  Assertions:
    - statusCode equals 200
    - body.$.token exists
  Extractions:
    - body.$.token → {{authToken}} (collection scope)

Step 2: CREATE PATIENT
  POST /v1/patients
  Headers: Authorization: Bearer {{authToken}}
  Body: { "firstName": "John", "lastName": "Doe", "dob": "1990-01-15" }
  Assertions:
    - statusCode equals 201
    - body.$.data.id exists
    - body.$.data.firstName equals "John"
  Extractions:
    - body.$.data.id → {{patientId}} (collection scope)

Step 3: GET PATIENT
  GET /v1/patients/{{patientId}}
  Headers: Authorization: Bearer {{authToken}}
  Assertions:
    - statusCode equals 200
    - body.$.data.id equals {{patientId}}
    - body.$.data.firstName equals "John"
  Extractions: (none)

Step 4: UPDATE PATIENT
  PUT /v1/patients/{{patientId}}
  Headers: Authorization: Bearer {{authToken}}
  Body: { "firstName": "Jane" }
  Assertions:
    - statusCode equals 200
    - body.$.data.firstName equals "Jane"

Step 5: DELETE PATIENT
  DELETE /v1/patients/{{patientId}}
  Headers: Authorization: Bearer {{authToken}}
  Assertions:
    - statusCode equals 204

Step 6: VERIFY DELETION
  GET /v1/patients/{{patientId}}
  Headers: Authorization: Bearer {{authToken}}
  Assertions:
    - statusCode equals 404
```

---

## 10. Collection Execution Flow

```
User clicks "Run Collection" (or CI/CD triggers via API key)
    │
    ▼
Load ApiCollection + ApiEnvironment
    │
    ▼
Resolve variables: {{varName}} → values from environment + collection
    │
    ▼
For each step in order:
    │
    ├─ Resolve {{varName}} in URL, headers, body, params
    ├─ Pre-request script (if any) → can set variables
    ├─ Execute HTTP request
    ├─ Capture response (status, headers, body, time)
    ├─ Run assertions → pass/fail each
    ├─ Run extractions → store {{variable}} values
    ├─ Post-response script (if any) → can set variables, log
    ├─ Record ApiStepResult
    │
    ▼ (next step, with updated variable context)
    │
    After all steps:
    ├─ Write ApiCollectionRunResult to data/api-runs/<id>.json
    ├─ Broadcast via WebSocket for real-time UI updates
    ├─ If linked to a UI suite: attach results to suite run
    └─ Return run result
```

---

## 11. Suite Linkage

API collections can be linked to UI test suites in two ways:

**Option A: Pre-run API Setup**
- Suite has `beforeAllApiCollectionId` — runs the API collection before UI scripts
- Use case: Create test data via API, then run UI tests against that data

**Option B: Embedded API Steps in UI Scripts**
- Existing `CALL API` keyword gains full power: references an `ApiRequest` by ID
- Use case: API call within a UI test step (e.g., "reset data via API before this step")

**Option C: Independent API Suite**
- A collection can run as a standalone suite with its own schedule
- Use case: Nightly API regression suite

---

## 12. UI Modules

| Module | File | Description |
|--------|------|-------------|
| `23-api-tests.js` | New | API test step builder, assertion editor, variable extraction UI |
| `24-api-collections.js` | New | Collection manager, reordering, run results viewer |
| `25-api-envs.js` | New | Environment management, variable editor, auth config |
| `06-locators.js` | Modify | Add "API" tab alongside Locators, Proposals, Health |
| `10-suites.js` | Modify | Add `beforeAllApiCollectionId` field |
| `11-execution.js` | Modify | Show API collection run results inline with UI run results |

---

## 13. Engine Files

| File | Purpose |
|------|---------|
| `src/utils/apiRunner.ts` | Execute API collections: resolve variables, run steps sequentially, capture responses, evaluate assertions, extract variables |
| `src/utils/apiAssertions.ts` | Evaluate assertion operators against ApiResponse (statusCode, headers, body JSONPath, responseTime, size, jsonSchemaValid) |
| `src/utils/openapiImport.ts` | Parse OpenAPI 3.0/3.1/2.0 JSON/YAML → ApiCollection |
| `src/utils/postmanImport.ts` | Parse Postman Collection v2.1/v3.0 → ApiCollection |
| `src/utils/curlImport.ts` | Parse cURL command string → ApiRequest |
| `src/utils/apiAuth.ts` | Auth token resolution: Bearer, API key, Basic, OAuth2 client_credentials |
| `src/utils/apiVariables.ts` | Variable resolution engine: `{{varName}}` template substitution with environment + collection + extracted layers |
| `src/data/types.ts` | Add ApiEnvironment, ApiRequest, ApiAssertion, ApiVariableExtraction, ApiTestStep, ApiCollection, ApiCollectionRunResult, ApiStepResult, ApiAssertionResult |
| `src/data/store.ts` | Add API_TESTS, API_COLLECTIONS, API_ENVIRONMENTS, API_RUNS collections |
| `src/ui/routes/api.routes.ts` | New — all API testing routes |
| `src/ui/server.ts` | Register api routes |

---

## 14. JSONPath Evaluation

For body assertions and variable extraction, we need a JSONPath engine.

**Recommended:** `jsonpath-plus` (MIT, ~30KB, zero dependencies, full JSONPath spec support)

```typescript
import { jp } from 'jsonpath-plus';
const value = jp({ path: '$.data.patient.id', json: responseBody });
```

---

## 15. JSON Schema Validation

For `jsonSchemaValid` assertions:

**Recommended:** `ajv` (MIT, widely used, JSON Schema draft-04/06/07/2020-12 support)

```typescript
import Ajv from 'ajv';
const ajv = new Ajv();
const valid = ajv.validate(schema, responseBody);
```

---

## 16. New Dependencies

| Package | Purpose | Size |
|----------|---------|------|
| `jsonpath-plus` | JSONPath evaluation for assertions & extraction | ~30KB |
| `ajv` | JSON Schema validation | ~80KB |
| `js-yaml` | Parse YAML OpenAPI specs (already used in codebase) | ~18KB |
| `openapi-types` | TypeScript types for OpenAPI 3.x | ~20KB (dev only) |

---

## 17. Storage

| File | Content |
|------|---------|
| `data/api-envs.json` | ApiEnvironment[] |
| `data/api-collections.json` | ApiCollection[] |
| `data/api-runs/<id>.json` | ApiCollectionRunResult |
| `data/api-tests.json` | (Deprecated — steps now embedded in collections) |

---

## 18. Execution Integration

The API runner integrates with the existing suite runner:

```typescript
// In run-spawner.ts or a new api-runner module:

export async function runApiCollection(
  collectionId: string,
  environmentId: string,
  triggeredBy: string,
  triggeredVia: 'ui' | 'api' | 'scheduler' | 'suite-link'
): Promise<ApiCollectionRunResult> {
  const collection = readAll<ApiCollection>(API_COLLECTIONS).find(c => c.id === collectionId);
  const env = readAll<ApiEnvironment>(API_ENVS).find(e => e.id === environmentId);
  
  if (!collection) throw new Error('Collection not found');
  if (!env) throw new Error('Environment not found');

  const variables = { ...envVariablesToMap(env), ...collectionVariableMap(collection) };
  const stepResults: ApiStepResult[] = [];
  
  for (const step of collection.steps) {
    const result = await runApiStep(step, variables, env, collection.auth);
    stepResults.push(result);
    // Merge extracted variables into context for next step
    for (const ext of result.extractedVariables) {
      variables[ext.variable] = ext.value;
    }
    // If step failed and no retry left, continue or abort based on collection setting
  }
  
  const runResult: ApiCollectionRunResult = { /* ... */ };
  writeRunResult(runResult);
  broadcast('api:run:done', runResult);
  return runResult;
}
```

---

## 19. OpenAPI Import — Detailed Mapping

| OpenAPI Field | Maps To |
|---------------|---------|
| `servers[0].url` | ApiEnvironment.baseUrl |
| `paths[path][method]` | ApiTestStep |
| `operationId` or `summary` | ApiTestStep.name |
| `parameters[in=query]` | ApiRequest.params[] |
| `parameters[in=path]` | ApiTestStep.pathParams[] (as `{{paramName}}`) |
| `parameters[in=header]` | ApiRequest.headers[] |
| `requestBody.content[application/json].schema` | ApiRequest.body (JSON example if available), ApiAssertion with jsonSchemaValid |
| `responses[status].description` | Step description |
| `responses[2xx]` | ApiAssertion: `statusCode equals 200/201` |
| `security` | ApiAuthConfig (Bearer, API key, OAuth2) |
| `components/schemas` | Referenced in jsonSchemaValid assertions |

---

## 20. Postman Import — Detailed Mapping

| Postman Field | Maps To |
|---------------|---------|
| `item[].name` | ApiTestStep.name |
| `item[].request.method` | ApiRequest.method |
| `item[].request.url.raw` | ApiRequest.url |
| `item[].request.url.query[]` | ApiRequest.params[] |
| `item[].request.url.variable[]` | ApiTestStep.pathParams[] |
| `item[].request.header[]` | ApiRequest.headers[] |
| `item[].request.body.mode` | ApiRequest.bodyType |
| `item[].request.body.raw` | ApiRequest.body |
| `item[].request.body.formdata[]` | ApiRequest.formData[] |
| `item[].request.auth` | ApiAuthConfig |
| `item[].event[][listen=test]` | Converted to ApiAssertion[] where possible |
| `variable[]` | ApiCollection.variables[] |

---

## 21. Phases

### Phase 1 — Foundations (Weeks 1-3)
- Data model (types.ts)
- Storage layer (api-envs.json, api-collections.json)
- API routes (CRUD for environments, collections, steps)
- API runner (basic: sequential execution, variable resolution, status code assertions)
- Auth: Bearer token, API key, Basic auth

### Phase 2 — Assertions & Extraction (Weeks 4-5)
- Full assertion engine (statusCode, header, body JSONPath, responseTime, size, jsonSchemaValid)
- Variable extraction (body JSONPath, header, statusCode, responseTime)
- API chaining (extract → pass to next step)
- cURL import

### Phase 3 — Import & Collections (Weeks 6-7)
- OpenAPI 3.0/3.1 import
- Swagger 2.0 import
- Postman Collection v2.1/v3.0 import
- Collection runner (sequential execution with variable context)
- Run results storage and WebSocket broadcast

### Phase 4 — UI & Integration (Weeks 8-10)
- Frontend: `23-api-tests.js` — step builder, assertion editor, variable extraction UI
- Frontend: `24-api-collections.js` — collection manager, reordering, run results viewer
- Frontend: `25-api-envs.js` — environment management, variable editor, auth config
- Suite linkage: `beforeAllApiCollectionId` in TestSuite
- Updated `modules.js` concatenation

### Phase 5 — Advanced (Weeks 11-12)
- GraphQL request type (query, mutation, variables editor)
- OAuth2 client_credentials flow
- Pre-request and post-response scripts
- Retry on failure
- Scheduler integration for API collections
- API test analytics dashboard

---

*End of API Testing Feature Plan & Specification*