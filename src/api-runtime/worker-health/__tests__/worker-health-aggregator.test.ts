// src/api-runtime/worker-health/__tests__/worker-health-aggregator.test.ts
// Phase D Step 12 — Worker health aggregator tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryLeaseRegistry } from '../../execution-leasing/in-memory-lease-registry';
import { aggregatePoolHealth } from '../worker-health-aggregator';
import type { WorkerHealthSnapshot } from '../../execution-coordinator/runtime-lifecycle';

function makeHealthySnapshot(): WorkerHealthSnapshot {
  return {
    workerId: 'worker-1',
    runtimeType: 'in-process',
    lifecycleState: 'running',
    activeRunCount: 0,
    totalRunsCompleted: 5,
    totalRunsFailed: 0,
    lastActiveAt: new Date().toISOString(),
    isAcceptingWork: true,
    capturedAt: new Date().toISOString(),
  };
}

describe('aggregatePoolHealth', () => {
  let registry: InMemoryLeaseRegistry;

  beforeEach(() => {
    registry = new InMemoryLeaseRegistry();
  });

  it('1. isHealthy is false when workerHealth is null', () => {
    const report = aggregatePoolHealth(null, registry);
    expect(report.isHealthy).toBe(false);
  });

  it('2. isHealthy is true when worker is healthy and no stuck runs', () => {
    const report = aggregatePoolHealth(makeHealthySnapshot(), registry);
    expect(report.isHealthy).toBe(true);
    expect(report.stuckRuns).toHaveLength(0);
  });

  it('3. stuckRuns is empty when all leases are recent (within threshold)', () => {
    registry.acquire('run-1', 'worker-1', 60_000);
    const report = aggregatePoolHealth(makeHealthySnapshot(), registry, 300_000);
    expect(report.stuckRuns).toHaveLength(0);
  });

  it('4. stuckRuns contains entry when a lease exceeds the threshold', () => {
    vi.useFakeTimers();
    const acquiredRegistry = new InMemoryLeaseRegistry();
    acquiredRegistry.acquire('run-stuck', 'worker-1', 3_600_000); // 1hr TTL — won't expire

    // Advance time past the stuck threshold
    vi.advanceTimersByTime(310_000);

    const report = aggregatePoolHealth(makeHealthySnapshot(), acquiredRegistry, 300_000);
    expect(report.stuckRuns).toHaveLength(1);
    expect(report.stuckRuns[0].runId).toBe('run-stuck');
    expect(report.stuckRuns[0].stuckForMs).toBeGreaterThan(300_000);

    vi.useRealTimers();
  });

  it('5. activeLeaseCount reflects the number of active leases', () => {
    registry.acquire('run-a', 'worker-1', 60_000);
    registry.acquire('run-b', 'worker-2', 60_000);
    const report = aggregatePoolHealth(null, registry);
    expect(report.activeLeaseCount).toBe(2);
  });

  it('6. workerSnapshot is included in the report', () => {
    const snapshot = makeHealthySnapshot();
    const report = aggregatePoolHealth(snapshot, registry);
    expect(report.workerSnapshot).toBe(snapshot);
  });
});
