// src/api-performance/__tests__/event-compactor.test.ts
import { describe, it, expect } from 'vitest';
import { compactReplaySession } from '../optimization/event-compactor';
import type { ReplaySession, ReplayEvent } from '../../api-observability/contracts/replay-event.contracts';

function makeEvent(seq: number, kind: ReplayEvent['kind'], stepId: string): ReplayEvent {
  return { seq, kind, stepId, stepName: `Step ${stepId}`, timestamp: new Date().toISOString() };
}

function makeSession(events: ReplayEvent[]): ReplaySession {
  return {
    runId: 'run-1',
    collectionId: 'col-1',
    synthesizedAt: new Date().toISOString(),
    _schemaVersion: 1,
    events,
    eventCount: events.length,
    stats: { requestsSent: 0, assertionsPassed: 0, assertionsFailed: 0, retriesTriggered: events.filter(e => e.kind === 'retry-triggered').length, teardownEvents: 0, failuresPropagated: 0 },
  };
}

describe('compactReplaySession', () => {
  it('strategy=none: returns events unchanged', () => {
    const events = [makeEvent(1, 'retry-triggered', 's1'), makeEvent(2, 'retry-triggered', 's1')];
    const session = makeSession(events);
    const result = compactReplaySession(session, { strategy: 'none', foldThreshold: 10, preserveTerminalEvents: true });
    expect(result.events).toHaveLength(2);
    expect(result.compactionResult.deterministicGuarantee).toBe(true);
  });

  it('folds ≥3 consecutive same-kind same-stepId events', () => {
    const events = Array.from({ length: 5 }, (_, i) => makeEvent(i + 1, 'retry-triggered', 's1'));
    const session = makeSession(events);
    const result = compactReplaySession(session);
    expect(result.events).toHaveLength(1);
    const summary = result.events[0] as { kind: string; foldedCount: number };
    expect(summary.kind).toBe('compacted-summary');
    expect(summary.foldedCount).toBe(5);
  });

  it('does not fold fewer than 3 events', () => {
    const events = [makeEvent(1, 'retry-triggered', 's1'), makeEvent(2, 'retry-triggered', 's1')];
    const session = makeSession(events);
    const result = compactReplaySession(session);
    expect(result.events).toHaveLength(2);
    expect(result.compactionResult.foldedGroups).toBe(0);
  });

  it('terminal events (step-completed) are never folded', () => {
    const events = [
      makeEvent(1, 'step-completed', 's1'),
      makeEvent(2, 'step-completed', 's1'),
      makeEvent(3, 'step-completed', 's1'),
      makeEvent(4, 'step-completed', 's1'),
    ];
    const session = makeSession(events);
    const result = compactReplaySession(session, { strategy: 'retry-fold', foldThreshold: 10, preserveTerminalEvents: true });
    expect(result.events).toHaveLength(4);
  });

  it('compressionRatio is accurate', () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(i + 1, 'retry-triggered', 's1'));
    const session = makeSession(events);
    const result = compactReplaySession(session);
    expect(result.compactionResult.originalEventCount).toBe(10);
    expect(result.compactionResult.compactedEventCount).toBe(1);
    expect(result.compactionResult.compressionRatio).toBe(0.1);
  });
});
