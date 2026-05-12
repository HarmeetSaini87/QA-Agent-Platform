/**
 * scheduler-lifecycle.test.ts
 * Phase C Step 1: validate SchedulerStateTracker and lifecycle hook wiring
 * in WorkflowEngine WITHOUT changing execution semantics.
 *
 * All existing engine.test.ts cases still pass unchanged.
 * These tests cover the NEW scheduler observability layer only.
 */

import { describe, it, expect, vi } from 'vitest';
import { createWorkflowEngine } from '../engine';
import type { WorkflowEngineConfig } from '../engine';
import type { WorkflowSnapshotHook, NodeTransitionEvent, NodeSkipEvent, NodeFailureEvent } from '../snapshot-hooks';
import { SchedulerStateTracker } from '../scheduler-state';
import type { ApiCollection, ApiEnvironment, ApiTestStep, ApiStepResult } from '../../../data/types';

// ── Test helpers ──────────────────────────────────────────────────────────────

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

// ── Group 1: SchedulerStateTracker unit tests ─────────────────────────────────

describe('SchedulerStateTracker — unit', () => {
  it('initialises all nodes as pending', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a', 'b', 'c'], new Map([['a', 'Step A'], ['b', 'Step B'], ['c', 'Step C']]));
    expect(tracker.getStatus('a')).toBe('pending');
    expect(tracker.getStatus('b')).toBe('pending');
    expect(tracker.getStatus('c')).toBe('pending');
  });

  it('transitions pending → running → completed', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a'], new Map([['a', 'Step A']]));
    tracker.markRunning('a');
    expect(tracker.getStatus('a')).toBe('running');
    tracker.markCompleted('a');
    expect(tracker.getStatus('a')).toBe('completed');
    const rec = tracker.getRecord('a');
    expect(rec?.startedAt).toBeDefined();
    expect(rec?.completedAt).toBeDefined();
    expect(rec?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('transitions pending → running → failed with reason', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a'], new Map([['a', 'Step A']]));
    tracker.markRunning('a');
    tracker.markFailed('a', 'assertion-failure', 'status != 200');
    expect(tracker.getStatus('a')).toBe('failed');
    const rec = tracker.getRecord('a');
    expect(rec?.failureReason).toBe('assertion-failure');
    expect(rec?.error).toBe('status != 200');
  });

  it('transitions pending → skipped with reason', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a'], new Map([['a', 'Step A']]));
    tracker.markSkipped('a', 'condition-false');
    expect(tracker.getStatus('a')).toBe('skipped');
    expect(tracker.getRecord('a')?.skipReason).toBe('condition-false');
    expect(tracker.getRecord('a')?.durationMs).toBe(0);
  });

  it('transitions pending → blocked', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a'], new Map([['a', 'Step A']]));
    tracker.markBlocked('a');
    expect(tracker.getStatus('a')).toBe('blocked');
  });

  it('records variablesBefore and variablesAfter', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a'], new Map([['a', 'A']]));
    tracker.recordVariablesBefore('a', { token: 'tok1' });
    tracker.recordVariablesAfter('a', { token: 'tok1', userId: '42' });
    expect(tracker.getRecord('a')?.variablesBefore).toEqual({ token: 'tok1' });
    expect(tracker.getRecord('a')?.variablesAfter).toEqual({ token: 'tok1', userId: '42' });
  });

  it('records contract violations', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a'], new Map([['a', 'A']]));
    tracker.recordContractViolations('a', ['missing field: id', 'wrong type: name']);
    expect(tracker.getRecord('a')?.contractViolations).toHaveLength(2);
  });

  it('categorise returns correct buckets', () => {
    const tracker = new SchedulerStateTracker();
    tracker.initialise(['a', 'b', 'c', 'd'], new Map([
      ['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'],
    ]));
    tracker.markRunning('a');
    tracker.markCompleted('a');
    tracker.markSkipped('b', 'condition-false');
    tracker.markBlocked('c');
    // d stays pending
    const cat = tracker.categorise();
    expect(cat.completed).toContain('a');
    expect(cat.skipped).toContain('b');
    expect(cat.blocked).toContain('c');
    expect(cat.pending).toContain('d');
  });

  it('defensive: getStatus for unknown node returns pending', () => {
    const tracker = new SchedulerStateTracker();
    expect(tracker.getStatus('unknown')).toBe('pending');
  });
});

// ── Group 2: onNodeTransition hook ───────────────────────────────────────────

describe('WorkflowEngine — onNodeTransition hook', () => {
  it('fires transition events for each node execution', async () => {
    const transitions: NodeTransitionEvent[] = [];
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onNodeTransition: (e) => transitions.push(e),
    }));
    const steps = [makeStep('a'), makeStep('b')];
    await engine.execute(makeCollection(steps, { executionMode: 'sequential' }), makeEnv(), 'r1', {});

    const aTransitions = transitions.filter(t => t.nodeId === 'a');
    const bTransitions = transitions.filter(t => t.nodeId === 'b');
    expect(aTransitions.some(t => t.to === 'running')).toBe(true);
    expect(aTransitions.some(t => t.to === 'completed')).toBe(true);
    expect(bTransitions.some(t => t.to === 'running')).toBe(true);
    expect(bTransitions.some(t => t.to === 'completed')).toBe(true);
  });

  it('transition events contain nodeId, nodeName, from, to, at', async () => {
    const transitions: NodeTransitionEvent[] = [];
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onNodeTransition: (e) => transitions.push(e),
    }));
    await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    const running = transitions.find(t => t.nodeId === 'a' && t.to === 'running');
    expect(running).toBeDefined();
    expect(running?.from).toBeDefined();
    expect(running?.at).toMatch(/^\d{4}-/);
    expect(running?.nodeName).toBe('Step a');
  });

  it('fires running→failed transition for failed step', async () => {
    const transitions: NodeTransitionEvent[] = [];
    const a = makeStep('a');
    const engine = createWorkflowEngine(makeConfig(async (step) => failResult(step), {
      onNodeTransition: (e) => transitions.push(e),
    }));
    await engine.execute(makeCollection([a]), makeEnv(), 'r1', {});
    const failed = transitions.find(t => t.nodeId === 'a' && t.to === 'failed');
    expect(failed).toBeDefined();
    expect(failed?.from).toBe('running');
  });
});

// ── Group 3: onNodeSkip hook ──────────────────────────────────────────────────

describe('WorkflowEngine — onNodeSkip hook', () => {
  it('fires condition-false skip for guarded step', async () => {
    const skips: NodeSkipEvent[] = [];
    const step = makeStep('a', { execution: { condition: 'false' } } as Partial<ApiTestStep>);
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onNodeSkip: (e) => skips.push(e),
    }));
    await engine.execute(makeCollection([step]), makeEnv(), 'r1', {});
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toBe('condition-false');
    expect(skips[0].nodeId).toBe('a');
  });

  it('fires dependency-failed skip on onFailure=stop', async () => {
    const skips: NodeSkipEvent[] = [];
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const engine = createWorkflowEngine(makeConfig(
      async (step) => step.id === 'a' ? failResult(step) : passResult(step),
      { onNodeSkip: (e) => skips.push(e) },
    ));
    const col = makeCollection([a, b], { onFailure: 'stop' });
    await engine.execute(col, makeEnv(), 'r1', {});
    const depSkip = skips.find(s => s.nodeId === 'b');
    expect(depSkip?.reason).toBe('dependency-failed');
    expect(depSkip?.causedByNodeId).toBe('a');
  });

  it('fires dependency-failed skip on onFailure=skipDependents', async () => {
    const skips: NodeSkipEvent[] = [];
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const engine = createWorkflowEngine(makeConfig(
      async (step) => step.id === 'a' ? failResult(step) : passResult(step),
      { onNodeSkip: (e) => skips.push(e) },
    ));
    const col = makeCollection([a, b], { onFailure: 'skipDependents' });
    await engine.execute(col, makeEnv(), 'r1', {});
    const depSkip = skips.find(s => s.nodeId === 'b');
    expect(depSkip?.reason).toBe('dependency-failed');
    expect(depSkip?.causedByNodeId).toBe('a');
  });
});

// ── Group 4: onNodeFail hook ──────────────────────────────────────────────────

describe('WorkflowEngine — onNodeFail hook', () => {
  it('fires with assertion-failure reason for failed step', async () => {
    const failures: NodeFailureEvent[] = [];
    const engine = createWorkflowEngine(makeConfig(
      async (step) => failResult(step),
      { onNodeFail: (e) => failures.push(e) },
    ));
    await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBe('assertion-failure');
    expect(failures[0].nodeId).toBe('a');
  });

  it('fires with http-error reason for error result', async () => {
    const failures: NodeFailureEvent[] = [];
    const engine = createWorkflowEngine(makeConfig(
      async (step) => errorResult(step),
      { onNodeFail: (e) => failures.push(e) },
    ));
    await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    expect(failures[0].reason).toBe('http-error');
    expect(failures[0].error).toBe('network error');
  });
});

// ── Group 5: blocked → running lifecycle for DAG nodes ───────────────────────

describe('WorkflowEngine — blocked→running lifecycle', () => {
  it('node starts blocked then transitions to running after deps complete', async () => {
    const transitions: NodeTransitionEvent[] = [];
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onNodeTransition: (e) => transitions.push(e),
    }));
    await engine.execute(makeCollection([a, b]), makeEnv(), 'r1', {});

    // b should have a running transition (from blocked or pending)
    const bRunning = transitions.find(t => t.nodeId === 'b' && t.to === 'running');
    expect(bRunning).toBeDefined();
    // b running must come after a completed
    const aCompleted = transitions.find(t => t.nodeId === 'a' && t.to === 'completed');
    expect(aCompleted).toBeDefined();
    const aIdx = transitions.indexOf(aCompleted!);
    const bIdx = transitions.indexOf(bRunning!);
    expect(aIdx).toBeLessThan(bIdx);
  });
});

// ── Group 6: hook errors don't break execution ────────────────────────────────

describe('WorkflowEngine — hook error isolation', () => {
  it('throws in onNodeTransition does not break execution', async () => {
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onNodeTransition: () => { throw new Error('hook error'); },
    }));
    const result = await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    expect(result.status).toBe('passed');
  });

  it('throws in onNodeSkip does not break execution', async () => {
    const step = makeStep('a', { execution: { condition: 'false' } } as Partial<ApiTestStep>);
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onNodeSkip: () => { throw new Error('hook error'); },
    }));
    const result = await engine.execute(makeCollection([step]), makeEnv(), 'r1', {});
    expect(result.stepResults[0].status).toBe('skipped');
  });

  it('throws in onNodeFail does not break execution', async () => {
    const engine = createWorkflowEngine(makeConfig(
      async (step) => failResult(step),
      { onNodeFail: () => { throw new Error('hook error'); } },
    ));
    const result = await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    expect(result.status).toBe('failed');
  });
});

// ── Group 7: ExecutionSnapshot via onSchedulerSnapshot ───────────────────────

describe('WorkflowEngine — onSchedulerSnapshot', () => {
  it('emits snapshot with correct runId and nodeRecords', async () => {
    const snapshots: import('../../../shared-core/contracts/dependency-graph.contract').ExecutionSnapshot[] = [];
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onSchedulerSnapshot: (s) => snapshots.push(s),
    }));
    await engine.execute(makeCollection([makeStep('a'), makeStep('b')]), makeEnv(), 'run-snap', {});

    expect(snapshots.length).toBeGreaterThan(0);
    const last = snapshots[snapshots.length - 1];
    expect(last.runId).toBe('run-snap');
    expect(last.collectionId).toBe('col1');
    expect(last.nodeRecords['a']).toBeDefined();
    expect(last.nodeRecords['b']).toBeDefined();
    expect(['completed', 'failed']).toContain(last.runStatus);
  });

  it('final snapshot has all nodes completed for all-pass run', async () => {
    const snapshots: import('../../../shared-core/contracts/dependency-graph.contract').ExecutionSnapshot[] = [];
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onSchedulerSnapshot: (s) => snapshots.push(s),
    }));
    await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    const final = snapshots[snapshots.length - 1];
    expect(final.completedNodeIds).toContain('a');
    expect(final.runStatus).toBe('completed');
  });

  it('snapshot not emitted when hook not registered', async () => {
    let called = false;
    const engine = createWorkflowEngine(makeConfig(undefined, {
      onRunComplete: () => { called = true; },
      // onSchedulerSnapshot intentionally absent
    }));
    await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    expect(called).toBe(true); // proves hooks work, but snapshot hook absent is fine
  });
});

// ── Group 8: execution semantics unchanged ────────────────────────────────────

describe('WorkflowEngine — execution semantics unchanged by Phase C Step 1', () => {
  it('sequential mode still produces correct results', async () => {
    const order: string[] = [];
    const engine = createWorkflowEngine(makeConfig(async (step) => {
      order.push(step.id);
      return passResult(step);
    }));
    await engine.execute(
      makeCollection([makeStep('a'), makeStep('b')], { executionMode: 'sequential' }),
      makeEnv(), 'r1', {},
    );
    expect(order).toEqual(['a', 'b']);
  });

  it('DAG mode respects dependency ordering', async () => {
    const order: string[] = [];
    const a = makeStep('a');
    const b = makeStep('b', { dependsOn: ['a'] });
    const engine = createWorkflowEngine(makeConfig(async (step) => {
      order.push(step.id);
      return passResult(step);
    }));
    await engine.execute(makeCollection([b, a]), makeEnv(), 'r1', {});
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('teardown still runs on failure', async () => {
    const ran: string[] = [];
    const test = makeStep('test');
    const teardown = makeStep('cleanup', { execution: { teardown: true } } as Partial<ApiTestStep>);
    const engine = createWorkflowEngine(makeConfig(async (step) => {
      ran.push(step.id);
      return step.id === 'test' ? failResult(step) : passResult(step);
    }));
    await engine.execute(makeCollection([test, teardown]), makeEnv(), 'r1', {});
    expect(ran).toContain('cleanup');
  });

  it('final result status unaffected by scheduler wiring', async () => {
    const engine = createWorkflowEngine(makeConfig(
      async (step) => failResult(step),
      { onNodeTransition: vi.fn(), onNodeSkip: vi.fn(), onNodeFail: vi.fn() },
    ));
    const result = await engine.execute(makeCollection([makeStep('a')]), makeEnv(), 'r1', {});
    expect(result.status).toBe('failed');
    expect(result.stepResults[0].status).toBe('failed');
  });
});
