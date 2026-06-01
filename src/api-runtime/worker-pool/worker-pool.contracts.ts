// src/api-runtime/worker-pool/worker-pool.contracts.ts
// Phase D Step 12: Worker pool registry abstraction for future multi-worker routing.
// Coordinator remains the dispatcher — pool tracks available workers + provides selection.

import type { IWorkerRuntime, WorkerMetadata } from '../runtime-workers/worker-contracts';

export type WorkerSelectionStrategy = 'round-robin' | 'least-loaded' | 'first-available';

export interface WorkerRegistration {
  readonly worker: IWorkerRuntime;
  readonly metadata: WorkerMetadata;
  readonly registeredAt: string;
}

export interface WorkerPoolConfig {
  readonly selectionStrategy: WorkerSelectionStrategy;
}

export interface WorkerPoolMetrics {
  readonly totalWorkers: number;
  readonly acceptingWorkersCount: number;
  readonly capturedAt: string;
}

export interface IWorkerPool {
  register(worker: IWorkerRuntime, metadata: WorkerMetadata): void;
  deregister(workerId: string): boolean;
  selectWorker(): IWorkerRuntime | null;
  listWorkers(): WorkerRegistration[];
  getMetrics(): WorkerPoolMetrics;
  readonly isAcceptingWork: boolean;
}
