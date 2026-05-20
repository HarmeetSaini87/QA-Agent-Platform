// src/api-observability/contracts/__tests__/distributed-replay.test.ts
// Test suite for distributed replay contracts and SingleWorkerReplayMerger

import { describe, it, expect } from 'vitest';
import {
  SingleWorkerReplayMerger,
  type DistributedReplayManifest,
  type WorkerReplayFragment,
} from '../distributed-replay.contracts';
import type { ReplayEvent } from '../replay-event.contracts';

describe('SingleWorkerReplayMerger', () => {
  const createMockEvent = (seq: number, kind: string = 'request-sent'): ReplayEvent => ({
    seq,
    kind: kind as any,
    stepId: `step-${seq}`,
    stepName: `Step ${seq}`,
    timestamp: new Date(Date.now() + seq * 1000).toISOString(),
  });

  const createMockFragment = (workerId: string, events: ReplayEvent[]): WorkerReplayFragment => ({
    workerId,
    runId: 'test-run-123',
    events,
    capturedAt: new Date().toISOString(),
  });

  const createManifest = (fragments: WorkerReplayFragment[]): DistributedReplayManifest => ({
    runId: 'test-run-123',
    strategy: 'single-worker',
    workerFragments: fragments,
    mergedAt: null,
  });

  it('throws when given 0 fragments', () => {
    const merger = new SingleWorkerReplayMerger();
    const manifest = createManifest([]);

    expect(() => merger.merge(manifest)).toThrow(
      'SingleWorkerReplayMerger requires exactly 1 fragment, got 0'
    );
  });

  it('throws when given 2 fragments', () => {
    const merger = new SingleWorkerReplayMerger();
    const fragment1 = createMockFragment('worker-1', [createMockEvent(1)]);
    const fragment2 = createMockFragment('worker-2', [createMockEvent(2)]);
    const manifest = createManifest([fragment1, fragment2]);

    expect(() => merger.merge(manifest)).toThrow(
      'SingleWorkerReplayMerger requires exactly 1 fragment, got 2'
    );
  });

  it('merge with 1 fragment returns ReplaySession with events sorted by seq', () => {
    const merger = new SingleWorkerReplayMerger();
    const events = [createMockEvent(3), createMockEvent(1), createMockEvent(2)];
    const fragment = createMockFragment('worker-1', events);
    const manifest = createManifest([fragment]);

    const session = merger.merge(manifest);

    expect(session.runId).toBe('test-run-123');
    expect(session.events).toHaveLength(3);
    expect(session.events[0].seq).toBe(1);
    expect(session.events[1].seq).toBe(2);
    expect(session.events[2].seq).toBe(3);
  });

  it('merge computes correct pass/fail/skip counts in stats', () => {
    const merger = new SingleWorkerReplayMerger();
    const events = [
      createMockEvent(1, 'request-sent'),
      {
        ...createMockEvent(2, 'assertion-evaluated'),
        assertion: { type: 'equals', passed: true },
      },
      {
        ...createMockEvent(3, 'assertion-evaluated'),
        assertion: { type: 'equals', passed: false },
      },
      {
        ...createMockEvent(4, 'assertion-evaluated'),
        assertion: { type: 'equals', passed: true },
      },
      createMockEvent(5, 'retry-triggered'),
      createMockEvent(6, 'failure-propagated'),
      { ...createMockEvent(7, 'teardown-executed'), isTeardown: true },
    ];
    const fragment = createMockFragment('worker-1', events);
    const manifest = createManifest([fragment]);

    const session = merger.merge(manifest);

    expect(session.stats.requestsSent).toBe(1);
    expect(session.stats.assertionsPassed).toBe(2);
    expect(session.stats.assertionsFailed).toBe(1);
    expect(session.stats.retriesTriggered).toBe(1);
    expect(session.stats.teardownEvents).toBe(1);
    expect(session.stats.failuresPropagated).toBe(1);
  });

  it('merge uses first event timestamp as startedAt and last as completedAt', () => {
    const merger = new SingleWorkerReplayMerger();
    const now = Date.now();
    const events = [
      { ...createMockEvent(1), timestamp: new Date(now).toISOString() },
      { ...createMockEvent(2), timestamp: new Date(now + 5000).toISOString() },
      { ...createMockEvent(3), timestamp: new Date(now + 10000).toISOString() },
    ];
    const fragment = createMockFragment('worker-1', events);
    const manifest = createManifest([fragment]);

    const session = merger.merge(manifest);

    // synthesizedAt is set from fragment.capturedAt
    expect(session.synthesizedAt).toBe(fragment.capturedAt);
    // events are sorted by seq
    expect(session.eventCount).toBe(3);
    expect(session._schemaVersion).toBe(1);
  });
});
