// src/api-orchestration/__tests__/queue-orchestrator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalQueueOrchestrator } from '../queue-orchestrator';
import { InMemoryExecutionQueue } from '../../api-runtime/orchestration/in-memory-execution-queue';
import { InMemoryLeaseRegistry } from '../../api-runtime/execution-leasing/in-memory-lease-registry';

function makeRequest(runId: string, priority = 5) {
  return { collectionId: 'col-1', runId, priority, payload: {} };
}

describe('LocalQueueOrchestrator', () => {
  let orchestrator: LocalQueueOrchestrator;
  beforeEach(() => {
    orchestrator = new LocalQueueOrchestrator(
      new InMemoryExecutionQueue(),
      new InMemoryLeaseRegistry(),
      'worker-test'
    );
  });

  it('submit: returns queued outcome with leaseId', () => {
    const result = orchestrator.submit(makeRequest('run-1'));
    expect(result.outcome).toBe('queued');
    expect(result.leaseId).toBeTruthy();
    expect(result.workerId).toBe('worker-test');
  });

  it('submit: returns lease-conflict for duplicate runId', () => {
    orchestrator.submit(makeRequest('run-1'));
    const result2 = orchestrator.submit(makeRequest('run-1'));
    expect(result2.outcome).toBe('lease-conflict');
  });

  it('snapshot: reflects queue depth and lease count', () => {
    orchestrator.submit(makeRequest('run-1'));
    orchestrator.submit(makeRequest('run-2'));
    const snap = orchestrator.snapshot();
    expect(snap.queueDepth).toBe(2);
    expect(snap.activeLeaseCount).toBe(2);
    expect(snap.workerCount).toBe(1);
  });

  it('drainOne: removes from queue and returns dispatched', () => {
    orchestrator.submit(makeRequest('run-1'));
    const result = orchestrator.drainOne();
    expect(result?.outcome).toBe('dispatched');
    expect(orchestrator.snapshot().queueDepth).toBe(0);
  });

  it('cancel: removes from queue and releases lease', () => {
    orchestrator.submit(makeRequest('run-1'));
    const cancelled = orchestrator.cancel('run-1');
    expect(cancelled).toBe(true);
    expect(orchestrator.snapshot().queueDepth).toBe(0);
  });
});
