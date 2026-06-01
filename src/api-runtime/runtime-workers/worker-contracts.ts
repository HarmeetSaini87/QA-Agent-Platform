/**
 * worker-contracts.ts — IWorkerRuntime + WorkerMetadata
 * Phase C Step 5: Worker Isolation Preparation.
 *
 * WHAT THIS ADDS:
 *   - IWorkerRuntime: stable interface for any worker (in-process or future child_process)
 *   - WorkerMetadata: static description of a worker instance
 *   - WorkerIsolationBoundary: describes what is/isn't isolated today vs future
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Actual execution (unchanged — in-process worker wraps existing engine)
 *   - Any runtime semantics (unchanged)
 *
 * Phase C Step 5: only InProcessWorkerRuntime implements this interface.
 * Future: ChildProcessWorkerRuntime implements the same interface.
 * Coordinator never knows which — it only calls IWorkerRuntime.
 */

import type {
  ExecutionPayload,
  ExecutionResultEnvelope,
  WorkerCapabilityHint,
} from '../execution-coordinator/contracts';
import type { CancellationToken } from '../execution-coordinator/runtime-lifecycle';

// ── IWorkerRuntime ────────────────────────────────────────────────────────────

/**
 * IWorkerRuntime — the stable worker boundary contract.
 * ExecutionCoordinator only depends on this interface — never on concrete workers.
 *
 * NON-NEGOTIABLE: every worker MUST call ctx.dispose() in finally.
 * This is enforced by InProcessWorkerRuntime and must be preserved in all future workers.
 */
export interface IWorkerRuntime {
  /** Unique stable worker ID for this instance */
  readonly workerId: string;

  /** Static capabilities — coordinator uses this for routing decisions */
  readonly capabilities: WorkerCapabilityHint;

  /**
   * Execute one payload.
   * Callers inject a CancellationToken — worker must check it at safe points.
   * Phase C Step 5: checked only at pre/post execution boundaries.
   * Phase C Step 6+: checked at wave boundaries inside WorkflowEngine.
   *
   * NON-NEGOTIABLE: MUST call finally { ctx.dispose() } for all Playwright contexts.
   */
  execute(
    payload: ExecutionPayload,
    cancellation: CancellationToken,
  ): Promise<ExecutionResultEnvelope>;

  /**
   * Dispose this worker runtime.
   * MUST be called before process exit or worker pool eviction.
   * Safe to call multiple times (idempotent).
   * Guarantees: all Playwright contexts disposed, connections closed.
   */
  dispose(): Promise<void>;

  /** True after dispose() has been called */
  readonly isDisposed: boolean;
}

// ── WorkerMetadata ────────────────────────────────────────────────────────────

/**
 * WorkerMetadata — static description of a worker instance.
 * Used by coordinator for logging and audit trail.
 */
export interface WorkerMetadata {
  workerId: string;
  runtimeType: import('../execution-coordinator/contracts').RuntimeType;
  createdAt: string;
  /**
   * Process identifier for future child-process workers.
   * undefined for in-process workers (same PID as coordinator).
   */
  pid?: number;
  /** Node.js version — relevant for child-process isolation compatibility */
  nodeVersion: string;
  /** Platform — for diagnostic purposes */
  platform: string;
}

// ── WorkerIsolationBoundary ───────────────────────────────────────────────────

/**
 * WorkerIsolationBoundary — describes what is and isn't isolated in a worker.
 * Phase C Step 5: documents current reality + future targets.
 * Coordinator reads this to make informed dispatch decisions.
 */
export interface WorkerIsolationBoundary {
  /** Process-level isolation: true only for child-process workers */
  processIsolated: boolean;
  /**
   * Memory-level isolation: true if worker has its own heap.
   * False for in-process workers (shared heap with coordinator).
   */
  memoryIsolated: boolean;
  /**
   * Playwright context isolation: true if each run gets a fresh Playwright context.
   * Phase C Step 5: true (each run creates and disposes its own context — see adapter.ts).
   */
  playwrightContextIsolated: boolean;
  /**
   * Variable scope isolation: true if worker cannot access coordinator-level variables.
   * Phase C Step 5: false — all in-process, shared module state possible.
   * Future child-process: true.
   */
  variableScopeIsolated: boolean;
  /**
   * True if the worker supports snapshot-safe execution transfer.
   * Phase C Step 5: false — snapshot is built post-run, not live-transferred.
   */
  snapshotTransferSafe: boolean;
}
