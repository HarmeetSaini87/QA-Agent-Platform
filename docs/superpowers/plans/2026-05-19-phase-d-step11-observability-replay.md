# Phase D Step 11: Enterprise Observability, Replay Engine & Execution Intelligence Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a post-hoc replay event model, observability query layer, execution diff contracts, and a timeline UI — all purely observational, zero changes to the execution runtime.

**Architecture:** A new `src/api-observability/` module synthesizes `ReplayEvent[]` from existing immutable `ApiCollectionRunResult + ExecutionSnapshot` records stored to disk by the existing runtime. Three new GET routes expose timeline, replay events, and an observability summary. A `28-api-replay.js` UI module shows the timeline and replay event list. Execution diff and AI RCA contracts are defined for future use. Runtime (`apiRunner.ts`, `workflow-engine`, DAG, retries) is untouched.

**Tech Stack:** TypeScript · Vitest · Express · vanilla JS (`28-api-replay.js`) · existing `execution-store`, `timeline-builder`, `artifact-engine`

---

## What already exists — DO NOT re-implement

Before starting, understand what is already built so subagents don't duplicate it:

| Already shipped | Location |
|---|---|
| `ExecutionTimeline` / `TimelineEvent` contracts | `src/shared-core/contracts/artifact.contract.ts` |
| `buildTimeline()`, `buildTimelineFromRecords()`, `saveTimeline()`, `loadTimeline()` | `src/api-runtime/artifact-engine/timeline-builder.ts` |
| `ExecutionSnapshot` / `NodeExecutionRecord` / `RetryState` / `DagGraph` | `src/shared-core/contracts/dependency-graph.contract.ts` |
| `saveSnapshot()`, `loadSnapshot()`, `listRunSummaries()` | `src/storage-provider/execution-store.ts` |
| `HarArtifact`, `HarEntry`, `ArtifactRef` | `src/shared-core/contracts/artifact.contract.ts` |
| `ExecutionRequest`, `ExecutionContext`, `ExecutionPayload` | `src/api-runtime/execution-coordinator/contracts.ts` |
| `FailureReason`, `SkipReason`, `RetryState`, `rerunEligible` | `src/shared-core/contracts/dependency-graph.contract.ts` |
| `ApiStepResult.isTeardown` | `src/data/types.ts` |

---

## File Structure

```
src/api-observability/
  contracts/
    replay-event.contracts.ts     — ReplayEvent, ReplaySession (spec req A, B, G)
    execution-diff.contracts.ts   — RunDiffRequest, StepDiff, RunDiffSummary (spec req F)
    rca-extension.contracts.ts    — RcaExtensionPoint, RcaHint (spec req J)
  replay-event-synthesizer.ts     — post-hoc synthesis: run result + snapshot → ReplayEvent[] (spec req B)
  replay-event-store.ts           — save/load/list replay event sessions (spec req G)
  observability-query.ts          — aggregate query: timeline + replay + snapshot → ObservabilitySummary (spec req C, G)
  routes/
    observability.routes.ts       — 3 GET endpoints (spec req C, D, E)
  index.ts                        — barrel export
src/ui/public/js/28-api-replay.js — timeline + replay event UI (spec req C, E)
src/ui/public/index.html          — add nav tab + panel
src/ui/public/styles_addon.css    — replay/observability CSS
src/ui/server.ts                  — register observability routes
```

---

## Task 1: Replay Event Contracts

**Files:**
- Create: `src/api-observability/contracts/replay-event.contracts.ts`
- Create: `src/api-observability/contracts/execution-diff.contracts.ts`
- Create: `src/api-observability/contracts/rca-extension.contracts.ts`

No TDD — types only.

- [ ] **Step 1: Create `src/api-observability/contracts/replay-event.contracts.ts`**

```typescript
// src/api-observability/contracts/replay-event.contracts.ts
// Spec req A: normalized immutable replay event records.
// Spec req B: replay session = the ordered list of events for one run.
// Spec req G: observability storage contract for RCA/audit history.

export type ReplayEventKind =
  | 'request-sent'
  | 'response-received'
  | 'assertion-evaluated'
  | 'retry-triggered'
  | 'dependency-wait'
  | 'lifecycle-hook-executed'
  | 'teardown-executed'
  | 'failure-propagated'
  | 'variable-extracted'
  | 'step-skipped'
  | 'step-completed';

export interface ReplayEvent {
  /** Stable monotonic sequence within the run — used for deterministic replay ordering */
  readonly seq: number;
  readonly kind: ReplayEventKind;
  readonly stepId: string;
  readonly stepName: string;
  /** ISO timestamp — sourced from existing run data; synthetic (run startedAt) when exact not available */
  readonly timestamp: string;
  readonly durationMs?: number;

  // request-sent / response-received
  readonly request?: {
    readonly method: string;
    readonly url: string;
    /** Header keys only — no secret values */
    readonly headerKeys: string[];
    /** Body length in bytes — not inline body */
    readonly bodySizeBytes: number;
  };
  readonly response?: {
    readonly status: number;
    readonly durationMs: number;
    readonly bodyTruncated: boolean;
    /** Header keys only */
    readonly headerKeys: string[];
  };

  // assertion-evaluated
  readonly assertion?: {
    readonly type: string;
    readonly passed: boolean;
    readonly message?: string;
  };

  // retry-triggered
  readonly retry?: {
    readonly attempt: number;
    readonly maxRetries: number;
    readonly delayMs: number;
    readonly triggerStatus?: number;
    readonly triggerError?: string;
  };

  // dependency-wait
  readonly dependency?: {
    readonly waitingForStepId: string;
    readonly waitingForStepName: string;
  };

  // lifecycle-hook-executed / teardown-executed
  readonly isTeardown?: boolean;
  readonly isLifecycleHook?: boolean;

  // failure-propagated
  readonly failure?: {
    readonly reason: string;
    readonly propagatedToStepIds: string[];
  };

  // variable-extracted
  readonly variable?: {
    readonly key: string;
    /** Value masked if name suggests secret (password, token, key, secret) */
    readonly maskedValue: string;
  };

  // step-skipped
  readonly skipReason?: string;
}

/** Immutable ordered sequence of replay events for one collection run */
export interface ReplaySession {
  readonly runId: string;
  readonly collectionId: string;
  readonly collectionName?: string;
  readonly synthesizedAt: string;
  /** Schema version — bump if ReplayEvent shape changes incompatibly */
  readonly _schemaVersion: 1;
  readonly events: readonly ReplayEvent[];
  /** Total number of events */
  readonly eventCount: number;
  /** Stats derived from events */
  readonly stats: {
    readonly requestsSent: number;
    readonly assertionsPassed: number;
    readonly assertionsFailed: number;
    readonly retriesTriggered: number;
    readonly teardownEvents: number;
    readonly failuresPropagated: number;
  };
}
```

- [ ] **Step 2: Create `src/api-observability/contracts/execution-diff.contracts.ts`**

```typescript
// src/api-observability/contracts/execution-diff.contracts.ts
// Spec req F: execution diff foundation contracts.
// ADVISORY ONLY — no diff engine implemented yet.

export interface RunDiffRequest {
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly collectionId: string;
  /** Compare only these step IDs — undefined = all steps */
  readonly stepIds?: string[];
  /** Include latency drift analysis */
  readonly includeLatencyDrift: boolean;
  /** Include response body diff (future — not implemented in Step 11) */
  readonly includeBodyDiff: boolean;
}

export type StepDiffKind =
  | 'status-changed'      // passed→failed, failed→passed
  | 'latency-drift'       // durationMs changed beyond threshold
  | 'retry-count-changed' // more/fewer retries needed
  | 'assertion-drift'     // assertion results differ
  | 'error-changed'       // different error message
  | 'new-step'            // step exists in candidate but not baseline
  | 'removed-step';       // step exists in baseline but not candidate

export interface StepDiff {
  readonly stepId: string;
  readonly stepName: string;
  readonly kind: StepDiffKind;
  readonly baseline?: {
    readonly status: string;
    readonly durationMs: number;
    readonly retryCount: number;
    readonly error?: string;
  };
  readonly candidate?: {
    readonly status: string;
    readonly durationMs: number;
    readonly retryCount: number;
    readonly error?: string;
  };
  readonly latencyDriftMs?: number;
  readonly latencyDriftPercent?: number;
}

export interface RunDiffSummary {
  readonly request: RunDiffRequest;
  readonly computedAt: string;
  readonly baselineStatus: string;
  readonly candidateStatus: string;
  readonly stepDiffs: readonly StepDiff[];
  /** True if overall status changed between runs */
  readonly statusChanged: boolean;
  /** Steps that regressed (passed→failed) */
  readonly regressedStepIds: string[];
  /** Steps that improved (failed→passed) */
  readonly improvedStepIds: string[];
  /** Future: body diff entries — empty array until diff engine ships */
  readonly bodyDiffs: readonly never[];
}
```

- [ ] **Step 3: Create `src/api-observability/contracts/rca-extension.contracts.ts`**

```typescript
// src/api-observability/contracts/rca-extension.contracts.ts
// Spec req J: AI RCA extension point contracts.
// ADVISORY ONLY — extension points for future AI RCA engine.
// No AI calls, no autonomous remediation, no runtime side effects.

export type RcaHintKind =
  | 'flakiness-pattern'       // step has high flakiness score
  | 'retry-exhaustion'        // step consistently exhausts retries
  | 'dependency-chain-break'  // cascading failure from a root cause
  | 'latency-anomaly'         // unusual latency vs historical baseline
  | 'auth-expiry'             // 401/403 pattern suggesting token expiry
  | 'environment-drift';      // same step fails in one env, passes in another

export interface RcaHint {
  readonly kind: RcaHintKind;
  readonly stepId: string;
  readonly stepName: string;
  readonly confidence: 'low' | 'medium' | 'high';
  /** Human-readable description of the hint */
  readonly description: string;
  /** Supporting evidence from run data — no inference, only facts */
  readonly evidence: readonly string[];
  /** Suggested investigation paths — NOT automated remediation */
  readonly investigationPaths: readonly string[];
}

/**
 * RcaExtensionPoint — the contract an AI RCA engine will implement in future.
 * Current behaviour: returns empty hints array (no-op implementation).
 * Future: AI engine analyses ReplaySession + FlakinessReport → RcaHint[].
 *
 * INVARIANT: implementations MUST NOT modify execution state, collections, or retries.
 */
export interface RcaExtensionPoint {
  /**
   * Analyse a replay session and return zero or more root cause hints.
   * Must be pure and side-effect-free.
   */
  analyseSession(session: import('./replay-event.contracts').ReplaySession): Promise<RcaHint[]>;
  /** Name of this RCA provider — for audit logging */
  readonly providerName: string;
}

/** No-op RCA provider — ships with Step 11, replaced by AI provider in future */
export class NoOpRcaProvider implements RcaExtensionPoint {
  readonly providerName = 'no-op';
  async analyseSession(): Promise<RcaHint[]> { return []; }
}
```

- [ ] **Step 4: TypeScript compile check**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-observability/contracts/ && git commit -m "feat(observability): replay event, execution diff, RCA extension contracts (Task 1)"
```

---

## Task 2: Replay Event Synthesizer

**Files:**
- Create: `src/api-observability/replay-event-synthesizer.ts`
- Create: `src/api-observability/__tests__/replay-event-synthesizer.test.ts`

The synthesizer reads from existing `ApiCollectionRunResult` (and optionally `ExecutionSnapshot`) and produces a `ReplaySession`. It never touches the runtime.

- [ ] **Step 1: Write the failing tests**

Create `src/api-observability/__tests__/replay-event-synthesizer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { synthesizeReplaySession } from '../replay-event-synthesizer';
import type { ApiCollectionRunResult, ApiStepResult } from '../../data/types';

function makeStepResult(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'GET /users',
    status: 'passed',
    request: { method: 'GET', url: 'http://x/users', headers: { Authorization: 'Bearer secret' }, body: undefined, queryParams: {} },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{}', durationMs: 45, bodyTruncated: false },
    assertionResults: [{ type: 'status', passed: true, message: 'status is 200' }],
    extractedVariables: { userId: '42' },
    durationMs: 45,
    ...overrides,
  };
}

function makeRunResult(steps: ApiStepResult[]): ApiCollectionRunResult {
  return {
    id: 'run-1',
    collectionId: 'col-1',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:01Z',
    status: 'passed',
    stepResults: steps,
    variableContext: {},
  };
}

describe('synthesizeReplaySession', () => {
  it('returns a ReplaySession with correct metadata', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    expect(session.runId).toBe('run-1');
    expect(session.collectionId).toBe('col-1');
    expect(session._schemaVersion).toBe(1);
    expect(typeof session.synthesizedAt).toBe('string');
  });

  it('emits request-sent and response-received events for each step', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    const kinds = session.events.map(e => e.kind);
    expect(kinds).toContain('request-sent');
    expect(kinds).toContain('response-received');
  });

  it('masks secret header values — exposes only header keys', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    const reqEvent = session.events.find(e => e.kind === 'request-sent');
    expect(reqEvent!.request!.headerKeys).toContain('authorization');
    // The header VALUE must not appear anywhere in any event
    const raw = JSON.stringify(session.events);
    expect(raw).not.toContain('Bearer secret');
  });

  it('emits assertion-evaluated events for each assertion result', () => {
    const step = makeStepResult({
      assertionResults: [
        { type: 'status', passed: true, message: 'ok' },
        { type: 'body', passed: false, message: 'body mismatch' },
      ],
    });
    const session = synthesizeReplaySession(makeRunResult([step]));
    const assertions = session.events.filter(e => e.kind === 'assertion-evaluated');
    expect(assertions).toHaveLength(2);
    expect(assertions.find(a => !a.assertion!.passed)!.assertion!.message).toBe('body mismatch');
  });

  it('emits variable-extracted events for each extracted variable', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    const varEvents = session.events.filter(e => e.kind === 'variable-extracted');
    expect(varEvents).toHaveLength(1);
    expect(varEvents[0].variable!.key).toBe('userId');
  });

  it('masks variable values that look like secrets', () => {
    const step = makeStepResult({ extractedVariables: { authToken: 'super-secret-value' } });
    const session = synthesizeReplaySession(makeRunResult([step]));
    const varEvent = session.events.find(e => e.kind === 'variable-extracted');
    expect(varEvent!.variable!.maskedValue).toBe('***');
  });

  it('does not mask non-secret variable values', () => {
    const step = makeStepResult({ extractedVariables: { userId: '42' } });
    const session = synthesizeReplaySession(makeRunResult([step]));
    const varEvent = session.events.find(e => e.kind === 'variable-extracted');
    expect(varEvent!.variable!.maskedValue).toBe('42');
  });

  it('emits step-completed for passed steps', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult({ status: 'passed' })]));
    expect(session.events.some(e => e.kind === 'step-completed')).toBe(true);
  });

  it('emits step-skipped for skipped steps', () => {
    const skipped = makeStepResult({ status: 'skipped', response: undefined });
    const session = synthesizeReplaySession(makeRunResult([skipped]));
    expect(session.events.some(e => e.kind === 'step-skipped')).toBe(true);
  });

  it('emits teardown-executed for teardown steps', () => {
    const td = makeStepResult({ isTeardown: true });
    const session = synthesizeReplaySession(makeRunResult([td]));
    const tdEvent = session.events.find(e => e.kind === 'teardown-executed');
    expect(tdEvent).toBeDefined();
    expect(tdEvent!.isTeardown).toBe(true);
  });

  it('seq numbers are strictly monotonically increasing', () => {
    const run = makeRunResult([makeStepResult({ stepId: 's1' }), makeStepResult({ stepId: 's2', stepName: 'step2' })]);
    const session = synthesizeReplaySession(run);
    const seqs = session.events.map(e => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it('stats.requestsSent equals number of steps with a response', () => {
    const run = makeRunResult([makeStepResult(), makeStepResult({ stepId: 's2', stepName: 's2' })]);
    const session = synthesizeReplaySession(run);
    expect(session.stats.requestsSent).toBe(2);
  });

  it('stats.assertionsFailed counts failed assertions across all steps', () => {
    const step = makeStepResult({
      assertionResults: [{ type: 'status', passed: false, message: 'fail' }],
    });
    const session = synthesizeReplaySession(makeRunResult([step]));
    expect(session.stats.assertionsFailed).toBe(1);
  });

  it('eventCount matches events array length', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    expect(session.eventCount).toBe(session.events.length);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-observability/__tests__/replay-event-synthesizer.test.ts 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/api-observability/replay-event-synthesizer.ts`**

```typescript
import type { ApiCollectionRunResult } from '../data/types';
import type { ExecutionSnapshot } from '../shared-core/contracts/dependency-graph.contract';
import type { ReplayEvent, ReplayEventKind, ReplaySession } from './contracts/replay-event.contracts';

const SECRET_KEY_RE = /password|token|secret|apikey|api_key|auth|credential/i;

function maskIfSecret(key: string, value: string): string {
  return SECRET_KEY_RE.test(key) ? '***' : value;
}

function headerKeys(headers: Record<string, string>): string[] {
  return Object.keys(headers).map(k => k.toLowerCase());
}

function bodySizeBytes(body: unknown): number {
  if (body === undefined || body === null) return 0;
  return Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
}

export function synthesizeReplaySession(
  run: ApiCollectionRunResult,
  _snapshot?: ExecutionSnapshot,
): ReplaySession {
  const events: ReplayEvent[] = [];
  let seq = 0;

  const stats = {
    requestsSent: 0,
    assertionsPassed: 0,
    assertionsFailed: 0,
    retriesTriggered: 0,
    teardownEvents: 0,
    failuresPropagated: 0,
  };

  for (const step of run.stepResults) {
    const ts = run.startedAt;

    // request-sent
    if (step.request) {
      events.push({
        seq: seq++, kind: 'request-sent', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        request: {
          method: step.request.method,
          url: step.request.url,
          headerKeys: headerKeys(step.request.headers ?? {}),
          bodySizeBytes: bodySizeBytes(step.request.body),
        },
        isTeardown: step.isTeardown,
      });
      stats.requestsSent++;
    }

    // response-received
    if (step.response) {
      events.push({
        seq: seq++, kind: 'response-received', stepId: step.stepId, stepName: step.stepName,
        timestamp: ts, durationMs: step.response.durationMs,
        response: {
          status: step.response.status,
          durationMs: step.response.durationMs,
          bodyTruncated: step.response.bodyTruncated,
          headerKeys: headerKeys(step.response.headers ?? {}),
        },
        isTeardown: step.isTeardown,
      });
    }

    // assertion-evaluated (one event per assertion)
    for (const ar of step.assertionResults ?? []) {
      events.push({
        seq: seq++, kind: 'assertion-evaluated', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        assertion: { type: ar.type ?? 'unknown', passed: ar.passed, message: ar.message },
      });
      if (ar.passed) stats.assertionsPassed++; else stats.assertionsFailed++;
    }

    // variable-extracted (one event per variable)
    for (const [key, value] of Object.entries(step.extractedVariables ?? {})) {
      events.push({
        seq: seq++, kind: 'variable-extracted', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        variable: { key, maskedValue: maskIfSecret(key, String(value)) },
      });
    }

    // teardown-executed
    if (step.isTeardown) {
      events.push({
        seq: seq++, kind: 'teardown-executed', stepId: step.stepId, stepName: step.stepName,
        timestamp: ts, durationMs: step.durationMs, isTeardown: true,
      });
      stats.teardownEvents++;
    }

    // step-skipped
    if (step.status === 'skipped') {
      events.push({
        seq: seq++, kind: 'step-skipped', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        skipReason: step.error ?? 'dependency-failed',
      });
    }

    // step-completed (non-skipped terminal event)
    if (step.status !== 'skipped') {
      events.push({
        seq: seq++, kind: 'step-completed', stepId: step.stepId, stepName: step.stepName,
        timestamp: ts, durationMs: step.durationMs,
        isTeardown: step.isTeardown,
      });
    }

    // failure-propagated
    if (step.status === 'failed' || step.status === 'error') {
      events.push({
        seq: seq++, kind: 'failure-propagated', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        failure: { reason: step.error ?? step.status, propagatedToStepIds: [] },
      });
      stats.failuresPropagated++;
    }
  }

  return {
    runId: run.id,
    collectionId: run.collectionId,
    synthesizedAt: new Date().toISOString(),
    _schemaVersion: 1,
    events,
    eventCount: events.length,
    stats,
  };
}
```

- [ ] **Step 4: Run tests — expect all green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-observability/__tests__/replay-event-synthesizer.test.ts 2>&1 | tail -15
```

- [ ] **Step 5: TypeScript check**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-observability/replay-event-synthesizer.ts src/api-observability/__tests__/replay-event-synthesizer.test.ts && git commit -m "feat(observability): replay event synthesizer — post-hoc, runtime-isolated (Task 2)"
```

---

## Task 3: Replay Event Store

**Files:**
- Create: `src/api-observability/replay-event-store.ts`
- Create: `src/api-observability/__tests__/replay-event-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/api-observability/__tests__/replay-event-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveReplaySession, loadReplaySession, replaySessionExists } from '../replay-event-store';
import type { ReplaySession } from '../contracts/replay-event.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSession(runId: string): ReplaySession {
  return {
    runId,
    collectionId: 'col-1',
    synthesizedAt: '2026-01-01T00:00:00Z',
    _schemaVersion: 1,
    events: [],
    eventCount: 0,
    stats: { requestsSent: 0, assertionsPassed: 0, assertionsFailed: 0, retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 },
  };
}

describe('replay-event-store', () => {
  it('saveReplaySession writes to data/replay-sessions/<runId>.replay.json', () => {
    saveReplaySession(makeSession('run-1'));
    const file = path.join(tmpDir, 'replay-sessions', 'run-1.replay.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('loadReplaySession returns null when absent', () => {
    expect(loadReplaySession('missing')).toBeNull();
  });

  it('loadReplaySession returns the saved session', () => {
    saveReplaySession(makeSession('run-2'));
    const loaded = loadReplaySession('run-2');
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe('run-2');
  });

  it('replaySessionExists returns false when absent', () => {
    expect(replaySessionExists('missing')).toBe(false);
  });

  it('replaySessionExists returns true after save', () => {
    saveReplaySession(makeSession('run-3'));
    expect(replaySessionExists('run-3')).toBe(true);
  });

  it('saveReplaySession uses atomic write — no .tmp file left behind', () => {
    saveReplaySession(makeSession('run-4'));
    const tmp = path.join(tmpDir, 'replay-sessions', 'run-4.replay.json.tmp');
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-observability/__tests__/replay-event-store.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create `src/api-observability/replay-event-store.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { ReplaySession } from './contracts/replay-event.contracts';

function replayDir(): string {
  return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'replay-sessions');
}

function sessionPath(runId: string): string {
  return path.join(replayDir(), `${runId}.replay.json`);
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function saveReplaySession(session: ReplaySession): void {
  atomicWrite(sessionPath(session.runId), JSON.stringify(session, null, 2));
}

export function loadReplaySession(runId: string): ReplaySession | null {
  const file = sessionPath(runId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as ReplaySession; }
  catch { return null; }
}

export function replaySessionExists(runId: string): boolean {
  return fs.existsSync(sessionPath(runId));
}
```

- [ ] **Step 4: Run tests — expect all green**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-observability/__tests__/replay-event-store.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: TypeScript check**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-observability/replay-event-store.ts src/api-observability/__tests__/replay-event-store.test.ts && git commit -m "feat(observability): replay event store — atomic write, lazy-cached (Task 3)"
```

---

## Task 4: Observability Query + Barrel Export

**Files:**
- Create: `src/api-observability/observability-query.ts`
- Create: `src/api-observability/__tests__/observability-query.test.ts`
- Create: `src/api-observability/index.ts`

The query function aggregates: existing timeline + existing snapshot + replay session (synthesizing and caching on first call).

- [ ] **Step 1: Write the failing tests**

Create `src/api-observability/__tests__/observability-query.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-query-test-'));
  process.env.DATA_DIR = tmpDir;
});
afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

vi.mock('../../storage-provider/execution-store', () => ({
  loadRunResult: vi.fn(),
  loadSnapshot: vi.fn(),
}));
vi.mock('../../api-runtime/artifact-engine/timeline-builder', () => ({
  loadTimeline: vi.fn(),
}));
vi.mock('../replay-event-store', () => ({
  loadReplaySession: vi.fn(),
  replaySessionExists: vi.fn(),
  saveReplaySession: vi.fn(),
}));

import { getObservabilitySummary } from '../observability-query';
import { loadRunResult, loadSnapshot } from '../../storage-provider/execution-store';
import { loadTimeline } from '../../api-runtime/artifact-engine/timeline-builder';
import { loadReplaySession, replaySessionExists, saveReplaySession } from '../replay-event-store';

const mockLoadRunResult = vi.mocked(loadRunResult);
const mockLoadSnapshot = vi.mocked(loadSnapshot);
const mockLoadTimeline = vi.mocked(loadTimeline);
const mockLoadReplaySession = vi.mocked(loadReplaySession);
const mockReplaySessionExists = vi.mocked(replaySessionExists);
const mockSaveReplaySession = vi.mocked(saveReplaySession);

function makeRun() {
  return {
    id: 'run-1', collectionId: 'col-1', startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:01Z', status: 'passed' as const,
    stepResults: [], variableContext: {},
  };
}

describe('getObservabilitySummary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when run result not found', async () => {
    mockLoadRunResult.mockReturnValue(undefined);
    const result = await getObservabilitySummary('run-x');
    expect(result).toBeNull();
  });

  it('returns summary with run metadata when run exists', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue(undefined);
    mockLoadTimeline.mockResolvedValue(undefined);
    mockReplaySessionExists.mockReturnValue(false);
    mockLoadReplaySession.mockReturnValue(null);
    mockSaveReplaySession.mockReturnValue(undefined);

    const summary = await getObservabilitySummary('run-1');
    expect(summary).not.toBeNull();
    expect(summary!.runId).toBe('run-1');
    expect(summary!.collectionId).toBe('col-1');
  });

  it('synthesizes and caches replay session when not yet stored', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue(undefined);
    mockLoadTimeline.mockResolvedValue(undefined);
    mockReplaySessionExists.mockReturnValue(false);
    mockLoadReplaySession.mockReturnValue(null);
    mockSaveReplaySession.mockReturnValue(undefined);

    await getObservabilitySummary('run-1');
    expect(mockSaveReplaySession).toHaveBeenCalledOnce();
  });

  it('loads cached replay session when already stored', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue(undefined);
    mockLoadTimeline.mockResolvedValue(undefined);
    mockReplaySessionExists.mockReturnValue(true);
    mockLoadReplaySession.mockReturnValue({
      runId: 'run-1', collectionId: 'col-1', synthesizedAt: '2026-01-01T00:00:00Z',
      _schemaVersion: 1, events: [], eventCount: 0,
      stats: { requestsSent: 0, assertionsPassed: 0, assertionsFailed: 0, retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 },
    });

    const summary = await getObservabilitySummary('run-1');
    expect(mockSaveReplaySession).not.toHaveBeenCalled();
    expect(summary!.replay).not.toBeNull();
  });

  it('includes hasSnapshot and hasTimeline in summary', async () => {
    mockLoadRunResult.mockReturnValue(makeRun() as any);
    mockLoadSnapshot.mockReturnValue({ runId: 'run-1' } as any);
    mockLoadTimeline.mockResolvedValue({ runId: 'run-1', events: [] } as any);
    mockReplaySessionExists.mockReturnValue(false);
    mockLoadReplaySession.mockReturnValue(null);
    mockSaveReplaySession.mockReturnValue(undefined);

    const summary = await getObservabilitySummary('run-1');
    expect(summary!.hasSnapshot).toBe(true);
    expect(summary!.hasTimeline).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-observability/__tests__/observability-query.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create `src/api-observability/observability-query.ts`**

```typescript
import { loadRunResult, loadSnapshot } from '../storage-provider/execution-store';
import { loadTimeline } from '../api-runtime/artifact-engine/timeline-builder';
import { loadReplaySession, replaySessionExists, saveReplaySession } from './replay-event-store';
import { synthesizeReplaySession } from './replay-event-synthesizer';
import type { ReplaySession } from './contracts/replay-event.contracts';
import type { ExecutionTimeline } from '../shared-core/contracts/artifact.contract';
import type { ExecutionSnapshot } from '../shared-core/contracts/dependency-graph.contract';

export interface ObservabilitySummary {
  readonly runId: string;
  readonly collectionId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly stepCount: number;
  readonly hasSnapshot: boolean;
  readonly hasTimeline: boolean;
  /** Replay session — synthesized on first request, then cached to disk */
  readonly replay: ReplaySession | null;
  /** Timeline — loaded from disk if available */
  readonly timeline: ExecutionTimeline | null;
  /** Snapshot summary — not full snapshot (too large) */
  readonly snapshotSummary: {
    readonly capturedAt: string;
    readonly completedNodeIds: number;
    readonly failedNodeIds: number;
    readonly skippedNodeIds: number;
  } | null;
}

export async function getObservabilitySummary(runId: string): Promise<ObservabilitySummary | null> {
  const run = loadRunResult(runId);
  if (!run) return null;

  const snapshot: ExecutionSnapshot | undefined = loadSnapshot(runId);
  const timeline: ExecutionTimeline | undefined = await loadTimeline(runId);

  let replay: ReplaySession | null;
  if (replaySessionExists(runId)) {
    replay = loadReplaySession(runId);
  } else {
    replay = synthesizeReplaySession(run, snapshot);
    saveReplaySession(replay);
  }

  return {
    runId: run.id,
    collectionId: run.collectionId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    stepCount: run.stepResults.length,
    hasSnapshot: snapshot !== undefined,
    hasTimeline: timeline !== undefined,
    replay,
    timeline: timeline ?? null,
    snapshotSummary: snapshot ? {
      capturedAt: snapshot.capturedAt,
      completedNodeIds: snapshot.completedNodeIds.length,
      failedNodeIds: snapshot.failedNodeIds.length,
      skippedNodeIds: snapshot.skippedNodeIds.length,
    } : null,
  };
}
```

- [ ] **Step 4: Create `src/api-observability/index.ts`**

```typescript
export { synthesizeReplaySession } from './replay-event-synthesizer';
export { saveReplaySession, loadReplaySession, replaySessionExists } from './replay-event-store';
export { getObservabilitySummary } from './observability-query';
export { NoOpRcaProvider } from './contracts/rca-extension.contracts';
export type {
  ReplayEvent, ReplayEventKind, ReplaySession,
} from './contracts/replay-event.contracts';
export type {
  RunDiffRequest, StepDiff, RunDiffSummary, StepDiffKind,
} from './contracts/execution-diff.contracts';
export type {
  RcaHint, RcaHintKind, RcaExtensionPoint,
} from './contracts/rca-extension.contracts';
export type { ObservabilitySummary } from './observability-query';
```

- [ ] **Step 5: Run all observability tests so far**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-observability/__tests__/ 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 6: TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -15
```

- [ ] **Step 7: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-observability/observability-query.ts src/api-observability/index.ts && git commit -m "feat(observability): observability query + barrel export (Task 4)"
```

---

## Task 5: Observability Routes + Server Registration

**Files:**
- Create: `src/api-observability/routes/observability.routes.ts`
- Modify: `src/ui/server.ts`

- [ ] **Step 1: Read `src/ui/server.ts`** to find where `registerApiSuiteRoutes` is imported (around line 60) and registered (around line 230). Also read `src/api-defects/routes/api-defects.routes.ts` to confirm the `requireAuth` import path.

- [ ] **Step 2: Create `src/api-observability/routes/observability.routes.ts`**

```typescript
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { getObservabilitySummary } from '../observability-query';
import { loadReplaySession, replaySessionExists, saveReplaySession } from '../replay-event-store';
import { synthesizeReplaySession } from '../replay-event-synthesizer';
import { loadRunResult, loadSnapshot } from '../../storage-provider/execution-store';
import { loadTimeline } from '../../api-runtime/artifact-engine/timeline-builder';

export function registerObservabilityRoutes(app: Express): void {

  /**
   * GET /api/api-runs/:runId/observability
   * Returns full ObservabilitySummary: run metadata + replay stats + timeline + snapshot summary.
   */
  app.get('/api/api-runs/:runId/observability', requireAuth, async (req: Request, res: Response) => {
    const summary = await getObservabilitySummary(req.params.runId);
    if (!summary) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
    return res.json(summary);
  });

  /**
   * GET /api/api-runs/:runId/replay-events
   * Returns the ReplaySession for a run.
   * Synthesizes and caches on first request — subsequent requests are read-only disk loads.
   */
  app.get('/api/api-runs/:runId/replay-events', requireAuth, async (req: Request, res: Response) => {
    const runId = req.params.runId;

    if (replaySessionExists(runId)) {
      const cached = loadReplaySession(runId);
      if (cached) return res.json(cached);
    }

    const run = loadRunResult(runId);
    if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });

    const snapshot = loadSnapshot(runId);
    const session = synthesizeReplaySession(run, snapshot);
    saveReplaySession(session);
    return res.json(session);
  });

  /**
   * GET /api/api-runs/:runId/timeline
   * Returns the ExecutionTimeline for a run.
   * Timeline is built by the execution engine and saved to data/api-timelines/.
   */
  app.get('/api/api-runs/:runId/timeline', requireAuth, async (req: Request, res: Response) => {
    const timeline = await loadTimeline(req.params.runId);
    if (!timeline) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Timeline not found for this run' } });
    return res.json(timeline);
  });
}
```

- [ ] **Step 3: Register in `src/ui/server.ts`**

Add import after the existing api-suite import:
```typescript
import { registerObservabilityRoutes } from '../api-observability/routes/observability.routes';
```

Add registration call after `registerApiSuiteRoutes(app);`:
```typescript
registerObservabilityRoutes(app);
```

- [ ] **Step 4: TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -15
```

Fix any errors — common issue: `loadRunResult` returns `ApiCollectionRunResult | undefined` which is correct.

- [ ] **Step 5: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/api-observability/routes/observability.routes.ts src/ui/server.ts && git commit -m "feat(observability): 3 GET routes — /observability, /replay-events, /timeline (Task 5)"
```

---

## Task 6: CSS + 28-api-replay.js UI Module

**Files:**
- Modify: `src/ui/public/styles_addon.css`
- Create: `src/ui/public/js/28-api-replay.js`
- Modify: `scripts/concat-modules.js`
- Modify: `src/ui/public/index.html`

- [ ] **Step 1: Read `src/ui/public/index.html`** — find the `api-suites` nav item and panel added in Step 10 to understand the exact pattern used.

- [ ] **Step 2: Read the end of `src/ui/public/styles_addon.css`** to know the append point.

- [ ] **Step 3: Append CSS to `src/ui/public/styles_addon.css`**

```css
/* ── Phase D Step 11: Observability & Replay ──────────────────────────────── */
.replay-event-row {
  display: flex;
  align-items: flex-start;
  padding: 4px 8px;
  border-bottom: 1px solid #1f2937;
  font-size: 11px;
  gap: 8px;
}
.replay-event-row:hover { background: #111827; }
.replay-event-kind {
  min-width: 140px;
  font-weight: 600;
  color: #6b7280;
}
.replay-event-kind.kind-request-sent { color: #60a5fa; }
.replay-event-kind.kind-response-received { color: #34d399; }
.replay-event-kind.kind-assertion-evaluated { color: #a78bfa; }
.replay-event-kind.kind-failure-propagated { color: #f87171; }
.replay-event-kind.kind-retry-triggered { color: #fbbf24; }
.replay-event-kind.kind-teardown-executed { color: #9ca3af; }
.replay-event-kind.kind-variable-extracted { color: #818cf8; }
.replay-event-kind.kind-step-skipped { color: #6b7280; }
.replay-event-kind.kind-step-completed { color: #4ade80; }
.obs-stat-card {
  display: inline-block;
  background: #111827;
  border: 1px solid #374151;
  border-radius: 4px;
  padding: 6px 12px;
  margin: 4px;
  font-size: 12px;
}
.obs-stat-card .obs-stat-value { font-size: 20px; font-weight: 700; display: block; }
.obs-stat-card .obs-stat-label { color: #6b7280; }
.timeline-event-row {
  padding: 3px 8px;
  font-size: 11px;
  border-bottom: 1px solid #1f2937;
  display: flex;
  gap: 8px;
}
.timeline-event-type { min-width: 120px; color: #6b7280; font-weight: 600; }
.timeline-event-type.evt-node-failed { color: #f87171; }
.timeline-event-type.evt-node-completed { color: #4ade80; }
.timeline-event-type.evt-node-retrying { color: #fbbf24; }
```

- [ ] **Step 4: Add nav tab in `index.html`**

After the `api-suites` nav item, add (matching the exact pattern found in Step 1):
```html
<div class="nav-item" data-tab="api-replay">🔍 Replay</div>
```

- [ ] **Step 5: Add page panel in `index.html`**

After the `panel-api-suites` panel, add:
```html
<div class="panel" id="panel-api-replay">
  <div id="api-replay-alert"></div>
  <div id="api-replay-content"></div>
</div>
```

- [ ] **Step 6: Create `src/ui/public/js/28-api-replay.js`**

```javascript
// Module: Observability & Replay Engine UI
// Page: api-replay

var _apiReplayCurrentRunId = null;

function apiReplayInit() {
  apiReplayRenderLanding();
}

function apiReplayRenderLanding() {
  var el = document.getElementById('api-replay-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px;">'
    + '<div style="font-size:16px;font-weight:600;margin-bottom:12px;color:#e5e7eb;">🔍 Execution Replay &amp; Observability</div>'
    + '<p>Enter a Run ID to inspect its replay events, timeline, and observability summary.</p>'
    + '<div style="display:flex;gap:8px;margin-top:12px;">'
    + '<input id="api-replay-run-input" class="form-control" style="max-width:320px;" placeholder="Run ID (e.g. abc123)" />'
    + '<button class="btn btn-sm" onclick="apiReplayLoad()">Load</button>'
    + '</div>'
    + '<div style="margin-top:16px;font-size:11px;color:#4b5563;">Tip: copy the Run ID from the API Runs tab.</div>'
    + '</div>';
}

async function apiReplayLoad(runId) {
  runId = runId || (document.getElementById('api-replay-run-input') || {}).value || '';
  runId = runId.trim();
  if (!runId) { modAlert('api-replay-alert', 'error', 'Enter a Run ID.'); return; }
  _apiReplayCurrentRunId = runId;

  var el = document.getElementById('api-replay-content');
  if (el) el.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Loading observability data...</div>';

  try {
    var res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/observability');
    if (!res.ok) {
      var err = await res.json();
      modAlert('api-replay-alert', 'error', (err.error && err.error.message) || 'Run not found.');
      apiReplayRenderLanding();
      return;
    }
    var summary = await res.json();
    apiReplayRenderSummary(summary);
  } catch (e) {
    modAlert('api-replay-alert', 'error', 'Error: ' + e.message);
  }
}

function apiReplayRenderSummary(summary) {
  var el = document.getElementById('api-replay-content');
  if (!el) return;

  var statusColor = summary.status === 'passed' ? '#4ade80' : '#f87171';
  var replay = summary.replay || {};
  var stats = replay.stats || {};

  el.innerHTML = '<div style="margin-bottom:12px;">'
    + '<button class="btn btn-sm" onclick="apiReplayRenderLanding()">&#8592; Back</button>'
    + '</div>'
    + '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">'
    + 'Run: <span style="font-family:monospace;font-size:13px;">' + escHtml(summary.runId) + '</span>'
    + ' <span style="color:' + statusColor + ';margin-left:8px;">' + escHtml(summary.status.toUpperCase()) + '</span>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:16px;">'
    + escHtml(summary.startedAt.replace('T',' ').slice(0,19))
    + ' &middot; ' + summary.stepCount + ' steps'
    + (summary.hasSnapshot ? ' &middot; <span style="color:#a78bfa;">snapshot</span>' : '')
    + (summary.hasTimeline ? ' &middot; <span style="color:#60a5fa;">timeline</span>' : '')
    + '</div>'

    // Stats cards
    + '<div style="margin-bottom:16px;">'
    + _obsStatCard(stats.requestsSent || 0, 'Requests')
    + _obsStatCard(stats.assertionsPassed || 0, 'Assertions Passed')
    + _obsStatCard(stats.assertionsFailed || 0, 'Assertions Failed')
    + _obsStatCard(stats.retriesTriggered || 0, 'Retries')
    + _obsStatCard(stats.teardownEvents || 0, 'Teardowns')
    + _obsStatCard(stats.failuresPropagated || 0, 'Failures')
    + '</div>'

    // Tab bar
    + '<div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid #374151;padding-bottom:8px;">'
    + '<button class="tbl-btn" onclick="apiReplayShowTab(\'events\')">Replay Events (' + (replay.eventCount || 0) + ')</button>'
    + '<button class="tbl-btn" onclick="apiReplayShowTab(\'timeline\')">Timeline</button>'
    + (summary.snapshotSummary ? '<button class="tbl-btn" onclick="apiReplayShowTab(\'snapshot\')">Snapshot</button>' : '')
    + '</div>'
    + '<div id="api-replay-tab-content"></div>';

  apiReplayShowTab('events');
}

function _obsStatCard(value, label) {
  return '<div class="obs-stat-card"><span class="obs-stat-value">' + value + '</span><span class="obs-stat-label">' + escHtml(label) + '</span></div>';
}

async function apiReplayShowTab(tab) {
  var el = document.getElementById('api-replay-tab-content');
  if (!el) return;

  if (tab === 'events') {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Loading replay events...</div>';
    try {
      var res = await fetch('/api/api-runs/' + encodeURIComponent(_apiReplayCurrentRunId) + '/replay-events');
      if (!res.ok) { el.innerHTML = '<div style="color:#f87171;">Failed to load replay events.</div>'; return; }
      var session = await res.json();
      el.innerHTML = apiReplayEventsHtml(session.events || []);
    } catch (e) {
      el.innerHTML = '<div style="color:#f87171;">Error: ' + escHtml(e.message) + '</div>';
    }

  } else if (tab === 'timeline') {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Loading timeline...</div>';
    try {
      var res2 = await fetch('/api/api-runs/' + encodeURIComponent(_apiReplayCurrentRunId) + '/timeline');
      if (!res2.ok) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No timeline recorded for this run.</div>'; return; }
      var timeline = await res2.json();
      el.innerHTML = apiReplayTimelineHtml(timeline.events || []);
    } catch (e2) {
      el.innerHTML = '<div style="color:#f87171;">Error: ' + escHtml(e2.message) + '</div>';
    }

  } else if (tab === 'snapshot') {
    // Snapshot summary was already loaded in observability call
    var res3 = await fetch('/api/api-runs/' + encodeURIComponent(_apiReplayCurrentRunId) + '/observability');
    var obs = res3.ok ? await res3.json() : null;
    var snap = obs && obs.snapshotSummary;
    if (!snap) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No snapshot available.</div>'; return; }
    el.innerHTML = '<div style="font-size:12px;padding:8px;">'
      + '<div><b>Captured:</b> ' + escHtml(snap.capturedAt.replace('T',' ').slice(0,19)) + '</div>'
      + '<div><b>Completed nodes:</b> ' + snap.completedNodeIds + '</div>'
      + '<div><b>Failed nodes:</b> ' + snap.failedNodeIds + '</div>'
      + '<div><b>Skipped nodes:</b> ' + snap.skippedNodeIds + '</div>'
      + '</div>';
  }
}

function apiReplayEventsHtml(events) {
  if (!events.length) return '<div style="color:var(--text-muted);font-size:12px;padding:8px;">No replay events.</div>';
  return '<div style="max-height:480px;overflow-y:auto;">'
    + events.map(function(e) {
      var kindClass = 'kind-' + e.kind;
      var detail = '';
      if (e.request) detail = e.request.method + ' ' + escHtml(e.request.url);
      else if (e.response) detail = 'HTTP ' + e.response.status + ' (' + e.response.durationMs + 'ms)';
      else if (e.assertion) detail = (e.assertion.passed ? '✓ ' : '✗ ') + escHtml(e.assertion.type) + (e.assertion.message ? ': ' + escHtml(e.assertion.message) : '');
      else if (e.variable) detail = e.variable.key + ' = ' + escHtml(e.variable.maskedValue);
      else if (e.failure) detail = escHtml(e.failure.reason);
      else if (e.skipReason) detail = escHtml(e.skipReason);
      return '<div class="replay-event-row">'
        + '<span style="color:#4b5563;min-width:32px;">' + e.seq + '</span>'
        + '<span class="replay-event-kind ' + kindClass + '">' + escHtml(e.kind.replace(/-/g,' ')) + '</span>'
        + '<span style="color:#9ca3af;min-width:120px;">' + escHtml(e.stepName) + '</span>'
        + '<span>' + detail + '</span>'
        + (e.durationMs != null ? '<span style="color:#4b5563;margin-left:auto;">' + e.durationMs + 'ms</span>' : '')
        + '</div>';
    }).join('')
    + '</div>';
}

function apiReplayTimelineHtml(events) {
  if (!events.length) return '<div style="color:var(--text-muted);font-size:12px;padding:8px;">No timeline events.</div>';
  return '<div style="max-height:480px;overflow-y:auto;">'
    + events.map(function(e) {
      var typeClass = 'evt-' + e.eventType;
      return '<div class="timeline-event-row">'
        + '<span class="timeline-event-type ' + typeClass + '">' + escHtml(e.eventType) + '</span>'
        + '<span style="color:#9ca3af;">' + escHtml(e.nodeName) + '</span>'
        + (e.durationMs != null ? '<span style="color:#4b5563;margin-left:auto;">' + e.durationMs + 'ms</span>' : '')
        + (e.detail ? '<span style="color:#6b7280;">' + escHtml(e.detail) + '</span>' : '')
        + '</div>';
    }).join('')
    + '</div>';
}

// Page load hook
if (typeof registerPageModule === 'function') {
  registerPageModule('api-replay', apiReplayInit);
}
```

- [ ] **Step 7: Register in `scripts/concat-modules.js`**

Find `'27-api-suites.js',` and add after it:
```javascript
'28-api-replay.js',
```

- [ ] **Step 8: Frontend build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js 2>&1 | tail -10
```

- [ ] **Step 9: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add src/ui/public/styles_addon.css src/ui/public/js/28-api-replay.js scripts/concat-modules.js src/ui/public/index.html && git commit -m "feat(observability): CSS + 28-api-replay.js replay/timeline UI (Task 6)"
```

---

## Task 7: Full Build + Regression

- [ ] **Step 1: Run all observability tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-observability/__tests__/ 2>&1 | tail -20
```

- [ ] **Step 2: Full TypeScript build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build 2>&1 | tail -15
```

- [ ] **Step 3: Regression — api-suite tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-suite/__tests__/ 2>&1 | tail -10
```

- [ ] **Step 4: Regression — api-defects tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-defects/__tests__/ 2>&1 | tail -10
```

- [ ] **Step 5: Regression — flakiness tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-flakiness/__tests__/ 2>&1 | tail -10
```

- [ ] **Step 6: Regression — teardown tag tests**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npx vitest run src/api-runtime/workflow-engine/__tests__/teardown-tag.test.ts 2>&1 | tail -10
```

---

## Task 8: CLAUDE.md Update

**Files:**
- Modify: `e:\AI Agent\qa-agent-platform-dev\CLAUDE.md`

- [ ] **Step 1: Read CLAUDE.md** — find the Step 10 plan reference line and the Shipped Features section.

- [ ] **Step 2: Add Step 11 plan reference**

After the Step 10 line:
```
> **📋 See [docs/superpowers/plans/2026-05-19-phase-d-step11-observability-replay.md](docs/superpowers/plans/2026-05-19-phase-d-step11-observability-replay.md) — Phase D Step 11 implementation plan (8 tasks). **COMPLETE as of 2026-05-19.**
```

- [ ] **Step 3: Add shipped feature entry**

After the `### API Suite Orchestration (shipped 2026-05-19)` section:

```markdown
### Observability, Replay Engine & Execution Intelligence (shipped 2026-05-19)
- Module: `src/api-observability/` — contracts, synthesizer, store, query, routes
- `synthesizeReplaySession()` — post-hoc, runtime-isolated: converts `ApiCollectionRunResult + ExecutionSnapshot` → `ReplaySession` (immutable, deterministic)
- Replay event store: `data/replay-sessions/<runId>.replay.json` (atomic write, lazy-cached on first GET)
- `getObservabilitySummary()` — aggregates run + timeline + snapshot + replay in one query
- Routes: `GET /api/api-runs/:runId/observability`, `/replay-events`, `/timeline`
- Contracts: `ReplayEvent`, `ReplaySession`, `RunDiffSummary`, `RcaExtensionPoint` (AI RCA hook — no-op today)
- UI: `28-api-replay.js` — observability summary, replay event list, timeline list, snapshot summary
- RUNTIME ISOLATION: synthesizer NEVER modifies execution state, retries, or scheduler
- Backward compatible: all existing routes and run data untouched
```

- [ ] **Step 4: Commit**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && git add CLAUDE.md docs/superpowers/plans/2026-05-19-phase-d-step11-observability-replay.md && git commit -m "docs: update CLAUDE.md with Phase D Step 11 completion"
```

---

## Self-Review: Spec Coverage

| Spec Requirement | Covered By | Notes |
|---|---|---|
| A. Replay Event Model | Task 1 (`replay-event.contracts.ts`) | `ReplayEvent` with 11 kinds, immutable, masked secrets |
| B. Execution Replay Layer | Tasks 2, 3, 5 | Post-hoc synthesizer + store + `/replay-events` route — no runtime changes |
| C. Timeline Reconstruction | Task 5 (`/timeline` route) + Task 6 (UI) | `loadTimeline` from existing `timeline-builder.ts`; UI displays event list |
| D. Request/Response Traceability | Task 2 (`request-sent`, `response-received` events) | Header keys only, body size only — no secrets stored |
| E. Replay Graph Overlay | Task 6 (UI tabs) | Event list view per run; graph overlay extension deferred to graph routes (no DAG changes) |
| F. Execution Diff Foundations | Task 1 (`execution-diff.contracts.ts`) | `RunDiffRequest`, `StepDiff`, `RunDiffSummary` contracts — engine deferred |
| G. Observability Storage Strategy | Tasks 3, 4, 5 | `replay-event-store.ts` + `observability-query.ts` + 3 GET routes |
| H. Runtime Isolation Rules | Design invariant | Synthesizer reads existing data only; zero runtime calls; spec comment in synthesizer |
| I. Backward Compatibility | No files deleted/modified | New module only; existing routes/stores untouched |
| J. Future AI RCA Preparation | Task 1 (`rca-extension.contracts.ts`) | `RcaExtensionPoint` interface + `NoOpRcaProvider` stub |
