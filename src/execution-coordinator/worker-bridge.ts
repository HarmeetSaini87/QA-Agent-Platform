/**
 * worker-bridge.ts
 * SKELETON — Phase C implementation target.
 *
 * Abstracts child_process spawning for crash-isolated collection runs.
 *
 * Phase C design:
 * - spawn(runId, payload) forks a worker process
 * - worker receives WorkflowEnvelope + environment via IPC
 * - worker calls api-runtime/* directly (no Express dependency)
 * - results streamed back via IPC messages → SSE to browser
 * - worker crash does NOT kill Express server
 *
 * Phase A: interface only.
 *
 * WHY child_process NOT worker_threads:
 * - Playwright requires separate process per context for stability
 * - Memory isolation: leaked contexts don't bloat main process
 * - Easier debugging (separate PID visible in task manager)
 * - Future: containerise workers without changing interface
 */

export interface WorkerPayload {
  runId: string;
  collectionId: string;
  environmentId: string;
  /** Serialised WorkflowEnvelope — passed via IPC */
  workflowJson: string;
}

export type WorkerStatus = 'spawning' | 'running' | 'completed' | 'failed' | 'killed';

export interface WorkerHandle {
  runId: string;
  pid?: number;
  status: WorkerStatus;
  startedAt: string;
  /** Kill the worker process */
  kill(): void;
}

export interface IWorkerBridge {
  spawn(payload: WorkerPayload): WorkerHandle;
  getHandle(runId: string): WorkerHandle | undefined;
  killAll(): void;
}

// ── Phase A stub ──────────────────────────────────────────────────────────────

export class WorkerBridgeStub implements IWorkerBridge {
  spawn(_payload: WorkerPayload): WorkerHandle {
    throw new Error('WorkerBridge not implemented yet — Phase C target');
  }
  getHandle(_runId: string): WorkerHandle | undefined {
    return undefined;
  }
  killAll(): void { /* no-op */ }
}
