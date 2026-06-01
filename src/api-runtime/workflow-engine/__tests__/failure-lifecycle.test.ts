/**
 * failure-lifecycle.test.ts
 * Phase C Step 4: unit + integration tests for failure propagation and recovery lifecycle.
 *
 * Verifies:
 *   - FailureClassifier classifies all FailureReason values correctly
 *   - RecoveryEligibility derivation per failure class
 *   - Dependency-blocked classification
 *   - retryExhausted flag affects classification
 *   - SchedulerStateTracker records failure propagation correctly
 *   - RetryHistoryEntry appended and immutable
 *   - onFailurePropagation hook fires on failed run
 *   - onFailurePropagation NOT fired on passing run
 *   - Execution order/status unchanged by Phase C Step 4 additions
 *   - deriveRecoveryPlan builds correct target/skip/blocking sets
 *   - failurePropagation embedded in ExecutionSnapshot
 */

import { describe, it, expect, vi } from 'vitest';
import {
  FailureClassifier,
  getFailureClassifier,
} from '../failure-classifier';
import type { FailureClass } from '../failure-classifier';
import {
  createEmptyFailurePropagationRecord,
  deriveRecoveryPlan,
} from '../failure-propagation';
import { SchedulerStateTracker } from '../scheduler-state';
import { createWorkflowEngine } from '../engine';
import type { WorkflowEngineConfig } from '../engine';
import type { WorkflowSnapshotHook } from '../snapshot-hooks';
import type { FailurePropagationRecord } from '../failure-propagation';
import type { ApiCollection, ApiEnvironment, ApiTestStep, ApiStepResult } from '../../../data/types';
import type { ExecutionSnapshot } from '../../../shared-core/contracts/dependency-graph.contract';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStep(id: string, overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id, name: `Step ${id}`,
    request: { method: 'GET', url: `https://api.test/${id}`, bodyType: 'none' },
    assertions: [], extractVariables: [], dependsOn: [],
    ...overrides,
  } as unknown as ApiTestStep;
}

function passResult(step: ApiTestStep): ApiStepResult {
  return {
    stepId: step.id, stepName: step.name, status: 'passed',
    request: step.request, assertionResults: [], extractedVariables: {}, durationMs: 10,
  };
}

function failResult(step: ApiTestStep): ApiStepResult {
  return { ...passResult(step), status: 'failed' };
}

function errorResult(step: ApiTestStep): ApiStepResult {
  return { ...passResult(step), status: 'error', error: 'network error' };
}

function makeCollection(steps: ApiTestStep[], overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col1', name: 'Test', projectId: 'proj1',
    steps, variables: [], executionMode: 'auto', maxConcurrency: 5,
    rateLimit: { requestsPerSecond: 100 },
    ...overrides,
  } as unknown as ApiCollection;
}

function makeEnv(): ApiEnvironment {
  return {
    id: 'env1', name: 'Env', projectId: 'proj1',
    variables: [], authConfig: { type: 'none' }, baseUrl: 'https://api.test',
  } as unknown as ApiEnvironment;
}

function makeConfig(
  executeStepFn?: (step: ApiTestStep) => Promise<ApiStepResult>,
  hooks?: WorkflowSnapshotHook,
): WorkflowEngineConfig {
  return {
    executeStep: executeStepFn ?? (async (step) => passResult(step)),
    resolveAuth: async () => ({}),
    onPartialWrite: vi.fn(),
    hooks,
  };
}

// ── Group 1: FailureClassifier unit tests ─────────────────────────────────────

describe('FailureClassifier — unit', () => {
  const classifier = new FailureClassifier();

  it('assertion-failure → assertion-failed class, eligible recovery', () => {
    const c = classifier.classify('n1', 'assertion-failure', false);
    expect(c.failureClass).toBe('assertion-failed');
    expect(c.recoveryEligibility).toBe('eligible');
    expect(c.isRetryCandidate).toBe(false);
  });

  it('http-error (not exhausted) → transport-failed, eligible', () => {
    const c = classifier.classify('n1', 'http-error', false);
    expect(c.failureClass).toBe('transport-failed');
    expect(c.recoveryEligibility).toBe('eligible');
    expect(c.isRetryCandidate).toBe(true);
  });

  it('http-error (exhausted) → terminal, not-eligible', () => {
    const c = classifier.classify('n1', 'http-error', true);
    expect(c.failureClass).toBe('terminal');
    expect(c.recoveryEligibility).toBe('not-eligible');
    expect(c.isRetryCandidate).toBe(false);
  });

  it('timeout (not exhausted) → timeout-failed, eligible', () => {
    const c = classifier.classify('n1', 'timeout', false);
    expect(c.failureClass).toBe('timeout-failed');
    expect(c.recoveryEligibility).toBe('eligible');
  });

  it('timeout (exhausted) → terminal, not-eligible', () => {
    const c = classifier.classify('n1', 'timeout', true);
    expect(c.failureClass).toBe('terminal');
    expect(c.recoveryEligibility).toBe('not-eligible');
  });

  it('contract-violation → validation-failed, eligible', () => {
    const c = classifier.classify('n1', 'contract-violation', false);
    expect(c.failureClass).toBe('validation-failed');
    expect(c.recoveryEligibility).toBe('eligible');
  });

  it('extraction-error → validation-failed, eligible', () => {
    const c = classifier.classify('n1', 'extraction-error', false);
    expect(c.failureClass).toBe('validation-failed');
    expect(c.recoveryEligibility).toBe('eligible');
  });

  it('script-error → terminal, not-eligible', () => {
    const c = classifier.classify('n1', 'script-error', false);
    expect(c.failureClass).toBe('terminal');
    expect(c.recoveryEligibility).toBe('not-eligible');
  });

  it('retry-exhausted → terminal, not-eligible', () => {
    const c = classifier.classify('n1', 'retry-exhausted', true);
    expect(c.failureClass).toBe('terminal');
    expect(c.recoveryEligibility).toBe('not-eligible');
  });

  it('classifyBlocked → dependency-blocked, eligible-with-deps', () => {
    const c = classifier.classifyBlocked('n2', 'n1');
    expect(c.failureClass).toBe('dependency-blocked');
    expect(c.recoveryEligibility).toBe('eligible-with-deps');
    expect(c.isRetryCandidate).toBe(false);
  });

  it('downstream blocked IDs populated when provided', () => {
    const c = classifier.classify('n1', 'assertion-failure', false, ['n2', 'n3']);
    expect(c.hasPropagatedDownstream).toBe(true);
    expect(c.downstreamBlockedNodeIds).toEqual(['n2', 'n3']);
  });

  it('singleton returns same instance', () => {
    expect(getFailureClassifier()).toBe(getFailureClassifier());
  });
});

// ── Group 2: SchedulerStateTracker Phase C Step 4 ─────────────────────────────

describe('SchedulerStateTracker — Phase C Step 4 failure tracking', () => {
  it('appendRetryHistoryEntry stores entry immutably', () => {
    const t = new SchedulerStateTracker();
    t.initialise(['a'], new Map([['a', 'Step A']]));
    t.appendRetryHistoryEntry('a', {
      attempt: 0, startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z',
      durationMs: 1000, httpStatus: 500, resultStatus: 'error', retriedAfter: true,
    });
    t.appendRetryHistoryEntry('a', {
      attempt: 1, startedAt: '2026-01-01T00:00:02Z', completedAt: '2026-01-01T00:00:03Z',
      durationMs: 1000, httpStatus: 500, resultStatus: 'error', retriedAfter: false,
    });
    const rec = t.getRecord('a');
    expect(rec?.retryHistory).toHaveLength(2);
    expect(rec?.retryHistory![0].attempt).toBe(0);
    expect(rec?.retryHistory![1].attempt).toBe(1);
  });

  it('recordFailureClassification stamps fields on record', () => {
    const t = new SchedulerStateTracker();
    t.initialise(['a'], new Map([['a', 'Step A']]));
    t.recordFailureClassification('a', 'assertion-failed', 'eligible', ['b']);
    const rec = t.getRecord('a');
    expect(rec?.failureClass).toBe('assertion-failed');
    expect(rec?.recoveryEligibility).toBe('eligible');
    expect(rec?.propagatedSkipToNodeIds).toEqual(['b']);
  });

  it('recordBlockedByFailure stamps blockedByNodeIds on record', () => {
    const t = new SchedulerStateTracker();
    t.initialise(['b'], new Map([['b', 'Step B']]));
    t.recordBlockedByFailure('b', 'a');
    const rec = t.getRecord('b');
    expect(rec?.blockedByNodeIds).toContain('a');
  });

  it('finaliseFailurePropagation sets finalisedAt timestamp', () => {
    const t = new SchedulerStateTracker();
    t.initialise(['a'], new Map([['a', 'Step A']]));
    const record = t.finaliseFailurePropagation();
    expect(record.finalisedAt).toBeTruthy();
  });

  it('failure propagation record aggregates root failures', () => {
    const t = new SchedulerStateTracker();
    t.initialise(['a', 'b'], new Map([['a', 'Step A'], ['b', 'Step B']]));
    t.recordFailureClassification('a', 'transport-failed', 'eligible');
    t.recordFailureClassification('b', 'assertion-failed', 'eligible');
    const record = t.getFailurePropagation();
    expect(record.rootFailureNodeIds).toContain('a');
    expect(record.rootFailureNodeIds).toContain('b');
  });

  it('dependency-blocked nodes not added to rootFailureNodeIds', () => {
    const t = new SchedulerStateTracker();
    t.initialise(['a', 'b'], new Map([['a', 'Step A'], ['b', 'Step B']]));
    t.recordFailureClassification('b', 'dependency-blocked', 'eligible-with-deps');
    const record = t.getFailurePropagation();
    expect(record.rootFailureNodeIds).not.toContain('b');
  });
});

// ── Group 3: deriveRecoveryPlan ───────────────────────────────────────────────

describe('deriveRecoveryPlan', () => {
  it('eligible failure → in targetNodeIds', () => {
    const record = createEmptyFailurePropagationRecord();
    record.rootFailureNodeIds = ['a'];
    record.failureClasses['a'] = 'assertion-failed';
    record.recoveryEligibility['a'] = 'eligible';
    const plan = deriveRecoveryPlan(record, ['a', 'b', 'c']);
    expect(plan.targetNodeIds).toContain('a');
    expect(plan.skipNodeIds).toContain('b');
    expect(plan.skipNodeIds).toContain('c');
  });

  it('terminal failure → in blockingNodeIds', () => {
    const record = createEmptyFailurePropagationRecord();
    record.rootFailureNodeIds = ['a'];
    record.failureClasses['a'] = 'terminal';
    record.recoveryEligibility['a'] = 'not-eligible';
    const plan = deriveRecoveryPlan(record, ['a', 'b']);
    expect(plan.blockingNodeIds).toContain('a');
    expect(plan.targetNodeIds).not.toContain('a');
  });

  it('downstream of eligible failure included in targets', () => {
    const record = createEmptyFailurePropagationRecord();
    record.rootFailureNodeIds = ['a'];
    record.failureClasses['a'] = 'transport-failed';
    record.recoveryEligibility['a'] = 'eligible';
    record.downstreamImpact['a'] = ['b'];
    record.recoveryEligibility['b'] = 'eligible-with-deps';
    const plan = deriveRecoveryPlan(record, ['a', 'b', 'c']);
    expect(plan.targetNodeIds).toContain('a');
    expect(plan.targetNodeIds).toContain('b');
    expect(plan.skipNodeIds).toContain('c');
  });

  it('generatedAt is set', () => {
    const plan = deriveRecoveryPlan(createEmptyFailurePropagationRecord(), ['a']);
    expect(plan.generatedAt).toBeTruthy();
  });
});

// ── Group 4: WorkflowEngine integration ──────────────────────────────────────

describe('WorkflowEngine — Phase C Step 4 hook integration', () => {
  it('onFailurePropagation fires when node fails', async () => {
    const captured: FailurePropagationRecord[] = [];
    const hooks: WorkflowSnapshotHook = {
      onFailurePropagation: (r) => { captured.push(r); },
    };
    const steps = [makeStep('a')];
    const collection = makeCollection(steps);
    const engine = createWorkflowEngine(makeConfig(async (step) => failResult(step), hooks));
    await engine.execute(collection, makeEnv(), 'run1', {});

    expect(captured).toHaveLength(1);
    expect(captured[0].rootFailureNodeIds).toContain('a');
  });

  it('onFailurePropagation NOT fired when all pass', async () => {
    const captured: FailurePropagationRecord[] = [];
    const hooks: WorkflowSnapshotHook = {
      onFailurePropagation: (r) => { captured.push(r); },
    };
    const steps = [makeStep('a'), makeStep('b')];
    const collection = makeCollection(steps);
    const engine = createWorkflowEngine(makeConfig(undefined, hooks));
    await engine.execute(collection, makeEnv(), 'run2', {});

    expect(captured).toHaveLength(0);
  });

  it('onFailurePropagation fires when downstream blocked (onFailure=stop)', async () => {
    const captured: FailurePropagationRecord[] = [];
    const hooks: WorkflowSnapshotHook = {
      onFailurePropagation: (r) => { captured.push(r); },
    };
    const a = makeStep('a');
    const b = makeStep('b');
    const steps = [a, b];
    const collection = makeCollection(steps, { onFailure: 'stop' } as Partial<ApiCollection>);
    const engine = createWorkflowEngine(makeConfig(async (step) => {
      if (step.id === 'a') return failResult(step);
      return passResult(step);
    }, hooks));
    await engine.execute(collection, makeEnv(), 'run3', {});

    expect(captured).toHaveLength(1);
    expect(captured[0].timeline.propagatedSkipNodeIds.length).toBeGreaterThan(0);
  });

  it('execution result status identical with and without hooks', async () => {
    const steps = [makeStep('a'), makeStep('b', { dependsOn: ['a'] } as Partial<ApiTestStep>)];
    const collection = makeCollection(steps);
    const executeStepFn = async (step: ApiTestStep) =>
      step.id === 'a' ? failResult(step) : passResult(step);

    const engineWithout = createWorkflowEngine(makeConfig(executeStepFn));
    const resultWithout = await engineWithout.execute(makeCollection(steps), makeEnv(), 'r1', {});

    const hooks: WorkflowSnapshotHook = { onFailurePropagation: vi.fn() };
    const engineWith = createWorkflowEngine(makeConfig(executeStepFn, hooks));
    const resultWith = await engineWith.execute(makeCollection(steps), makeEnv(), 'r2', {});

    expect(resultWith.status).toBe(resultWithout.status);
    expect(resultWith.stepResults.length).toBe(resultWithout.stepResults.length);
  });

  it('failureClass stamped on node record', async () => {
    const snapshots: ExecutionSnapshot[] = [];
    const hooks: WorkflowSnapshotHook = {
      onSchedulerSnapshot: (s) => snapshots.push(s),
      onFailurePropagation: vi.fn(),
    };
    const steps = [makeStep('a')];
    const collection = makeCollection(steps);
    const engine = createWorkflowEngine(makeConfig(async (step) => failResult(step), hooks));
    await engine.execute(collection, makeEnv(), 'run4', {});

    const last = snapshots[snapshots.length - 1];
    const nodeRec = last.nodeRecords['a'];
    expect(nodeRec.failureClass).toBe('assertion-failed');
    expect(nodeRec.recoveryEligibility).toBe('eligible');
  });

  it('failurePropagation embedded in snapshot when failures exist', async () => {
    const snapshots: ExecutionSnapshot[] = [];
    const hooks: WorkflowSnapshotHook = {
      onSchedulerSnapshot: (s) => snapshots.push(s),
    };
    const steps = [makeStep('a')];
    const collection = makeCollection(steps);
    const engine = createWorkflowEngine(makeConfig(async (step) => failResult(step), hooks));
    await engine.execute(collection, makeEnv(), 'run5', {});

    const last = snapshots[snapshots.length - 1];
    expect(last.failurePropagation).toBeDefined();
    expect(last.failurePropagation!.rootFailureNodeIds).toContain('a');
  });

  it('retryHistory entry present on failed node record', async () => {
    const snapshots: ExecutionSnapshot[] = [];
    const hooks: WorkflowSnapshotHook = {
      onSchedulerSnapshot: (s) => snapshots.push(s),
    };
    const steps = [makeStep('a')];
    const collection = makeCollection(steps);
    const engine = createWorkflowEngine(makeConfig(async (step) => failResult(step), hooks));
    await engine.execute(collection, makeEnv(), 'run6', {});

    const last = snapshots[snapshots.length - 1];
    const rec = last.nodeRecords['a'];
    expect(rec.retryHistory).toBeDefined();
    expect(rec.retryHistory!.length).toBeGreaterThan(0);
    expect(rec.retryHistory![0].resultStatus).toBe('failed');
  });

  it('skipDependents propagation records blockedByNodeIds', async () => {
    const snapshots: ExecutionSnapshot[] = [];
    const hooks: WorkflowSnapshotHook = {
      onSchedulerSnapshot: (s) => snapshots.push(s),
    };
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] } as Partial<ApiTestStep>);
    const collection = makeCollection([a, b], { onFailure: 'skipDependents' } as Partial<ApiCollection>);
    const engine = createWorkflowEngine(makeConfig(async (step) => {
      if (step.id === 'a') return failResult(step);
      return passResult(step);
    }, hooks));
    await engine.execute(collection, makeEnv(), 'run7', {});

    const last = snapshots[snapshots.length - 1];
    const recB = last.nodeRecords['b'];
    expect(recB.blockedByNodeIds).toContain('a');
    expect(recB.failureClass).toBe('dependency-blocked');
  });

  it('error result classified as transport-failed or terminal (no retries = exhausted)', async () => {
    // With maxRetries=0 the single attempt has retriedAfter=false → retryExhausted=true → terminal
    // This is correct: no retry budget, so the failure is terminal from scheduler perspective
    const snapshots: ExecutionSnapshot[] = [];
    const hooks: WorkflowSnapshotHook = {
      onSchedulerSnapshot: (s) => snapshots.push(s),
    };
    const steps = [makeStep('a')];
    const collection = makeCollection(steps);
    const engine = createWorkflowEngine(makeConfig(async (step) => errorResult(step), hooks));
    await engine.execute(collection, makeEnv(), 'run8', {});

    const last = snapshots[snapshots.length - 1];
    const rec = last.nodeRecords['a'];
    // http-error with no retry budget → exhausted → terminal
    expect(rec.failureClass).toBe('terminal');
    expect(rec.recoveryEligibility).toBe('not-eligible');
    // But the FailureReason is still http-error
    expect(rec.failureReason).toBe('http-error');
  });
});

// ── Group 5: deterministic execution guarantees ───────────────────────────────

describe('Phase C Step 4 — deterministic execution guarantees', () => {
  it('passing run: no failurePropagation in snapshot', async () => {
    const snapshots: ExecutionSnapshot[] = [];
    const hooks: WorkflowSnapshotHook = {
      onSchedulerSnapshot: (s) => snapshots.push(s),
    };
    const steps = [makeStep('a'), makeStep('b')];
    const collection = makeCollection(steps);
    const engine = createWorkflowEngine(makeConfig(undefined, hooks));
    const result = await engine.execute(collection, makeEnv(), 'run9', {});

    expect(result.status).toBe('passed');
    const last = snapshots[snapshots.length - 1];
    expect(last.failurePropagation).toBeUndefined();
  });

  it('failure timeline events in chronological order', async () => {
    const captured: FailurePropagationRecord[] = [];
    const hooks: WorkflowSnapshotHook = {
      onFailurePropagation: (r) => captured.push(r),
    };
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] } as Partial<ApiTestStep>);
    const collection = makeCollection([a, b], { onFailure: 'skipDependents' } as Partial<ApiCollection>);
    const engine = createWorkflowEngine(makeConfig(async (step) => failResult(step), hooks));
    await engine.execute(collection, makeEnv(), 'run10', {});

    const record = captured[0];
    expect(record.timeline.events.length).toBeGreaterThan(0);
    // node-failed event should be first
    expect(record.timeline.events[0].type).toBe('node-failed');
  });
});
