// src/api-runtime/worker-health/worker-health-aggregator.ts
// Phase D Step 12 — Worker health aggregator.
// Composes WorkerHealthSnapshot + lease registry → WorkerPoolHealthReport.
// ADVISORY ONLY — read-only projection, no side effects.

import type { WorkerHealthSnapshot } from '../execution-coordinator/runtime-lifecycle';
import type { ILeaseRegistry } from '../execution-leasing/lease.contracts';

export interface StuckRunRecord {
  readonly runId: string;
  readonly workerId: string;
  readonly leasedAt: string;       // ISO-8601 (acquiredAt from lease)
  readonly stuckForMs: number;
}

export interface WorkerPoolHealthReport {
  readonly generatedAt: string;    // ISO-8601
  readonly isHealthy: boolean;
  readonly workerCount: number;
  readonly activeLeaseCount: number;
  readonly stuckRuns: readonly StuckRunRecord[];
  readonly workerSnapshot: WorkerHealthSnapshot | null;
}

export function aggregatePoolHealth(
  workerHealth: WorkerHealthSnapshot | null,
  leaseRegistry: ILeaseRegistry,
  stuckThresholdMs = 300_000,
): WorkerPoolHealthReport {
  const now = Date.now();
  const activeLeases = leaseRegistry.listActiveLeases();

  const stuckRuns: StuckRunRecord[] = activeLeases
    .filter(l => now - new Date(l.acquiredAt).getTime() > stuckThresholdMs)
    .map(l => ({
      runId: l.runId,
      workerId: l.workerId,
      leasedAt: l.acquiredAt,
      stuckForMs: now - new Date(l.acquiredAt).getTime(),
    }));

  return {
    generatedAt: new Date(now).toISOString(),
    isHealthy: workerHealth !== null && stuckRuns.length === 0,
    workerCount: workerHealth?.isAcceptingWork !== undefined ? 1 : 0,
    activeLeaseCount: activeLeases.length,
    stuckRuns,
    workerSnapshot: workerHealth,
  };
}
