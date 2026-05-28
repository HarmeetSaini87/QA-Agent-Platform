# API Testing Module — Implementation Plan Phase 3: Import Engines
**Week 5 | Spec:** `docs/superpowers/specs/2026-05-02-api-testing-design.md`
**Depends on:** Phase 2 complete (`ApiCollection`, `ApiTestStep`, `ApiRequest` types all defined and in use)

---

## Scope
Three import engines that convert external formats into `ApiCollection` objects. By end of Phase 3: users can import from OpenAPI 3.x/Swagger 2.0, Postman Collection v2.1/v3.0, and raw cURL commands — all producing valid collections that Phase 2 engine can execute.

---

## Tasks

### [API] Task 3.1 — OpenAPI Import Engine (`openapiImport.ts`)
**File:** `src/utils/openapiImport.ts` (new)

Converts an OpenAPI 3.x or Swagger 2.0 spec into an `ApiCollection`.

**Input:** Raw YAML or JSON string (spec content), target `environmentId`.

**Key function:**
```typescript
export function importFromOpenApi(
  specContent: string,
  environmentId: string,
  options?: { tag?: string; includeExamples?: boolean }
): ApiCollection
```

**Conversion rules:**
- Each `operationId` (or `{method} {path}` if no operationId) → one `ApiTestStep`
- `servers[0].url` → set as `ApiEnvironment.baseUrl` hint (returned separately, not saved automatically)
- Path + query parameters → `ApiRequest.queryParams` or substituted into URL as `{{paramName}}`
- `requestBody` examples → `ApiRequest.body` if `includeExamples: true`
- `responses` 2xx schema → auto-generate one `jsonSchemaValid` `ApiAssertion` per operation
- `securitySchemes` → map to `ApiAuthConfig` type (bearer→bearer, apiKey→apiKey, oauth2→oauth2_client_credentials)
- Tag filter: if `options.tag` provided, import only operations tagged with that value
- Operations with no 2xx response defined → import with no assertions (not skipped)

**Parser:** use `js-yaml` for YAML parsing; `JSON.parse` for JSON. Detect by trying JSON first, fall back to YAML.

**OpenAPI version detection:** check `openapi` field (3.x) vs `swagger` field (2.0); normalise Swagger 2.0 `basePath` + `host` → full URL.

**Acceptance:**
- Petstore OpenAPI 3.0 spec → collection with correct step count
- Each step has correct method + URL
- `jsonSchemaValid` assertion generated for 2xx responses with schema
- Tag filter reduces step count to tagged operations only

---

### [API] Task 3.2 — Postman Import Engine (`postmanImport.ts`)
**File:** `src/utils/postmanImport.ts` (new)

Converts a Postman Collection v2.1 or v3.0 export JSON into an `ApiCollection`.

**Key function:**
```typescript
export function importFromPostman(
  collectionJson: string,
  environmentId: string
): ApiCollection
```

**Conversion rules:**
- Collection `info.name` → `ApiCollection.name`
- Each `item` (request) → one `ApiTestStep`
- Nested folders → flattened; folder name prepended to step name (`"Auth / Login"`)
- Postman `{{varName}}` syntax → kept as-is (same as platform syntax)
- `pm.test` scripts in `event[listen=test]` → **not imported** (log warning, do not fail import)
- `pre-request` scripts → **not imported** (log warning)
- Auth at collection level → `ApiCollection` level `authConfig`; auth at request level → `ApiStepExecution` level (step overrides collection)
- Postman environment variables → imported as `ApiCollection.variables[]` with `sensitive: false`
- `disabled: true` items → imported but `execution.condition: 'false'` set (effectively skipped)

**Version detection:** check `info.schema` URL — `v2.1` vs `v3.0`.

**Acceptance:**
- Postman v2.1 collection JSON → correct step count and names
- Folder nesting flattened with prefix
- Disabled request → `condition: 'false'`
- Collection-level auth mapped to `ApiCollection.authConfig`

---

### [API] Task 3.3 — cURL Import Engine (`curlImport.ts`)
**File:** `src/utils/curlImport.ts` (new)

Parses a single cURL command string into one `ApiTestStep`.

**Key function:**
```typescript
export function importFromCurl(
  curlCommand: string,
  environmentId: string
): ApiTestStep
```

**Supported cURL flags:**
| Flag | Maps to |
|------|---------|
| `-X`, `--request` | `ApiRequest.method` |
| `-H`, `--header` | `ApiRequest.headers` |
| `-d`, `--data`, `--data-raw` | `ApiRequest.body` |
| `--data-urlencode` | `ApiRequest.body` (form-encoded) |
| `-u`, `--user` | `ApiAuthConfig` basic auth |
| `-b`, `--cookie` | `ApiRequest.headers['Cookie']` |
| `--json` | body + `Content-Type: application/json` |
| `-k`, `--insecure` | noted in step name as `[insecure]`, no runtime effect |
| URL (bare arg) | `ApiRequest.url` |

**Body type detection:** if `Content-Type: application/json` header present → `bodyType: 'json'`; `application/x-www-form-urlencoded` → `bodyType: 'form'`; else → `bodyType: 'raw'`.

**Default method:** `GET` if no `-X` flag and no body; `POST` if body present and no `-X`.

**Multi-line cURL:** strip `\` line continuations before parsing.

**Acceptance:**
- `curl -X POST https://api.example.com/v1/users -H "Authorization: Bearer token" -d '{"name":"test"}'` → correct method, URL, header, body, bodyType
- Basic auth flag → `ApiAuthConfig.basic`
- Multi-line cURL (with `\`) → parsed correctly

---

### [API] Task 3.4 — Import Endpoints in `api-testing.routes.ts`
**File:** `src/ui/routes/api-testing.routes.ts` (modified)

Add 3 import endpoints:

```
POST   /api/api-collections/import/openapi
  body: { specContent: string, environmentId: string, tag?: string, includeExamples?: boolean }
  → returns: ApiCollection (not yet saved — client decides to save via PUT)

POST   /api/api-collections/import/postman
  body: { collectionJson: string, environmentId: string }
  → returns: ApiCollection (not yet saved)

POST   /api/api-collections/import/curl
  body: { curlCommand: string, environmentId: string }
  → returns: ApiTestStep (client appends to existing collection)
```

**Design:** Import endpoints return the converted object — they do NOT auto-save. The frontend (Phase 4) shows a preview and lets the user confirm before saving via existing `POST /api/api-collections`.

**Auth:** `requireAuth` + `requireRole(['Admin', 'Editor'])` on all three.

**Error handling:** if parse fails, return `400` with `{ error: string }` describing what failed (e.g. `"Invalid OpenAPI spec: missing 'paths' object"`).

**Acceptance:**
- POST with valid OpenAPI YAML → 200 with `ApiCollection` JSON
- POST with invalid JSON → 400 with descriptive error
- POST with cURL → 200 with `ApiTestStep` JSON

---

### [API] Task 3.5 — Import Logging
**File:** `src/ui/routes/api-testing.routes.ts`

Log audit entries for all imports:
```typescript
logAudit(req, 'IMPORT_OPENAPI', { stepCount: collection.steps.length, tag: options.tag });
logAudit(req, 'IMPORT_POSTMAN', { stepCount: collection.steps.length, collectionName: collection.name });
logAudit(req, 'IMPORT_CURL', { method: step.request.method, url: step.request.url });
```

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero TypeScript errors
- [ ] `npm run build` — clean compile
- [ ] OpenAPI 3.0 Petstore YAML → collection with correct steps and assertions
- [ ] Swagger 2.0 spec → correct URL constructed from `host` + `basePath`
- [ ] Postman v2.1 export → correct step count, folders flattened
- [ ] Disabled Postman item → `condition: 'false'`
- [ ] cURL POST with JSON body → correct method, headers, bodyType
- [ ] Multi-line cURL → parsed correctly
- [ ] Invalid spec → 400 with descriptive error message
- [ ] Import audit entries in `data/audit.ndjson`
- [ ] Port 3003 — no regression to existing routes

---

## Files Created / Modified

| File | Action |
|------|--------|
| `src/utils/openapiImport.ts` | Created — OpenAPI 3.x + Swagger 2.0 → ApiCollection |
| `src/utils/postmanImport.ts` | Created — Postman v2.1/v3.0 → ApiCollection |
| `src/utils/curlImport.ts` | Created — cURL string → ApiTestStep |
| `src/ui/routes/api-testing.routes.ts` | Modified — add 3 import endpoints |

---

## Dependencies to Verify
```bash
# js-yaml — likely already installed; verify:
node -e "require('js-yaml')" && echo "present" || echo "MISSING"

# openapi-types (dev, for TypeScript types only):
npm install --save-dev openapi-types
```

No new runtime dependencies beyond what Phase 2 already installed (`jsonpath-plus`, `ajv`).

---

## Not In Phase 3 Scope

- Frontend import UI (file upload, cURL input panel) → Phase 4
- GraphQL body type → v2.0 deferred (spec §18)
- Postman `pm.test` / pre-request script conversion → v2.0 deferred
- HAR import → not in spec
