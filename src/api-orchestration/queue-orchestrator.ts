// src/api-orchestration/queue-orchestrator.ts
// Phase E Step 3: LocalQueueOrchestrator — composes queue + lease into one coordination surface.
// Single-node default. Execution semantics unchanged — orchestrator routes, never alters DAG.

import { randomUUID } from 'crypto';
import { InMemoryExecutionQueue } from '../api-runtime/orchestration/in-memory-execution-queue';
import { getLeaseRegistrySingleton } from '../api-runtime/execution-leasing/in-memory-lease-registry';
import type { ILeaseRegistry } from '../api-runtime/execution-leasing/lease.contracts';
import type { IExecutionQueue } from '../api-runtime/orchestration/queue.contracts';
import type {
  IQueueOrchestrator,
  OrchestrationRequest,
  OrchestrationResult,
  OrchestrationQueueSnapshot,
} from './contracts/queue-orchestrator.contracts';

const DEFAULT_LEASE_TTL_MS = 300_000; // 5 minutes

export class LocalQueueOrchestrator implements IQueueOrchestrator {
  private readonly _workerId: string;
  /** Maps runId → requestId for cancel lookups (queue.remove takes requestId). */
  private readonly _requestIdByRunId = new Map<string, string>();

  constructor(
    private readonly _queue: IExecutionQueue,
    private readonly _leaseRegistry: ILeaseRegistry,
    workerId?: string
  ) {
    this._workerId = workerId ?? `local-worker-${randomUUID().slice(0, 8)}`;
  }

  submit(request: OrchestrationRequest): OrchestrationResult {
    const enqueuedAt = new Date().toISOString();

    // Try to acquire a lease immediately
    const leaseResult = this._leaseRegistry.acquire(request.runId, this._workerId, DEFAULT_LEASE_TTL_MS);

    if (!leaseResult.success) {
      return {
        runId: request.runId,
        outcome: 'lease-conflict',
        enqueuedAt,
        reason: leaseResult.reason,
      };
    }

    // Enqueue for dispatch — track requestId for cancel lookups
    const requestId = randomUUID();
    this._requestIdByRunId.set(request.runId, requestId);
    this._queue.enqueue({
      requestId,
      collectionId: request.collectionId,
      runId: request.runId,
      priority: request.priority,
      enqueuedAt,
      payload: {
        ...request.payload,
        tenantId: request.tenantId,
        requestedBy: request.requestedBy,
      },
    });

    const metrics = this._queue.getMetrics();

    return {
      runId: request.runId,
      outcome: 'queued',
      workerId: this._workerId,
      leaseId: leaseResult.lease?.leaseId,
      queueDepthAfter: metrics.depth,
      enqueuedAt,
    };
  }

  cancel(runId: string, _reason = 'orchestrator-cancel'): boolean {
    const requestId = this._requestIdByRunId.get(runId);
    const removed = requestId ? this._queue.remove(requestId) : false;
    this._requestIdByRunId.delete(runId);
    this._leaseRegistry.release(runId, this._workerId);
    return removed;
  }

  drainOne(): OrchestrationResult | null {
    const item = this._queue.dequeue();
    if (!item) return null;

    return {
      runId: item.runId,
      outcome: 'dispatched',
      workerId: this._workerId,
      queueDepthAfter: this._queue.depth,
      enqueuedAt: item.enqueuedAt,
    };
  }

  snapshot(): OrchestrationQueueSnapshot {
    const qMetrics = this._queue.getMetrics();
    const activeLeases = this._leaseRegistry.listActiveLeases();
    return {
      capturedAt: new Date().toISOString(),
      queueDepth: qMetrics.depth,
      activeLeaseCount: activeLeases.length,
      workerCount: 1,
      oldestEnqueuedAt: qMetrics.oldestEnqueuedAt,
    };
  }
}

let _instance: LocalQueueOrchestrator | null = null;

export function getQueueOrchestratorSingleton(): LocalQueueOrchestrator {
  if (!_instance) {
    _instance = new LocalQueueOrchestrator(
      new InMemoryExecutionQueue(),
      getLeaseRegistrySingleton()
    );
  }
  return _instance;
}

export function _resetQueueOrchestratorSingleton(): void {
  _instance = null;
}
