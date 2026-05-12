/**
 * coordinator.ts — ExecutionCoordinator
 * Phase C Step 5: Worker Isolation Preparation & Execution Coordinator Evolution.
 *
 * WHAT THIS IS:
 *   ExecutionCoordinator is the runtime orchestration boundary between the API server
 *   and the execution workers. Today it runs fully in-process. Future: it will route
 *   execution requests to child_process or remote workers.
 *
 * COORDINATOR RESPONSIBILITIES (current + future):
 *   - Accept ExecutionRequest from API routes
 *   - Assign a worker runtime (in-process today)
 *   - Build ExecutionPayload and dispatch to worker
 *   - Track in-flight runs via ExecutionSlot
 *   - Track own lifecycle via RuntimeLifecycleTracker
 *   - Surface cancellation tokens to in-flight runs
 *   - Report worker health on demand
 *   - Ensure all workers are drained on shutdown
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - WorkflowEngine execution (still called via InProcessWorkerRuntime)
 *   - Retry/DAG/variable/assertion semantics (all unchanged)
 *   - apiRunner.ts runCollection() route (still exists; wires into coordinator)
 *
 * Phase C Step 5: coordinator routes all work to InProcessWorkerRuntime.
 * Phase C Step 6+: coordinator will route to child-process workers.
 *
 * BOUNDARY RULE: coordinator never imports from ui/ or auth/ directly.
 */

import type {
  ExecutionRequest,
  ExecutionPayload,
  ExecutionContext,
  ExecutionResultEnvelope,
  WorkerCapabilityHint,
} from './contracts';
import {
  RuntimeLifecycleTracker,
  createExecutionSlot,
} from './runtime-lifecycle';
import type { ExecutionSlot } from './runtime-lifecycle';
import type { IWorkerRuntime } from '../runtime-workers/worker-contracts';

// ── IExecutionCoordinator interface ──────────────────────────────────────────

/**
 * IExecutionCoordinator — the stable boundary contract.
 * API routes and apiRunner.ts use this interface — not the concrete class.
 * Future: swap InProcessWorkerRuntime for child-process worker without changing callers.
 */
export interface IExecutionCoordinator {
  /**
   * Dispatch an execution request to an appropriate worker runtime.
   * Returns a result envelope when the run completes or is cancelled.
   */
  dispatch(request: ExecutionRequest): Promise<ExecutionResultEnvelope>;

  /**
   * Cancel an in-flight run by runId.
   * Safe to call if run has already completed (no-op).
   */
  cancel(runId: string, reason?: string): void;

  /**
   * Graceful shutdown — drain all in-flight runs, then stop.
   * Waits for all active slots to complete before resolving.
   */
  shutdown(): Promise<void>;

  /** Current coordinator lifecycle state */
  readonly lifecycleState: ReturnType<RuntimeLifecycleTracker['toSnapshot']>;

  /** Worker capability hints for the registered runtime */
  readonly workerCapabilities: WorkerCapabilityHint;

  /** Health snapshot of the registered worker */
  getWorkerHealth(): import('./runtime-lifecycle').WorkerHealthSnapshot;
}

// ── ExecutionCoordinator ──────────────────────────────────────────────────────

export class ExecutionCoordinator implements IExecutionCoordinator {
  private readonly _lifecycle = new RuntimeLifecycleTracker();
  private readonly _slots = new Map<string, ExecutionSlot>();
  private _totalCompleted = 0;
  private _totalFailed = 0;
  private _lastActiveAt = new Date().toISOString();

  constructor(private readonly _worker: IWorkerRuntime) {
    this._lifecycle.transition('starting');
    this._lifecycle.transition('idle', 'coordinator ready');
  }

  get lifecycleState() { return this._lifecycle.toSnapshot(); }
  get workerCapabilities(): WorkerCapabilityHint { return this._worker.capabilities; }

  /**
   * Dispatch one execution request to the worker.
   * Phase C Step 5: always in-process, always synchronous within the worker.
   */
  async dispatch(request: ExecutionRequest): Promise<ExecutionResultEnvelope> {
    if (!this._lifecycle.isAcceptingWork) {
      return this._rejectedEnvelope(request.runId, `Coordinator not accepting work: ${this._lifecycle.state}`);
    }

    if (this._lifecycle.state === 'idle') {
      this._lifecycle.transition('running', `first run dispatched: ${request.runId}`);
    }

    const slot = createExecutionSlot(request.runId, this._worker.workerId);
    this._slots.set(request.runId, slot);
    this._lastActiveAt = new Date().toISOString();

    const payload = this._buildPayload(request, slot);
    const dispatchStart = Date.now();

    let envelope: ExecutionResultEnvelope;
    try {
      envelope = await this._worker.execute(payload, slot.cancellationToken);
      if (envelope.runStatus === 'failed' || envelope.runStatus === 'error') {
        this._totalFailed++;
      } else {
        this._totalCompleted++;
      }
    } catch (err) {
      this._totalFailed++;
      envelope = {
        runId: request.runId,
        workerId: this._worker.workerId,
        outcome: 'worker-error',
        runStatus: 'error',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - dispatchStart,
        workerError: err instanceof Error ? err.message : String(err),
      };
    } finally {
      slot.markComplete();
      this._slots.delete(request.runId);
      this._lastActiveAt = new Date().toISOString();
    }

    // Transition back to idle when no more in-flight runs
    if (this._slots.size === 0 && this._lifecycle.state === 'running') {
      this._lifecycle.transition('idle', 'all runs complete');
    }

    return envelope;
  }

  cancel(runId: string, reason = 'coordinator-cancel'): void {
    this._slots.get(runId)?.cancellationToken.cancel(reason);
  }

  async shutdown(): Promise<void> {
    if (this._lifecycle.isShutDown) return;

    this._lifecycle.transition('stopping', 'shutdown requested');

    // Cancel all in-flight runs
    for (const slot of this._slots.values()) {
      slot.cancellationToken.cancel('coordinator-shutdown');
    }

    // Drain: wait for all slots to complete
    await Promise.allSettled([...this._slots.values()].map(s => s.completion));

    // Dispose worker
    await this._worker.dispose();

    this._lifecycle.transition('stopped', 'all runs drained');
  }

  getWorkerHealth(): import('./runtime-lifecycle').WorkerHealthSnapshot {
    return {
      workerId: this._worker.workerId,
      runtimeType: this._worker.capabilities.runtimeType,
      lifecycleState: this._lifecycle.state,
      activeRunCount: this._slots.size,
      totalRunsCompleted: this._totalCompleted,
      totalRunsFailed: this._totalFailed,
      lastActiveAt: this._lastActiveAt,
      isAcceptingWork: this._lifecycle.isAcceptingWork,
      capturedAt: new Date().toISOString(),
    };
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _buildPayload(request: ExecutionRequest, slot: ExecutionSlot): ExecutionPayload {
    const context: ExecutionContext = {
      runId: request.runId,
      collectionId: request.collection.id,
      projectId: request.collection.projectId,
      variables: request.initialVariables,
      authHeaders: {},
      baseUrl: request.environment.baseUrl ?? '',
      stepTimeoutMs: 30_000,
      capturedAt: new Date().toISOString(),
    };
    return {
      request,
      context,
      assignedWorkerId: slot.workerId,
      dispatchedAt: new Date().toISOString(),
    };
  }

  private _rejectedEnvelope(runId: string, reason: string): ExecutionResultEnvelope {
    return {
      runId,
      workerId: this._worker.workerId,
      outcome: 'worker-error',
      runStatus: 'error',
      completedAt: new Date().toISOString(),
      durationMs: 0,
      workerError: reason,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _coordinator: ExecutionCoordinator | null = null;

/**
 * getExecutionCoordinator — returns the singleton coordinator.
 * Lazily initialised with InProcessWorkerRuntime on first call.
 * Phase C Step 5: always returns in-process coordinator.
 * Future: factory pattern will inject child-process worker instead.
 */
/**
 * getExecutionCoordinator — returns the singleton coordinator.
 * Call setCoordinatorWorker() first to inject a worker (done by apiRunner.ts at startup).
 * If no worker injected, returns null — callers must check.
 *
 * Phase C Step 5: worker is injected externally to avoid circular deps.
 * Pattern: apiRunner.ts calls setCoordinatorWorker(createInProcessWorker()) at startup.
 */
export function getExecutionCoordinator(): ExecutionCoordinator | null {
  return _coordinator;
}

/** Inject a worker and create (or recreate) the singleton coordinator. */
export function setCoordinatorWorker(worker: IWorkerRuntime): ExecutionCoordinator {
  _coordinator = new ExecutionCoordinator(worker);
  return _coordinator;
}

/** Reset singleton — for testing only. */
export function _resetCoordinatorSingleton(): void {
  _coordinator = null;
}
