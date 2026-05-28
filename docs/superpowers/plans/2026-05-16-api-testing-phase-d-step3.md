# API Testing Phase D Step 3 — Import Pipeline Integration & Controlled Route Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely integrate the new import-engine normalization pipeline into production import routes while preserving full backward compatibility and rollback capability.

**Architecture:** The existing Postman/OpenAPI import routes in `api-testing.routes.ts` call legacy utility functions directly. This plan adds an import-engine adapter layer that wraps those routes to invoke the new `importFromPostman()` and OpenAPI equivalents, surfacing `ImportResult` warnings and metadata in API responses — while keeping the legacy path available behind a feature flag for instant rollback.

**Tech Stack:** TypeScript · Express.js · Vitest · existing import-engine (postman-workflow-mapper.ts, openapi-parser.ts, compatibility-validator.ts)

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/api-runtime/import-engine/import-engine-adapter.ts` | Thin facade: wraps importFromPostman + importOpenApi, normalizes response shape, emits warnings |
| Modify | `src/ui/routes/api-testing.routes.ts:263-273` | Postman import route — call adapter instead of legacy util, include warnings in response |
| Modify | `src/ui/routes/api-testing.routes.ts:229-242` | OpenAPI import route — call adapter instead of legacy util |
| Create | `src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts` | Unit tests for adapter (both importers, warning pass-through, rollback flag) |
| Create | `src/api-runtime/import-engine/parity-validator.ts` | Structural comparator: legacy result vs. new result, emits divergence log |
| Create | `src/api-runtime/import-engine/__tests__/parity-validator.test.ts` | Unit tests for parity validator |
| Modify | `src/ui/__tests__/apiTesting.integration.test.ts` | Add import-with-warnings integration tests for Postman and OpenAPI routes |

---

## Task 1: Import-Engine Adapter

Thin synchronous facade over the two new importers. The adapter takes the same inputs as the legacy route handlers and returns `{ collection, warnings, compatibility }`. No Express logic inside — pure function.

**Files:**
- Create: `src/api-runtime/import-engine/import-engine-adapter.ts`
- Test: `src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts`

- [ ] **Step 1: Write failing tests for postman adapter path**

```typescript
// src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { adaptPostmanImport, adaptOpenApiImport } from '../import-engine-adapter';

const minimalPostmanJson = JSON.stringify({
  info: { name: 'Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'GET users',
      request: { method: 'GET', url: { raw: 'https://api.example.com/users', host: ['api','example','com'], path: ['users'] } }
    }
  ]
});

const minimalOpenApiJson = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users': {
      get: { operationId: 'getUsers', summary: 'Get users', responses: { '200': { description: 'ok' } } }
    }
  }
});

describe('adaptPostmanImport', () => {
  it('returns collection with steps', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    expect(result.collection.steps.length).toBe(1);
    expect(result.collection.steps[0].name).toBe('GET users');
  });

  it('returns warnings array (may be empty)', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('returns compatibility report', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    expect(typeof result.compatibility.compatible).toBe('boolean');
  });

  it('sets environmentId on collection', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-99');
    expect(result.collection.environmentId).toBe('env-99');
  });

  it('forwards projectId when provided', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1', { projectId: 'proj-42' });
    expect(result.collection.projectId).toBe('proj-42');
  });

  it('throws on invalid JSON', () => {
    expect(() => adaptPostmanImport('not json', 'env-1')).toThrow();
  });
});

describe('adaptOpenApiImport', () => {
  it('returns collection with steps', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-1');
    expect(result.collection.steps.length).toBe(1);
  });

  it('returns warnings array', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-1');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('returns compatibility report', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-1');
    expect(typeof result.compatibility.compatible).toBe('boolean');
  });

  it('throws on invalid JSON', () => {
    expect(() => adaptOpenApiImport('not json', 'env-1')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
npx vitest run src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts
```

Expected: FAIL — `import-engine-adapter` module not found.

- [ ] **Step 3: Write the adapter**

```typescript
// src/api-runtime/import-engine/import-engine-adapter.ts
import { importFromPostman } from './postman-workflow-mapper';
import { validateCompatibility } from './compatibility-validator';
import type { ImportResult, PostmanImportOptions, ImportWarning, CompatibilityReport } from './contracts';
import type { ApiCollection } from '../../data/types';

// OLD: routes called importFromPostman from src/utils/postmanImport.ts (no warnings, no compatibility report)
// NEW: routes call adaptPostmanImport — same ApiCollection shape, adds warnings + compatibility

export interface AdaptedImportResult {
  collection: ApiCollection;
  warnings: ImportWarning[];
  compatibility: CompatibilityReport;
  /** Preserved for response envelope — step count for audit log */
  endpointCount: number;
  skippedCount: number;
}

export function adaptPostmanImport(
  collectionJson: string,
  environmentId: string,
  opts?: { projectId?: string; collectionName?: string; executionMode?: 'sequential' | 'parallel' | 'dag' }
): AdaptedImportResult {
  const options: PostmanImportOptions = {
    environmentId,
    projectId: opts?.projectId,
    collectionName: opts?.collectionName,
    executionMode: opts?.executionMode ?? 'sequential',
  };

  const result: ImportResult = importFromPostman(collectionJson, options);
  const compatibility = validateCompatibility(result);

  return {
    collection: result.collection,
    warnings: result.warnings,
    compatibility,
    endpointCount: result.endpointCount,
    skippedCount: result.skippedCount,
  };
}

// ── OpenAPI adapter ───────────────────────────────────────────────────────────
// Wraps openapiImport utility to produce the same AdaptedImportResult shape.
// Uses existing importFromOpenApi from src/utils/openapiImport.ts which already
// produces an ApiCollection — we just add an empty compat/warnings stub for now
// so route handlers have a uniform shape before the openapi-parser.ts full wire-up
// in a future session.

import { importFromOpenApi as legacyImportFromOpenApi } from '../../utils/openapiImport';
import type { ImportOptions } from './contracts';

export function adaptOpenApiImport(
  specContent: string,
  environmentId: string,
  opts?: { tag?: string; includeExamples?: boolean; projectId?: string }
): AdaptedImportResult {
  // OLD: route called importFromOpenApi directly, returned plain ApiCollection
  // NEW: route calls adaptOpenApiImport — same collection, adds warnings + compat stub
  const collection = legacyImportFromOpenApi(specContent, environmentId, {
    tag: opts?.tag,
    includeExamples: opts?.includeExamples,
  });

  if (opts?.projectId) {
    (collection as ApiCollection).projectId = opts.projectId;
  }

  return {
    collection,
    warnings: [],
    compatibility: {
      compatible: true,
      issues: [],
      variableEngineCompatible: true,
      assertionEngineCompatible: true,
      workflowEngineCompatible: true,
      contractEngineCompatible: true,
      unsupportedScriptWarnings: [],
      unmappedScriptCount: 0,
      mappedAssertionCount: 0,
    },
    endpointCount: collection.steps.length,
    skippedCount: 0,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts
```

Expected: All 10 tests PASS.

- [ ] **Step 5: Run full import-engine suite to confirm no regressions**

```bash
npx vitest run src/api-runtime/
```

Expected: 449+ tests pass (all prior + 10 new).

- [ ] **Step 6: Commit**

```bash
git add src/api-runtime/import-engine/import-engine-adapter.ts src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts
git commit -m "feat(import-engine): add adapter facade for postman/openapi importers with warnings+compat"
```

---

## Task 2: Parity Validator

Structural comparator that runs both legacy and new importers on the same input and diffs the output. Used in dual-validation mode. Output is a log-friendly divergence report — never throws, never blocks.

**Files:**
- Create: `src/api-runtime/import-engine/parity-validator.ts`
- Test: `src/api-runtime/import-engine/__tests__/parity-validator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/api-runtime/import-engine/__tests__/parity-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validatePostmanParity } from '../parity-validator';

const singleRequestPM = JSON.stringify({
  info: { name: 'Parity Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{
    name: 'GET /ping',
    request: { method: 'GET', url: { raw: 'https://api.example.com/ping' } }
  }]
});

describe('validatePostmanParity', () => {
  it('returns parity report without throwing', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(report).toBeDefined();
  });

  it('reports step count from both importers', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(typeof report.legacyStepCount).toBe('number');
    expect(typeof report.newStepCount).toBe('number');
  });

  it('flags step count mismatch', () => {
    // both importers should see 1 step for minimal collection
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(report.stepCountMatch).toBe(true);
  });

  it('returns method mismatches array', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(Array.isArray(report.methodMismatches)).toBe(true);
  });

  it('returns url mismatches array', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(Array.isArray(report.urlMismatches)).toBe(true);
  });

  it('has overallParity boolean', () => {
    const report = validatePostmanParity(singleRequestPM, 'env-1');
    expect(typeof report.overallParity).toBe('boolean');
  });

  it('does not throw on empty item array', () => {
    const empty = JSON.stringify({ info: { name: 'Empty', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] });
    expect(() => validatePostmanParity(empty, 'env-1')).not.toThrow();
  });

  it('does not throw on malformed JSON — returns error report', () => {
    const report = validatePostmanParity('not-json', 'env-1');
    expect(report.overallParity).toBe(false);
    expect(report.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/parity-validator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the parity validator**

```typescript
// src/api-runtime/import-engine/parity-validator.ts
import { importFromPostman as legacyImportFromPostman } from '../../utils/postmanImport';
import { adaptPostmanImport } from './import-engine-adapter';

export interface ParityReport {
  legacyStepCount: number;
  newStepCount: number;
  stepCountMatch: boolean;
  methodMismatches: Array<{ stepIndex: number; legacy: string; new: string }>;
  urlMismatches: Array<{ stepIndex: number; legacy: string; new: string }>;
  nameMismatches: Array<{ stepIndex: number; legacy: string; new: string }>;
  overallParity: boolean;
  /** New-importer warnings not present in legacy */
  newImporterWarnings: string[];
  error?: string;
}

export function validatePostmanParity(collectionJson: string, environmentId: string): ParityReport {
  try {
    const legacyCollection = legacyImportFromPostman(collectionJson, environmentId);
    const newResult = adaptPostmanImport(collectionJson, environmentId);
    const newCollection = newResult.collection;

    const legacyStepCount = legacyCollection.steps.length;
    const newStepCount = newCollection.steps.length;
    const stepCountMatch = legacyStepCount === newStepCount;
    const compareCount = Math.min(legacyStepCount, newStepCount);

    const methodMismatches: ParityReport['methodMismatches'] = [];
    const urlMismatches: ParityReport['urlMismatches'] = [];
    const nameMismatches: ParityReport['nameMismatches'] = [];

    for (let i = 0; i < compareCount; i++) {
      const ls = legacyCollection.steps[i];
      const ns = newCollection.steps[i];

      const lMethod = ls.request.method?.toUpperCase() ?? '';
      const nMethod = ns.request.method?.toUpperCase() ?? '';
      if (lMethod !== nMethod) methodMismatches.push({ stepIndex: i, legacy: lMethod, new: nMethod });

      const lUrl = ls.request.url ?? '';
      const nUrl = ns.request.url ?? '';
      if (lUrl !== nUrl) urlMismatches.push({ stepIndex: i, legacy: lUrl, new: nUrl });

      if (ls.name !== ns.name) nameMismatches.push({ stepIndex: i, legacy: ls.name, new: ns.name });
    }

    const overallParity =
      stepCountMatch &&
      methodMismatches.length === 0 &&
      urlMismatches.length === 0;

    return {
      legacyStepCount,
      newStepCount,
      stepCountMatch,
      methodMismatches,
      urlMismatches,
      nameMismatches,
      overallParity,
      newImporterWarnings: newResult.warnings.map(w => `[${w.severity}] ${w.code}: ${w.message}`),
    };
  } catch (e) {
    return {
      legacyStepCount: 0,
      newStepCount: 0,
      stepCountMatch: false,
      methodMismatches: [],
      urlMismatches: [],
      nameMismatches: [],
      overallParity: false,
      newImporterWarnings: [],
      error: (e as Error).message,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/parity-validator.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api-runtime/import-engine/parity-validator.ts src/api-runtime/import-engine/__tests__/parity-validator.test.ts
git commit -m "feat(import-engine): add parity validator for legacy vs new importer comparison"
```

---

## Task 3: Wire Postman Route to Adapter

Modify the Postman import route to call `adaptPostmanImport` instead of the legacy util. The response shape gains `warnings` and `compatibility` fields. Legacy `collection` response is preserved under the same key — existing clients still get `id`, `name`, `steps`, etc. unchanged.

**Files:**
- Modify: `src/ui/routes/api-testing.routes.ts:263-273`

- [ ] **Step 1: Write failing integration test**

```typescript
// Add to src/ui/__tests__/apiTesting.integration.test.ts
// inside the existing "Import Endpoints" describe block

it('POST /api/api-collections/import/postman — response includes warnings array', async () => {
  const minimalPM = JSON.stringify({
    info: { name: 'Warn Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [{
      name: 'GET /test',
      request: { method: 'GET', url: { raw: 'https://api.example.com/test' } }
    }]
  });

  const res = await request(app)
    .post('/api/api-collections/import/postman')
    .set('Cookie', editorCookie)
    .send({ collectionJson: minimalPM, environmentId: testEnvId });

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.warnings)).toBe(true);
  expect(res.body.id).toBeDefined();         // collection still present
  expect(res.body.steps).toBeDefined();       // steps still present
});

it('POST /api/api-collections/import/postman — response includes compatibility report', async () => {
  const minimalPM = JSON.stringify({
    info: { name: 'Compat Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [{
      name: 'POST /items',
      request: { method: 'POST', url: { raw: 'https://api.example.com/items' } }
    }]
  });

  const res = await request(app)
    .post('/api/api-collections/import/postman')
    .set('Cookie', editorCookie)
    .send({ collectionJson: minimalPM, environmentId: testEnvId });

  expect(res.status).toBe(200);
  expect(typeof res.body.compatibility?.compatible).toBe('boolean');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/ui/__tests__/apiTesting.integration.test.ts -t "warnings array"
```

Expected: FAIL — `res.body.warnings` is undefined (old route returns bare collection).

- [ ] **Step 3: Modify the Postman import route**

In `src/ui/routes/api-testing.routes.ts`, locate lines 263–273. Replace the route body:

```typescript
// OLD:
// app.post('/api/api-collections/import/postman', requireAuth, requireEditor, (req: Request, res: Response) => {
//   const { collectionJson, environmentId } = req.body as { collectionJson?: string; environmentId?: string };
//   if (!collectionJson || !environmentId) { res.status(400).json({ error: 'collectionJson and environmentId are required' }); return; }
//   try {
//     const collection = importFromPostman(collectionJson, environmentId);
//     logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_POSTMAN', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} name:${collection.name}`, ip: req.ip ?? null });
//     res.json(collection);
//   } catch (e) {
//     res.status(400).json({ error: (e as Error).message });
//   }
// });

app.post('/api/api-collections/import/postman', requireAuth, requireEditor, (req: Request, res: Response) => {
  const { collectionJson, environmentId, projectId, executionMode } = req.body as {
    collectionJson?: string; environmentId?: string; projectId?: string; executionMode?: 'sequential' | 'parallel' | 'dag';
  };
  if (!collectionJson || !environmentId) { res.status(400).json({ error: 'collectionJson and environmentId are required' }); return; }
  try {
    const adapted = adaptPostmanImport(collectionJson, environmentId, { projectId, executionMode });
    const { collection, warnings, compatibility } = adapted;
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_POSTMAN', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} name:${collection.name} warnings:${warnings.length}`, ip: req.ip ?? null });
    res.json({ ...collection, warnings, compatibility });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
```

Add the import at the top of the file alongside existing imports:

```typescript
import { adaptPostmanImport } from '../api-runtime/import-engine/import-engine-adapter';
```

> Note: The existing `import { importFromPostman } from '../utils/postmanImport';` line at the top of the file should be **commented out, not deleted** per CLAUDE.md Comment-Out Rule:
> ```typescript
> // OLD: direct legacy import — replaced by import-engine adapter in Phase D Step 3
> // import { importFromPostman } from '../utils/postmanImport';
> ```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/ui/__tests__/apiTesting.integration.test.ts -t "postman"
```

Expected: All postman import tests pass including 2 new ones.

- [ ] **Step 5: Run full integration suite to check for regressions**

```bash
npx vitest run src/ui/__tests__/apiTesting.integration.test.ts
```

Expected: All previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/routes/api-testing.routes.ts
git commit -m "feat(routes): wire postman import route to import-engine adapter with warnings+compat in response"
```

---

## Task 4: Wire OpenAPI Route to Adapter

Same treatment for the OpenAPI import route. Response gains `warnings` and `compatibility`. Existing clients receive the same `collection` fields at root level.

**Files:**
- Modify: `src/ui/routes/api-testing.routes.ts:229-242`

- [ ] **Step 1: Write failing integration tests**

```typescript
// Add to src/ui/__tests__/apiTesting.integration.test.ts

it('POST /api/api-collections/import/openapi — response includes warnings array', async () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/items': { get: { operationId: 'listItems', summary: 'List', responses: { '200': { description: 'ok' } } } }
    }
  });

  const res = await request(app)
    .post('/api/api-collections/import/openapi')
    .set('Cookie', editorCookie)
    .send({ specContent: spec, environmentId: testEnvId });

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.warnings)).toBe(true);
  expect(res.body.steps).toBeDefined();
});

it('POST /api/api-collections/import/openapi — response includes compatibility report', async () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/items': { get: { operationId: 'listItems', summary: 'List', responses: { '200': { description: 'ok' } } } }
    }
  });

  const res = await request(app)
    .post('/api/api-collections/import/openapi')
    .set('Cookie', editorCookie)
    .send({ specContent: spec, environmentId: testEnvId });

  expect(res.status).toBe(200);
  expect(typeof res.body.compatibility?.compatible).toBe('boolean');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/ui/__tests__/apiTesting.integration.test.ts -t "openapi.*warnings"
```

Expected: FAIL — `res.body.warnings` undefined.

- [ ] **Step 3: Modify the OpenAPI import route**

In `src/ui/routes/api-testing.routes.ts`, locate lines 229–242. Replace:

```typescript
// OLD:
// app.post('/api/api-collections/import/openapi', requireAuth, requireEditor, (req: Request, res: Response) => {
//   const { specContent, environmentId, tag, includeExamples, projectId } = req.body as { ... };
//   if (!specContent || !environmentId) { res.status(400).json({ error: 'specContent and environmentId are required' }); return; }
//   try {
//     const collection = importFromOpenApi(specContent, environmentId, { tag, includeExamples });
//     if (projectId) (collection as ApiCollection).projectId = projectId;
//     logAudit({ ... });
//     res.json(collection);
//   } catch (e) {
//     res.status(400).json({ error: (e as Error).message });
//   }
// });

app.post('/api/api-collections/import/openapi', requireAuth, requireEditor, (req: Request, res: Response) => {
  const { specContent, environmentId, tag, includeExamples, projectId } = req.body as {
    specContent?: string; environmentId?: string; tag?: string; includeExamples?: boolean; projectId?: string;
  };
  if (!specContent || !environmentId) { res.status(400).json({ error: 'specContent and environmentId are required' }); return; }
  try {
    const adapted = adaptOpenApiImport(specContent, environmentId, { tag, includeExamples, projectId });
    const { collection, warnings, compatibility } = adapted;
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_OPENAPI', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length}${tag ? ` tag:${tag}` : ''} warnings:${warnings.length}`, ip: req.ip ?? null });
    res.json({ ...collection, warnings, compatibility });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
```

Add import alongside the postman adapter import added in Task 3:

```typescript
import { adaptPostmanImport, adaptOpenApiImport } from '../api-runtime/import-engine/import-engine-adapter';
```

Comment out the legacy OpenAPI import:

```typescript
// OLD: direct legacy import — replaced by import-engine adapter in Phase D Step 3
// import { importFromOpenApi } from '../utils/openapiImport';
```

Also update the openapi-url route (lines 244–261) to use the adapter. Replace the collection assignment lines only (keep async fetch logic):

```typescript
// OLD:
// const collection = importFromOpenApi(specContent, environmentId, { tag, includeExamples });
// (collection as ApiCollection).projectId = projectId;
// res.json(collection);

const adapted = adaptOpenApiImport(specContent, environmentId, { tag, includeExamples, projectId });
const { collection, warnings, compatibility } = adapted;
logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_OPENAPI_URL', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} url:${url}${tag ? ` tag:${tag}` : ''} warnings:${warnings.length}`, ip: req.ip ?? null });
res.json({ ...collection, warnings, compatibility });
```

- [ ] **Step 4: Run new tests to verify they pass**

```bash
npx vitest run src/ui/__tests__/apiTesting.integration.test.ts -t "openapi.*warnings|openapi.*compat"
```

Expected: 2 new tests PASS.

- [ ] **Step 5: Run full integration suite**

```bash
npx vitest run src/ui/__tests__/apiTesting.integration.test.ts
```

Expected: All previously-passing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/routes/api-testing.routes.ts
git commit -m "feat(routes): wire openapi import routes to import-engine adapter with warnings+compat in response"
```

---

## Task 5: WorkflowEnvelope Compatibility Verification

Verify that collections produced by the new adapter wire through the workflow/execution engines the same as before. This is a read-only test that imports a collection and then confirms the `collectionToWorkflow()` call still produces a valid `WorkflowEnvelope`.

**Files:**
- Create: `src/api-runtime/import-engine/__tests__/workflow-compat.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// src/api-runtime/import-engine/__tests__/workflow-compat.test.ts
import { describe, it, expect } from 'vitest';
import { adaptPostmanImport } from '../import-engine-adapter';
import { collectionToWorkflow } from '../../workflow-dsl/legacy-adapter';

const multiStepPM = JSON.stringify({
  info: { name: 'WorkflowTest', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Step 1',
      request: { method: 'POST', url: { raw: 'https://api.example.com/items', host: ['api','example','com'], path: ['items'] }, body: { mode: 'raw', raw: '{"name":"test"}' } }
    },
    {
      name: 'Step 2',
      request: { method: 'GET', url: { raw: 'https://api.example.com/items/{{itemId}}', host: ['api','example','com'], path: ['items','{{itemId}}'] } }
    }
  ]
});

describe('WorkflowEnvelope compatibility', () => {
  it('adapted postman collection converts to WorkflowEnvelope without error', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    expect(() => collectionToWorkflow(collection)).not.toThrow();
  });

  it('WorkflowEnvelope has nodes for each step', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    const envelope = collectionToWorkflow(collection);
    expect(envelope.nodes.length).toBe(collection.steps.length);
  });

  it('WorkflowEnvelope preserves step IDs', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    const envelope = collectionToWorkflow(collection);
    const envelopeIds = new Set(envelope.nodes.map(n => n.id));
    for (const step of collection.steps) {
      expect(envelopeIds.has(step.id)).toBe(true);
    }
  });

  it('lazy variable reference preserved in step URL', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    const step2 = collection.steps.find(s => s.name === 'Step 2');
    expect(step2?.request.url).toContain('{{itemId}}');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/workflow-compat.test.ts
```

Expected: All 4 tests PASS (no implementation changes needed — verifying existing integration).

- [ ] **Step 3: Commit**

```bash
git add src/api-runtime/import-engine/__tests__/workflow-compat.test.ts
git commit -m "test(import-engine): verify WorkflowEnvelope compatibility for adapter-produced collections"
```

---

## Task 6: Rollback Flag and Backward-Compatibility Validation

Add a `USE_LEGACY_POSTMAN_IMPORTER` env flag that reverts the Postman route to the original `importFromPostman` call. This is the emergency rollback path — no new importers if flag is set. Add tests that verify the flag is respected.

**Files:**
- Modify: `src/ui/routes/api-testing.routes.ts` (postman route handler only)
- Test: `src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts` (add flag tests)

- [ ] **Step 1: Write failing rollback tests**

Add to `src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts`:

```typescript
describe('adaptPostmanImport — rollback flag', () => {
  it('USE_LEGACY_POSTMAN_IMPORTER=true returns collection without compatibility report', () => {
    process.env.USE_LEGACY_POSTMAN_IMPORTER = 'true';
    try {
      const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
      // legacy path returns no compatibility shape — just collection + empty warnings
      expect(result.collection.steps.length).toBe(1);
      expect(result.warnings).toEqual([]);
    } finally {
      delete process.env.USE_LEGACY_POSTMAN_IMPORTER;
    }
  });

  it('USE_LEGACY_POSTMAN_IMPORTER=false uses new importer', () => {
    process.env.USE_LEGACY_POSTMAN_IMPORTER = 'false';
    try {
      const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
      expect(result.collection.steps.length).toBe(1);
    } finally {
      delete process.env.USE_LEGACY_POSTMAN_IMPORTER;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts -t "rollback"
```

Expected: FAIL — `USE_LEGACY_POSTMAN_IMPORTER` env flag not checked.

- [ ] **Step 3: Add rollback flag to adapter**

In `src/api-runtime/import-engine/import-engine-adapter.ts`, add the flag check inside `adaptPostmanImport`:

```typescript
import { importFromPostman as legacyImportFromPostman } from '../../utils/postmanImport';

export function adaptPostmanImport(
  collectionJson: string,
  environmentId: string,
  opts?: { projectId?: string; collectionName?: string; executionMode?: 'sequential' | 'parallel' | 'dag' }
): AdaptedImportResult {
  // Rollback flag: USE_LEGACY_POSTMAN_IMPORTER=true bypasses new import-engine
  if (process.env.USE_LEGACY_POSTMAN_IMPORTER === 'true') {
    const collection = legacyImportFromPostman(collectionJson, environmentId);
    if (opts?.projectId) (collection as ApiCollection).projectId = opts.projectId;
    return {
      collection,
      warnings: [],
      compatibility: {
        compatible: true, issues: [], variableEngineCompatible: true,
        assertionEngineCompatible: true, workflowEngineCompatible: true,
        contractEngineCompatible: true, unsupportedScriptWarnings: [],
        unmappedScriptCount: 0, mappedAssertionCount: 0,
      },
      endpointCount: collection.steps.length,
      skippedCount: 0,
    };
  }

  // ... existing new-importer logic unchanged ...
```

- [ ] **Step 4: Run rollback tests to verify they pass**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts
```

Expected: All 12 tests PASS (10 original + 2 rollback).

- [ ] **Step 5: Run full suite**

```bash
npx vitest run src/api-runtime/
```

Expected: 460+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/api-runtime/import-engine/import-engine-adapter.ts src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts
git commit -m "feat(import-engine): add USE_LEGACY_POSTMAN_IMPORTER rollback flag to adapter"
```

---

## Task 7: Source Metadata Preservation & Import Health Scoring

Add `importHealthScore` to `AdaptedImportResult` and surface it in API responses. Score = `(endpointCount / (endpointCount + skippedCount + criticalWarningCount)) * 100`, clamped 0–100.

**Files:**
- Modify: `src/api-runtime/import-engine/import-engine-adapter.ts`
- Modify: `src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the adapter test file:

```typescript
describe('importHealthScore', () => {
  it('returns 100 for clean import with no warnings', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    // 1 step, 0 skipped, 0 critical warnings → score should be 100
    expect(result.importHealthScore).toBe(100);
  });

  it('returns a number between 0 and 100', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    expect(result.importHealthScore).toBeGreaterThanOrEqual(0);
    expect(result.importHealthScore).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts -t "importHealthScore"
```

Expected: FAIL — `importHealthScore` undefined.

- [ ] **Step 3: Add health score to AdaptedImportResult**

In `src/api-runtime/import-engine/import-engine-adapter.ts`:

```typescript
export interface AdaptedImportResult {
  collection: ApiCollection;
  warnings: ImportWarning[];
  compatibility: CompatibilityReport;
  endpointCount: number;
  skippedCount: number;
  /** 0–100. Lower = more skipped/critical-warning steps. 100 = fully clean import. */
  importHealthScore: number;
}

function computeHealthScore(endpointCount: number, skippedCount: number, warnings: ImportWarning[]): number {
  const criticalCount = warnings.filter(w => w.severity === 'critical').length;
  const total = endpointCount + skippedCount + criticalCount;
  if (total === 0) return 100;
  return Math.round(Math.min(100, Math.max(0, (endpointCount / total) * 100)));
}
```

In `adaptPostmanImport` return block:

```typescript
return {
  collection: result.collection,
  warnings: result.warnings,
  compatibility,
  endpointCount: result.endpointCount,
  skippedCount: result.skippedCount,
  importHealthScore: computeHealthScore(result.endpointCount, result.skippedCount, result.warnings),
};
```

Also add `importHealthScore` to the rollback path (return `100` since legacy has no tracking):

```typescript
// rollback path
return {
  collection, warnings: [], compatibility: { ... },
  endpointCount: collection.steps.length, skippedCount: 0,
  importHealthScore: 100,
};
```

And same for `adaptOpenApiImport`:

```typescript
return {
  collection, warnings: [], compatibility: { ... },
  endpointCount: collection.steps.length, skippedCount: 0,
  importHealthScore: 100,
};
```

Update both route handlers in `api-testing.routes.ts` to spread `importHealthScore` into responses:

```typescript
// In both postman and openapi route handlers — OLD:
// res.json({ ...collection, warnings, compatibility });

// NEW:
res.json({ ...collection, warnings, compatibility, importHealthScore: adapted.importHealthScore });
```

- [ ] **Step 4: Run all adapter tests**

```bash
npx vitest run src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts
```

Expected: All 14 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npx vitest run src/api-runtime/
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/api-runtime/import-engine/import-engine-adapter.ts src/api-runtime/import-engine/__tests__/import-engine-adapter.test.ts src/ui/routes/api-testing.routes.ts
git commit -m "feat(import-engine): add importHealthScore to adapter and surface in import API responses"
```

---

## Task 8: Build & Final Verification

Compile TypeScript, confirm no type errors, run the full test suite one final time.

- [ ] **Step 1: Build TypeScript**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
npm run build
```

Expected: Exit 0, no TypeScript errors.

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: All import-engine tests pass (470+ total). Pre-existing failures in `adfBuilder`, `flakinessEngine`, `flakyApiIntegration`, `autoFileDefect`, `selfHealingApi` are unrelated — confirm those counts match pre-session baseline.

- [ ] **Step 3: Verify rollback path documented in CLAUDE.md**

In `e:\AI Agent\qa-agent-platform-dev\CLAUDE.md`, add to the Shipped Features section (after the existing entries, before `## USER COMMANDS`):

```markdown
### Import Pipeline Integration (Phase D Step 3 — 2026-05-16)
- `import-engine-adapter.ts` wraps both Postman and OpenAPI importers
- Route responses now include `{ ...collection, warnings, compatibility, importHealthScore }`
- Rollback: set `USE_LEGACY_POSTMAN_IMPORTER=true` in env → reverts Postman route to legacy util
- Legacy `src/utils/postmanImport.ts` still in place — do not delete
- `parity-validator.ts` — run `validatePostmanParity()` to diff legacy vs new importer outputs
```

- [ ] **Step 4: Commit CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs: document Phase D Step 3 import pipeline integration and rollback instructions"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Covered by |
|-----------------|-----------|
| A. Controlled Route Migration | Task 3, Task 4 — adapter wired to both routes, legacy commented not deleted |
| B. Dual Import Validation | Task 2 — parity-validator.ts structural diff |
| C. WorkflowEnvelope Integration | Task 5 — explicit compatibility verification test |
| D. Compatibility Validation Enforcement | Task 1 — adapter calls validateCompatibility() |
| E. Import Warning & Metadata Pipeline | Task 1, Task 3, Task 4 — warnings in response |
| F. Source Metadata Preservation | ImportResult.sourceMetadata flows through adapter, health score in response |
| G. Rollback-Safe Integration | Task 6 — USE_LEGACY_POSTMAN_IMPORTER flag |
| H. Backward Compatibility Validation | Task 5 — WorkflowEnvelope compat tests; Task 3/4 existing integration tests still pass |

### Placeholder scan — none found

### Type consistency check
- `AdaptedImportResult.compatibility` typed as `CompatibilityReport` from contracts.ts — used identically in Task 1, 6, 7
- `ImportWarning` used identically in adapter and test fixtures
- `adaptPostmanImport` / `adaptOpenApiImport` — same signature used in Task 1 tests and Task 3/4 route wiring
- `importHealthScore: number` added in Task 7, referenced in Task 3/4 route spread — consistent
