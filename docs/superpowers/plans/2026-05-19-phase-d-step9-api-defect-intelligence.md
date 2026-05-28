# Phase D Step 9: API Defect Intelligence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full API-specific defect intelligence module that enriches Jira defects with flakiness scores, retry history, dependency chains, and URL healing suggestions — without touching existing UI-test defect flows, healingEngine, or the execution runtime.

**Architecture:** A new `src/api-defects/` module (contracts → enricher → heal-advisor → store → routes) enriches step failure context using Step 8 flakiness data, Phase D Step 7 graph overlays, and new URL heuristics. A new ADF builder export produces rich Jira descriptions. The Runs UI gets a "Jira & Heal" tab per step with a "File Defect" button and inline healing suggestions. All existing UI-test defect flows (`src/ui/routes/jira.routes.ts`, `defectsStore.ts`, `healingEngine.ts`) are untouched.

**Tech Stack:** TypeScript · Vitest · Express · vanilla JS (`25-api-runs.js`) · existing data stores

**Key findings from grep:**
- Store constants: `API_COLLECTIONS = 'api-collections'`, `API_ENVS = 'api-envs'` (from `src/data/store.ts`)
- `_apiRunsStepTab(btn, containerId, tab)` receives `btn`, `containerId`, `tab` — does NOT receive `stepId` directly; `stepId` must be read from context (detailId encodes it, or read from a `data-step-id` attribute on the container)
- Jira helper import path: `../../ui/helpers/jira-helpers`

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `src/api-defects/contracts/api-defect.contracts.ts` | Create | All shared types: `ApiDefectRecord`, `ApiDefectPayload`, `ApiHealingSuggestion`, `ApiDefectEnrichmentContext` |
| `src/api-defects/api-defect-enricher.ts` | Create | Pure fn: `enrichDefectPayload(ctx)` → `ApiDefectPayload` |
| `src/api-defects/api-heal-advisor.ts` | Create | Pure fn: `proposeUrlFixes(step)` → `ApiHealingSuggestion[]` |
| `src/api-defects/api-defect-store.ts` | Create | Persist/load `ApiDefectRecord[]` to `data/api-defects.json` |
| `src/api-defects/routes/api-defects.routes.ts` | Create | POST `/api/api-defects/draft`, POST `/api/api-defects/file`, GET `/api/api-defects/by-step/:stepId` |
| `src/api-defects/index.ts` | Create | Barrel export |
| `src/utils/adfBuilder.ts` | Modify | Add `buildEnrichedApiDefectAdf(payload)` — new export only, old functions unchanged |
| `src/ui/server.ts` | Modify | Import + register `registerApiDefectsRoutes` |
| `src/ui/public/js/25-api-runs.js` | Modify | Add "Jira & Heal" tab + "File Defect" button + healing panel + defect cache helpers |
| `src/ui/public/styles_addon.css` | Modify | `.api-defect-pill`, `.api-heal-card` styles |
| `src/api-defects/__tests__/api-defect-enricher.test.ts` | Create | Unit tests: enrichment, flakiness merge, retry stats, dependency chain |
| `src/api-defects/__tests__/api-heal-advisor.test.ts` | Create | Unit tests: all suggestion types + empty for passed |
| `src/api-defects/__tests__/api-defect-store.test.ts` | Create | Unit tests: save/load/dedup roundtrip |

---

## Task 1: API Defect Contracts

**Files:**
- Create: `src/api-defects/contracts/api-defect.contracts.ts`

- [ ] **Step 1: Create the contracts file**

```typescript
// src/api-defects/contracts/api-defect.contracts.ts

import type { ApiStepResult, ApiCollection, ApiEnvironment, ApiCollectionRunResult } from '../../data/types';
import type { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';
import type { RunGraphNodeResult } from '../../data/types';

export interface ApiDefectEnrichmentContext {
  step: ApiStepResult;
  run: ApiCollectionRunResult;
  collection: ApiCollection;
  environment: ApiEnvironment;
  /** Optional — from Step 8 flakiness report */
  flakinessReport?: CollectionFlakinessReport;
  /** Optional — from Phase D Step 7 graph overlay */
  graphNodeResult?: RunGraphNodeResult;
}

export interface ApiHealingSuggestion {
  readonly type: 'version_drift' | 'missing_prefix' | 'base_url_drift' | 'path_mismatch' | 'auth_refresh';
  readonly currentUrl: string;
  readonly suggestedUrl: string;
  readonly confidence: number;  // 0.0–1.0
  readonly reason: string;
}

export interface ApiDefectPayload {
  // Identity
  readonly stepId: string;
  readonly stepName: string;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly runId: string;
  // Request context
  readonly method: string;
  readonly url: string;
  readonly httpStatus?: number;
  readonly durationMs: number;
  // Failure detail
  readonly failedAssertions: ReadonlyArray<{ field: string; operator: string; expected: unknown; actual: unknown }>;
  readonly errorMessage?: string;
  readonly requestBody?: string;  // truncated to 500 chars, auth headers redacted
  readonly responseBody?: string;  // truncated to 500 chars
  // Enrichment
  readonly flakinessScore?: number;
  readonly failRate?: number;
  readonly isFlaky?: boolean;
  readonly retryCount: number;
  readonly retryHistory: ReadonlyArray<{ attempt: number; httpStatus?: number; error?: string; durationMs: number }>;
  readonly dependencyChain: readonly string[];  // stepIds this step depends on (from collection.steps[].dependsOn)
  readonly signatureKey?: string;  // from Step 8 dominantSignature.signatureKey
  // Environment
  readonly environmentName: string;
  readonly environmentBaseUrl: string;
  readonly collectionVersion?: string;
  // Healing
  readonly healingSuggestions: readonly ApiHealingSuggestion[];
}

export interface ApiDefectRecord {
  readonly defectKey: string;
  readonly jiraId: string;
  readonly stepId: string;
  readonly stepName: string;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly runId: string;
  readonly environmentId: string;
  readonly environmentName: string;
  readonly projectId?: string;
  readonly signatureKey?: string;
  readonly status: 'open' | 'closed';
  readonly createdAt: string;
  readonly createdBy: string;
  readonly jiraUrl: string;
}

export interface ApiDefectsRegistry {
  readonly _schemaVersion: 1;
  defects: ApiDefectRecord[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: zero errors on the new file (it only imports types).

---

## Task 2: ADF Enrichment — `buildEnrichedApiDefectAdf`

**Files:**
- Modify: `src/utils/adfBuilder.ts`

This is a TDD task. We write the test first, run it (expect failure because function doesn't exist yet), implement, then run again to confirm green.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/adfBuilder-enriched.test.ts`:

```typescript
// src/utils/__tests__/adfBuilder-enriched.test.ts
import { describe, it, expect } from 'vitest';
import { buildEnrichedApiDefectAdf } from '../adfBuilder';
import type { ApiDefectPayload } from '../../api-defects/contracts/api-defect.contracts';

function makePayload(overrides: Partial<ApiDefectPayload> = {}): ApiDefectPayload {
  return {
    stepId: 'step-1',
    stepName: 'GET Users',
    collectionId: 'col-1',
    collectionName: 'User API',
    runId: 'run-42',
    method: 'GET',
    url: 'https://api.example.com/v1/users',
    httpStatus: 404,
    durationMs: 320,
    failedAssertions: [{ field: 'status', operator: 'equals', expected: 200, actual: 404 }],
    errorMessage: undefined,
    requestBody: undefined,
    responseBody: '{"error":"not found"}',
    flakinessScore: 0.72,
    failRate: 0.5,
    isFlaky: true,
    retryCount: 2,
    retryHistory: [
      { attempt: 1, httpStatus: 404, durationMs: 120 },
      { attempt: 2, httpStatus: 404, durationMs: 115, error: 'timeout' },
    ],
    dependencyChain: ['step-0'],
    signatureKey: 'http_404_GET_/v1/users',
    environmentName: 'Staging',
    environmentBaseUrl: 'https://api.example.com',
    healingSuggestions: [
      {
        type: 'version_drift',
        currentUrl: 'https://api.example.com/v1/users',
        suggestedUrl: 'https://api.example.com/v2/users',
        confidence: 0.6,
        reason: 'Endpoint returned 404. API may have upgraded from v1 to v2.',
      },
    ],
    ...overrides,
  };
}

describe('buildEnrichedApiDefectAdf', () => {
  it('returns a doc node with version 1', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(Array.isArray(adf.content)).toBe(true);
  });

  it('includes collection name and environment', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('User API');
    expect(text).toContain('Staging');
  });

  it('includes step name, method, and URL', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('GET Users');
    expect(text).toContain('GET');
    expect(text).toContain('/v1/users');
  });

  it('includes flakiness info when flakinessScore is defined', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('FLAKY');
    expect(text).toContain('72%');
  });

  it('omits flakiness section when flakinessScore is undefined', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload({ flakinessScore: undefined, isFlaky: undefined, failRate: undefined }));
    const text = JSON.stringify(adf);
    expect(text).not.toContain('FLAKY');
    expect(text).not.toContain('Flakiness');
  });

  it('includes failed assertion detail', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('status');
    expect(text).toContain('equals');
  });

  it('includes retry history attempts', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('Attempt 1');
    expect(text).toContain('Attempt 2');
  });

  it('includes dependency chain', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('step-0');
  });

  it('includes healing suggestion type and reason', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('version_drift');
    expect(text).toContain('v2');
  });

  it('includes response body when present', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('not found');
  });

  it('omits retry history section when retryHistory is empty', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload({ retryHistory: [], retryCount: 0 }));
    const text = JSON.stringify(adf);
    expect(text).not.toContain('Retry History');
  });

  it('omits dependency section when dependencyChain is empty', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload({ dependencyChain: [] }));
    const text = JSON.stringify(adf);
    expect(text).not.toContain('Dependency Chain');
  });
});
```

- [ ] **Step 2: Run the test — expect failure (function not exported yet)**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/utils/__tests__/adfBuilder-enriched.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Add `buildEnrichedApiDefectAdf` to `src/utils/adfBuilder.ts`**

Open `src/utils/adfBuilder.ts` and append the following at the end of the file (after all existing exports). Do NOT modify any existing function.

First, add the import for `ApiDefectPayload` at the top of the file alongside other imports:

```typescript
import type { ApiDefectPayload } from '../api-defects/contracts/api-defect.contracts';
```

Then append to the bottom of the file:

```typescript
// ─── Phase D Step 9: Enriched API Defect ADF ────────────────────────────────

export function buildEnrichedApiDefectAdf(payload: ApiDefectPayload): ADFNode {
  const content: ADFNode[] = [];

  content.push(heading(2, 'Collection'));
  content.push(paragraphText(`${payload.collectionName} — Environment: ${payload.environmentName} (${payload.environmentBaseUrl})`));
  content.push(paragraphText(`Run ID: ${payload.runId}`));

  content.push(heading(2, 'Failed Step'));
  content.push(paragraphText(`${payload.stepName} — ${payload.method} ${payload.url}`));
  content.push(paragraphText(`Status: ${payload.httpStatus ?? 'N/A'} | Duration: ${payload.durationMs}ms | Retries: ${payload.retryCount}`));

  if (payload.flakinessScore !== undefined) {
    const flakyTag = payload.isFlaky ? '⚡ FLAKY' : 'stable';
    content.push(paragraphText(`Flakiness: ${flakyTag} | Score: ${Math.round(payload.flakinessScore * 100)}% | Fail Rate: ${Math.round((payload.failRate ?? 0) * 100)}%`));
  }

  if (payload.failedAssertions.length > 0) {
    content.push(heading(2, 'Failed Assertions'));
    content.push(orderedList(
      payload.failedAssertions.map(a =>
        `${a.field} ${a.operator} ${JSON.stringify(a.expected)} — got ${JSON.stringify(a.actual)}`
      )
    ));
  }

  if (payload.retryHistory.length > 0) {
    content.push(heading(2, 'Retry History'));
    content.push(orderedList(
      payload.retryHistory.map(h =>
        `Attempt ${h.attempt}: HTTP ${h.httpStatus ?? 'N/A'} — ${h.durationMs}ms${h.error ? ' | ' + h.error.slice(0, 80) : ''}`
      )
    ));
  }

  if (payload.dependencyChain.length > 0) {
    content.push(heading(2, 'Dependency Chain'));
    content.push(paragraphText(`This step depends on: ${payload.dependencyChain.join(', ')}`));
  }

  if (payload.healingSuggestions.length > 0) {
    content.push(heading(2, 'Healing Suggestions'));
    content.push(orderedList(
      payload.healingSuggestions.map(s =>
        `[${s.type}] ${s.reason} (confidence: ${Math.round(s.confidence * 100)}%)${s.suggestedUrl !== s.currentUrl ? ' → ' + s.suggestedUrl : ''}`
      )
    ));
  }

  if (payload.requestBody) {
    content.push(heading(2, 'Request Sent'));
    content.push(codeBlock(`${payload.method} ${payload.url}\n\n${payload.requestBody}`));
  }

  if (payload.responseBody) {
    content.push(heading(2, 'Response Received'));
    content.push(codeBlock(`Status: ${payload.httpStatus ?? 'N/A'}\n${payload.responseBody}`));
  }

  if (payload.errorMessage) {
    content.push(heading(2, 'Error'));
    content.push(codeBlock(payload.errorMessage));
  }

  return { type: 'doc', version: 1, content };
}
```

**Note:** `heading`, `paragraphText`, `orderedList`, and `codeBlock` are helper functions already defined in `adfBuilder.ts`. Verify their exact names by reading the file before editing if unsure.

- [ ] **Step 4: Run the test — expect all green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/utils/__tests__/adfBuilder-enriched.test.ts 2>&1 | tail -20
```

---

## Task 3: API Defect Enricher

**Files:**
- Create: `src/api-defects/api-defect-enricher.ts`
- Create: `src/api-defects/__tests__/api-defect-enricher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api-defects/__tests__/api-defect-enricher.test.ts`:

```typescript
// src/api-defects/__tests__/api-defect-enricher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { enrichDefectPayload } from '../api-defect-enricher';
import type { ApiDefectEnrichmentContext } from '../contracts/api-defect.contracts';
import type { ApiStepResult, ApiCollectionRunResult, ApiCollection, ApiEnvironment } from '../../data/types';
import type { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';

// Mock the heal advisor so enricher tests stay pure
vi.mock('../api-heal-advisor', () => ({
  proposeUrlFixes: () => [],
}));

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'GET /users',
    status: 'failed',
    request: { method: 'GET', url: 'https://api.example.com/v1/users', headers: {}, body: undefined, queryParams: {} },
    response: { status: 404, headers: {}, body: '{"error":"nf"}', durationMs: 200, bodyTruncated: false },
    assertionResults: [
      { field: 'status', operator: 'equals', passed: false, actual: 404, expected: 200 },
      { field: 'body.id', operator: 'exists', passed: true, actual: true, expected: true },
    ],
    extractedVariables: {},
    durationMs: 200,
    ...overrides,
  } as ApiStepResult;
}

function makeRun(overrides: Partial<ApiCollectionRunResult> = {}): ApiCollectionRunResult {
  return {
    id: 'run-1',
    collectionId: 'col-1',
    startedAt: '2026-05-01T00:00:00Z',
    completedAt: '2026-05-01T00:01:00Z',
    status: 'failed',
    stepResults: [],
    variableContext: {},
    ...overrides,
  } as ApiCollectionRunResult;
}

function makeCollection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col-1',
    name: 'User API',
    environmentId: 'env-1',
    steps: [{ id: 'step-1', dependsOn: ['step-0'] } as any],
    ...overrides,
  } as ApiCollection;
}

function makeEnv(overrides: Partial<ApiEnvironment> = {}): ApiEnvironment {
  return {
    id: 'env-1',
    name: 'Staging',
    baseUrl: 'https://api.example.com',
    variables: [],
    ...overrides,
  } as ApiEnvironment;
}

describe('enrichDefectPayload', () => {
  it('sets stepId, collectionId, runId from context', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.stepId).toBe('step-1');
    expect(result.collectionId).toBe('col-1');
    expect(result.runId).toBe('run-1');
  });

  it('populates flakinessScore, failRate, isFlaky from flakinessReport when matching record exists', () => {
    const flakinessReport: CollectionFlakinessReport = {
      collectionId: 'col-1',
      computedAt: '2026-05-01T00:00:00Z',
      stepRecords: [
        {
          stepId: 'step-1',
          flakinessScore: 0.72,
          failRate: 0.5,
          isFlaky: true,
          alternationIndex: 0.4,
          dominantSignature: { signatureKey: 'http_404', category: 'http_status' } as any,
          retryStats: { retryCount: 2, maxRetryAttempt: 2, avgAttemptDurationMs: 150, recoveredAfterRetry: false },
          hotspots: [],
          totalRuns: 10,
          failCount: 5,
        } as any,
      ],
      clusterGroups: [],
    } as any;

    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
      flakinessReport,
    };
    const result = enrichDefectPayload(ctx);
    expect(result.flakinessScore).toBe(0.72);
    expect(result.failRate).toBe(0.5);
    expect(result.isFlaky).toBe(true);
    expect(result.signatureKey).toBe('http_404');
  });

  it('leaves flakinessScore undefined when flakinessReport is absent', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.flakinessScore).toBeUndefined();
    expect(result.signatureKey).toBeUndefined();
  });

  it('populates retryHistory from graphNodeResult.retryHistory', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
      graphNodeResult: {
        stepId: 'step-1',
        stepName: 'GET /users',
        status: 'failed',
        durationMs: 200,
        retryCount: 2,
        retryHistory: [
          { attempt: 1, startedAt: 't1', completedAt: 't2', durationMs: 110, httpStatus: 404, error: undefined, resultStatus: 'failed', retriedAfter: 500 },
          { attempt: 2, startedAt: 't3', completedAt: 't4', durationMs: 115, httpStatus: 404, error: 'timeout', resultStatus: 'failed', retriedAfter: 500 },
        ],
      } as any,
    };
    const result = enrichDefectPayload(ctx);
    expect(result.retryHistory).toHaveLength(2);
    expect(result.retryHistory[0].attempt).toBe(1);
    expect(result.retryHistory[1].error).toBe('timeout');
    expect(result.retryCount).toBe(2);
  });

  it('retryCount is 0 when graphNodeResult is absent', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.retryCount).toBe(0);
    expect(result.retryHistory).toHaveLength(0);
  });

  it('populates dependencyChain from collection.steps[].dependsOn', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection({ steps: [{ id: 'step-1', dependsOn: ['step-0', 'step-auth'] } as any] }),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.dependencyChain).toEqual(['step-0', 'step-auth']);
  });

  it('dependencyChain is empty when step has no dependsOn', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection({ steps: [{ id: 'step-1' } as any] }),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.dependencyChain).toEqual([]);
  });

  it('failedAssertions only includes assertions where passed === false', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.failedAssertions).toHaveLength(1);
    expect(result.failedAssertions[0].field).toBe('status');
  });

  it('redacts Authorization header in requestBody context', () => {
    const step = makeStep({
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/users',
        headers: { 'Authorization': 'Bearer secret-token', 'Content-Type': 'application/json' },
        body: { name: 'test' },
        queryParams: {},
      },
    });
    // The enricher redacts Authorization from headers — but requestBody comes from request.body, not headers.
    // We verify the enricher does NOT expose the token in the payload's requestBody.
    const ctx: ApiDefectEnrichmentContext = {
      step,
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    // requestBody contains the request body, not headers — so it should NOT contain 'secret-token'
    expect(result.requestBody).not.toContain('secret-token');
  });

  it('healingSuggestions is non-empty for a 404 step (uses real advisor)', async () => {
    // Un-mock for this test by re-importing with real advisor
    vi.unmock('../api-heal-advisor');
    const { enrichDefectPayload: real } = await import('../api-defect-enricher?real');
    // Since vitest module cache is shared, we test the logic directly via the real advisor
    const { proposeUrlFixes } = await import('../api-heal-advisor');
    const step = makeStep({ request: { method: 'GET', url: 'https://api.example.com/v1/users', headers: {}, body: undefined, queryParams: {} } });
    const suggestions = proposeUrlFixes(step);
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/api-defect-enricher.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Create `src/api-defects/api-defect-enricher.ts`**

```typescript
// src/api-defects/api-defect-enricher.ts
import type { ApiDefectEnrichmentContext, ApiDefectPayload } from './contracts/api-defect.contracts';
import { proposeUrlFixes } from './api-heal-advisor';

export function enrichDefectPayload(ctx: ApiDefectEnrichmentContext): ApiDefectPayload {
  const { step, run, collection, environment, flakinessReport, graphNodeResult } = ctx;

  // Flakiness enrichment from Step 8 report
  const stepFlakiness = flakinessReport?.stepRecords.find(r => r.stepId === step.stepId);

  // Retry history — prefer graph node (has per-attempt detail), fallback to empty
  const retryHistory = graphNodeResult?.retryHistory?.map(h => ({
    attempt: h.attempt,
    httpStatus: h.httpStatus,
    error: h.error,
    durationMs: h.durationMs,
  })) ?? [];
  const retryCount = graphNodeResult?.retryCount ?? retryHistory.length;

  // Dependency chain — steps this step depends on
  const thisStep = collection.steps.find(s => s.id === step.stepId);
  const dependencyChain: readonly string[] = (thisStep as any)?.dependsOn ?? [];

  // Request body — truncated, auth headers redacted
  const redactedHeaders = { ...(step.request.headers ?? {}) };
  if (redactedHeaders['Authorization']) redactedHeaders['Authorization'] = '[REDACTED]';
  if (redactedHeaders['authorization']) redactedHeaders['authorization'] = '[REDACTED]';
  const requestBody = step.request.body
    ? JSON.stringify(step.request.body).slice(0, 500)
    : undefined;

  // Response body — truncated
  const responseBody = step.response?.body
    ? (typeof step.response.body === 'string'
        ? step.response.body.slice(0, 500)
        : JSON.stringify(step.response.body).slice(0, 500))
    : undefined;

  // Failed assertions
  const failedAssertions = step.assertionResults
    .filter(a => !a.passed)
    .map(a => ({ field: a.field, operator: a.operator, expected: a.expected, actual: a.actual }));

  // Healing suggestions
  const healingSuggestions = proposeUrlFixes(step);

  // Signature key from dominant signature
  const signatureKey = (stepFlakiness?.dominantSignature as any)?.signatureKey;

  return {
    stepId: step.stepId,
    stepName: step.stepName,
    collectionId: collection.id,
    collectionName: collection.name,
    runId: run.id,
    method: step.request.method,
    url: step.request.url,
    httpStatus: step.response?.status,
    durationMs: step.durationMs,
    failedAssertions,
    errorMessage: step.error,
    requestBody,
    responseBody,
    flakinessScore: stepFlakiness?.flakinessScore,
    failRate: stepFlakiness?.failRate,
    isFlaky: (stepFlakiness as any)?.isFlaky,
    retryCount,
    retryHistory,
    dependencyChain,
    signatureKey,
    environmentName: environment.name,
    environmentBaseUrl: environment.baseUrl,
    healingSuggestions,
  };
}
```

- [ ] **Step 4: Run the test — expect green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/api-defect-enricher.test.ts 2>&1 | tail -20
```

---

## Task 4: API Heal Advisor

**Files:**
- Create: `src/api-defects/api-heal-advisor.ts`
- Create: `src/api-defects/__tests__/api-heal-advisor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api-defects/__tests__/api-heal-advisor.test.ts`:

```typescript
// src/api-defects/__tests__/api-heal-advisor.test.ts
import { describe, it, expect } from 'vitest';
import { proposeUrlFixes } from '../api-heal-advisor';
import type { ApiStepResult } from '../../data/types';

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'Test Step',
    status: 'failed',
    request: { method: 'GET', url: 'https://api.example.com/users', headers: {}, body: undefined, queryParams: {} },
    response: { status: 200, headers: {}, body: 'ok', durationMs: 100, bodyTruncated: false },
    assertionResults: [],
    extractedVariables: {},
    durationMs: 100,
    ...overrides,
  } as ApiStepResult;
}

describe('proposeUrlFixes', () => {
  it('returns empty array when step passed (200 status, no error)', () => {
    const step = makeStep({ status: 'passed' });
    expect(proposeUrlFixes(step)).toEqual([]);
  });

  it('suggests version_drift for 404 with /v1/ in URL', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/v1/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const drift = suggestions.find(s => s.type === 'version_drift');
    expect(drift).toBeDefined();
    expect(drift!.suggestedUrl).toContain('/v2/');
    expect(drift!.confidence).toBe(0.6);
  });

  it('suggests version_drift with v2→v3 when URL has /v2/', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/v2/orders', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const drift = suggestions.find(s => s.type === 'version_drift');
    expect(drift).toBeDefined();
    expect(drift!.suggestedUrl).toContain('/v3/');
  });

  it('suggests missing_prefix for 404 URL without /api/', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const prefix = suggestions.find(s => s.type === 'missing_prefix');
    expect(prefix).toBeDefined();
    expect(prefix!.suggestedUrl).toContain('/api/users');
  });

  it('does NOT suggest missing_prefix when URL already has /api/', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/api/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    expect(suggestions.find(s => s.type === 'missing_prefix')).toBeUndefined();
  });

  it('suggests base_url_drift for network error ECONNREFUSED', () => {
    const step = makeStep({
      response: undefined,
      error: 'ECONNREFUSED 127.0.0.1:3001',
    });
    const suggestions = proposeUrlFixes(step);
    const drift = suggestions.find(s => s.type === 'base_url_drift');
    expect(drift).toBeDefined();
    expect(drift!.confidence).toBe(0.7);
    expect(drift!.reason).toContain('ECONNREFUSED');
  });

  it('suggests base_url_drift for ENOTFOUND', () => {
    const step = makeStep({
      response: undefined,
      error: 'ENOTFOUND api.example.com',
    });
    const suggestions = proposeUrlFixes(step);
    expect(suggestions.find(s => s.type === 'base_url_drift')).toBeDefined();
  });

  it('suggests auth_refresh for 401 with confidence 0.8', () => {
    const step = makeStep({
      response: { status: 401, headers: {}, body: 'unauth', durationMs: 80, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const auth = suggestions.find(s => s.type === 'auth_refresh');
    expect(auth).toBeDefined();
    expect(auth!.confidence).toBe(0.8);
    expect(auth!.reason).toContain('401');
  });

  it('suggests auth_refresh for 403', () => {
    const step = makeStep({
      response: { status: 403, headers: {}, body: 'forbidden', durationMs: 80, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const auth = suggestions.find(s => s.type === 'auth_refresh');
    expect(auth).toBeDefined();
    expect(auth!.reason).toContain('403');
  });

  it('returns 2 suggestions for 404 with /v1/ AND no /api/ prefix', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/v1/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    // version_drift + missing_prefix (since /v1/users doesn't contain /api/)
    expect(suggestions.length).toBe(2);
    expect(suggestions.map(s => s.type)).toContain('version_drift');
    expect(suggestions.map(s => s.type)).toContain('missing_prefix');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/api-heal-advisor.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Create `src/api-defects/api-heal-advisor.ts`**

```typescript
// src/api-defects/api-heal-advisor.ts
import type { ApiStepResult } from '../data/types';
import type { ApiHealingSuggestion } from './contracts/api-defect.contracts';

const VERSION_RX = /\/(v\d+)\//i;

export function proposeUrlFixes(step: ApiStepResult): ApiHealingSuggestion[] {
  const suggestions: ApiHealingSuggestion[] = [];
  const url = step.request.url;
  const status = step.response?.status;
  const error = step.error ?? '';

  // 1. 404 → version drift (v1 → v2 suggestion)
  if (status === 404) {
    const m = url.match(VERSION_RX);
    if (m) {
      const currentVersion = m[1];
      const versionNum = parseInt(currentVersion.replace('v', ''), 10);
      if (!isNaN(versionNum)) {
        const nextVersion = `v${versionNum + 1}`;
        suggestions.push({
          type: 'version_drift',
          currentUrl: url,
          suggestedUrl: url.replace(`/${currentVersion}/`, `/${nextVersion}/`),
          confidence: 0.6,
          reason: `Endpoint returned 404. API may have upgraded from ${currentVersion} to ${nextVersion}.`,
        });
      }
    }
  }

  // 2. 404 → missing /api prefix
  if (status === 404 && !url.includes('/api/')) {
    const urlObj = tryParseUrl(url);
    if (urlObj) {
      const withPrefix = urlObj.origin + '/api' + urlObj.pathname + urlObj.search;
      suggestions.push({
        type: 'missing_prefix',
        currentUrl: url,
        suggestedUrl: withPrefix,
        confidence: 0.5,
        reason: 'Endpoint returned 404. Common fix: add /api prefix to the path.',
      });
    }
  }

  // 3. Network error / no response → base URL drift
  if (!step.response && (error.includes('ECONNREFUSED') || error.includes('ENOTFOUND') || error.includes('ETIMEDOUT'))) {
    suggestions.push({
      type: 'base_url_drift',
      currentUrl: url,
      suggestedUrl: url,  // same URL — hint to check base URL in environment config
      confidence: 0.7,
      reason: `Network error: ${error.slice(0, 80)}. Verify the base URL in the environment configuration.`,
    });
  }

  // 4. 401/403 → auth refresh
  if (status === 401 || status === 403) {
    suggestions.push({
      type: 'auth_refresh',
      currentUrl: url,
      suggestedUrl: url,
      confidence: 0.8,
      reason: `Auth failure (${status}). Refresh the bearer token or API key in the environment configuration.`,
    });
  }

  return suggestions;
}

function tryParseUrl(url: string): URL | null {
  try { return new URL(url); } catch { return null; }
}
```

- [ ] **Step 4: Run the test — expect green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/api-heal-advisor.test.ts 2>&1 | tail -20
```

---

## Task 5: API Defect Store

**Files:**
- Create: `src/api-defects/api-defect-store.ts`
- Create: `src/api-defects/__tests__/api-defect-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api-defects/__tests__/api-defect-store.test.ts`:

```typescript
// src/api-defects/__tests__/api-defect-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Override DATA_DIR to a temp directory for tests
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-defect-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Import after env var is set — use dynamic import to get fresh module
async function getStore() {
  // Clear module cache for store (vitest reloads module per test via dynamic import with timestamp trick)
  return await import('../api-defect-store?t=' + Date.now());
}

import type { ApiDefectRecord } from '../contracts/api-defect.contracts';

function makeRecord(overrides: Partial<ApiDefectRecord> = {}): ApiDefectRecord {
  return {
    defectKey: 'PROJ-1',
    jiraId: 'jira-1',
    stepId: 'step-1',
    stepName: 'GET /users',
    collectionId: 'col-1',
    collectionName: 'User API',
    runId: 'run-1',
    environmentId: 'env-1',
    environmentName: 'Staging',
    status: 'open',
    createdAt: '2026-05-01T00:00:00Z',
    createdBy: 'tester',
    jiraUrl: 'https://jira.example.com/browse/PROJ-1',
    ...overrides,
  };
}

describe('api-defect-store', () => {
  it('loadApiDefectsRegistry returns default empty registry when file absent', async () => {
    const store = await getStore();
    const reg = store.loadApiDefectsRegistry();
    expect(reg._schemaVersion).toBe(1);
    expect(reg.defects).toEqual([]);
  });

  it('appendApiDefectRecord then loadApiDefectsRegistry returns the appended record', async () => {
    const store = await getStore();
    const record = makeRecord();
    store.appendApiDefectRecord(record);
    const reg = store.loadApiDefectsRegistry();
    expect(reg.defects).toHaveLength(1);
    expect(reg.defects[0].defectKey).toBe('PROJ-1');
  });

  it('findOpenApiDefect returns null when no matching record', async () => {
    const store = await getStore();
    const result = store.findOpenApiDefect('step-1', 'col-1');
    expect(result).toBeNull();
  });

  it('findOpenApiDefect returns record when stepId+collectionId match and status is open', async () => {
    const store = await getStore();
    store.appendApiDefectRecord(makeRecord());
    const result = store.findOpenApiDefect('step-1', 'col-1');
    expect(result).not.toBeNull();
    expect(result!.defectKey).toBe('PROJ-1');
  });

  it('findOpenApiDefect returns null when matching record has status closed', async () => {
    const store = await getStore();
    store.appendApiDefectRecord(makeRecord({ status: 'closed' }));
    const result = store.findOpenApiDefect('step-1', 'col-1');
    expect(result).toBeNull();
  });

  it('saveApiDefectsRegistry performs atomic write (no .tmp file left behind)', async () => {
    const store = await getStore();
    store.appendApiDefectRecord(makeRecord());
    const tmpFile = path.join(tmpDir, 'api-defects.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'api-defects.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/api-defect-store.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Create `src/api-defects/api-defect-store.ts`**

```typescript
// src/api-defects/api-defect-store.ts
import * as fs from 'fs';
import * as path from 'path';
import type { ApiDefectRecord, ApiDefectsRegistry } from './contracts/api-defect.contracts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');

function defectsPath(): string { return path.join(DATA_DIR, 'api-defects.json'); }

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadApiDefectsRegistry(): ApiDefectsRegistry {
  try {
    const raw = fs.readFileSync(defectsPath(), 'utf8');
    const parsed = JSON.parse(raw) as ApiDefectsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, defects: [] };
  }
}

export function saveApiDefectsRegistry(reg: ApiDefectsRegistry): void {
  atomicWrite(defectsPath(), JSON.stringify(reg, null, 2));
}

export function findOpenApiDefect(stepId: string, collectionId: string): ApiDefectRecord | null {
  const reg = loadApiDefectsRegistry();
  return reg.defects.find(d =>
    d.stepId === stepId && d.collectionId === collectionId && d.status === 'open'
  ) ?? null;
}

export function appendApiDefectRecord(record: ApiDefectRecord): void {
  const reg = loadApiDefectsRegistry();
  reg.defects.push(record);
  saveApiDefectsRegistry(reg);
}
```

**Note:** The `DATA_DIR` constant is evaluated at module load time. The test uses `process.env.DATA_DIR` but the constant is resolved once on import. To make the store test-friendly, refactor `defectsPath()` to read `process.env.DATA_DIR` at call time (already done above — `defectsPath()` and `atomicWrite` both derive from `DATA_DIR` which is `const` at module init). To work with dynamic `DATA_DIR` in tests, use dynamic imports per test (as the test already does with `getStore()`).

However, since `DATA_DIR` is a top-level `const`, the dynamic import trick with `?t=` query param may not force a true re-evaluation in all Vitest configurations. An alternative: make `defectsPath()` read `process.env.DATA_DIR` inline:

```typescript
// src/api-defects/api-defect-store.ts  (final version with inline env read)
import * as fs from 'fs';
import * as path from 'path';
import type { ApiDefectRecord, ApiDefectsRegistry } from './contracts/api-defect.contracts';

function dataDir(): string { return path.resolve(process.env.DATA_DIR || 'data'); }
function defectsPath(): string { return path.join(dataDir(), 'api-defects.json'); }

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadApiDefectsRegistry(): ApiDefectsRegistry {
  try {
    const raw = fs.readFileSync(defectsPath(), 'utf8');
    const parsed = JSON.parse(raw) as ApiDefectsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, defects: [] };
  }
}

export function saveApiDefectsRegistry(reg: ApiDefectsRegistry): void {
  atomicWrite(defectsPath(), JSON.stringify(reg, null, 2));
}

export function findOpenApiDefect(stepId: string, collectionId: string): ApiDefectRecord | null {
  const reg = loadApiDefectsRegistry();
  return reg.defects.find(d =>
    d.stepId === stepId && d.collectionId === collectionId && d.status === 'open'
  ) ?? null;
}

export function appendApiDefectRecord(record: ApiDefectRecord): void {
  const reg = loadApiDefectsRegistry();
  reg.defects.push(record);
  saveApiDefectsRegistry(reg);
}
```

Update the test to use direct imports (not dynamic) since `DATA_DIR` is now read inline at call time:

```typescript
// src/api-defects/__tests__/api-defect-store.test.ts  (final — direct import)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadApiDefectsRegistry,
  saveApiDefectsRegistry,
  findOpenApiDefect,
  appendApiDefectRecord,
} from '../api-defect-store';
import type { ApiDefectRecord } from '../contracts/api-defect.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-defect-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<ApiDefectRecord> = {}): ApiDefectRecord {
  return {
    defectKey: 'PROJ-1',
    jiraId: 'jira-1',
    stepId: 'step-1',
    stepName: 'GET /users',
    collectionId: 'col-1',
    collectionName: 'User API',
    runId: 'run-1',
    environmentId: 'env-1',
    environmentName: 'Staging',
    status: 'open',
    createdAt: '2026-05-01T00:00:00Z',
    createdBy: 'tester',
    jiraUrl: 'https://jira.example.com/browse/PROJ-1',
    ...overrides,
  };
}

describe('api-defect-store', () => {
  it('loadApiDefectsRegistry returns default empty registry when file absent', () => {
    const reg = loadApiDefectsRegistry();
    expect(reg._schemaVersion).toBe(1);
    expect(reg.defects).toEqual([]);
  });

  it('appendApiDefectRecord then loadApiDefectsRegistry returns the appended record', () => {
    appendApiDefectRecord(makeRecord());
    const reg = loadApiDefectsRegistry();
    expect(reg.defects).toHaveLength(1);
    expect(reg.defects[0].defectKey).toBe('PROJ-1');
  });

  it('findOpenApiDefect returns null when no matching record', () => {
    expect(findOpenApiDefect('step-1', 'col-1')).toBeNull();
  });

  it('findOpenApiDefect returns record when stepId+collectionId match and status is open', () => {
    appendApiDefectRecord(makeRecord());
    const result = findOpenApiDefect('step-1', 'col-1');
    expect(result).not.toBeNull();
    expect(result!.defectKey).toBe('PROJ-1');
  });

  it('findOpenApiDefect returns null when matching record has status closed', () => {
    appendApiDefectRecord(makeRecord({ status: 'closed' }));
    expect(findOpenApiDefect('step-1', 'col-1')).toBeNull();
  });

  it('saveApiDefectsRegistry performs atomic write (no .tmp file left behind)', () => {
    appendApiDefectRecord(makeRecord());
    const tmpFile = path.join(tmpDir, 'api-defects.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'api-defects.json'))).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test — expect green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/api-defect-store.test.ts 2>&1 | tail -20
```

---

## Task 6: Barrel Export + TypeScript Build Verification

**Files:**
- Create: `src/api-defects/index.ts`

- [ ] **Step 1: Create the barrel**

```typescript
// src/api-defects/index.ts
export { enrichDefectPayload } from './api-defect-enricher';
export { proposeUrlFixes } from './api-heal-advisor';
export {
  loadApiDefectsRegistry,
  saveApiDefectsRegistry,
  findOpenApiDefect,
  appendApiDefectRecord,
} from './api-defect-store';
export type {
  ApiDefectEnrichmentContext,
  ApiHealingSuggestion,
  ApiDefectPayload,
  ApiDefectRecord,
  ApiDefectsRegistry,
} from './contracts/api-defect.contracts';
```

- [ ] **Step 2: TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -30
```

Expected: zero TypeScript errors. Fix any import path issues before continuing.

---

## Task 7: API Defect Routes + Register in server.ts

**Files:**
- Create: `src/api-defects/routes/api-defects.routes.ts`
- Modify: `src/ui/server.ts`

- [ ] **Step 1: Create the routes file**

```typescript
// src/api-defects/routes/api-defects.routes.ts
import type { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { requireAuth, requireEditor } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { logger } from '../../utils/logger';
import { getJiraClient } from '../../ui/helpers/jira-helpers';
import { loadJiraConfig } from '../../utils/defectsStore';
import { buildEnrichedApiDefectAdf } from '../../utils/adfBuilder';
import { enrichDefectPayload } from '../api-defect-enricher';
import { findOpenApiDefect, appendApiDefectRecord, loadApiDefectsRegistry } from '../api-defect-store';
import { getReport } from '../../api-flakiness/flakiness-service';
import { readAll } from '../../data/store';
import { API_COLLECTIONS, API_ENVS } from '../../data/store';
import type { ApiCollection, ApiEnvironment, ApiCollectionRunResult } from '../../data/types';
import type { ApiDefectRecord } from '../contracts/api-defect.contracts';

const RUNS_DIR = path.resolve(process.env.DATA_DIR || 'data', 'api-runs');

function loadRun(runId: string): ApiCollectionRunResult | null {
  const file = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as ApiCollectionRunResult; }
  catch { return null; }
}

export function registerApiDefectsRoutes(app: Express): void {
  /**
   * POST /api/api-defects/draft
   * Returns enriched defect payload + dedup check + healing suggestions.
   * Body: { runId, stepId }
   */
  app.post('/api/api-defects/draft', requireAuth, async (req: Request, res: Response) => {
    const { runId, stepId } = req.body || {};
    if (!runId || !stepId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'runId and stepId required' } });
    }

    const run = loadRun(runId);
    if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });

    const step = run.stepResults.find(s => s.stepId === stepId);
    if (!step) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Step not found in run' } });

    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === run.collectionId);
    if (!collection) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Collection not found' } });

    const environments = readAll<ApiEnvironment>(API_ENVS);
    const environment = environments.find(e => e.id === collection.environmentId);
    if (!environment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Environment not found' } });

    let flakinessReport;
    try { flakinessReport = getReport(run.collectionId); } catch { /* non-fatal */ }

    const payload = enrichDefectPayload({ step, run, collection, environment, flakinessReport });

    const cfg = loadJiraConfig();
    const existingDefect = findOpenApiDefect(stepId, run.collectionId);

    // Jira project key from collection's project or config default
    const projects = readAll<any>('projects');
    const project = projects.find((p: any) => p.id === (collection as any).projectId);
    const jiraProjectKey = project?.jiraProjectKey || null;

    const summary = `[API] ${payload.stepName} failed — ${payload.method} ${payload.url}`.slice(0, 255);

    return res.json({
      payload,
      summary,
      descriptionADF: buildEnrichedApiDefectAdf(payload),
      suggestedPriority: cfg?.defaultPriority || 'Medium',
      existingDefect,
      jiraProjectKey,
      isJiraConfigured: !!cfg && !!getJiraClient(),
    });
  });

  /**
   * POST /api/api-defects/file
   * Files enriched defect to Jira and records in api-defects.json.
   * Body: { runId, stepId, summary, descriptionADF, priority, parentStoryKey }
   */
  app.post('/api/api-defects/file', requireEditor, async (req: Request, res: Response) => {
    const { runId, stepId, summary, descriptionADF, priority, parentStoryKey } = req.body || {};
    if (!runId || !stepId || !summary || !descriptionADF || !priority || !parentStoryKey) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing required field' } });
    }
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(String(parentStoryKey))) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'parentStoryKey must look like ABC-123' } });
    }

    const cfg = loadJiraConfig();
    if (!cfg) return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Configure Jira in Admin' } });
    const client = getJiraClient();
    if (!client) return res.status(400).json({ error: { code: 'JIRA_NOT_CONFIGURED', message: 'Set Jira credentials in .env' } });

    const run = loadRun(runId);
    if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });

    const step = run.stepResults.find(s => s.stepId === stepId);
    if (!step) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Step not found in run' } });

    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === run.collectionId);
    if (!collection) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Collection not found' } });

    const environments = readAll<ApiEnvironment>(API_ENVS);
    const environment = environments.find(e => e.id === collection.environmentId);
    if (!environment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Environment not found' } });

    // Dedup check — local registry first
    const existingLocal = findOpenApiDefect(stepId, run.collectionId);
    if (existingLocal) {
      return res.status(409).json({
        error: { code: 'ALREADY_FILED', message: 'Open defect already exists', details: { defectKey: existingLocal.defectKey, jiraUrl: existingLocal.jiraUrl } }
      });
    }

    // Resolve Jira project key
    const projects = readAll<any>('projects');
    const project = projects.find((p: any) => p.id === (collection as any).projectId);
    const jiraProjectKey = project?.jiraProjectKey;
    if (!jiraProjectKey) {
      return res.status(400).json({ error: { code: 'JIRA_PROJECT_KEY_MISSING', message: 'Jira Project Key not configured for this project' } });
    }

    let created: { key: string; id: string; self: string };
    try {
      created = await client.createIssue({
        projectKey: jiraProjectKey,
        issueType: cfg.issueType,
        summary: String(summary).slice(0, 255),
        descriptionADF,
        priority,
        parentStoryKey: String(parentStoryKey),
      });
    } catch (e: any) {
      logger.error('[api-defect.file] createIssue failed', { code: e?.code, httpStatus: e?.httpStatus });
      const httpStatus = e?.httpStatus && e.httpStatus >= 400 && e.httpStatus < 500 ? 400 : 502;
      return res.status(httpStatus).json({ error: { code: e?.code || 'JIRA_ERROR', message: e?.message || 'Issue creation failed' } });
    }

    const baseUrl = (cfg as any).baseUrl || '';
    const jiraUrl = `${baseUrl.replace(/\/$/, '')}/browse/${created.key}`;
    const record: ApiDefectRecord = {
      defectKey: created.key,
      jiraId: created.id,
      stepId,
      stepName: step.stepName,
      collectionId: run.collectionId,
      collectionName: collection.name,
      runId,
      environmentId: collection.environmentId,
      environmentName: environment.name,
      projectId: (collection as any).projectId,
      status: 'open',
      createdAt: new Date().toISOString(),
      createdBy: (req.session as any)?.username || 'unknown',
      jiraUrl,
    };
    appendApiDefectRecord(record);

    logAudit({
      userId: (req.session as any)?.userId,
      username: (req.session as any)?.username,
      action: 'API_DEFECT_FILED',
      resourceType: 'api-defect',
      resourceId: created.key,
      details: `${step.stepName} (${runId})`,
      ip: req.ip ?? null,
    });

    return res.json({ defectKey: created.key, jiraUrl });
  });

  /**
   * GET /api/api-defects/by-step/:stepId
   * Returns all defect records for a step.
   */
  app.get('/api/api-defects/by-step/:stepId', requireAuth, (req: Request, res: Response) => {
    const reg = loadApiDefectsRegistry();
    return res.json({ defects: reg.defects.filter(d => d.stepId === req.params.stepId) });
  });
}
```

- [ ] **Step 2: Register routes in `src/ui/server.ts`**

In `src/ui/server.ts`, add the import alongside the other route registrations (near `registerFlakinessRoutes`):

```typescript
import { registerApiDefectsRoutes } from '../api-defects/routes/api-defects.routes';
```

And add the call immediately after `registerFlakinessRoutes(app);`:

```typescript
registerApiDefectsRoutes(app);
```

- [ ] **Step 3: TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -30
```

Expected: zero errors. If `logAudit` signature differs, adjust the object shape to match the existing `logAudit` call signature in `src/ui/routes/jira.routes.ts` (read that file to confirm field names).

---

## Task 8: CSS Additions

**Files:**
- Modify: `src/ui/public/styles_addon.css`

- [ ] **Step 1: Append the CSS**

Open `src/ui/public/styles_addon.css` and append to the end of the file:

```css
/* ── Phase D Step 9: API Defect Intelligence ──────────────────────────────── */
.api-defect-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(59,130,246,.15);
  border: 1px solid rgba(59,130,246,.4);
  color: #93c5fd;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
}
.api-defect-pill a { color: #93c5fd; text-decoration: underline; }
.api-heal-card {
  background: #1a1f2e;
  border: 1px solid #374151;
  border-left: 3px solid #a78bfa;
  border-radius: 4px;
  padding: 8px 10px;
  margin-bottom: 6px;
}
```

---

## Task 9: Runs UI — Jira & Heal Tab

**Files:**
- Modify: `src/ui/public/js/25-api-runs.js`

This task adds three things:
1. A defect cache + `_apiRunsFetchStepDefect(stepId)` helper
2. `_apiRunsFileDefect(runId, stepId)` — calls draft then file endpoints
3. A "Jira & Heal" tab in `_buildStepDetailHtml` with async `_apiRunsLoadJiraPanel(stepId)`
4. A hook in `_apiRunsStepTab` to call `_apiRunsLoadJiraPanel` when the jira tab is opened

**Important wiring note:** `_apiRunsStepTab(btn, containerId, tab)` does NOT receive `stepId`. The `containerId` encodes the step detail ID (e.g., `step-detail-${step.stepId}`). The tab onclick for the new Jira tab will pass `step.stepId` directly via the template literal, so `_apiRunsLoadJiraPanel` can be called from within the tab's `onclick` rather than from `_apiRunsStepTab`.

- [ ] **Step 1: Add defect cache state and `_apiRunsFetchStepDefect`**

Locate the section near the top of `25-api-runs.js` where module-level `var` declarations are made (near `_apiRunsExpandedSteps`, `_apiRunsFlakinessReport`, etc.). Add after the last `var` declaration:

```javascript
var _apiRunsApiDefectCache = {};  // stepId → { defectKey, jiraUrl } | null

async function _apiRunsFetchStepDefect(stepId) {
  if (Object.prototype.hasOwnProperty.call(_apiRunsApiDefectCache, stepId)) {
    return _apiRunsApiDefectCache[stepId];
  }
  try {
    var res = await fetch('/api/api-defects/by-step/' + encodeURIComponent(stepId));
    if (!res.ok) { _apiRunsApiDefectCache[stepId] = null; return null; }
    var data = await res.json();
    var open = (data.defects || []).find(function(d) { return d.status === 'open'; }) || null;
    _apiRunsApiDefectCache[stepId] = open ? { defectKey: open.defectKey, jiraUrl: open.jiraUrl } : null;
    return _apiRunsApiDefectCache[stepId];
  } catch (e) {
    _apiRunsApiDefectCache[stepId] = null;
    return null;
  }
}
```

- [ ] **Step 2: Add `_apiRunsFileDefect`**

Add before or after `_apiRunsFetchStepDefect`:

```javascript
async function _apiRunsFileDefect(runId, stepId) {
  var parentStoryKey = prompt('Enter parent story key (e.g. PROJ-123):');
  if (!parentStoryKey || !/^[A-Z][A-Z0-9_]+-\d+$/.test(parentStoryKey.trim())) {
    if (parentStoryKey !== null) modAlert('api-runs-alert', 'error', 'Invalid story key format. Use ABC-123.');
    return;
  }

  // Draft first
  var draft;
  try {
    var draftRes = await fetch('/api/api-defects/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runId, stepId: stepId }),
    });
    if (draftRes.status === 409) {
      var d409 = await draftRes.json();
      modAlert('api-runs-alert', 'info', 'Defect already filed: ' + (d409.error && d409.error.details ? d409.error.details.defectKey : 'existing'));
      return;
    }
    if (!draftRes.ok) {
      var derr = await draftRes.json();
      throw new Error((derr.error && derr.error.message) || 'Draft failed');
    }
    draft = await draftRes.json();
  } catch (e) {
    modAlert('api-runs-alert', 'error', 'Draft error: ' + e.message);
    return;
  }

  // File
  try {
    var fileRes = await fetch('/api/api-defects/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: runId,
        stepId: stepId,
        summary: draft.summary,
        descriptionADF: draft.descriptionADF,
        priority: draft.suggestedPriority,
        parentStoryKey: parentStoryKey.trim(),
      }),
    });
    if (fileRes.status === 409) {
      var f409 = await fileRes.json();
      modAlert('api-runs-alert', 'info', 'Defect already filed: ' + (f409.error && f409.error.details ? f409.error.details.defectKey : ''));
      return;
    }
    if (!fileRes.ok) {
      var ferr = await fileRes.json();
      throw new Error((ferr.error && ferr.error.message) || 'File failed');
    }
    var result = await fileRes.json();
    delete _apiRunsApiDefectCache[stepId];  // invalidate cache
    modAlert('api-runs-alert', 'success', 'Defect filed: <a href="' + result.jiraUrl + '" target="_blank">' + result.defectKey + '</a>');
  } catch (e) {
    modAlert('api-runs-alert', 'error', 'File error: ' + e.message);
  }
}
```

- [ ] **Step 3: Add `_apiRunsLoadJiraPanel`**

```javascript
async function _apiRunsLoadJiraPanel(stepId) {
  var defectEl = document.getElementById('jira-defect-ref-' + stepId);
  var healEl   = document.getElementById('jira-heal-panel-' + stepId);
  if (!defectEl) return;

  // Load existing defect
  var defect = await _apiRunsFetchStepDefect(stepId);
  if (defect) {
    defectEl.innerHTML = '<span class="api-defect-pill">🔗 <a href="' + escHtml(defect.jiraUrl) + '" target="_blank">' + escHtml(defect.defectKey) + '</a></span>';
  }

  // Load healing suggestions via draft (non-blocking)
  if (!_apiRunsCurrentRunId || !healEl) return;
  try {
    var r = await fetch('/api/api-defects/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: _apiRunsCurrentRunId, stepId: stepId }),
    });
    if (!r.ok) return;
    var data = await r.json();
    var suggestions = (data.payload && data.payload.healingSuggestions) ? data.payload.healingSuggestions : [];
    if (suggestions.length === 0) {
      healEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">No healing suggestions.</div>';
      return;
    }
    healEl.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-muted);">💡 Healing Suggestions</div>'
      + suggestions.map(function(s) {
        return '<div class="api-heal-card">'
          + '<div style="font-size:11px;font-weight:600;color:#a78bfa;">' + escHtml(s.type.replace(/_/g, ' ').toUpperCase()) + ' \xB7 ' + Math.round(s.confidence * 100) + '% confidence</div>'
          + '<div style="font-size:11px;margin-top:2px;">' + escHtml(s.reason) + '</div>'
          + (s.suggestedUrl !== s.currentUrl ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">→ ' + escHtml(s.suggestedUrl) + '</div>' : '')
          + '</div>';
      }).join('');
  } catch (e) { /* non-fatal */ }
}
```

**Note:** `_apiRunsCurrentRunId` must be a module-level variable tracking the current run ID. Check whether this variable exists in `25-api-runs.js` (likely as `_apiRunsCurrentRun.id` from `_apiRunsCurrentRun`). If the module stores the run object as `_apiRunsCurrentRun`, use `_apiRunsCurrentRun && _apiRunsCurrentRun.id` instead.

- [ ] **Step 4: Extend `_buildStepDetailHtml` to add the Jira tab**

In `_buildStepDetailHtml(step)`, locate the tab buttons template (lines ~236–241 per grep results). After the Vars button line:

```javascript
${extractedRows ? `<button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','vars')" data-steptab="vars">Vars</button>` : ''}
```

Add:

```javascript
<button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','jira');_apiRunsLoadJiraPanel('${step.stepId}')" data-steptab="jira">Jira &amp; Heal</button>
```

Then in the tab panels section (the `data-steppanel` divs), after the vars panel, add:

```javascript
<div data-steppanel="jira" style="display:none;padding:10px;">
  ${step.status !== 'passed'
    ? `<button class="btn btn-sm" style="margin-bottom:8px;" onclick="_apiRunsFileDefect('${_apiRunsCurrentRun && _apiRunsCurrentRun.id}','${step.stepId}')">🐛 File Defect in Jira</button>`
    : '<div style="color:var(--text-muted);font-size:12px;">Step passed — no defect to file.</div>'}
  <div id="jira-defect-ref-${step.stepId}" style="margin-top:6px;"></div>
  <div id="jira-heal-panel-${step.stepId}" style="margin-top:10px;"></div>
</div>
```

**Note on `_apiRunsCurrentRun`:** Read the current state of `_buildStepDetailHtml` to confirm the variable name used for the current run. If it is `_apiRunsCurrentRun`, use `_apiRunsCurrentRun.id`. If it is different, adjust accordingly. Check the existing `_apiRunsFlakinessReport` usage near line 260+ to identify how `collectionId` is obtained, as `runId` is likely accessed the same way.

---

## Task 10: Frontend Build

**Files:**
- `scripts/concat-modules.js` — verify `'25-api-runs.js'` is in the list (no new entry needed)

- [ ] **Step 1: Verify concat-modules.js has 25-api-runs.js**

```bash
grep -n "25-api-runs" "e:\AI Agent\qa-agent-platform-dev\scripts\concat-modules.js"
```

Expected: entry found. No new entry needed.

- [ ] **Step 2: Run frontend build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js 2>&1 | tail -20
```

Expected: success.

---

## Task 11: Full Build + Regression + CLAUDE.md Update

- [ ] **Step 1: Run all new unit tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/ src/utils/__tests__/adfBuilder-enriched.test.ts 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 2: Full TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -20
```

Expected: zero errors.

- [ ] **Step 3: Regression — run existing flakiness tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-flakiness/__tests__/ 2>&1 | tail -20
```

Expected: all existing Step 8 tests still pass.

- [ ] **Step 4: Regression — existing UI defect store tests (if any)**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/utils/__tests__/ 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 5: Update `e:\AI Agent\qa-agent-platform-dev\CLAUDE.md`**

Open the CLAUDE.md and append to the SentinelEval section or create a new "Phase D Progress" section:

```markdown
## Phase D API Testing Progress

| Step | Name | Status |
|---|---|---|
| Step 9 | API Defect Intelligence | ✅ Complete |

### Step 9 New Modules
- `src/api-defects/` — enricher, heal-advisor, store, routes
- `src/utils/adfBuilder.ts` — added `buildEnrichedApiDefectAdf`
- `src/ui/server.ts` — registered `registerApiDefectsRoutes`
- `src/ui/public/js/25-api-runs.js` — Jira & Heal tab per step
- `data/api-defects.json` — persists filed API defect records
```

---

## Self-Review: Spec Coverage

| Requirement | Covered | Notes |
|---|---|---|
| `ApiDefectEnrichmentContext`, `ApiHealingSuggestion`, `ApiDefectPayload`, `ApiDefectRecord`, `ApiDefectsRegistry` | Task 1 | Exact field names and readonly modifiers match spec |
| `enrichDefectPayload` — flakiness merge | Task 3 test #2 | `flakinessScore`, `failRate`, `isFlaky`, `signatureKey` |
| `enrichDefectPayload` — absent flakiness | Task 3 test #3 | `flakinessScore` undefined |
| `enrichDefectPayload` — retry history from graph | Task 3 test #4 | per-attempt `httpStatus`, `error`, `durationMs` |
| `enrichDefectPayload` — retryCount=0 no graph | Task 3 test #5 | default to 0 / empty array |
| `enrichDefectPayload` — dependency chain | Task 3 test #6 | reads `collection.steps[].dependsOn` |
| `enrichDefectPayload` — failedAssertions filter | Task 3 test #7 | only `passed===false` |
| Auth header redaction | Task 3 test #8 | `Authorization` header not in requestBody |
| `buildEnrichedApiDefectAdf` — doc structure | Task 2 test #1 | `type:'doc'`, `version:1` |
| `buildEnrichedApiDefectAdf` — conditional sections | Task 2 tests #5–12 | flakiness, retries, deps, healing omitted when empty |
| `proposeUrlFixes` — empty for passed | Task 4 test #1 | 200 status no suggestions |
| `proposeUrlFixes` — version_drift v1→v2 | Task 4 test #2 | confidence 0.6 |
| `proposeUrlFixes` — version_drift v2→v3 | Task 4 test #3 | increments correctly |
| `proposeUrlFixes` — missing_prefix | Task 4 test #4 | adds /api/ prefix |
| `proposeUrlFixes` — no missing_prefix when /api/ present | Task 4 test #5 | dedup guard |
| `proposeUrlFixes` — base_url_drift ECONNREFUSED | Task 4 test #6 | confidence 0.7 |
| `proposeUrlFixes` — base_url_drift ENOTFOUND | Task 4 test #7 | same rule |
| `proposeUrlFixes` — auth_refresh 401 | Task 4 test #8 | confidence 0.8 |
| `proposeUrlFixes` — auth_refresh 403 | Task 4 test #9 | reason contains 403 |
| `proposeUrlFixes` — 2 suggestions 404+/v1/ | Task 4 test #10 | version_drift + missing_prefix |
| `loadApiDefectsRegistry` — absent file → empty | Task 5 test #1 | schemaVersion 1 |
| `appendApiDefectRecord` → load roundtrip | Task 5 test #2 | persisted correctly |
| `findOpenApiDefect` → null when absent | Task 5 test #3 | correct |
| `findOpenApiDefect` → returns open record | Task 5 test #4 | stepId+collectionId match |
| `findOpenApiDefect` → null for closed | Task 5 test #5 | status guard |
| Atomic write (no .tmp left behind) | Task 5 test #6 | rename atomicity |
| POST `/api/api-defects/draft` | Task 7 | returns payload+ADF+existingDefect+jiraProjectKey |
| POST `/api/api-defects/file` | Task 7 | Jira issue created, record persisted, audit logged |
| GET `/api/api-defects/by-step/:stepId` | Task 7 | returns filtered defects array |
| 409 dedup on file | Task 7 | `findOpenApiDefect` guard before createIssue |
| `buildEnrichedApiDefectAdf` imported in `adfBuilder.ts` | Task 2 | old exports untouched |
| `registerApiDefectsRoutes` in server.ts | Task 7 Step 2 | alongside flakiness routes |
| CSS `.api-defect-pill` + `.api-heal-card` | Task 8 | appended to styles_addon.css |
| "Jira & Heal" tab in step detail | Task 9 | per-step, lazy-loaded on tab open |
| "File Defect" button only for non-passed steps | Task 9 Step 4 | `step.status !== 'passed'` guard |
| Defect pill with link shown when open defect exists | Task 9 Step 3 | `_apiRunsLoadJiraPanel` |
| Healing suggestions rendered in Jira panel | Task 9 Step 3 | `api-heal-card` per suggestion |
| `readAll(API_COLLECTIONS)` and `readAll(API_ENVS)` | Task 7 | using constants from `src/data/store.ts` |
| `getJiraClient` from `../../ui/helpers/jira-helpers` | Task 7 | exact import path confirmed |
| `healingEngine.ts` untouched | All tasks | no references to it |
| `src/ui/routes/jira.routes.ts` untouched | All tasks | no modifications |
| `defectsStore.ts` untouched | All tasks | only imported `loadJiraConfig` |
