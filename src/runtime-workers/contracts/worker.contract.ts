/**
 * worker.contract.ts
 * SKELETON — Phase C implementation target.
 *
 * IRuntimeWorker interface and WorkerMetadata model.
 * Phase A: interface definitions only — no implementations.
 */

export enum WorkerStatus {
  Idle      = 'idle',
  Spawning  = 'spawning',
  Running   = 'running',
  Completed = 'completed',
  Failed    = 'failed',
  Killed    = 'killed',
}

export interface WorkerMetadata {
  workerId: string;
  /** RuntimeType string value — kept as string to avoid circular import with runtime-registry */
  runtimeType: string;
  version: string;
  /** e.g. ['dag', 'retry', 'contract-validation'] */
  capabilities: string[];
}

export interface IRuntimeWorker {
  readonly meta: WorkerMetadata;
  readonly status: WorkerStatus;

  /** Phase C: dispatch execution to worker. Phase A: interface only. */
  execute(payload: import('./payload.contract').ExecutionPayload): Promise<import('./result.contract').ExecutionResult>;

  /** Phase C: signal worker to cancel an in-flight run. */
  cancel(runId: string): Promise<void>;

  /** Returns current WorkerStatus for a given runId. */
  getStatus(runId: string): WorkerStatus;
}
