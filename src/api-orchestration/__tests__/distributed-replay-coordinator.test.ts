// src/api-orchestration/__tests__/distributed-replay-coordinator.test.ts
import { describe, it, expect } from 'vitest';
import { SingleWorkerReplayCoordinator } from '../distributed-replay-coordinator';
import type { ReplaySession, ReplayEvent } from '../../api-observability/contracts/replay-event.contracts';

function makeEvent(seq: number, stepId: string): ReplayEvent {
  return { seq, kind: 'step-completed', stepId, stepName: `Step ${stepId}`, timestamp: new Date().toISOString() };
}

function makeSession(runId: string, events: ReplayEvent[]): ReplaySession {
  return {
    runId, collectionId: 'col-1', synthesizedAt: new Date().toISOString(), _schemaVersion: 1,
    events, eventCount: events.length,
    stats: { requestsSent: 1, assertionsPassed: 1, assertionsFailed: 0, retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 },
  };
}

describe('SingleWorkerReplayCoordinator', () => {
  const coordinator = new SingleWorkerReplayCoordinator();

  it('single contribution: passthrough with deterministicGuarantee=true', () => {
    const session = makeSession('r1', [makeEvent(1, 's1'), makeEvent(2, 's2')]);
    const result = coordinator.merge([{ workerId: 'w1', runId: 'r1', session, shardIndex: 0, totalShards: 1 }]);
    expect(result.deterministicGuarantee).toBe(true);
    expect(result.mergedSession.eventCount).toBe(2);
    expect(result.workerCount).toBe(1);
  });

  it('multi-contribution: merges events sorted by seq', () => {
    const s1 = makeSession('r1', [makeEvent(1, 'a'), makeEvent(3, 'c')]);
    const s2 = makeSession('r1', [makeEvent(2, 'b'), makeEvent(4, 'd')]);
    const result = coordinator.merge([
      { workerId: 'w1', runId: 'r1', session: s1, shardIndex: 0, totalShards: 2 },
      { workerId: 'w2', runId: 'r1', session: s2, shardIndex: 1, totalShards: 2 },
    ]);
    expect(result.mergedSession.eventCount).toBe(4);
    expect(result.mergedSession.events[0].seq).toBe(1);
    expect(result.mergedSession.events[3].seq).toBe(4);
  });

  it('deduplication: duplicate seq is kept once', () => {
    const s1 = makeSession('r1', [makeEvent(1, 'a'), makeEvent(2, 'b')]);
    const s2 = makeSession('r1', [makeEvent(2, 'b'), makeEvent(3, 'c')]);
    const result = coordinator.merge([
      { workerId: 'w1', runId: 'r1', session: s1, shardIndex: 0, totalShards: 2 },
      { workerId: 'w2', runId: 'r1', session: s2, shardIndex: 1, totalShards: 2 },
    ]);
    expect(result.mergedSession.eventCount).toBe(3);
  });

  it('validateDeterminism: true for strictly ascending seq', () => {
    const session = makeSession('r1', [makeEvent(1, 'a'), makeEvent(2, 'b'), makeEvent(3, 'c')]);
    expect(coordinator.validateDeterminism(session)).toBe(true);
  });

  it('validateDeterminism: false for out-of-order seq', () => {
    const session = makeSession('r1', [makeEvent(1, 'a'), makeEvent(3, 'c'), makeEvent(2, 'b')]);
    expect(coordinator.validateDeterminism(session)).toBe(false);
  });

  it('throws on empty contributions', () => {
    expect(() => coordinator.merge([])).toThrow();
  });
});
