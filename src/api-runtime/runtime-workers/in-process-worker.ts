/**
 * in-process-worker.ts — InProcessWorkerRuntime
 * Phase C Step 5: Worker Isolation Preparation.
 *
 * WHAT THIS IS:
 *   InProcessWorkerRuntime implements IWorkerRuntime for the current in-process execution path.
 *   It is a BOUNDARY FORMALIZATION — it documents and enforces the worker interface
 *   without changing any execution semantics.
 *
 *   Phase C Step 5: execute() receives an ExecutionPayload but delegates back to the
 *   injected runFn (provided by apiRunner.ts / WorkflowEngine). This keeps the actual
 *   engine wiring in apiRunner.ts unchanged while establishing the worker boundary contract.
 *
 * ISOLATION BOUNDARY (current reality, Phase C Step 5):
 *   processIsolated:            false  (same PID as coordinator)
 *   memoryIsolated:             false  (shared heap)
 *   playwrightContextIsolated:  true   (each step: new context → always disposed in finally)
 *   variableScopeIsolated:      false  (shared module singletons)
 *   snapshotTransferSafe:       false  (snapshot built post-run)
 *
 * NON-NEGOTIABLE: finally { ctx.dispose() } must be preserved in any execution path
 * that creates a Playwright context. InProcessWorkerRuntime delegates to the existing
 * execution path which already upholds this guarantee.
 *
 * Future: ChildProcessWorkerRuntime will implement the same IWorkerRuntime interface
 * and enforce the same dispose guarantee in the child process.
 */

import { v4 as uuidv4 } from 'uuid';
import type { IWorkerRuntime, WorkerMetadata, WorkerIsolationBoundary } from './worker-contracts';
import type {
  ExecutionPayload,
  ExecutionResultEnvelope,
  WorkerCapabilityHint,
} from '../execution-coordinator/contracts';
import type { CancellationToken } from '../execution-coordinator/runtime-lifecycle';
import type { ApiCollectionRunResult } from '../../data/types';

/** Injectable run function — matches the existing apiRunner.ts / engine signature */
export type InProcessRunFn = (
  collectionId: string,
  environmentId: string,
  runId: string,
  projectId?: string,
) => Promise<ApiCollectionRunResult>;

// ── InProcessWorkerRuntime ────────────────────────────────────────────────────

export class InProcessWorkerRuntime implements IWorkerRuntime {
  readonly workerId: string;
  private _isDisposed = false;

  readonly capabilities: WorkerCapabilityHint = {
    runtimeType: 'in-process',
    maxConcurrency: 10,
    supportsSnapshots: true,
    supportsHarCapture: true,
    supportsContractDrift: true,
    isolatesContextPerNode: false,
  };

  readonly metadata: WorkerMetadata;

  readonly isolationBoundary: WorkerIsolationBoundary = {
    processIsolated: false,
    memoryIsolated: false,
    playwrightContextIsolated: true,
    variableScopeIsolated: false,
    snapshotTransferSafe: false,
  };

  /**
   * _runFn: injectable execution function.
   * Default: undefined — callers must inject via setRunFn() before first execute().
   * This keeps the worker boundary clean without importing apiRunner.ts directly
   * (avoids circular dependency: api-runtime → utils → api-runtime).
   */
  private _runFn?: InProcessRunFn;

  constructor(workerId?: string) {
    this.workerId = workerId ?? `in-process-${uuidv4().slice(0, 8)}`;
    this.metadata = {
      workerId: this.workerId,
      runtimeType: 'in-process',
      createdAt: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
    };
  }

  get isDisposed(): boolean { return this._isDisposed; }

  /** Inject the execution function. Called once at startup by apiRunner.ts or tests. */
  setRunFn(fn: InProcessRunFn): void {
    this._runFn = fn;
  }

  /**
   * Execute one payload via the injected run function.
   *
   * Phase C Step 5: CancellationToken is stored and checked pre-dispatch.
   * Phase C Step 6+: token will be passed into WorkflowEngine wave loop.
   *
   * NON-NEGOTIABLE: run function must guarantee finally { ctx.dispose() }
   * for all Playwright contexts — enforced by adapter.ts.
   */
  async execute(
    payload: ExecutionPayload,
    cancellation: CancellationToken,
  ): Promise<ExecutionResultEnvelope> {
    if (this._isDisposed) {
      return this._errorEnvelope(payload.request.runId, 'Worker already disposed');
    }

    // Pre-dispatch cancellation check
    if (cancellation.isCancelled) {
      return this._cancelledEnvelope(payload.request.runId, cancellation.reason);
    }

    if (!this._runFn) {
      return this._errorEnvelope(payload.request.runId, 'InProcessWorkerRuntime: runFn not injected — call setRunFn() first');
    }

    const { request } = payload;
    const startMs = Date.now();

    try {
      const result = await this._runFn(
        request.collection.id,
        request.environment.id,
        request.runId,
        request.collection.projectId,
      );

      return {
        runId: request.runId,
        workerId: this.workerId,
        outcome: 'completed',
        runStatus: result.status === 'passed' ? 'passed' : 'failed',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        runId: request.runId,
        workerId: this.workerId,
        outcome: 'worker-error',
        runStatus: 'error',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        workerError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    this._isDisposed = true;
    // In-process: no resources to release at worker level.
    // Playwright contexts are disposed per-request inside adapter.ts (finally guarantee).
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _errorEnvelope(runId: string, error: string): ExecutionResultEnvelope {
    return {
      runId, workerId: this.workerId,
      outcome: 'worker-error', runStatus: 'error',
      completedAt: new Date().toISOString(), durationMs: 0,
      workerError: error,
    };
  }

  private _cancelledEnvelope(runId: string, reason?: string): ExecutionResultEnvelope {
    return {
      runId, workerId: this.workerId,
      outcome: 'cancelled', runStatus: 'error',
      completedAt: new Date().toISOString(), durationMs: 0,
      workerError: `Cancelled: ${reason ?? 'no reason'}`,
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createInProcessWorker(workerId?: string): InProcessWorkerRuntime {
  return new InProcessWorkerRuntime(workerId);
}
