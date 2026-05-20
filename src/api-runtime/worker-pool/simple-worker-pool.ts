// src/api-runtime/worker-pool/simple-worker-pool.ts
// Phase D Step 12: SimpleWorkerPool — single-node default, round-robin for future multi-worker.

import type { IWorkerRuntime, WorkerMetadata } from '../runtime-workers/worker-contracts';
import type {
  IWorkerPool,
  WorkerPoolConfig,
  WorkerPoolMetrics,
  WorkerRegistration,
} from './worker-pool.contracts';

export class SimpleWorkerPool implements IWorkerPool {
  private readonly _workers = new Map<string, WorkerRegistration>();
  private _roundRobinIndex = 0;

  constructor(private readonly _config: WorkerPoolConfig = { selectionStrategy: 'round-robin' }) {}

  register(worker: IWorkerRuntime, metadata: WorkerMetadata): void {
    this._workers.set(worker.workerId, {
      worker,
      metadata,
      registeredAt: new Date().toISOString(),
    });
  }

  deregister(workerId: string): boolean {
    return this._workers.delete(workerId);
  }

  selectWorker(): IWorkerRuntime | null {
    const available = [...this._workers.values()]
      .filter(r => !r.worker.isDisposed)
      .map(r => r.worker);
    if (!available.length) return null;
    const idx = this._roundRobinIndex % available.length;
    this._roundRobinIndex++;
    return available[idx];
  }

  listWorkers(): WorkerRegistration[] {
    return [...this._workers.values()];
  }

  getMetrics(): WorkerPoolMetrics {
    const workers = [...this._workers.values()];
    return {
      totalWorkers: workers.length,
      acceptingWorkersCount: workers.filter(r => !r.worker.isDisposed).length,
      capturedAt: new Date().toISOString(),
    };
  }

  get isAcceptingWork(): boolean {
    return [...this._workers.values()].some(r => !r.worker.isDisposed);
  }
}
