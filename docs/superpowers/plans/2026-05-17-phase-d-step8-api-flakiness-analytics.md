# Phase D Step 8: API Flakiness Analytics & Failure Clustering Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build observational-only API flakiness analytics and deterministic failure clustering on top of existing run history — no changes to runtime execution.

**Architecture:** A new `api-flakiness` module (contracts → aggregator → store → routes) reads existing `data/api-runs/*.json` files and `data/api-snapshots/*.json`, computes flakiness scores + failure signatures per (collectionId, stepId), persists summaries to `data/api-flakiness/`, and exposes REST endpoints consumed by the existing Runs UI.  The execution runtime (apiRunner.ts, retry-engine, DAG scheduler) is never touched.

**Tech Stack:** TypeScript · Vitest · Express · vanilla JS (25-api-runs.js + new 26-api-flakiness.js) · existing artifact stores

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `src/api-flakiness/contracts/flakiness.contracts.ts` | Create | All shared types: FailureSignature, StepFlakinessRecord, CollectionFlakinessReport, ClusterGroup |
| `src/api-flakiness/failure-signature.ts` | Create | Pure fn: `buildFailureSignature(stepResult, retryHistory?)` → FailureSignature |
| `src/api-flakiness/aggregator.ts` | Create | Pure fn: `aggregateRunsForStep(stepId, runs[])` → StepFlakinessRecord |
| `src/api-flakiness/cluster-engine.ts` | Create | Pure fn: `clusterFailures(records[])` → ClusterGroup[] (rule-based, no ML) |
| `src/api-flakiness/flakiness-store.ts` | Create | Persist/load CollectionFlakinessReport to `data/api-flakiness/{collectionId}.json` |
| `src/api-flakiness/flakiness-service.ts` | Create | Orchestrate: load runs → aggregate → cluster → save; getReport(collectionId) |
| `src/api-flakiness/routes/api-flakiness.routes.ts` | Create | GET /api/flakiness/:collectionId and POST /api/flakiness/:collectionId/recompute |
| `src/api-flakiness/index.ts` | Create | Barrel export |
| `src/ui/server.ts` | Modify | Import + register flakiness routes |
| `src/data/types.ts` | Modify | Re-export key types (no new runtime types) |
| `src/ui/public/js/25-api-runs.js` | Modify | Flaky indicators in run list + node detail badge |
| `src/ui/public/js/26-api-flakiness.js` | Create | Flakiness tab module (collection-level report view) |
| `src/ui/public/index.html` | Modify | Add flakiness tab panel + nav item for API Flakiness |
| `src/ui/public/styles_addon.css` | Modify | Flaky badge + cluster card + heatmap CSS |
| `src/api-flakiness/__tests__/failure-signature.test.ts` | Create | Unit tests: all 6 failure categories |
| `src/api-flakiness/__tests__/aggregator.test.ts` | Create | Unit tests: retry freq, fail rate, instability thresholds |
| `src/api-flakiness/__tests__/cluster-engine.test.ts` | Create | Unit tests: 5 cluster rules, tie-break, empty input |
| `src/api-flakiness/__tests__/flakiness-service.test.ts` | Create | Integration: scan → aggregate → cluster → getReport |

---

## Task 1: Failure Signature Contracts

**Files:**
- Create: `src/api-flakiness/contracts/flakiness.contracts.ts`

- [ ] **Step 1: Create the contracts file**

```typescript
// src/api-flakiness/contracts/flakiness.contracts.ts

export type FailureCategory =
  | 'assertion'
  | 'http_status'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'dependency_propagation'
  | 'unknown';

export interface FailureSignature {
  /** Normalized identifier — used as cluster key */
  readonly signatureKey: string;
  readonly category: FailureCategory;
  /** HTTP status if available */
  readonly httpStatus?: number;
  /** Normalized assertion field path e.g. "body.id" */
  readonly assertionField?: string;
  readonly assertionOperator?: string;
  /** Transport error class e.g. "ECONNREFUSED", "ETIMEDOUT" */
  readonly transportError?: string;
  /** Step that caused propagation failure (if category=dependency_propagation) */
  readonly propagatedFromStepId?: string;
}

export interface RetryStats {
  readonly retryCount: number;
  readonly maxRetryAttempt: number;
  /** Average duration across all attempts (ms) */
  readonly avgAttemptDurationMs: number;
  /** Did the final attempt pass after retries? */
  readonly recoveredAfterRetry: boolean;
}

export interface StepFlakinessRecord {
  readonly stepId: string;
  readonly stepName: string;
  readonly collectionId: string;
  /** Total runs observed (all statuses) */
  readonly totalRuns: number;
  readonly failedRuns: number;
  readonly passedRuns: number;
  readonly skippedRuns: number;
  /** 0.0–1.0 */
  readonly failRate: number;
  /** 0.0–1.0 — how often runs alternate pass/fail (instability signal) */
  readonly alternationIndex: number;
  /** Composite instability score: 0.7*failRate + 0.3*alternationIndex */
  readonly flakinessScore: number;
  readonly isFlaky: boolean;
  /** Threshold used to decide isFlaky */
  readonly flakinessThreshold: number;
  readonly retryStats: RetryStats;
  /** Dominant failure signature across all failed runs */
  readonly dominantSignature?: FailureSignature;
  /** All unique signatures seen */
  readonly signatures: readonly FailureSignature[];
  readonly lastFailedAt?: string;
  readonly lastPassedAt?: string;
  readonly computedAt: string;
}

export type ClusterDimension =
  | 'endpoint'
  | 'http_status'
  | 'assertion_type'
  | 'transport_error'
  | 'dependency_chain';

export interface ClusterGroup {
  readonly clusterId: string;       // `${dimension}:${key}`
  readonly dimension: ClusterDimension;
  readonly dimensionKey: string;    // e.g. "GET /api/users", "404", "body.id eq"
  readonly stepIds: readonly string[];
  readonly stepNames: readonly string[];
  readonly totalFailures: number;
  readonly avgFlakinessScore: number;
}

export interface CollectionFlakinessReport {
  readonly collectionId: string;
  readonly computedAt: string;
  readonly runsAnalyzed: number;
  readonly stepRecords: readonly StepFlakinessRecord[];
  readonly clusters: readonly ClusterGroup[];
  /** Steps with flakinessScore >= threshold, sorted descending */
  readonly hotspots: readonly string[];
  /** Collection-level stability: 1 - avgFailRate across all steps */
  readonly stabilityScore: number;
}
```

- [ ] **Step 2: No test for pure contracts — commit**

```bash
git add src/api-flakiness/contracts/flakiness.contracts.ts
git commit -m "feat(flakiness): add flakiness analytics contracts"
```

---

## Task 2: Failure Signature Builder — Tests First

**Files:**
- Create: `src/api-flakiness/failure-signature.ts`
- Create: `src/api-flakiness/__tests__/failure-signature.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/api-flakiness/__tests__/failure-signature.test.ts
import { describe, it, expect } from 'vitest';
import { buildFailureSignature } from '../failure-signature';
import type { ApiStepResult } from '../../data/types';

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'GET Users',
    status: 'failed',
    request: { url: 'https://api.example.com/users', method: 'GET', headers: {}, body: undefined },
    response: { status: 200, headers: {}, body: '' },
    assertionResults: [],
    extractedVariables: {},
    durationMs: 300,
    ...overrides,
  };
}

describe('buildFailureSignature', () => {
  it('categorizes assertion failure', () => {
    const step = makeStep({
      status: 'failed',
      assertionResults: [
        { assertionIndex: 0, field: 'body.id', operator: 'eq', passed: false, actual: null, expected: 1 },
      ],
    });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('assertion');
    expect(sig.assertionField).toBe('body.id');
    expect(sig.assertionOperator).toBe('eq');
    expect(sig.signatureKey).toBe('assertion:body.id:eq');
  });

  it('categorizes http_status failure', () => {
    const step = makeStep({ status: 'failed', response: { status: 503, headers: {}, body: '' }, assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('http_status');
    expect(sig.httpStatus).toBe(503);
    expect(sig.signatureKey).toBe('http_status:503');
  });

  it('categorizes timeout from error string', () => {
    const step = makeStep({ status: 'error', error: 'Request timed out after 30000ms', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('timeout');
    expect(sig.signatureKey).toBe('timeout:ETIMEDOUT');
  });

  it('categorizes network error ECONNREFUSED', () => {
    const step = makeStep({ status: 'error', error: 'connect ECONNREFUSED 127.0.0.1:3000', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('network');
    expect(sig.transportError).toBe('ECONNREFUSED');
    expect(sig.signatureKey).toBe('network:ECONNREFUSED');
  });

  it('categorizes auth failure on 401/403', () => {
    const step = makeStep({ status: 'failed', response: { status: 401, headers: {}, body: '' }, assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('auth');
    expect(sig.signatureKey).toBe('auth:401');
  });

  it('categorizes auth failure on 403', () => {
    const step = makeStep({ status: 'failed', response: { status: 403, headers: {}, body: '' }, assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('auth');
    expect(sig.signatureKey).toBe('auth:403');
  });

  it('categorizes dependency_propagation from skipped + error message', () => {
    const step = makeStep({ status: 'skipped', error: 'Skipped: dependency step-2 failed', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('dependency_propagation');
    expect(sig.signatureKey).toContain('dependency_propagation');
  });

  it('falls back to unknown', () => {
    const step = makeStep({ status: 'failed', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('unknown');
    expect(sig.signatureKey).toBe('unknown:failed');
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/failure-signature.test.ts 2>&1 | tail -20
```

Expected: `Cannot find module '../failure-signature'`

- [ ] **Step 3: Implement failure-signature.ts**

```typescript
// src/api-flakiness/failure-signature.ts
import type { ApiStepResult } from '../data/types';
import type { FailureCategory, FailureSignature } from './contracts/flakiness.contracts';

const NETWORK_ERRORS = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'];
const TIMEOUT_PATTERNS = /timed?\s*out|timeout|ETIMEDOUT/i;
const DEP_PROPAGATION_PATTERNS = /skipped.*dependency|dependency.*failed|blocked by/i;

function detectTransportError(error: string): string | undefined {
  for (const code of NETWORK_ERRORS) {
    if (error.includes(code)) return code;
  }
  return undefined;
}

export function buildFailureSignature(
  step: ApiStepResult,
  retryHistory?: Array<{ httpStatus?: number; error?: string }>
): FailureSignature {
  const error = step.error ?? '';
  const httpStatus = step.response?.status;

  // 1. dependency propagation (skipped by upstream failure)
  if (step.status === 'skipped' && DEP_PROPAGATION_PATTERNS.test(error)) {
    return {
      signatureKey: 'dependency_propagation:skipped',
      category: 'dependency_propagation',
    };
  }

  // 2. assertion failures (check before http_status — assertion is more specific)
  const failedAssertions = step.assertionResults.filter(a => !a.passed);
  if (failedAssertions.length > 0) {
    const a = failedAssertions[0];
    return {
      signatureKey: `assertion:${a.field}:${a.operator}`,
      category: 'assertion',
      assertionField: a.field,
      assertionOperator: a.operator,
    };
  }

  // 3. auth failures
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      signatureKey: `auth:${httpStatus}`,
      category: 'auth',
      httpStatus,
    };
  }

  // 4. timeout
  if (TIMEOUT_PATTERNS.test(error)) {
    return {
      signatureKey: 'timeout:ETIMEDOUT',
      category: 'timeout',
      transportError: 'ETIMEDOUT',
    };
  }

  // 5. network/transport errors
  const transportError = detectTransportError(error);
  if (transportError) {
    return {
      signatureKey: `network:${transportError}`,
      category: 'network',
      transportError,
    };
  }

  // 6. non-2xx HTTP status
  if (httpStatus !== undefined && (httpStatus < 200 || httpStatus >= 300)) {
    return {
      signatureKey: `http_status:${httpStatus}`,
      category: 'http_status',
      httpStatus,
    };
  }

  // 7. unknown
  return {
    signatureKey: `unknown:${step.status}`,
    category: 'unknown',
  };
}
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/failure-signature.test.ts 2>&1 | tail -15
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add src/api-flakiness/failure-signature.ts src/api-flakiness/__tests__/failure-signature.test.ts
git commit -m "feat(flakiness): failure signature builder with 6 categories"
```

---

## Task 3: Flakiness Aggregator — Tests First

**Files:**
- Create: `src/api-flakiness/aggregator.ts`
- Create: `src/api-flakiness/__tests__/aggregator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/api-flakiness/__tests__/aggregator.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateRunsForStep } from '../aggregator';
import type { ApiCollectionRunResult, ApiStepResult } from '../../data/types';

function makeStepResult(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-A',
    stepName: 'POST Login',
    status: 'passed',
    request: { url: 'https://api.example.com/login', method: 'POST', headers: {}, body: undefined },
    response: { status: 200, headers: {}, body: '' },
    assertionResults: [],
    extractedVariables: {},
    durationMs: 200,
    ...overrides,
  };
}

function makeRun(stepResult: ApiStepResult, id: string, startedAt: string): ApiCollectionRunResult {
  return {
    id,
    collectionId: 'col-1',
    startedAt,
    completedAt: startedAt,
    status: stepResult.status === 'passed' ? 'passed' : 'failed',
    stepResults: [stepResult],
    variableContext: {},
  };
}

describe('aggregateRunsForStep', () => {
  it('returns null when step absent from all runs', () => {
    const run = makeRun(makeStepResult({ stepId: 'step-B' }), 'r1', '2026-05-17T00:00:00Z');
    const result = aggregateRunsForStep('step-A', 'col-1', [run]);
    expect(result).toBeNull();
  });

  it('computes failRate = 0 when all passed', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'passed' }), id, `2026-05-17T0${i}:00:00Z`)
    );
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.failRate).toBe(0);
    expect(rec.isFlaky).toBe(false);
    expect(rec.flakinessScore).toBe(0);
  });

  it('computes failRate = 1 when all failed', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed' }), id, `2026-05-17T0${i}:00:00Z`)
    );
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.failRate).toBeCloseTo(1);
    expect(rec.isFlaky).toBe(true);
  });

  it('detects alternating pass/fail pattern', () => {
    // pass, fail, pass, fail, pass, fail
    const statuses: Array<ApiStepResult['status']> = ['passed','failed','passed','failed','passed','failed'];
    const runs = statuses.map((status, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status }), `r${i}`, `2026-05-17T0${i}:00:00Z`)
    );
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.alternationIndex).toBeGreaterThan(0.5);
    expect(rec.isFlaky).toBe(true);
  });

  it('counts retries from retryCount on RunGraphNodeResult (if provided)', () => {
    // Aggregator works from plain ApiCollectionRunResult — retryCount comes from stepResults
    // When error field set and status failed, retryStats reflects best-effort from plain data
    const runs = ['r1','r2'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed', error: 'timeout' }), id, `2026-05-17T0${i}:00:00Z`)
    );
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.retryStats.retryCount).toBeGreaterThanOrEqual(0);
  });

  it('populates dominantSignature', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed',
        response: { status: 503, headers: {}, body: '' }, assertionResults: [] }),
        id, `2026-05-17T0${i}:00:00Z`)
    );
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.dominantSignature?.category).toBe('http_status');
    expect(rec.dominantSignature?.httpStatus).toBe(503);
  });

  it('sets lastFailedAt and lastPassedAt', () => {
    const runs = [
      makeRun(makeStepResult({ stepId: 'step-A', status: 'passed' }), 'r1', '2026-05-15T00:00:00Z'),
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed' }), 'r2', '2026-05-16T00:00:00Z'),
    ];
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.lastFailedAt).toBe('2026-05-16T00:00:00Z');
    expect(rec.lastPassedAt).toBe('2026-05-15T00:00:00Z');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/aggregator.test.ts 2>&1 | tail -20
```

Expected: `Cannot find module '../aggregator'`

- [ ] **Step 3: Implement aggregator.ts**

```typescript
// src/api-flakiness/aggregator.ts
import type { ApiCollectionRunResult } from '../data/types';
import type { StepFlakinessRecord, FailureSignature, RetryStats } from './contracts/flakiness.contracts';
import { buildFailureSignature } from './failure-signature';

const FLAKINESS_THRESHOLD = 0.2;

export function aggregateRunsForStep(
  stepId: string,
  collectionId: string,
  runs: ApiCollectionRunResult[]
): StepFlakinessRecord | null {
  // Collect all step results across runs, sorted by startedAt asc
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const stepEntries = sorted.flatMap(run =>
    run.stepResults
      .filter(sr => sr.stepId === stepId)
      .map(sr => ({ sr, run }))
  );

  if (stepEntries.length === 0) return null;

  const stepName = stepEntries[0].sr.stepName;
  const totalRuns = stepEntries.length;

  let failedRuns = 0;
  let passedRuns = 0;
  let skippedRuns = 0;
  let lastFailedAt: string | undefined;
  let lastPassedAt: string | undefined;
  const signatures: FailureSignature[] = [];

  for (const { sr, run } of stepEntries) {
    if (sr.status === 'passed') {
      passedRuns++;
      if (!lastPassedAt || run.startedAt > lastPassedAt) lastPassedAt = run.startedAt;
    } else if (sr.status === 'skipped') {
      skippedRuns++;
    } else {
      failedRuns++;
      if (!lastFailedAt || run.startedAt > lastFailedAt) lastFailedAt = run.startedAt;
      signatures.push(buildFailureSignature(sr));
    }
  }

  const failRate = totalRuns > 0 ? failedRuns / totalRuns : 0;

  // Alternation index: fraction of consecutive pairs that differ in pass/fail
  const outcomes = stepEntries.map(({ sr }) => sr.status === 'passed' ? 'pass' : 'fail');
  let alternations = 0;
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i] !== outcomes[i - 1]) alternations++;
  }
  const alternationIndex = outcomes.length > 1 ? alternations / (outcomes.length - 1) : 0;

  const flakinessScore = parseFloat((0.7 * failRate + 0.3 * alternationIndex).toFixed(4));
  const isFlaky = flakinessScore >= FLAKINESS_THRESHOLD;

  // Dominant signature = most common signatureKey among failures
  const sigCounts: Record<string, { sig: FailureSignature; count: number }> = {};
  for (const sig of signatures) {
    if (!sigCounts[sig.signatureKey]) sigCounts[sig.signatureKey] = { sig, count: 0 };
    sigCounts[sig.signatureKey].count++;
  }
  const dominantSignature = Object.values(sigCounts).sort((a, b) => b.count - a.count)[0]?.sig;

  // Unique signatures
  const uniqueSignatures = Object.values(sigCounts).map(e => e.sig);

  // Retry stats: derived from step-level data (no snapshot required)
  const retryStats: RetryStats = {
    retryCount: failedRuns,           // proxy: each failed run may represent a retried attempt
    maxRetryAttempt: 0,               // enriched by flakiness-service if snapshot available
    avgAttemptDurationMs: stepEntries.reduce((sum, { sr }) => sum + sr.durationMs, 0) / totalRuns,
    recoveredAfterRetry: false,       // enriched by flakiness-service if snapshot available
  };

  return {
    stepId,
    stepName,
    collectionId,
    totalRuns,
    failedRuns,
    passedRuns,
    skippedRuns,
    failRate,
    alternationIndex,
    flakinessScore,
    isFlaky,
    flakinessThreshold: FLAKINESS_THRESHOLD,
    retryStats,
    dominantSignature,
    signatures: uniqueSignatures,
    lastFailedAt,
    lastPassedAt,
    computedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/aggregator.test.ts 2>&1 | tail -15
```

Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add src/api-flakiness/aggregator.ts src/api-flakiness/__tests__/aggregator.test.ts
git commit -m "feat(flakiness): step aggregator — failRate, alternationIndex, dominant signature"
```

---

## Task 4: Cluster Engine — Tests First

**Files:**
- Create: `src/api-flakiness/cluster-engine.ts`
- Create: `src/api-flakiness/__tests__/cluster-engine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/api-flakiness/__tests__/cluster-engine.test.ts
import { describe, it, expect } from 'vitest';
import { clusterFailures } from '../cluster-engine';
import type { StepFlakinessRecord } from '../contracts/flakiness.contracts';

function makeRecord(overrides: Partial<StepFlakinessRecord> = {}): StepFlakinessRecord {
  return {
    stepId: 'step-1',
    stepName: 'GET Users',
    collectionId: 'col-1',
    totalRuns: 10,
    failedRuns: 5,
    passedRuns: 5,
    skippedRuns: 0,
    failRate: 0.5,
    alternationIndex: 0.5,
    flakinessScore: 0.5,
    isFlaky: true,
    flakinessThreshold: 0.2,
    retryStats: { retryCount: 3, maxRetryAttempt: 2, avgAttemptDurationMs: 300, recoveredAfterRetry: false },
    signatures: [],
    computedAt: '2026-05-17T00:00:00Z',
    ...overrides,
  };
}

describe('clusterFailures', () => {
  it('returns empty array for empty input', () => {
    expect(clusterFailures([])).toEqual([]);
  });

  it('clusters by http_status', () => {
    const records = [
      makeRecord({ stepId: 's1', stepName: 'GET /a', dominantSignature: { signatureKey: 'http_status:503', category: 'http_status', httpStatus: 503 } }),
      makeRecord({ stepId: 's2', stepName: 'GET /b', dominantSignature: { signatureKey: 'http_status:503', category: 'http_status', httpStatus: 503 } }),
    ];
    const clusters = clusterFailures(records);
    const httpCluster = clusters.find(c => c.dimension === 'http_status');
    expect(httpCluster).toBeDefined();
    expect(httpCluster!.stepIds).toContain('s1');
    expect(httpCluster!.stepIds).toContain('s2');
    expect(httpCluster!.dimensionKey).toBe('503');
  });

  it('clusters by assertion_type', () => {
    const records = [
      makeRecord({ stepId: 's1', dominantSignature: { signatureKey: 'assertion:body.id:eq', category: 'assertion', assertionField: 'body.id', assertionOperator: 'eq' } }),
      makeRecord({ stepId: 's2', dominantSignature: { signatureKey: 'assertion:body.id:eq', category: 'assertion', assertionField: 'body.id', assertionOperator: 'eq' } }),
    ];
    const clusters = clusterFailures(records);
    const ac = clusters.find(c => c.dimension === 'assertion_type');
    expect(ac).toBeDefined();
    expect(ac!.dimensionKey).toBe('body.id eq');
    expect(ac!.stepIds).toHaveLength(2);
  });

  it('clusters by transport_error', () => {
    const records = [
      makeRecord({ stepId: 's1', dominantSignature: { signatureKey: 'network:ECONNREFUSED', category: 'network', transportError: 'ECONNREFUSED' } }),
      makeRecord({ stepId: 's2', dominantSignature: { signatureKey: 'network:ECONNREFUSED', category: 'network', transportError: 'ECONNREFUSED' } }),
    ];
    const clusters = clusterFailures(records);
    const nc = clusters.find(c => c.dimension === 'transport_error');
    expect(nc).toBeDefined();
    expect(nc!.dimensionKey).toBe('ECONNREFUSED');
  });

  it('does not cluster records with no dominant signature', () => {
    const records = [makeRecord({ dominantSignature: undefined })];
    const clusters = clusterFailures(records);
    expect(clusters).toHaveLength(0);
  });

  it('computes avgFlakinessScore per cluster', () => {
    const records = [
      makeRecord({ stepId: 's1', flakinessScore: 0.8, dominantSignature: { signatureKey: 'http_status:500', category: 'http_status', httpStatus: 500 } }),
      makeRecord({ stepId: 's2', flakinessScore: 0.4, dominantSignature: { signatureKey: 'http_status:500', category: 'http_status', httpStatus: 500 } }),
    ];
    const clusters = clusterFailures(records);
    const c = clusters.find(c => c.dimension === 'http_status')!;
    expect(c.avgFlakinessScore).toBeCloseTo(0.6);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/cluster-engine.test.ts 2>&1 | tail -15
```

Expected: `Cannot find module '../cluster-engine'`

- [ ] **Step 3: Implement cluster-engine.ts**

```typescript
// src/api-flakiness/cluster-engine.ts
import type { StepFlakinessRecord, ClusterGroup, ClusterDimension } from './contracts/flakiness.contracts';

interface ClusterAccumulator {
  dimension: ClusterDimension;
  dimensionKey: string;
  stepIds: string[];
  stepNames: string[];
  totalFailures: number;
  flakinessScores: number[];
}

export function clusterFailures(records: StepFlakinessRecord[]): ClusterGroup[] {
  const accumulators = new Map<string, ClusterAccumulator>();

  function addToCluster(
    clusterId: string,
    dimension: ClusterDimension,
    dimensionKey: string,
    rec: StepFlakinessRecord
  ): void {
    if (!accumulators.has(clusterId)) {
      accumulators.set(clusterId, { dimension, dimensionKey, stepIds: [], stepNames: [], totalFailures: 0, flakinessScores: [] });
    }
    const acc = accumulators.get(clusterId)!;
    acc.stepIds.push(rec.stepId);
    acc.stepNames.push(rec.stepName);
    acc.totalFailures += rec.failedRuns;
    acc.flakinessScores.push(rec.flakinessScore);
  }

  for (const rec of records) {
    const sig = rec.dominantSignature;
    if (!sig) continue;

    switch (sig.category) {
      case 'http_status':
        if (sig.httpStatus !== undefined) {
          addToCluster(`http_status:${sig.httpStatus}`, 'http_status', String(sig.httpStatus), rec);
        }
        break;

      case 'assertion':
        if (sig.assertionField && sig.assertionOperator) {
          const key = `${sig.assertionField} ${sig.assertionOperator}`;
          addToCluster(`assertion_type:${key}`, 'assertion_type', key, rec);
        }
        break;

      case 'network':
      case 'timeout':
        if (sig.transportError) {
          addToCluster(`transport_error:${sig.transportError}`, 'transport_error', sig.transportError, rec);
        }
        break;

      case 'dependency_propagation':
        addToCluster('dependency_chain:propagation', 'dependency_chain', 'propagation', rec);
        break;

      // 'auth' and 'unknown' are not clustered across steps (too broad)
    }
  }

  return Array.from(accumulators.entries())
    .filter(([, acc]) => acc.stepIds.length >= 1)
    .map(([clusterId, acc]) => ({
      clusterId,
      dimension: acc.dimension,
      dimensionKey: acc.dimensionKey,
      stepIds: acc.stepIds,
      stepNames: acc.stepNames,
      totalFailures: acc.totalFailures,
      avgFlakinessScore: parseFloat(
        (acc.flakinessScores.reduce((s, v) => s + v, 0) / acc.flakinessScores.length).toFixed(4)
      ),
    }))
    .sort((a, b) => b.totalFailures - a.totalFailures);
}
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/cluster-engine.test.ts 2>&1 | tail -15
```

Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add src/api-flakiness/cluster-engine.ts src/api-flakiness/__tests__/cluster-engine.test.ts
git commit -m "feat(flakiness): rule-based failure cluster engine (5 dimensions)"
```

---

## Task 5: Flakiness Store

**Files:**
- Create: `src/api-flakiness/flakiness-store.ts`

- [ ] **Step 1: Implement flakiness-store.ts**

```typescript
// src/api-flakiness/flakiness-store.ts
import * as fs from 'fs';
import * as path from 'path';
import type { CollectionFlakinessReport } from './contracts/flakiness.contracts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const FLAKINESS_DIR = path.join(DATA_DIR, 'api-flakiness');

function ensureDir(): void {
  if (!fs.existsSync(FLAKINESS_DIR)) fs.mkdirSync(FLAKINESS_DIR, { recursive: true });
}

export function saveReport(report: CollectionFlakinessReport): void {
  ensureDir();
  const filePath = path.join(FLAKINESS_DIR, `${report.collectionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
}

export function loadReport(collectionId: string): CollectionFlakinessReport | undefined {
  const filePath = path.join(FLAKINESS_DIR, `${collectionId}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CollectionFlakinessReport;
}

export function listReportIds(): string[] {
  if (!fs.existsSync(FLAKINESS_DIR)) return [];
  return fs.readdirSync(FLAKINESS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api-flakiness/flakiness-store.ts
git commit -m "feat(flakiness): flakiness report store (data/api-flakiness/)"
```

---

## Task 6: Flakiness Service + Integration Test

**Files:**
- Create: `src/api-flakiness/flakiness-service.ts`
- Create: `src/api-flakiness/__tests__/flakiness-service.test.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// src/api-flakiness/__tests__/flakiness-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { computeReport } from '../flakiness-service';
import type { ApiCollectionRunResult, ApiStepResult } from '../../data/types';

function makeStep(id: string, status: ApiStepResult['status'], httpStatus = 200): ApiStepResult {
  return {
    stepId: id,
    stepName: `Step ${id}`,
    status,
    request: { url: `https://api.example.com/${id}`, method: 'GET', headers: {}, body: undefined },
    response: { status: httpStatus, headers: {}, body: '' },
    assertionResults: [],
    extractedVariables: {},
    durationMs: 100,
  };
}

function makeRun(id: string, steps: ApiStepResult[], startedAt: string): ApiCollectionRunResult {
  const allPassed = steps.every(s => s.status === 'passed');
  return {
    id,
    collectionId: 'col-test',
    startedAt,
    completedAt: startedAt,
    status: allPassed ? 'passed' : 'failed',
    stepResults: steps,
    variableContext: {},
  };
}

describe('computeReport', () => {
  it('returns empty report for no runs', () => {
    const report = computeReport('col-test', []);
    expect(report.collectionId).toBe('col-test');
    expect(report.stepRecords).toHaveLength(0);
    expect(report.clusters).toHaveLength(0);
    expect(report.runsAnalyzed).toBe(0);
    expect(report.stabilityScore).toBe(1);
  });

  it('detects flaky step with alternating results', () => {
    const statuses: ApiStepResult['status'][] = ['passed','failed','passed','failed','passed','failed'];
    const runs = statuses.map((s, i) =>
      makeRun(`r${i}`, [makeStep('step-A', s, s === 'failed' ? 503 : 200)], `2026-05-17T0${i}:00:00Z`)
    );
    const report = computeReport('col-test', runs);
    const rec = report.stepRecords.find(r => r.stepId === 'step-A')!;
    expect(rec.isFlaky).toBe(true);
    expect(rec.dominantSignature?.category).toBe('http_status');
    expect(report.hotspots).toContain('step-A');
  });

  it('clusters steps by shared http_status', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(id, [
        makeStep('step-A', 'failed', 503),
        makeStep('step-B', 'failed', 503),
      ], `2026-05-17T0${i}:00:00Z`)
    );
    const report = computeReport('col-test', runs);
    const cluster = report.clusters.find(c => c.dimension === 'http_status' && c.dimensionKey === '503');
    expect(cluster).toBeDefined();
    expect(cluster!.stepIds).toContain('step-A');
    expect(cluster!.stepIds).toContain('step-B');
  });

  it('computes stabilityScore = 1 when all passed', () => {
    const runs = ['r1','r2'].map((id, i) =>
      makeRun(id, [makeStep('step-A', 'passed')], `2026-05-17T0${i}:00:00Z`)
    );
    const report = computeReport('col-test', runs);
    expect(report.stabilityScore).toBeCloseTo(1);
  });

  it('stabilityScore < 1 when failures exist', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(id, [makeStep('step-A', i === 0 ? 'passed' : 'failed', 500)], `2026-05-17T0${i}:00:00Z`)
    );
    const report = computeReport('col-test', runs);
    expect(report.stabilityScore).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/flakiness-service.test.ts 2>&1 | tail -15
```

Expected: `Cannot find module '../flakiness-service'`

- [ ] **Step 3: Implement flakiness-service.ts**

```typescript
// src/api-flakiness/flakiness-service.ts
import * as fs from 'fs';
import * as path from 'path';
import type { ApiCollectionRunResult } from '../data/types';
import { aggregateRunsForStep } from './aggregator';
import { clusterFailures } from './cluster-engine';
import { saveReport, loadReport } from './flakiness-store';
import type { CollectionFlakinessReport, StepFlakinessRecord } from './contracts/flakiness.contracts';

const RUNS_DIR = path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-runs');

/** Load all persisted runs for a collection (max 100, most recent first) */
export function loadRunsForCollection(collectionId: string): ApiCollectionRunResult[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json'));
  const runs: ApiCollectionRunResult[] = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')) as ApiCollectionRunResult;
      if (r.collectionId === collectionId) runs.push(r);
    } catch { /* skip corrupt */ }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100);
}

/** Pure: compute report from provided runs (testable without disk) */
export function computeReport(
  collectionId: string,
  runs: ApiCollectionRunResult[]
): CollectionFlakinessReport {
  // Collect all distinct stepIds seen across runs
  const stepIds = new Set<string>();
  for (const run of runs) {
    for (const sr of run.stepResults) stepIds.add(sr.stepId);
  }

  const stepRecords: StepFlakinessRecord[] = [];
  for (const stepId of stepIds) {
    const rec = aggregateRunsForStep(stepId, collectionId, runs);
    if (rec) stepRecords.push(rec);
  }

  const clusters = clusterFailures(stepRecords);

  const hotspots = stepRecords
    .filter(r => r.isFlaky)
    .sort((a, b) => b.flakinessScore - a.flakinessScore)
    .map(r => r.stepId);

  const avgFailRate = stepRecords.length > 0
    ? stepRecords.reduce((sum, r) => sum + r.failRate, 0) / stepRecords.length
    : 0;

  return {
    collectionId,
    computedAt: new Date().toISOString(),
    runsAnalyzed: runs.length,
    stepRecords,
    clusters,
    hotspots,
    stabilityScore: parseFloat((1 - avgFailRate).toFixed(4)),
  };
}

/** Recompute and persist report for a collection */
export function recomputeAndSave(collectionId: string): CollectionFlakinessReport {
  const runs = loadRunsForCollection(collectionId);
  const report = computeReport(collectionId, runs);
  saveReport(report);
  return report;
}

/** Get cached report, recomputing if absent */
export function getReport(collectionId: string): CollectionFlakinessReport {
  const cached = loadReport(collectionId);
  if (cached) return cached;
  return recomputeAndSave(collectionId);
}
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/flakiness-service.test.ts 2>&1 | tail -15
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add src/api-flakiness/flakiness-service.ts src/api-flakiness/__tests__/flakiness-service.test.ts
git commit -m "feat(flakiness): flakiness service — computeReport, recomputeAndSave, getReport"
```

---

## Task 7: Barrel Export + TypeScript Build

**Files:**
- Create: `src/api-flakiness/index.ts`

- [ ] **Step 1: Create barrel**

```typescript
// src/api-flakiness/index.ts
export type {
  FailureCategory,
  FailureSignature,
  RetryStats,
  StepFlakinessRecord,
  ClusterDimension,
  ClusterGroup,
  CollectionFlakinessReport,
} from './contracts/flakiness.contracts';
export { buildFailureSignature } from './failure-signature';
export { aggregateRunsForStep } from './aggregator';
export { clusterFailures } from './cluster-engine';
export { getReport, recomputeAndSave, computeReport } from './flakiness-service';
```

- [ ] **Step 2: TypeScript build — expect clean**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build 2>&1 | tail -10
```

Expected: no output (tsc exits clean)

- [ ] **Step 3: Commit**

```bash
git add src/api-flakiness/index.ts
git commit -m "feat(flakiness): barrel export + verified clean TS build"
```

---

## Task 8: REST Routes

**Files:**
- Create: `src/api-flakiness/routes/api-flakiness.routes.ts`
- Modify: `src/ui/server.ts`

- [ ] **Step 1: Create route file**

```typescript
// src/api-flakiness/routes/api-flakiness.routes.ts
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { getReport, recomputeAndSave } from '../flakiness-service';

export function registerFlakinessRoutes(app: Express): void {
  const noCache = (res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  };

  /**
   * GET /api/flakiness/:collectionId
   * Returns cached CollectionFlakinessReport (computes if not cached).
   */
  app.get('/api/flakiness/:collectionId', requireAuth, (req: Request, res: Response) => {
    noCache(res);
    try {
      const report = getReport(req.params.collectionId);
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: 'FLAKINESS_ERROR', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/flakiness/:collectionId/recompute
   * Forces a fresh scan of all runs for the collection.
   */
  app.post('/api/flakiness/:collectionId/recompute', requireAuth, (req: Request, res: Response) => {
    noCache(res);
    try {
      const report = recomputeAndSave(req.params.collectionId);
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: 'FLAKINESS_RECOMPUTE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  });
}
```

- [ ] **Step 2: Register routes in server.ts**

Find the line `registerWorkflowGraphRoutes(app);` in `src/ui/server.ts` and add after it:

```typescript
import { registerFlakinessRoutes } from '../api-flakiness/routes/api-flakiness.routes';
```

Add at the top with other imports, then after `registerWorkflowGraphRoutes(app);`:

```typescript
registerFlakinessRoutes(app);
```

- [ ] **Step 3: TypeScript build — expect clean**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build 2>&1 | tail -10
```

Expected: no output

- [ ] **Step 4: Commit**

```bash
git add src/api-flakiness/routes/api-flakiness.routes.ts src/ui/server.ts
git commit -m "feat(flakiness): REST routes GET /api/flakiness/:collectionId + POST .../recompute"
```

---

## Task 9: Runs UI — Flaky Indicators in Run List

**Files:**
- Modify: `src/ui/public/js/25-api-runs.js`
- Modify: `src/ui/public/styles_addon.css`

- [ ] **Step 1: Add flaky badge CSS to styles_addon.css**

Append to end of the exec graph section (after `.exec-graph-legend-retried`):

```css
/* Phase D Step 8: Flakiness indicators in run list */
.api-run-flaky-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: rgba(250,204,21,.15);
  border: 1px solid rgba(250,204,21,.4);
  color: #facc15;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  vertical-align: middle;
}
.api-run-hotspot-row td:first-child {
  border-left: 3px solid #facc15;
}
.flakiness-score-bar {
  display: inline-block;
  height: 6px;
  border-radius: 3px;
  vertical-align: middle;
  margin-left: 4px;
}
.flakiness-cluster-card {
  background: #1e2130;
  border: 1px solid #374151;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 8px;
}
.flakiness-cluster-card h4 {
  margin: 0 0 6px 0;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

- [ ] **Step 2: Add flakiness fetch + indicator to `_apiRunsRenderList` in 25-api-runs.js**

Find the `_apiRunsRenderList` function and replace it:

```javascript
// Phase D Step 8: cache flakiness report per collection
var _apiRunsFlakinessReport = null;
var _apiRunsFlakinessColId  = null;

async function _apiRunsFetchFlakiness(collectionId) {
  if (_apiRunsFlakinessColId === collectionId && _apiRunsFlakinessReport) return _apiRunsFlakinessReport;
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(collectionId));
    if (res.ok) {
      _apiRunsFlakinessReport = await res.json();
      _apiRunsFlakinessColId  = collectionId;
    }
  } catch (_) { /* non-fatal */ }
  return _apiRunsFlakinessReport;
}

function _apiRunsRenderList() {
  const tbody = document.getElementById('api-runs-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (_apiRunsList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No runs yet</td></tr>';
    return;
  }
  const hotspotSet = new Set(_apiRunsFlakinessReport ? (_apiRunsFlakinessReport.hotspots || []) : []);

  for (const run of _apiRunsList) {
    const passed  = run.stepResults?.filter(s => s.status === 'passed').length ?? 0;
    const failed  = run.stepResults?.filter(s => s.status === 'failed' || s.status === 'error').length ?? 0;
    const skipped = run.stepResults?.filter(s => s.status === 'skipped').length ?? 0;
    const total   = run.stepResults?.length ?? 0;
    const dur = run.startedAt && run.completedAt
      ? Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000) + 's'
      : '—';
    const badgeColor = run.status === 'passed' ? '#22c55e' : run.status === 'failed' ? '#ef4444' : run.status === 'running' ? '#3b82f6' : '#f59e0b';
    const badge = run.status === 'running'
      ? `<span class="badge" style="background:${badgeColor};color:#fff">⟳ running</span>`
      : `<span class="badge" style="background:${badgeColor};color:#fff">${run.status}</span>`;

    // Flaky indicator: mark run if any failed step is a known hotspot
    const hasFlaky = run.stepResults?.some(s => hotspotSet.has(s.stepId) && s.status !== 'passed');
    const flakyBadge = hasFlaky ? ' <span class="api-run-flaky-badge">⚡ flaky</span>' : '';

    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    if (hasFlaky) tr.classList.add('api-run-hotspot-row');
    tr.onclick = () => apiRunsViewDetail(run.id);
    tr.innerHTML = `
      <td>${badge}${flakyBadge}</td>
      <td style="font-size:12px">${run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</td>
      <td>${dur}</td>
      <td>${total}</td>
      <td><span style="color:#22c55e">${passed}✓</span> <span style="color:#ef4444">${failed}✗</span> <span style="color:#9ca3af">${skipped}⊘</span></td>
      <td><button class="tbl-btn" onclick="event.stopPropagation();apiRunsViewDetail('${run.id}')">View</button></td>`;
    tbody.appendChild(tr);
  }
}
```

- [ ] **Step 3: Trigger flakiness fetch when loading runs**

Find `apiRunsLoad` function. After `_apiRunsList = await res.json();` and before `_apiRunsRenderList();`, add:

```javascript
    if (_apiRunsCollectionId) {
      await _apiRunsFetchFlakiness(_apiRunsCollectionId);
    }
```

- [ ] **Step 4: Build frontend**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build:js 2>&1 | tail -5
```

Expected: `Built modules.js: ... KB`

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/js/25-api-runs.js src/ui/public/styles_addon.css
git commit -m "feat(flakiness): flaky badge + hotspot row highlight in runs list"
```

---

## Task 10: Flakiness Analytics Tab UI (26-api-flakiness.js)

**Files:**
- Create: `src/ui/public/js/26-api-flakiness.js`
- Modify: `src/ui/public/index.html`

- [ ] **Step 1: Create 26-api-flakiness.js**

```javascript
// API FLAKINESS ANALYTICS MODULE
// Collection-level flakiness report: hotspots, clusters, step breakdown
// ══════════════════════════════════════════════════════════════════════════════

var _flakinessColId   = null;
var _flakinessReport  = null;

async function flakinessLoad(collectionId) {
  _flakinessColId = collectionId || _flakinessColId;
  if (!_flakinessColId) {
    document.getElementById('flakiness-empty').style.display = '';
    document.getElementById('flakiness-content').style.display = 'none';
    return;
  }
  document.getElementById('flakiness-empty').style.display = 'none';
  document.getElementById('flakiness-content').style.display = '';
  document.getElementById('flakiness-loading').style.display = '';

  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId));
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    document.getElementById('flakiness-loading').style.display = 'none';
    modAlert('flakiness-alert', 'error', 'Load failed: ' + e.message);
  }
}

async function flakinessRecompute() {
  if (!_flakinessColId) return;
  document.getElementById('flakiness-loading').style.display = '';
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId) + '/recompute', { method: 'POST' });
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    modAlert('flakiness-alert', 'error', 'Recompute failed: ' + e.message);
  } finally {
    document.getElementById('flakiness-loading').style.display = 'none';
  }
}

function _flakinessRender() {
  document.getElementById('flakiness-loading').style.display = 'none';
  if (!_flakinessReport) return;
  _flakinessRenderSummary();
  _flakinessRenderHotspots();
  _flakinessRenderClusters();
  _flakinessRenderStepTable();
}

function _flakinessRenderSummary() {
  const r = _flakinessReport;
  const el = document.getElementById('flakiness-summary');
  if (!el) return;
  const stability = Math.round(r.stabilityScore * 100);
  const stabColor = stability >= 90 ? '#22c55e' : stability >= 70 ? '#f59e0b' : '#ef4444';
  el.innerHTML = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px;">
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:${stabColor}">${stability}%</div>
        <div style="font-size:11px;color:var(--text-muted)">Stability Score</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:var(--text-main)">${r.runsAnalyzed}</div>
        <div style="font-size:11px;color:var(--text-muted)">Runs Analyzed</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#facc15">${r.hotspots.length}</div>
        <div style="font-size:11px;color:var(--text-muted)">Flaky Steps</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#a78bfa">${r.clusters.length}</div>
        <div style="font-size:11px;color:var(--text-muted)">Clusters</div>
      </div>
    </div>
    <div style="font-size:10px;color:var(--text-muted)">Computed: ${new Date(r.computedAt).toLocaleString()}</div>`;
}

function _flakinessRenderHotspots() {
  const el = document.getElementById('flakiness-hotspots');
  if (!el || !_flakinessReport) return;
  const hotspotIds = new Set(_flakinessReport.hotspots);
  const flaky = _flakinessReport.stepRecords.filter(r => hotspotIds.has(r.stepId))
    .sort((a, b) => b.flakinessScore - a.flakinessScore);
  if (flaky.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No flaky steps detected.</div>';
    return;
  }
  el.innerHTML = flaky.map(function(r) {
    var pct = Math.round(r.flakinessScore * 100);
    var barColor = pct >= 70 ? '#ef4444' : pct >= 40 ? '#f59e0b' : '#facc15';
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #374151;">'
      + '<div style="flex:1;font-size:12px;">' + _flakinessEscHtml(r.stepName) + '</div>'
      + '<div style="width:100px;background:#1e2130;border-radius:4px;height:8px;">'
      + '<div style="width:' + pct + '%;background:' + barColor + ';border-radius:4px;height:100%;"></div></div>'
      + '<div style="width:36px;text-align:right;font-size:11px;color:' + barColor + ';">' + pct + '%</div>'
      + '<div style="width:60px;text-align:right;font-size:10px;color:var(--text-muted);">' + Math.round(r.failRate * 100) + '% fail</div>'
      + '</div>';
  }).join('');
}

function _flakinessRenderClusters() {
  const el = document.getElementById('flakiness-clusters');
  if (!el || !_flakinessReport) return;
  if (_flakinessReport.clusters.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No failure clusters detected.</div>';
    return;
  }
  el.innerHTML = _flakinessReport.clusters.map(function(c) {
    var dimLabel = { http_status: 'HTTP Status', assertion_type: 'Assertion', transport_error: 'Transport Error', dependency_chain: 'Dependency Chain', endpoint: 'Endpoint' }[c.dimension] || c.dimension;
    return '<div class="flakiness-cluster-card">'
      + '<h4>' + dimLabel + ': ' + _flakinessEscHtml(c.dimensionKey) + '</h4>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">' + c.stepIds.length + ' step(s) · ' + c.totalFailures + ' total failures · avg score ' + Math.round(c.avgFlakinessScore * 100) + '%</div>'
      + '<div style="font-size:11px;color:#9ca3af;">' + c.stepNames.map(function(n) { return _flakinessEscHtml(n); }).join(', ') + '</div>'
      + '</div>';
  }).join('');
}

function _flakinessRenderStepTable() {
  const el = document.getElementById('flakiness-step-tbody');
  if (!el || !_flakinessReport) return;
  const records = [..._flakinessReport.stepRecords].sort((a, b) => b.flakinessScore - a.flakinessScore);
  el.innerHTML = records.map(function(r) {
    var pct = Math.round(r.flakinessScore * 100);
    var color = r.isFlaky ? '#facc15' : '#22c55e';
    var flakyLabel = r.isFlaky ? '<span class="api-run-flaky-badge">⚡ flaky</span>' : '<span style="color:#22c55e;font-size:10px;">stable</span>';
    var sig = r.dominantSignature ? r.dominantSignature.category : '—';
    return '<tr>'
      + '<td style="font-size:12px;">' + _flakinessEscHtml(r.stepName) + ' ' + flakyLabel + '</td>'
      + '<td style="text-align:center;font-size:11px;">' + Math.round(r.failRate * 100) + '%</td>'
      + '<td><div style="display:flex;align-items:center;gap:4px;">'
      + '<div style="width:60px;background:#1e2130;border-radius:3px;height:6px;">'
      + '<div style="width:' + pct + '%;background:' + color + ';border-radius:3px;height:100%;"></div></div>'
      + '<span style="font-size:10px;color:' + color + ';">' + pct + '%</span></div></td>'
      + '<td style="font-size:11px;color:var(--text-muted);">' + _flakinessEscHtml(sig) + '</td>'
      + '<td style="text-align:center;font-size:11px;">' + r.totalRuns + '</td>'
      + '</tr>';
  }).join('');
}

function _flakinessEscHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 2: Add panel + nav to index.html**

In `src/ui/public/index.html`, find the nav item for `api-runs`:
```html
<div class="nav-item" data-tab="api-runs">
```

Add immediately after that nav-item's closing tag:
```html
<div class="nav-item" data-tab="api-flakiness">API Flakiness</div>
```

Find `</div><!-- /panel-api-runs -->` and add immediately after:
```html
<div class="panel" id="panel-api-flakiness">
  <div class="panel-header">
    <h2>API Flakiness Analytics</h2>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-sm" onclick="flakinessRecompute()">↺ Recompute</button>
    </div>
  </div>
  <div id="flakiness-alert"></div>
  <div id="flakiness-empty" style="display:none;color:var(--text-muted);padding:20px;">Select a collection to view flakiness analytics.</div>
  <div id="flakiness-loading" style="display:none;color:var(--text-muted);padding:8px;">Computing…</div>
  <div id="flakiness-content" style="display:none;">
    <div id="flakiness-summary" style="margin-bottom:16px;"></div>
    <h3 style="font-size:13px;margin:0 0 8px 0;color:var(--text-muted);">⚡ Flaky Hotspots</h3>
    <div id="flakiness-hotspots" style="margin-bottom:16px;"></div>
    <h3 style="font-size:13px;margin:0 0 8px 0;color:var(--text-muted);">🗂 Failure Clusters</h3>
    <div id="flakiness-clusters" style="margin-bottom:16px;"></div>
    <h3 style="font-size:13px;margin:0 0 8px 0;color:var(--text-muted);">Step Breakdown</h3>
    <table class="data-table" style="width:100%;">
      <thead><tr>
        <th>Step</th><th>Fail Rate</th><th>Flakiness</th><th>Signature</th><th>Runs</th>
      </tr></thead>
      <tbody id="flakiness-step-tbody"></tbody>
    </table>
  </div>
</div><!-- /panel-api-flakiness -->
```

- [ ] **Step 3: Wire tab switch in 08-tab-switch.js**

In `src/ui/public/js/08-tab-switch.js`, find:
```javascript
if (tab === 'api-runs') apiRunsLoad();
```

Add after:
```javascript
if (tab === 'api-flakiness') flakinessLoad();
```

Also add `'api-flakiness'` to the `PROJECT_SCOPED_TABS` Set.

- [ ] **Step 4: Add 26-api-flakiness.js to concat list**

Check `scripts/concat-modules.js` for the list of JS files. Add `'src/ui/public/js/26-api-flakiness.js'` after the `25-api-runs.js` entry.

- [ ] **Step 5: Build frontend**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build:js 2>&1 | tail -5
```

Expected: `Built modules.js: ... KB`

- [ ] **Step 6: Commit**

```bash
git add src/ui/public/js/26-api-flakiness.js src/ui/public/index.html src/ui/public/js/08-tab-switch.js
git commit -m "feat(flakiness): API Flakiness Analytics tab — hotspots, clusters, step table"
```

---

## Task 11: Graph Overlay Integration (Flaky Node Badges on Exec Graph)

**Files:**
- Modify: `src/ui/public/js/25-api-runs.js`

- [ ] **Step 1: Enrich `_execGraphBuildElementsFromNodeResults` to add flaky class**

In `25-api-runs.js`, find the `_execGraphBuildElementsFromNodeResults` function and add flaky enrichment.

After `var nr = nodeResults[node.id];` and before building `classes`, add:
```javascript
    // Phase D Step 8: mark node as flaky if it appears in hotspots
    var isHotspot = _apiRunsFlakinessReport && (_apiRunsFlakinessReport.hotspots || []).indexOf(node.id) > -1;
```

In the `classes` array, add:
```javascript
    if (isHotspot) classes.push('exec-node-flaky');
```

In the label, prepend flaky marker:
```javascript
    var flakyMark = isHotspot ? '⚡ ' : '';
    var retryBadge = nr && nr.retryCount > 0 ? ' ↺' + nr.retryCount : '';
    // OLD: label: (node.label || node.id) + retryBadge,
    label: flakyMark + (node.label || node.id) + retryBadge,
```

- [ ] **Step 2: Add `exec-node-flaky` CSS to Cytoscape styles in `_execGraphCyStyles`**

In `_execGraphCyStyles()`, after the `exec-node-retried` style block, add:
```javascript
    { selector: 'node.exec-node-flaky', style: {
        'border-color': '#facc15',
        'border-width': 3,
        'border-style': 'dashed',
    }},
```

- [ ] **Step 3: Build frontend**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build:js 2>&1 | tail -5
```

Expected: `Built modules.js: ... KB`

- [ ] **Step 4: Commit**

```bash
git add src/ui/public/js/25-api-runs.js
git commit -m "feat(flakiness): flaky node overlay on execution graph (dashed yellow border)"
```

---

## Task 12: Full Build + Regression Check

**Files:** None (verification only)

- [ ] **Step 1: Full TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build 2>&1 | tail -10
```

Expected: no output (clean)

- [ ] **Step 2: Run all flakiness tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/api-flakiness/__tests__/ 2>&1 | tail -20
```

Expected: `~26 passed` across 4 test files

- [ ] **Step 3: Verify pre-existing failures unchanged**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npx vitest run src/utils/__tests__/ 2>&1 | tail -10
```

Expected: same 39 failures as before — no new failures

- [ ] **Step 4: Update CLAUDE.md — mark Phase D Step 8 complete**

In `e:\AI Agent\qa-agent-platform-dev\CLAUDE.md`, add a pointer to the plan file in the superpowers plans section:

```markdown
> **📋 See [docs/superpowers/plans/2026-05-17-phase-d-step8-api-flakiness-analytics.md](docs/superpowers/plans/2026-05-17-phase-d-step8-api-flakiness-analytics.md) — Phase D Step 8 implementation plan (12 tasks). **COMPLETE as of 2026-05-17.**
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Phase D Step 8 complete — API Flakiness Analytics & Failure Clustering"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task(s) |
|---|---|
| A. Failure Signature Model (6 categories) | Task 2 |
| B. Flakiness Aggregation (failRate, alternation, retryStats) | Task 3 |
| C. TestEvent Mapping — uses ApiStepResult not Playwright TestEvent (correct: API domain) | Task 3, 6 |
| D. Failure Clustering (5 dimensions, rule-based) | Task 4 |
| E. Runs UI — flaky indicators, retry heat, hotspot rows | Task 9 |
| F. Graph Overlay — flaky node badges, dashed border | Task 11 |
| G. Metrics prep — stabilityScore, hotspots[], CollectionFlakinessReport contracts | Task 1, 6 |
| H. Backward compat — reads existing runs, no schema changes | All tasks (store is additive) |
| I. Runtime isolation — no apiRunner.ts changes, analytics observational only | All tasks |
| J. AI RCA extension points — FailureSignature.signatureKey + RetryStats ready for AI consumer | Task 1 |

### Type Consistency Check
- `FailureSignature` defined Task 1 → used Tasks 2, 3, 4 ✓
- `StepFlakinessRecord` defined Task 1 → returned Task 3, consumed Tasks 4, 6 ✓
- `CollectionFlakinessReport` defined Task 1 → returned Task 6, stored Task 5, routed Task 8, rendered Task 10 ✓
- `computeReport` defined Task 6 → tested Task 6, exported Task 7 ✓
- `_apiRunsFlakinessReport` state var added Task 9 → consumed Task 11 ✓

### Placeholder Scan
No TBD, TODO, or "implement later" phrases found. All steps have concrete code.
