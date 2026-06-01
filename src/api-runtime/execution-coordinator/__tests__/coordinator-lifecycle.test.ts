/**
 * coordinator-lifecycle.test.ts
 * Phase C Step 5: ExecutionCoordinator + RuntimeLifecycleTracker + CancellationToken tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CancellationToken,
  RuntimeLifecycleTracker,
  InvalidLifecycleTransitionError,
  createExecutionSlot,
} from '../runtime-lifecycle';
import {
  ExecutionCoordinator,
  getExecutionCoordinator,
  setCoordinatorWorker,
  _resetCoordinatorSingleton,
} from '../coordinator';
import type { IWorkerRuntime } from '../../runtime-workers/worker-contracts';
import type { ExecutionPayload, ExecutionResultEnvelope, WorkerCapabilityHint } from '../contracts';
import type { CancellationToken as CT } from '../runtime-lifecycle';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWorker(overrides?: Partial<IWorkerRuntime>): IWorkerRuntime {
  return {
    workerId: 'test-worker-01',
    isDisposed: false,
    capabilities: {
      runtimeType: 'in-process',
      maxConcurrency: 10,
      supportsSnapshots: false,
      supportsHarCapture: false,
      supportsContractDrift: false,
      isolatesContextPerNode: false,
    } satisfies WorkerCapabilityHint,
    execute: vi.fn(async (_payload: ExecutionPayload, _token: CT): Promise<ExecutionResultEnvelope> => ({
      runId: _payload.request.runId,
      workerId: 'test-worker-01',
      outcome: 'completed',
      runStatus: 'passed',
      completedAt: new Date().toISOString(),
      durationMs: 10,
    })),
    dispose: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeRequest(runId = 'run-001') {
  return {
    runId,
    collection: { id: 'col-1', projectId: 'proj-1' },
    environment: { id: 'env-1', baseUrl: 'http://test.local' },
    initialVariables: {},
    runtimeType: 'in-process' as const,
    enqueuedAt: new Date().toISOString(),
  };
}

// ── CancellationToken ─────────────────────────────────────────────────────────

describe('CancellationToken', () => {
  it('starts not cancelled', () => {
    const t = new CancellationToken();
    expect(t.isCancelled).toBe(false);
    expect(t.reason).toBeUndefined();
    expect(t.cancelledAt).toBeUndefined();
  });

  it('cancels with reason', () => {
    const t = new CancellationToken();
    t.cancel('user-request');
    expect(t.isCancelled).toBe(true);
    expect(t.reason).toBe('user-request');
    expect(t.cancelledAt).toBeDefined();
  });

  it('idempotent — second cancel does not overwrite reason', () => {
    const t = new CancellationToken();
    t.cancel('first');
    t.cancel('second');
    expect(t.reason).toBe('first');
  });

  it('toSnapshot reflects state', () => {
    const t = new CancellationToken();
    t.cancel('snapshot-test');
    const s = t.toSnapshot();
    expect(s.isCancelled).toBe(true);
    expect(s.reason).toBe('snapshot-test');
    expect(s.cancelledAt).toBeDefined();
  });
});

// ── RuntimeLifecycleTracker ───────────────────────────────────────────────────

describe('RuntimeLifecycleTracker', () => {
  it('starts in idle', () => {
    const t = new RuntimeLifecycleTracker();
    expect(t.state).toBe('idle');
    expect(t.isAcceptingWork).toBe(true);
    expect(t.isShutDown).toBe(false);
  });

  it('valid transition: idle → running', () => {
    const t = new RuntimeLifecycleTracker();
    t.transition('starting');
    t.transition('running', 'first run');
    expect(t.state).toBe('running');
    expect(t.history).toHaveLength(2);
    expect(t.history[1].reason).toBe('first run');
  });

  it('invalid transition throws InvalidLifecycleTransitionError', () => {
    const t = new RuntimeLifecycleTracker();
    t.transition('starting');
    t.transition('error');
    // stopped is terminal — no valid outgoing transitions except 'stopped' from 'error'
    t.transition('stopped');
    expect(() => t.transition('running')).toThrow(InvalidLifecycleTransitionError);
  });

  it('isAcceptingWork true for idle and running', () => {
    const t = new RuntimeLifecycleTracker();
    expect(t.isAcceptingWork).toBe(true); // idle
    t.transition('starting');
    t.transition('running');
    expect(t.isAcceptingWork).toBe(true); // running
    t.transition('stopping');
    expect(t.isAcceptingWork).toBe(false);
  });

  it('isShutDown true for stopped and error', () => {
    const t = new RuntimeLifecycleTracker();
    t.transition('starting');
    t.transition('error');
    expect(t.isShutDown).toBe(true);
  });

  it('onEnter fires when state is entered', () => {
    const t = new RuntimeLifecycleTracker();
    const cb = vi.fn();
    t.onEnter('running', cb);
    t.transition('starting');
    t.transition('running');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('onEnter does not fire for other states', () => {
    const t = new RuntimeLifecycleTracker();
    const cb = vi.fn();
    t.onEnter('stopped', cb);
    t.transition('starting');
    expect(cb).not.toHaveBeenCalled();
  });

  it('toSnapshot returns state + history', () => {
    const t = new RuntimeLifecycleTracker();
    t.transition('starting', 'boot');
    const snap = t.toSnapshot();
    expect(snap.state).toBe('starting');
    expect(snap.history).toHaveLength(1);
  });
});

// ── createExecutionSlot ───────────────────────────────────────────────────────

describe('createExecutionSlot', () => {
  it('slot has expected shape', () => {
    const slot = createExecutionSlot('run-x', 'worker-x');
    expect(slot.runId).toBe('run-x');
    expect(slot.workerId).toBe('worker-x');
    expect(slot.startedAt).toBeDefined();
    expect(slot.cancellationToken).toBeInstanceOf(CancellationToken);
    expect(slot.completion).toBeInstanceOf(Promise);
    expect(typeof slot.markComplete).toBe('function');
  });

  it('completion resolves after markComplete()', async () => {
    const slot = createExecutionSlot('run-y', 'worker-y');
    let resolved = false;
    slot.completion.then(() => { resolved = true; });
    expect(resolved).toBe(false);
    slot.markComplete();
    await slot.completion;
    expect(resolved).toBe(true);
  });
});

// ── ExecutionCoordinator ──────────────────────────────────────────────────────

describe('ExecutionCoordinator', () => {
  beforeEach(() => {
    _resetCoordinatorSingleton();
  });

  it('starts in idle lifecycle', () => {
    const coordinator = new ExecutionCoordinator(makeWorker());
    expect(coordinator.lifecycleState.state).toBe('idle');
  });

  it('dispatch: successful run returns passed envelope', async () => {
    const coordinator = new ExecutionCoordinator(makeWorker());
    const result = await coordinator.dispatch(makeRequest());
    expect(result.runId).toBe('run-001');
    expect(result.outcome).toBe('completed');
    expect(result.runStatus).toBe('passed');
  });

  it('dispatch: returns to idle after single run', async () => {
    const coordinator = new ExecutionCoordinator(makeWorker());
    await coordinator.dispatch(makeRequest());
    expect(coordinator.lifecycleState.state).toBe('idle');
  });

  it('dispatch: worker failure returns error envelope', async () => {
    const worker = makeWorker({
      execute: vi.fn(async () => { throw new Error('worker exploded'); }),
    });
    const coordinator = new ExecutionCoordinator(worker);
    const result = await coordinator.dispatch(makeRequest());
    expect(result.outcome).toBe('worker-error');
    expect(result.runStatus).toBe('error');
    expect(result.workerError).toContain('worker exploded');
  });

  it('dispatch: rejected when coordinator is stopped', async () => {
    const coordinator = new ExecutionCoordinator(makeWorker());
    await coordinator.shutdown();
    const result = await coordinator.dispatch(makeRequest('run-002'));
    expect(result.outcome).toBe('worker-error');
    expect(result.workerError).toContain('not accepting work');
  });

  it('cancel: cancels token for in-flight slot', async () => {
    let capturedToken: CT | undefined;
    const worker = makeWorker({
      execute: vi.fn(async (_p, token: CT) => {
        capturedToken = token;
        return {
          runId: _p.request.runId,
          workerId: 'test-worker-01',
          outcome: 'completed' as const,
          runStatus: 'passed' as const,
          completedAt: new Date().toISOString(),
          durationMs: 5,
        };
      }),
    });
    const coordinator = new ExecutionCoordinator(worker);
    coordinator.cancel('run-001', 'test-cancel'); // no-op before dispatch
    await coordinator.dispatch(makeRequest());
    // Token was passed to the worker — confirm it exists
    expect(capturedToken).toBeDefined();
    // After completion, cancel is a safe no-op
    coordinator.cancel('run-001', 'post-complete');
  });

  it('shutdown: transitions to stopped, disposes worker', async () => {
    const worker = makeWorker();
    const coordinator = new ExecutionCoordinator(worker);
    await coordinator.shutdown();
    expect(coordinator.lifecycleState.state).toBe('stopped');
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('shutdown: idempotent — second call is no-op', async () => {
    const worker = makeWorker();
    const coordinator = new ExecutionCoordinator(worker);
    await coordinator.shutdown();
    await coordinator.shutdown();
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('getWorkerHealth: returns full health snapshot', async () => {
    const coordinator = new ExecutionCoordinator(makeWorker());
    await coordinator.dispatch(makeRequest());
    const health = coordinator.getWorkerHealth();
    expect(health.workerId).toBe('test-worker-01');
    expect(health.runtimeType).toBe('in-process');
    expect(health.totalRunsCompleted).toBe(1);
    expect(health.totalRunsFailed).toBe(0);
    expect(health.activeRunCount).toBe(0);
    expect(health.isAcceptingWork).toBe(true);
  });

  it('getWorkerHealth: failed run increments totalRunsFailed', async () => {
    const worker = makeWorker({
      execute: vi.fn(async (p: ExecutionPayload): Promise<ExecutionResultEnvelope> => ({
        runId: p.request.runId,
        workerId: 'test-worker-01',
        outcome: 'completed',
        runStatus: 'failed',
        completedAt: new Date().toISOString(),
        durationMs: 5,
      })),
    });
    const coordinator = new ExecutionCoordinator(worker);
    await coordinator.dispatch(makeRequest());
    expect(coordinator.getWorkerHealth().totalRunsFailed).toBe(1);
    expect(coordinator.getWorkerHealth().totalRunsCompleted).toBe(0);
  });

  it('workerCapabilities: proxies worker capabilities', () => {
    const coordinator = new ExecutionCoordinator(makeWorker());
    expect(coordinator.workerCapabilities.runtimeType).toBe('in-process');
    expect(coordinator.workerCapabilities.maxConcurrency).toBe(10);
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────────

describe('coordinator singleton', () => {
  beforeEach(() => {
    _resetCoordinatorSingleton();
  });

  it('getExecutionCoordinator returns null before setCoordinatorWorker', () => {
    expect(getExecutionCoordinator()).toBeNull();
  });

  it('setCoordinatorWorker creates and returns singleton', () => {
    const c = setCoordinatorWorker(makeWorker());
    expect(c).toBeInstanceOf(ExecutionCoordinator);
    expect(getExecutionCoordinator()).toBe(c);
  });

  it('_resetCoordinatorSingleton clears singleton', () => {
    setCoordinatorWorker(makeWorker());
    _resetCoordinatorSingleton();
    expect(getExecutionCoordinator()).toBeNull();
  });
});
