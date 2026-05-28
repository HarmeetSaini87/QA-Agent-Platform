# API Testing Module — Implementation Plan Phase 1: Foundations
**Weeks 1–2 | Spec:** `docs/superpowers/specs/2026-05-02-api-testing-design.md`

---

## Scope
Lay the data layer, storage, and core type system. No UI, no execution engine yet.
By end of Phase 1: environments and collections can be stored, loaded, and served via REST. All TypeScript types compile.

---

## Tasks

### [API] Task 1.1 — Add TypeScript Interfaces to `types.ts`
**File:** `src/data/types.ts`

Add the following interfaces (spec §4):
- `ApiEnvironment` — id, name, baseUrl, variables[], authConfig?
- `ApiVariable` — key, value, sensitive?
- `ApiDynamicValue` — type ('uuid'|'timestamp'|'env'), format?
- `ApiAuthConfig` — type, bearer?, apiKey?, basic?, oauth2CC?
- `ApiRequest` — method, url, headers, queryParams, body, bodyType
- `ApiAssertion` — field, operator, expected, weight, severity, message?
- `ApiVariableExtraction` — name, source, path, scope
- `ApiStepExecution` — retryPolicy, idempotent?, timeoutMs?, variableWritePolicy?, onFailure?, teardown?, logLevel?, delayAfterMs?, condition?
- `ApiTestStep` — id, name, request, assertions[], extractVariables[], execution, dependsOn[], group?, order?
- `ApiCollection` — id, name, environmentId, steps[], variables[], onFailure, executionMode, maxConcurrency?, logLevel?, rateLimit?, tags?
- `ApiCollectionRunResult` — id, collectionId, startedAt, completedAt, status, stepResults[], variableContext
- `ApiStepResult` — stepId, stepName, status, request, response, assertionResults[], extractedVariables, durationMs, error?
- `ApiAssertionResult` — assertionIndex, field, operator, passed, actual, expected, message?, confidenceScore
- `ApiResponseSnapshot` — status, headers, body, bodyTruncated, durationMs, har?

**Acceptance:** `npx tsc --noEmit` passes with no new errors.

---

### [API] Task 1.2 — Add Store Constants to `store.ts`
**File:** `src/data/store.ts`

Add two new collection name constants:
```typescript
export const API_ENVS = 'api-envs';
export const API_COLLECTIONS = 'api-collections';
```

Verify `store.ts` generic `getAll`, `getById`, `upsert`, `remove` helpers work with these collections (they should — no custom logic needed).

**Run directories:** create `data/api-runs/` directory (can be empty — run files written there by runner in Phase 2).

**Acceptance:** No code change to store logic; constants only. `data/api-envs.json` and `data/api-collections.json` created as empty `[]` files.

---

### [API] Task 1.3 — Create `api.routes.ts` (Environments + Collections CRUD only)
**File:** `src/ui/routes/api-testing.routes.ts`

Implement REST endpoints for Phase 1 scope only:

**Environments (5 endpoints):**
```
GET    /api/api-envs                  → getAll(API_ENVS)
POST   /api/api-envs                  → upsert(API_ENVS, body)
GET    /api/api-envs/:id              → getById(API_ENVS, id)
PUT    /api/api-envs/:id              → upsert(API_ENVS, body)
DELETE /api/api-envs/:id              → remove(API_ENVS, id)
```

**Collections (5 endpoints):**
```
GET    /api/api-collections           → getAll(API_COLLECTIONS)
POST   /api/api-collections           → upsert(API_COLLECTIONS, body)
GET    /api/api-collections/:id       → getById(API_COLLECTIONS, id)
PUT    /api/api-collections/:id       → upsert(API_COLLECTIONS, body)
DELETE /api/api-collections/:id       → remove(API_COLLECTIONS, id)
```

Auth middleware: apply `requireAuth` + `requireRole(['Admin','Editor'])` for write ops; `requireAuth` only for reads (match existing route patterns).

**Acceptance:** All 10 endpoints return correct status codes. Manual curl test passes.

---

### [API] Task 1.4 — Register Route in `server.ts`
**File:** `src/ui/server.ts`

```typescript
import apiTestingRoutes from './routes/api-testing.routes';
// ...
app.use('/api', apiTestingRoutes);
```

Place after existing route registrations, before the 404 handler.

**Acceptance:** Server compiles (`npm run build`) and starts. `curl http://localhost:3003/api/api-envs` returns `[]`.

---

### [API] Task 1.5 — Encryption for Sensitive Variables
**File:** `src/utils/apiSecrets.ts` (new)

Wrap `src/auth/crypto.ts` encrypt/decrypt for sensitive ApiVariable values.

```typescript
import { encrypt, decrypt } from '../auth/crypto';

export function encryptSensitiveVars(vars: ApiVariable[]): ApiVariable[] {
  return vars.map(v => v.sensitive ? { ...v, value: encrypt(v.value) } : v);
}

export function decryptSensitiveVars(vars: ApiVariable[]): ApiVariable[] {
  return vars.map(v => v.sensitive ? { ...v, value: decrypt(v.value) } : v);
}
```

Apply in `api-testing.routes.ts`:
- Encrypt on `POST`/`PUT` to `api-envs` before storing
- Decrypt on `GET` responses for `api-envs`

**Acceptance:** Storing an environment with `sensitive: true` variable shows encrypted value in `data/api-envs.json`. GET returns decrypted value.

---

### [API] Task 1.6 — Audit Logging
**File:** `src/ui/routes/api-testing.routes.ts`

Add `logAudit()` calls for all write operations, matching existing route patterns:
```typescript
logAudit(req, 'CREATE_API_ENV', { envId: env.id });
logAudit(req, 'UPDATE_API_ENV', { envId: id });
logAudit(req, 'DELETE_API_ENV', { envId: id });
logAudit(req, 'CREATE_API_COLLECTION', { collectionId: col.id });
logAudit(req, 'UPDATE_API_COLLECTION', { collectionId: id });
logAudit(req, 'DELETE_API_COLLECTION', { collectionId: id });
```

**Acceptance:** Audit log entries appear in `data/audit.ndjson` after write operations.

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero new TypeScript errors
- [ ] `npm run build` — compiles without error
- [ ] `curl GET /api/api-envs` → `[]`
- [ ] `curl POST /api/api-envs` with body → stored, returned with `id`
- [ ] `curl GET /api/api-collections` → `[]`
- [ ] Sensitive variable value is encrypted in `data/api-envs.json`
- [ ] Audit log shows CREATE/UPDATE/DELETE entries
- [ ] Port 3003 still running — no regression to existing routes

---

## Files Created / Modified

| File | Action |
|------|--------|
| `src/data/types.ts` | Modified — add 14 API interfaces |
| `src/data/store.ts` | Modified — add `API_ENVS`, `API_COLLECTIONS` constants |
| `src/ui/routes/api-testing.routes.ts` | Created — 10 CRUD endpoints |
| `src/ui/server.ts` | Modified — register new route |
| `src/utils/apiSecrets.ts` | Created — encrypt/decrypt wrapper |
| `data/api-envs.json` | Created — empty `[]` |
| `data/api-collections.json` | Created — empty `[]` |
| `data/api-runs/` | Created — empty directory |

---

## Not In Phase 1 Scope

- HTTP execution engine (`apiRunner.ts`) → Phase 2
- Assertion engine (`apiAssertions.ts`) → Phase 2
- Variable resolution (`apiVariables.ts`) → Phase 2
- Auth engine (`apiAuth.ts`) → Phase 2
- Import engines → Phase 3
- Frontend UI modules → Phase 4
- Run execution endpoints (`POST /api/api-collections/:id/run`) → Phase 2
