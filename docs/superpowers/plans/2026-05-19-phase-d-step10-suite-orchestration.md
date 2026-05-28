# Phase D Step 10: Suite Orchestration, API Lifecycle Hooks & Teardown Execution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add enterprise API suite orchestration — lifecycle hooks (beforeAll/afterAll/beforeEach/afterEach), teardown observability, shared context propagation, and a suite management UI — composing the existing `runCollection` primitive without touching the execution runtime.

**Architecture:** A new `src/api-suite/` module defines `ApiSuite`, a suite orchestrator that composes `runCollection` calls in lifecycle order with try/finally guarantees, a suite run store (atomic write to `data/api-suite-runs/`), and Express routes. `ApiStepResult` gains an `isTeardown` flag for observability (the engine already runs teardown — this just marks the results). A new `27-api-suites.js` UI module and a teardown badge in `25-api-runs.js` complete the feature.

**Tech Stack:** TypeScript · Vitest · Express · vanilla JS (`27-api-suites.js`) · existing `runCollection` primitive

---

## Task 1: ApiSuite Contracts

- [ ] **Step 1: Create `src/api-suite/contracts/api-suite.contracts.ts`**

No TDD — this is types only.

```typescript
// src/api-suite/contracts/api-suite.contracts.ts

export type SuiteLifecyclePhase = 'before_all' | 'before_each' | 'main' | 'after_each' | 'after_all';

export interface ApiSuite {
  id: string;
  name: string;
  projectId?: string;
  description?: string;
  /** Ordered list of main collection IDs to run */
  collectionIds: string[];
  /** Run once before all collections — variables propagated forward */
  beforeAllCollectionId?: string;
  /** Run once after all (guaranteed via try/finally) */
  afterAllCollectionId?: string;
  /** Run before each main collection */
  beforeEachCollectionId?: string;
  /** Run after each main collection (guaranteed via try/finally) */
  afterEachCollectionId?: string;
  environmentId: string;
  /** What to do when a collection fails */
  onFailure: 'stop' | 'continue';
  createdAt: string;
  updatedAt: string;
}

export interface SuiteCollectionResult {
  readonly phase: SuiteLifecyclePhase;
  readonly collectionId: string;
  readonly collectionName: string;
  /** The ApiCollectionRunResult.id for this phase run */
  readonly runId: string;
  readonly status: 'passed' | 'failed' | 'error' | 'skipped';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  /** true for beforeAll/afterAll/beforeEach/afterEach */
  readonly isLifecycleHook: boolean;
  /** Variables passed into this phase */
  readonly contextIn?: Record<string, string>;
  /** Variables extracted from this phase (for propagation) */
  readonly contextOut?: Record<string, string>;
  readonly failureReason?: string;
}

export interface SuiteRunResult {
  readonly id: string;
  readonly suiteId: string;
  readonly suiteName: string;
  readonly status: 'passed' | 'failed' | 'error' | 'running';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly phaseResults: readonly SuiteCollectionResult[];
  /** Accumulated variables from all lifecycle phases */
  readonly sharedContext: Record<string, string>;
  readonly failureReason?: string;
}

export interface SuiteRunRegistry {
  readonly _schemaVersion: 1;
  runs: SuiteRunResult[];
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-suite/contracts/api-suite.contracts.ts && git commit -m "feat(api-suite): add ApiSuite contract types (Task 1)"
```

---

## Task 2: isTeardown Observability

**Files:**
- Modify: `src/data/types.ts` (add field to `ApiStepResult`)
- Modify: `src/api-runtime/workflow-engine/engine.ts` (tag teardown results)
- Create: `src/api-runtime/workflow-engine/__tests__/teardown-tag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api-runtime/workflow-engine/__tests__/teardown-tag.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// We test that the engine tags teardown step results with isTeardown: true
// by reading the actual ApiCollectionRunResult returned from runCollection.
// We mock executeStep and resolveAuth for isolation.

vi.mock('../../../utils/apiRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/apiRunner')>();
  return actual;
});

import { runCollection } from '../../../utils/apiRunner';
import type { ApiCollection, ApiEnvironment } from '../../../data/types';

function makeCollection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col-1', name: 'Test Col', environmentId: 'env-1',
    steps: [
      { id: 'step-main', name: 'Main', request: { method: 'GET', url: 'http://x/main', headers: {}, body: undefined, queryParams: {} }, assertions: [], extractVariables: [], execution: { teardown: false }, dependsOn: [] },
      { id: 'step-td', name: 'Teardown', request: { method: 'DELETE', url: 'http://x/td', headers: {}, body: undefined, queryParams: {} }, assertions: [], extractVariables: [], execution: { teardown: true }, dependsOn: [] },
    ],
    variables: [], onFailure: 'continue', executionMode: 'sequential',
    ...overrides,
  } as ApiCollection;
}

function makeEnv(): ApiEnvironment {
  return { id: 'env-1', name: 'Test', baseUrl: 'http://x', variables: [] } as ApiEnvironment;
}

describe('teardown observability', () => {
  it('teardown step result has isTeardown: true', async () => {
    // NOTE: This is an integration-style test — it calls runCollection with a real engine
    // but uses a real HTTP endpoint. Since we can't hit real HTTP in unit tests, we
    // test the contract by checking the engine.ts teardown tagging logic directly.
    //
    // Instead, test via the engine directly:
    const { WorkflowEngine } = await import('../engine');
    const executeStep = vi.fn().mockResolvedValue({
      stepId: 'step-td', stepName: 'Teardown', status: 'passed',
      request: { method: 'DELETE', url: 'http://x/td', headers: {}, body: undefined, queryParams: {} },
      response: { status: 200, headers: {}, body: '', durationMs: 10, bodyTruncated: false },
      assertionResults: [], extractedVariables: {}, durationMs: 10,
    });
    const resolveAuth = vi.fn().mockResolvedValue({});
    const engine = new WorkflowEngine({ executeStep, resolveAuth, onPartialWrite: () => {} });
    const result = await engine.execute(makeCollection(), makeEnv(), 'run-1', {});
    const tdResult = result.stepResults.find(r => r.stepId === 'step-td');
    expect(tdResult).toBeDefined();
    expect(tdResult!.isTeardown).toBe(true);
    const mainResult = result.stepResults.find(r => r.stepId === 'step-main');
    expect(mainResult!.isTeardown).toBeFalsy();
  });

  it('teardown step runs even when main step fails', async () => {
    const { WorkflowEngine } = await import('../engine');
    const executeStep = vi.fn()
      .mockImplementationOnce(async () => ({
        stepId: 'step-main', stepName: 'Main', status: 'failed',
        request: { method: 'GET', url: 'http://x/main', headers: {}, body: undefined, queryParams: {} },
        assertionResults: [], extractedVariables: {}, durationMs: 5, error: 'boom',
      }))
      .mockImplementationOnce(async () => ({
        stepId: 'step-td', stepName: 'Teardown', status: 'passed',
        request: { method: 'DELETE', url: 'http://x/td', headers: {}, body: undefined, queryParams: {} },
        assertionResults: [], extractedVariables: {}, durationMs: 5,
      }));
    const resolveAuth = vi.fn().mockResolvedValue({});
    const collection = makeCollection();
    collection.onFailure = 'stop';  // even with stop — teardown must run
    const engine = new WorkflowEngine({ executeStep, resolveAuth, onPartialWrite: () => {} });
    const result = await engine.execute(collection, makeEnv(), 'run-1', {});
    const tdResult = result.stepResults.find(r => r.stepId === 'step-td');
    expect(tdResult).toBeDefined();
    expect(tdResult!.isTeardown).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-runtime/workflow-engine/__tests__/teardown-tag.test.ts 2>&1 | tail -15
```

Expected: FAIL — `isTeardown` property doesn't exist yet.

- [ ] **Step 3: Add `isTeardown?: boolean` to `ApiStepResult` in `src/data/types.ts`**

In `src/data/types.ts`, find `ApiStepResult` (line 671) and add the field:

```typescript
export interface ApiStepResult {
  stepId: string;
  stepName: string;
  status: 'passed' | 'failed' | 'skipped' | 'error' | 'degraded';
  request: ApiRequest;
  response?: ApiResponseSnapshot;
  assertionResults: ApiAssertionResult[];
  extractedVariables: Record<string, string>;
  durationMs: number;
  contractViolations?: string[];
  error?: string;
  healingProposal?: string;
  isTeardown?: boolean;  // ← ADD THIS LINE
}
```

- [ ] **Step 4: Tag teardown results in `src/api-runtime/workflow-engine/engine.ts`**

Find the teardown loop (line ~456). Change from:

```typescript
for (const step of teardownSteps) {
  const authHeaders = await resolveAuth(
    environment.authConfig ?? { type: 'none' },
    state.sharedContext
  ).catch(() => ({}));
  const result = await executeStep(step, state.sharedContext, authHeaders, environment.baseUrl ?? '');
  state.stepResults.push(result);
}
```

To:

```typescript
for (const step of teardownSteps) {
  const authHeaders = await resolveAuth(
    environment.authConfig ?? { type: 'none' },
    state.sharedContext
  ).catch(() => ({}));
  const result = await executeStep(step, state.sharedContext, authHeaders, environment.baseUrl ?? '');
  state.stepResults.push({ ...result, isTeardown: true });
}
```

- [ ] **Step 5: Run test to verify green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-runtime/workflow-engine/__tests__/teardown-tag.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: TypeScript check**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/data/types.ts src/api-runtime/workflow-engine/engine.ts src/api-runtime/workflow-engine/__tests__/teardown-tag.test.ts && git commit -m "feat(api-suite): add isTeardown observability to ApiStepResult (Task 2)"
```

---

## Task 3: Suite Orchestrator

**Files:**
- Create: `src/api-suite/suite-orchestrator.ts`
- Create: `src/api-suite/__tests__/suite-orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/api-suite/__tests__/suite-orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock runCollection and saveSuiteRunResult
vi.mock('../../utils/apiRunner', () => ({
  runCollection: vi.fn(),
}));
vi.mock('../suite-run-store', () => ({
  saveSuiteRunResult: vi.fn().mockResolvedValue(undefined),
}));

import { runSuite } from '../suite-orchestrator';
import { runCollection } from '../../utils/apiRunner';
import type { ApiSuite, SuiteRunResult } from '../contracts/api-suite.contracts';
import type { ApiCollection, ApiEnvironment } from '../../data/types';

const mockRunCollection = vi.mocked(runCollection);

function makeOkResult(collectionId: string, runId: string, vars: Record<string,string> = {}) {
  return {
    id: runId, collectionId,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:01Z',
    status: 'passed' as const,
    stepResults: [],
    variableContext: vars,
  };
}

function makeFailResult(collectionId: string, runId: string) {
  return { ...makeOkResult(collectionId, runId), status: 'failed' as const };
}

function makeSuite(overrides: Partial<ApiSuite> = {}): ApiSuite {
  return {
    id: 'suite-1', name: 'My Suite',
    collectionIds: ['col-main-1', 'col-main-2'],
    environmentId: 'env-1',
    onFailure: 'continue',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCollections(): ApiCollection[] {
  return [
    { id: 'col-before-all', name: 'Before All', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as ApiCollection,
    { id: 'col-after-all', name: 'After All', environmentId: 'env-1', steps: [], variables: [], onFailure: 'continue', executionMode: 'sequential' } as ApiCollection,
    { id: 'col-before-each', name: 'Before Each', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as ApiCollection,
    { id: 'col-after-each', name: 'After Each', environmentId: 'env-1', steps: [], variables: [], onFailure: 'continue', executionMode: 'sequential' } as ApiCollection,
    { id: 'col-main-1', name: 'Main 1', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as ApiCollection,
    { id: 'col-main-2', name: 'Main 2', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as ApiCollection,
  ];
}

const env: ApiEnvironment = { id: 'env-1', name: 'Test', baseUrl: 'http://x', variables: [] } as ApiEnvironment;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runSuite', () => {
  it('runs collections in order: main 1 → main 2', async () => {
    mockRunCollection
      .mockResolvedValueOnce(makeOkResult('col-main-1', 'r1'))
      .mockResolvedValueOnce(makeOkResult('col-main-2', 'r2'));

    const result = await runSuite(makeSuite(), makeCollections(), env);
    
    expect(result.status).toBe('passed');
    expect(result.phaseResults).toHaveLength(2);
    expect(result.phaseResults[0].collectionId).toBe('col-main-1');
    expect(result.phaseResults[1].collectionId).toBe('col-main-2');
    expect(result.phaseResults[0].phase).toBe('main');
  });

  it('runs lifecycle order: beforeAll → beforeEach → main → afterEach → afterAll', async () => {
    mockRunCollection.mockResolvedValue(makeOkResult('any', 'r'));

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      beforeAllCollectionId: 'col-before-all',
      afterAllCollectionId: 'col-after-all',
      beforeEachCollectionId: 'col-before-each',
      afterEachCollectionId: 'col-after-each',
    });

    const result = await runSuite(suite, makeCollections(), env);
    const phases = result.phaseResults.map(r => r.phase);
    expect(phases).toEqual(['before_all', 'before_each', 'main', 'after_each', 'after_all']);
  });

  it('afterAll runs even when a main collection fails', async () => {
    const called: string[] = [];
    mockRunCollection.mockImplementation(async (col) => {
      called.push(col.id);
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1');
      return makeOkResult(col.id, 'r2');
    });

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      afterAllCollectionId: 'col-after-all',
    });

    const result = await runSuite(suite, makeCollections(), env);
    expect(called).toContain('col-after-all');
    const afterAllPhase = result.phaseResults.find(p => p.phase === 'after_all');
    expect(afterAllPhase).toBeDefined();
  });

  it('afterEach runs even when main collection fails', async () => {
    mockRunCollection.mockImplementation(async (col) => {
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1');
      return makeOkResult(col.id, 'r2');
    });

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      afterEachCollectionId: 'col-after-each',
    });

    const result = await runSuite(suite, makeCollections(), env);
    const afterEachPhase = result.phaseResults.find(p => p.phase === 'after_each');
    expect(afterEachPhase).toBeDefined();
  });

  it('with onFailure=stop, stops after first collection failure but still runs afterAll', async () => {
    const called: string[] = [];
    mockRunCollection.mockImplementation(async (col) => {
      called.push(col.id);
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1');
      return makeOkResult(col.id, 'r2');
    });

    const suite = makeSuite({
      onFailure: 'stop',
      collectionIds: ['col-main-1', 'col-main-2'],
      afterAllCollectionId: 'col-after-all',
    });

    const result = await runSuite(suite, makeCollections(), env);
    expect(called).not.toContain('col-main-2');
    expect(called).toContain('col-after-all');
    expect(result.status).toBe('failed');
  });

  it('with onFailure=continue, all collections run despite failure', async () => {
    const called: string[] = [];
    mockRunCollection.mockImplementation(async (col) => {
      called.push(col.id);
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1');
      return makeOkResult(col.id, 'r2');
    });

    const suite = makeSuite({ onFailure: 'continue' });
    await runSuite(suite, makeCollections(), env);
    expect(called).toContain('col-main-1');
    expect(called).toContain('col-main-2');
  });

  it('variables from beforeAll are passed to main collections as inheritedContext', async () => {
    const capturedContexts: Record<string, string>[] = [];
    mockRunCollection.mockImplementation(async (col, _env, _runId, ctx) => {
      capturedContexts.push(ctx ?? {});
      return makeOkResult(col.id, 'r', { TOKEN: 'abc123' });
    });

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      beforeAllCollectionId: 'col-before-all',
    });

    await runSuite(suite, makeCollections(), env);
    // The main collection call (index 1) should have TOKEN in its context
    expect(capturedContexts[1]).toMatchObject({ TOKEN: 'abc123' });
  });

  it('isLifecycleHook is true for non-main phases', async () => {
    mockRunCollection.mockResolvedValue(makeOkResult('any', 'r'));

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      beforeAllCollectionId: 'col-before-all',
      afterAllCollectionId: 'col-after-all',
    });

    const result = await runSuite(suite, makeCollections(), env);
    const beforeAll = result.phaseResults.find(p => p.phase === 'before_all');
    const main = result.phaseResults.find(p => p.phase === 'main');
    const afterAll = result.phaseResults.find(p => p.phase === 'after_all');
    expect(beforeAll!.isLifecycleHook).toBe(true);
    expect(main!.isLifecycleHook).toBe(false);
    expect(afterAll!.isLifecycleHook).toBe(true);
  });

  it('suite status is failed when any collection fails', async () => {
    mockRunCollection
      .mockResolvedValueOnce(makeFailResult('col-main-1', 'r1'))
      .mockResolvedValueOnce(makeOkResult('col-main-2', 'r2'));

    const result = await runSuite(makeSuite(), makeCollections(), env);
    expect(result.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-suite/__tests__/suite-orchestrator.test.ts 2>&1 | tail -15
```

- [ ] **Step 3: Create `src/api-suite/suite-orchestrator.ts`**

```typescript
import { nanoid } from 'nanoid';
import { runCollection } from '../utils/apiRunner';
import { saveSuiteRunResult } from './suite-run-store';
import type { ApiSuite, SuiteRunResult, SuiteCollectionResult, SuiteLifecyclePhase } from './contracts/api-suite.contracts';
import type { ApiCollection, ApiEnvironment } from '../data/types';

export async function runSuite(
  suite: ApiSuite,
  allCollections: ApiCollection[],
  environment: ApiEnvironment,
): Promise<SuiteRunResult> {
  const suiteRunId = nanoid();
  const startedAt = new Date().toISOString();
  const phaseResults: SuiteCollectionResult[] = [];
  let sharedContext: Record<string, string> = {};
  let overallStatus: SuiteRunResult['status'] = 'passed';
  let failFast = false;

  function findCollection(id: string): ApiCollection {
    const c = allCollections.find(c => c.id === id);
    if (!c) throw new Error(`Suite orchestrator: collection ${id} not found`);
    return c;
  }

  async function runPhase(
    collectionId: string | undefined,
    phase: SuiteLifecyclePhase,
  ): Promise<SuiteCollectionResult | null> {
    if (!collectionId) return null;
    const collection = findCollection(collectionId);
    const runId = nanoid();
    const phaseStart = Date.now();
    const contextIn = { ...sharedContext };
    try {
      const result = await runCollection(collection, environment, runId, { ...sharedContext });
      if (phase === 'before_all' || phase === 'before_each') {
        sharedContext = { ...sharedContext, ...result.variableContext };
      }
      if (result.status !== 'passed') overallStatus = 'failed';
      return {
        phase, collectionId, collectionName: collection.name, runId,
        status: result.status as SuiteCollectionResult['status'],
        startedAt: result.startedAt, completedAt: result.completedAt,
        durationMs: Date.now() - phaseStart,
        isLifecycleHook: phase !== 'main',
        contextIn, contextOut: result.variableContext,
      };
    } catch (err: unknown) {
      overallStatus = 'failed';
      return {
        phase, collectionId, collectionName: collection.name, runId,
        status: 'error',
        startedAt: new Date(Date.now() - (Date.now() - phaseStart)).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - phaseStart,
        isLifecycleHook: phase !== 'main',
        contextIn,
        failureReason: (err instanceof Error) ? err.message : String(err),
      };
    }
  }

  try {
    const beforeAllResult = await runPhase(suite.beforeAllCollectionId, 'before_all');
    if (beforeAllResult) {
      phaseResults.push(beforeAllResult);
      if (beforeAllResult.status !== 'passed' && suite.onFailure === 'stop') {
        failFast = true;
      }
    }

    if (!failFast) {
      for (const collectionId of suite.collectionIds) {
        let shouldBreak = false;
        try {
          const beforeEachResult = await runPhase(suite.beforeEachCollectionId, 'before_each');
          if (beforeEachResult) phaseResults.push(beforeEachResult);

          const mainResult = await runPhase(collectionId, 'main');
          if (mainResult) {
            phaseResults.push(mainResult);
            if (mainResult.status !== 'passed' && suite.onFailure === 'stop') {
              shouldBreak = true;
            }
          }
        } finally {
          const afterEachResult = await runPhase(suite.afterEachCollectionId, 'after_each');
          if (afterEachResult) phaseResults.push(afterEachResult);
        }
        if (shouldBreak) break;
      }
    }
  } finally {
    const afterAllResult = await runPhase(suite.afterAllCollectionId, 'after_all');
    if (afterAllResult) phaseResults.push(afterAllResult);
  }

  const completedAt = new Date().toISOString();
  const suiteResult: SuiteRunResult = {
    id: suiteRunId, suiteId: suite.id, suiteName: suite.name,
    status: overallStatus,
    startedAt, completedAt,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    phaseResults, sharedContext,
  };

  await saveSuiteRunResult(suiteResult);
  return suiteResult;

  // Extension point: K. Future distributed orchestration
  // To support parallel lifecycle execution, replace the sequential for-loop with
  // a worker pool that respects beforeEach/afterEach ordering per collection.
  // The suite-run-store and SuiteRunResult schema are already prepared for it.
}
```

- [ ] **Step 4: Run tests — expect green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-suite/__tests__/suite-orchestrator.test.ts 2>&1 | tail -15
```

- [ ] **Step 5: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-suite/suite-orchestrator.ts src/api-suite/__tests__/suite-orchestrator.test.ts && git commit -m "feat(api-suite): add suite orchestrator with lifecycle order and afterAll guarantee (Task 3)"
```

---

## Task 4: Suite Run Store + runCollection inheritedContext

**Files:**
- Create: `src/api-suite/suite-run-store.ts`
- Create: `src/api-suite/__tests__/suite-run-store.test.ts`
- Modify: `src/utils/apiRunner.ts` (add optional `inheritedContext` param)

- [ ] **Step 1: Add `inheritedContext` param to `runCollection`**

Read `src/utils/apiRunner.ts` lines 163-178. Change signature:

```typescript
export async function runCollection(
  collection: ApiCollection,
  environment: ApiEnvironment,
  runId: string,
  inheritedContext?: Record<string, string>,
): Promise<ApiCollectionRunResult> {
```

After the existing variable initialization loops (line ~177), add:

```typescript
  // Merge inherited context from suite lifecycle (beforeAll/beforeEach extracted variables)
  if (inheritedContext) {
    for (const [k, v] of Object.entries(inheritedContext)) initialContext[k] = v;
  }
```

- [ ] **Step 2: Write the failing suite-run-store tests**

Create `src/api-suite/__tests__/suite-run-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveSuiteRunResult, loadSuiteRun, listSuiteRuns } from '../suite-run-store';
import type { SuiteRunResult } from '../contracts/api-suite.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-run-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeResult(id: string, suiteId = 'suite-1'): SuiteRunResult {
  return {
    id, suiteId, suiteName: 'Test Suite',
    status: 'passed', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z',
    durationMs: 1000, phaseResults: [], sharedContext: {},
  };
}

describe('suite-run-store', () => {
  it('saveSuiteRunResult writes file to data/api-suite-runs/', async () => {
    await saveSuiteRunResult(makeResult('run-1'));
    const file = path.join(tmpDir, 'api-suite-runs', 'run-1.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.id).toBe('run-1');
  });

  it('loadSuiteRun returns null when file absent', () => {
    expect(loadSuiteRun('nonexistent')).toBeNull();
  });

  it('loadSuiteRun returns saved result', async () => {
    await saveSuiteRunResult(makeResult('run-2'));
    const loaded = loadSuiteRun('run-2');
    expect(loaded).not.toBeNull();
    expect(loaded!.suiteId).toBe('suite-1');
  });

  it('listSuiteRuns returns runs for a suiteId sorted by startedAt desc', async () => {
    await saveSuiteRunResult(makeResult('run-a', 'suite-1'));
    await saveSuiteRunResult(makeResult('run-b', 'suite-1'));
    await saveSuiteRunResult(makeResult('run-c', 'suite-2'));
    const runs = listSuiteRuns('suite-1');
    expect(runs).toHaveLength(2);
    expect(runs.every(r => r.suiteId === 'suite-1')).toBe(true);
  });

  it('saveSuiteRunResult performs atomic write (no .tmp file left)', async () => {
    await saveSuiteRunResult(makeResult('run-3'));
    const tmpFile = path.join(tmpDir, 'api-suite-runs', 'run-3.json.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-suite/__tests__/suite-run-store.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Create `src/api-suite/suite-run-store.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { SuiteRunResult } from './contracts/api-suite.contracts';

function suiteRunsDir(): string {
  return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-suite-runs');
}

function runPath(runId: string): string {
  return path.join(suiteRunsDir(), `${runId}.json`);
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export async function saveSuiteRunResult(result: SuiteRunResult): Promise<void> {
  atomicWrite(runPath(result.id), JSON.stringify(result, null, 2));
}

export function loadSuiteRun(runId: string): SuiteRunResult | null {
  const file = runPath(runId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as SuiteRunResult; }
  catch { return null; }
}

export function listSuiteRuns(suiteId: string): SuiteRunResult[] {
  const dir = suiteRunsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
  const runs: SuiteRunResult[] = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SuiteRunResult;
      if (r.suiteId === suiteId) runs.push(r);
    } catch { /* skip corrupt files */ }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
```

- [ ] **Step 5: Run test — expect green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-suite/__tests__/suite-run-store.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: TypeScript check**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-suite/suite-run-store.ts src/api-suite/__tests__/suite-run-store.test.ts src/utils/apiRunner.ts && git commit -m "feat(api-suite): suite run store + inheritedContext param in runCollection (Task 4)"
```

---

## Task 5: API_SUITES Store Constant + Suite CRUD Routes

**Files:**
- Modify: `src/data/store.ts` (add `API_SUITES`)
- Create: `src/api-suite/routes/api-suites.routes.ts`
- Modify: `src/ui/server.ts` (import + register)

- [ ] **Step 1: Add `API_SUITES` to `src/data/store.ts`**

Read `src/data/store.ts` and find the `API_COLLECTIONS` and `API_ENVS` constants. Add after them:

```typescript
export const API_SUITES = 'api-suites';
```

- [ ] **Step 2: Create `src/api-suite/routes/api-suites.routes.ts`**

Read `src/api-defects/routes/api-defects.routes.ts` to understand the route pattern (requireAuth, requireEditor, logAudit). Then create:

```typescript
import type { Express, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { requireAuth, requireEditor } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { logger } from '../../utils/logger';
import { readAll, saveOne, deleteOne, API_SUITES, API_COLLECTIONS, API_ENVS } from '../../data/store';
import { runSuite } from '../suite-orchestrator';
import { loadSuiteRun, listSuiteRuns } from '../suite-run-store';
import type { ApiSuite } from '../contracts/api-suite.contracts';
import type { ApiCollection, ApiEnvironment } from '../../data/types';

export function registerApiSuiteRoutes(app: Express): void {
  // LIST
  app.get('/api/api-suites', requireAuth, (_req: Request, res: Response) => {
    res.json(readAll<ApiSuite>(API_SUITES));
  });

  // GET
  app.get('/api/api-suites/:id', requireAuth, (req: Request, res: Response) => {
    const suites = readAll<ApiSuite>(API_SUITES);
    const suite = suites.find(s => s.id === req.params.id);
    if (!suite) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Suite not found' } });
    return res.json(suite);
  });

  // CREATE
  app.post('/api/api-suites', requireEditor, (req: Request, res: Response) => {
    const { name, collectionIds, environmentId, onFailure,
            beforeAllCollectionId, afterAllCollectionId,
            beforeEachCollectionId, afterEachCollectionId,
            description, projectId } = req.body || {};
    if (!name || !collectionIds?.length || !environmentId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name, collectionIds, environmentId required' } });
    }
    const suite: ApiSuite = {
      id: nanoid(), name, collectionIds, environmentId,
      onFailure: onFailure ?? 'continue',
      beforeAllCollectionId, afterAllCollectionId,
      beforeEachCollectionId, afterEachCollectionId,
      description, projectId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveOne(API_SUITES, suite);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'API_SUITE_CREATED', resourceType: 'api-suite', resourceId: suite.id, details: suite.name, ip: req.ip ?? null });
    return res.status(201).json(suite);
  });

  // UPDATE
  app.put('/api/api-suites/:id', requireEditor, (req: Request, res: Response) => {
    const suites = readAll<ApiSuite>(API_SUITES);
    const existing = suites.find(s => s.id === req.params.id);
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Suite not found' } });
    const updated: ApiSuite = { ...existing, ...req.body, id: existing.id, updatedAt: new Date().toISOString() };
    saveOne(API_SUITES, updated);
    return res.json(updated);
  });

  // DELETE
  app.delete('/api/api-suites/:id', requireEditor, (req: Request, res: Response) => {
    const suites = readAll<ApiSuite>(API_SUITES);
    if (!suites.find(s => s.id === req.params.id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Suite not found' } });
    deleteOne(API_SUITES, req.params.id);
    return res.status(204).send();
  });

  // RUN SUITE
  app.post('/api/api-suites/:id/run', requireEditor, async (req: Request, res: Response) => {
    const suites = readAll<ApiSuite>(API_SUITES);
    const suite = suites.find(s => s.id === req.params.id);
    if (!suite) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Suite not found' } });

    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const environment = readAll<ApiEnvironment>(API_ENVS).find(e => e.id === suite.environmentId);
    if (!environment) return res.status(400).json({ error: { code: 'ENV_NOT_FOUND', message: 'Suite environment not found' } });

    res.json({ message: 'Suite run started', suiteId: suite.id });

    // Non-blocking — run suite in background
    runSuite(suite, collections, environment).catch(err => {
      logger.error('[api-suites] runSuite failed', { suiteId: suite.id, err: err?.message });
    });
  });

  // GET SUITE RUN RESULT
  app.get('/api/api-suite-runs/:runId', requireAuth, (req: Request, res: Response) => {
    const result = loadSuiteRun(req.params.runId);
    if (!result) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Suite run not found' } });
    return res.json(result);
  });

  // LIST SUITE RUNS for a suite
  app.get('/api/api-suites/:id/runs', requireAuth, (req: Request, res: Response) => {
    const runs = listSuiteRuns(req.params.id);
    return res.json(runs);
  });
}
```

> **Note on `saveOne` and `deleteOne`:** Read `src/data/store.ts` to confirm these helper names. If they're named differently (e.g. `writeAll`, `replaceById`), adapt. The key operations are: read array, push/replace/remove, write array back to `data/<key>.json`.

- [ ] **Step 3: Register in `src/ui/server.ts`**

Find `import { registerApiDefectsRoutes }` (line 59) and add after it:

```typescript
import { registerApiSuiteRoutes } from '../api-suite/routes/api-suites.routes';
```

Find `registerApiDefectsRoutes(app);` (line 229) and add after it:

```typescript
registerApiSuiteRoutes(app);
```

- [ ] **Step 4: TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -20
```

Fix any errors (e.g. if `saveOne`/`deleteOne` have different names in store.ts — read the file to confirm).

- [ ] **Step 5: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/data/store.ts src/api-suite/routes/api-suites.routes.ts src/ui/server.ts && git commit -m "feat(api-suite): CRUD + run routes for ApiSuite (Task 5)"
```

---

## Task 6: Barrel Export + Full TypeScript Build

**Files:**
- Create: `src/api-suite/index.ts`

- [ ] **Step 1: Create barrel**

```typescript
export { runSuite } from './suite-orchestrator';
export { saveSuiteRunResult, loadSuiteRun, listSuiteRuns } from './suite-run-store';
export type {
  ApiSuite, SuiteLifecyclePhase, SuiteCollectionResult, SuiteRunResult, SuiteRunRegistry,
} from './contracts/api-suite.contracts';
```

- [ ] **Step 2: Full TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -20
```

Expected: zero errors.

- [ ] **Step 3: Run all api-suite tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-suite/__tests__/ 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-suite/index.ts && git commit -m "feat(api-suite): barrel export (Task 6)"
```

---

## Task 7: Lifecycle Graph Overlay

**Files:**
- Modify: `src/data/types.ts` (add `isTeardown` to `RunGraphNodeResult`)
- Modify: `src/workflow-graph/routes/workflow-graph.routes.ts` (annotate teardown nodes)

- [ ] **Step 1: Add `isTeardown?: boolean` to `RunGraphNodeResult` in `src/data/types.ts`**

Read `src/data/types.ts` line ~697 for `RunGraphNodeResult`. Add `isTeardown?: boolean` to this interface (alongside the `isTeardown` already added to `ApiStepResult` in Task 2):

```typescript
export interface RunGraphNodeResult {
  stepId: string;
  stepName: string;
  status: 'passed' | 'failed' | 'error' | 'skipped' | 'degraded' | 'running'
        | 'queued' | 'retrying' | 'timed_out' | 'pending';
  durationMs: number | null;
  retryCount: number;
  retryHistory: Array<{ attempt: number; status: string; durationMs: number }>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  contractViolations?: string[];
  assertionFailures?: string[];
  isTeardown?: boolean;  // ← ADD THIS
}
```

> **Note:** Preserve the exact existing fields from line ~697 — read the file first to confirm the current shape before editing.

- [ ] **Step 2: Propagate `isTeardown` in the graph route**

Read `src/workflow-graph/routes/workflow-graph.routes.ts`. Find the `GET /api/api-runs/:runId/graph` handler. Locate the loop that builds `nodeResults` from `run.stepResults`. Add `isTeardown: stepResult.isTeardown ?? false` to each `nodeResults` entry. Example — the loop likely looks like:

```typescript
// Before:
nodeResults[stepResult.stepId] = {
  stepId: stepResult.stepId,
  stepName: stepResult.stepName,
  // ...other mapped fields...
};

// After — add one field:
nodeResults[stepResult.stepId] = {
  stepId: stepResult.stepId,
  stepName: stepResult.stepName,
  // ...other mapped fields...
  isTeardown: stepResult.isTeardown ?? false,
};
```

- [ ] **Step 3: TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/data/types.ts src/workflow-graph/routes/workflow-graph.routes.ts && git commit -m "feat(api-suite): propagate isTeardown through lifecycle graph overlay (Task 7)"
```

---

## Task 8: CSS + 27-api-suites.js UI Module

**Files:**
- Modify: `src/ui/public/styles_addon.css`
- Create: `src/ui/public/js/27-api-suites.js`
- Modify: `scripts/concat-modules.js` (add `'27-api-suites.js'`)
- Modify: `src/ui/public/index.html` (add nav tab and panel)

- [ ] **Step 1: Append CSS to `src/ui/public/styles_addon.css`**

Read the file end, then append:

```css
/* ── Phase D Step 10: API Suite Orchestration ─────────────────────────────── */
.suite-lifecycle-phase {
  border-left: 3px solid #374151;
  padding: 6px 10px;
  margin-bottom: 4px;
  font-size: 12px;
}
.suite-lifecycle-phase.phase-before_all,
.suite-lifecycle-phase.phase-after_all {
  border-left-color: #a78bfa;
}
.suite-lifecycle-phase.phase-main {
  border-left-color: #22c55e;
}
.suite-lifecycle-phase.phase-before_each,
.suite-lifecycle-phase.phase-after_each {
  border-left-color: #6b7280;
}
.teardown-badge {
  display: inline-block;
  background: rgba(107,114,128,.2);
  border: 1px solid #4b5563;
  color: #9ca3af;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 4px;
}
.suite-run-failed { color: #f87171; }
.suite-run-passed { color: #4ade80; }
```

- [ ] **Step 2: Read `src/ui/public/index.html` for nav tab pattern**

Read lines near the existing "API Runs" or "API Flakiness" nav tab to identify the exact HTML pattern used (tab data-page attribute, icon, label).

- [ ] **Step 3: Add nav tab in `index.html`**

After the `api-flakiness` nav tab item, add (adapting to match the exact pattern from Step 2):

```html
<li><a href="#" class="nav-link" data-page="api-suites">⚡ API Suites</a></li>
```

- [ ] **Step 4: Add page panel in `index.html`**

After the `api-flakiness` page div, add:

```html
<div id="page-api-suites" class="page-panel" style="display:none;">
  <div id="api-suites-alert"></div>
  <div id="api-suites-content"></div>
</div>
```

- [ ] **Step 5: Create `src/ui/public/js/27-api-suites.js`**

Read `src/ui/public/js/26-api-flakiness.js` top ~50 lines and `src/ui/public/js/25-api-runs.js` top ~50 lines to understand the module initialization pattern. Then create:

```javascript
// Module: API Suite Orchestration
// Page: api-suites

var _apiSuitesList = [];
var _apiSuitesCurrentSuiteId = null;

function apiSuitesInit() {
  if (typeof window._apiSuitesLoaded === 'undefined') {
    window._apiSuitesLoaded = true;
  }
  apiSuitesLoad();
}

async function apiSuitesLoad() {
  try {
    var res = await fetch('/api/api-suites');
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Failed to load suites.'); return; }
    _apiSuitesList = await res.json();
    apiSuitesRender();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error loading suites: ' + e.message);
  }
}

function apiSuitesRender() {
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  if (_apiSuitesList.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);padding:20px;">No API suites yet. <button class="btn btn-sm" onclick="apiSuitesShowCreate()">+ New Suite</button></div>';
    return;
  }
  el.innerHTML = '<div style="margin-bottom:12px;"><button class="btn btn-sm" onclick="apiSuitesShowCreate()">+ New Suite</button></div>'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Collections</th><th>Environment</th><th>Actions</th></tr></thead><tbody>'
    + _apiSuitesList.map(function(s) {
      return '<tr>'
        + '<td><a href="#" onclick="apiSuitesShowDetail(\'' + escHtml(s.id) + '\');return false;">' + escHtml(s.name) + '</a></td>'
        + '<td>' + (s.collectionIds ? s.collectionIds.length : 0) + ' collections</td>'
        + '<td>' + escHtml(s.environmentId || '') + '</td>'
        + '<td>'
        + '<button class="tbl-btn" onclick="apiSuitesRunSuite(\'' + escHtml(s.id) + '\')">&#9654; Run</button> '
        + '<button class="tbl-btn" onclick="apiSuitesDelete(\'' + escHtml(s.id) + '\')">Delete</button>'
        + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table></div>';
}

async function apiSuitesShowDetail(suiteId) {
  _apiSuitesCurrentSuiteId = suiteId;
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Loading...</div>';
  try {
    var suiteRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId));
    var runsRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId) + '/runs');
    if (!suiteRes.ok) { modAlert('api-suites-alert', 'error', 'Suite not found'); return; }
    var suite = await suiteRes.json();
    var runs = runsRes.ok ? await runsRes.json() : [];
    el.innerHTML = apiSuitesDetailHtml(suite, runs);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesDetailHtml(suite, runs) {
  var html = '<div style="margin-bottom:12px;">'
    + '<button class="btn btn-sm" onclick="apiSuitesLoad()">&#8592; Back</button> '
    + '<button class="btn btn-sm" onclick="apiSuitesRunSuite(\'' + escHtml(suite.id) + '\')">&#9654; Run Suite</button>'
    + '</div>'
    + '<div style="font-size:16px;font-weight:600;margin-bottom:8px;">' + escHtml(suite.name) + '</div>'
    + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">'
    + 'Collections: ' + (suite.collectionIds || []).length
    + (suite.beforeAllCollectionId ? ' | beforeAll: ' + escHtml(suite.beforeAllCollectionId) : '')
    + (suite.afterAllCollectionId ? ' | afterAll: ' + escHtml(suite.afterAllCollectionId) : '')
    + '</div>';

  if (runs.length === 0) {
    html += '<div style="color:var(--text-muted);font-size:12px;">No runs yet.</div>';
    return html;
  }

  html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Recent Runs</div>'
    + runs.slice(0, 10).map(function(r) {
      var statusClass = r.status === 'passed' ? 'suite-run-passed' : 'suite-run-failed';
      return '<div style="border:1px solid #374151;border-radius:4px;padding:8px;margin-bottom:6px;cursor:pointer;" onclick="apiSuitesShowRun(\'' + escHtml(r.id) + '\')">'
        + '<span class="' + statusClass + '">' + escHtml(r.status.toUpperCase()) + '</span> '
        + '<span style="font-size:11px;color:var(--text-muted);">' + escHtml(r.startedAt.replace('T',' ').slice(0,19)) + '</span> '
        + '<span style="font-size:11px;">' + r.phaseResults.length + ' phases</span>'
        + '</div>';
    }).join('');

  return html;
}

async function apiSuitesShowRun(runId) {
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  try {
    var res = await fetch('/api/api-suite-runs/' + encodeURIComponent(runId));
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Run not found'); return; }
    var run = await res.json();
    el.innerHTML = apiSuitesRunHtml(run);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesRunHtml(run) {
  var statusClass = run.status === 'passed' ? 'suite-run-passed' : 'suite-run-failed';
  var html = '<div style="margin-bottom:12px;">'
    + '<button class="btn btn-sm" onclick="apiSuitesShowDetail(\'' + escHtml(run.suiteId) + '\')">&#8592; Back</button>'
    + '</div>'
    + '<div style="font-size:16px;font-weight:600;margin-bottom:4px;">' + escHtml(run.suiteName) + ' &#8212; <span class="' + statusClass + '">' + escHtml(run.status.toUpperCase()) + '</span></div>'
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">'
    + escHtml(run.startedAt.replace('T',' ').slice(0,19)) + ' &middot; ' + Math.round(run.durationMs / 1000) + 's'
    + '</div>'
    + '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Lifecycle Timeline</div>'
    + (run.phaseResults || []).map(function(p) {
      var phaseStatus = p.status === 'passed' ? '&#9989;' : p.status === 'failed' ? '&#10060;' : '&#9888;&#65039;';
      var hookBadge = p.isLifecycleHook
        ? '<span style="font-size:10px;background:#1f2937;border:1px solid #374151;border-radius:3px;padding:1px 5px;margin-left:4px;color:#9ca3af;">'
          + escHtml(p.phase.replace(/_/g,' ').toUpperCase()) + '</span>'
        : '';
      return '<div class="suite-lifecycle-phase phase-' + escHtml(p.phase) + '">'
        + phaseStatus + ' '
        + '<a href="#" onclick="typeof apiRunsLoadByRunId===\'function\'&&apiRunsLoadByRunId(\'' + escHtml(p.runId) + '\');return false;">' + escHtml(p.collectionName) + '</a>'
        + hookBadge
        + ' <span style="font-size:10px;color:var(--text-muted);">' + p.durationMs + 'ms</span>'
        + '</div>';
    }).join('');

  return html;
}

async function apiSuitesRunSuite(suiteId) {
  try {
    var res = await fetch('/api/api-suites/' + encodeURIComponent(suiteId) + '/run', { method: 'POST' });
    if (!res.ok) {
      var err = await res.json();
      modAlert('api-suites-alert', 'error', (err.error && err.error.message) || 'Run failed');
      return;
    }
    modAlert('api-suites-alert', 'success', 'Suite run started &#8212; refresh Runs tab shortly.');
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

async function apiSuitesDelete(suiteId) {
  if (!confirm('Delete this suite?')) return;
  try {
    var res = await fetch('/api/api-suites/' + encodeURIComponent(suiteId), { method: 'DELETE' });
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Delete failed'); return; }
    apiSuitesLoad();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesShowCreate() {
  modAlert('api-suites-alert', 'info', 'Suite creation UI &#8212; enter suite config below, then submit.');
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  el.innerHTML = '<div style="margin-bottom:12px;"><button class="btn btn-sm" onclick="apiSuitesLoad()">&#8592; Cancel</button></div>'
    + '<form onsubmit="apiSuitesCreate(event)">'
    + '<div class="form-group"><label>Suite Name</label><input name="name" class="form-control" required /></div>'
    + '<div class="form-group"><label>Collection IDs (comma-separated)</label><input name="collectionIds" class="form-control" required /></div>'
    + '<div class="form-group"><label>Environment ID</label><input name="environmentId" class="form-control" required /></div>'
    + '<div class="form-group"><label>On Failure</label><select name="onFailure" class="form-control"><option value="continue">continue</option><option value="stop">stop</option></select></div>'
    + '<div class="form-group"><label>Before All Collection ID (optional)</label><input name="beforeAllCollectionId" class="form-control" /></div>'
    + '<div class="form-group"><label>After All Collection ID (optional)</label><input name="afterAllCollectionId" class="form-control" /></div>'
    + '<button type="submit" class="btn btn-primary">Create Suite</button>'
    + '</form>';
}

async function apiSuitesCreate(event) {
  event.preventDefault();
  var form = event.target;
  var body = {
    name: form.name.value.trim(),
    collectionIds: form.collectionIds.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    environmentId: form.environmentId.value.trim(),
    onFailure: form.onFailure.value,
    beforeAllCollectionId: form.beforeAllCollectionId.value.trim() || undefined,
    afterAllCollectionId: form.afterAllCollectionId.value.trim() || undefined,
  };
  try {
    var res = await fetch('/api/api-suites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      var err = await res.json();
      modAlert('api-suites-alert', 'error', (err.error && err.error.message) || 'Create failed');
      return;
    }
    modAlert('api-suites-alert', 'success', 'Suite created.');
    apiSuitesLoad();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

// Page load hook — called by router when page becomes active
if (typeof registerPageModule === 'function') {
  registerPageModule('api-suites', apiSuitesInit);
}
```

- [ ] **Step 6: Register in `scripts/concat-modules.js`**

Find the line `'26-api-flakiness.js',` and add after it:

```javascript
'27-api-suites.js',
```

- [ ] **Step 7: Frontend build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/ui/public/styles_addon.css src/ui/public/js/27-api-suites.js scripts/concat-modules.js src/ui/public/index.html && git commit -m "feat(api-suite): CSS + 27-api-suites.js suite management UI (Task 8)"
```

---

## Task 9: 25-api-runs.js Teardown Badge

**Files:**
- Modify: `src/ui/public/js/25-api-runs.js`

- [ ] **Step 1: Read `25-api-runs.js` step rendering function**

Read `src/ui/public/js/25-api-runs.js` and find where step results are rendered (the function that builds each step row — likely something like `_buildStepRowHtml` or within `_apiRunsRenderResults`). Locate where `step.stepName` or `result.stepName` is displayed.

- [ ] **Step 2: Add teardown badge to step rendering**

Find the line where the step name is rendered in a step row. Add a teardown badge after the step name when `result.isTeardown === true`. Example pattern:

```javascript
// Before:
'<td>' + escHtml(r.stepName) + '</td>'

// After:
'<td>' + escHtml(r.stepName) + (r.isTeardown ? '<span class="teardown-badge">teardown</span>' : '') + '</td>'
```

The exact surrounding code will vary — read the file first to find the correct location and match the existing style.

- [ ] **Step 3: Frontend build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/ui/public/js/25-api-runs.js && git commit -m "feat(api-suite): teardown badge in API runs step table (Task 9)"
```

---

## Task 10: Full Build + Regression + CLAUDE.md

- [ ] **Step 1: Run all api-suite tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-suite/__tests__/ src/api-runtime/workflow-engine/__tests__/teardown-tag.test.ts 2>&1 | tail -20
```

- [ ] **Step 2: Full TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -15
```

- [ ] **Step 3: Regression — existing flakiness tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-flakiness/__tests__/ 2>&1 | tail -10
```

- [ ] **Step 4: Regression — api-defects tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/ 2>&1 | tail -10
```

- [ ] **Step 5: Regression — existing apiRunner tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/utils/__tests__/apiRunner.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Update CLAUDE.md**

Open `e:\AI Agent\qa-agent-platform-dev\CLAUDE.md`. Find the line referencing Step 9 plan completion and add after it:

```
> **See [docs/superpowers/plans/2026-05-19-phase-d-step10-suite-orchestration.md](docs/superpowers/plans/2026-05-19-phase-d-step10-suite-orchestration.md) — Phase D Step 10 implementation plan (10 tasks). COMPLETE as of 2026-05-19.**
```

Add to the Shipped Features section:

```markdown
### API Suite Orchestration (shipped 2026-05-19)
- Module: `src/api-suite/` — contracts, orchestrator, run-store, routes
- `runSuite()` composes `runCollection` with lifecycle order: beforeAll → beforeEach → main → afterEach → afterAll
- afterAll and afterEach guaranteed via try/finally — run even on failure
- Shared context propagation: beforeAll extracted variables flow into each main collection
- `ApiStepResult.isTeardown` — step-level teardown observability (tagged by engine)
- Store: `data/api-suite-runs/<runId>.json` (atomic write)
- Routes: `GET/POST/PUT/DELETE /api/api-suites`, `POST /api/api-suites/:id/run`, `GET /api/api-suite-runs/:runId`
- UI: `27-api-suites.js` — suite management, lifecycle timeline, run history
- teardown badge in `25-api-runs.js` step table
- Backward compatible: `runCollection` unchanged API (optional 4th param)
- Extension point: parallel lifecycle execution hook in `suite-orchestrator.ts`
```

- [ ] **Step 7: Commit CLAUDE.md**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add CLAUDE.md && git commit -m "docs: update CLAUDE.md with Phase D Step 10 completion"
```

---

## Self-Review: Spec Coverage

| Spec Requirement | Covered By | Notes |
|---|---|---|
| A. Suite Runner API Integration | Tasks 1, 5 | `ApiSuite` type + CRUD routes with lifecycle hook ID fields |
| B. Lifecycle Execution Model | Task 3 | `beforeAll → main → afterAll` order, `onFailure=stop/continue`, failure propagation |
| C. Teardown Execution Guarantees | Tasks 2, 3, 4 | `isTeardown` flag on `ApiStepResult`, try/finally in orchestrator, `inheritedContext` param |
| D. Lifecycle Graph Visualization | Task 7 | `isTeardown` added to `RunGraphNodeResult`, annotated in graph route handler |
| E. Failure Isolation Rules | Task 3 | `onFailure` enforced in orchestrator loop; `afterAll` always runs via outer try/finally |
| F. Shared Context Propagation | Tasks 3, 4 | `sharedContext` accumulated from `beforeAll`/`beforeEach`; passed as `inheritedContext` to `runCollection` |
| G. Runs UI Lifecycle Visibility | Tasks 8, 9 | `27-api-suites.js` lifecycle timeline; teardown badge in `25-api-runs.js` step table |
| H. Retry & Flakiness Compatibility | No task needed | Automatic — suite orchestrator delegates to `runCollection` which already handles retries |
| I. Runtime Isolation Rules | Guaranteed by design | Orchestrator composes `runCollection`; never touches DAG, WorkflowEngine, or retry logic |
| J. Backward Compatibility | Tasks 4, 5 | `runCollection` optional 4th param; `API_SUITES` additive; no existing routes modified |
| K. Future Extension Points | Task 3 | Comment in `suite-orchestrator.ts` after main for-loop documents parallel worker pool path |
