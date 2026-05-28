// src/api-performance/optimization/event-compactor.ts
// Phase E Step 1: Replay event compaction for large execution histories.
// View-only — returns compacted copy. Never mutates stored ReplaySession.
// Replay determinism preserved: terminal events (step-completed, failure-propagated) never folded.

import type { ReplayEvent, ReplaySession } from '../../api-observability/contracts/replay-event.contracts';
import type { CompactionConfig, CompactedEventSummary, CompactionResult } from '../contracts/compaction.contracts';

export type CompactedEvent = ReplayEvent | CompactedEventSummary;

export interface CompactedReplayView {
  readonly runId: string;
  readonly collectionId: string;
  readonly originalEventCount: number;
  readonly events: readonly CompactedEvent[];
  readonly compactionResult: CompactionResult;
}

const TERMINAL_KINDS = new Set(['step-completed', 'failure-propagated', 'step-skipped']);

const DEFAULT_CONFIG: CompactionConfig = {
  strategy: 'retry-fold',
  foldThreshold: 10,
  preserveTerminalEvents: true,
};

export function compactReplaySession(
  session: ReplaySession,
  config: CompactionConfig = DEFAULT_CONFIG
): CompactedReplayView {
  if (config.strategy === 'none') {
    return {
      runId: session.runId,
      collectionId: session.collectionId,
      originalEventCount: session.eventCount,
      events: session.events,
      compactionResult: {
        strategy: 'none',
        originalEventCount: session.eventCount,
        compactedEventCount: session.eventCount,
        foldedGroups: 0,
        compressionRatio: 1,
        deterministicGuarantee: true,
      },
    };
  }

  const compacted: CompactedEvent[] = [];
  let foldedGroups = 0;

  let i = 0;
  while (i < session.events.length) {
    const event = session.events[i];

    if (
      config.preserveTerminalEvents && TERMINAL_KINDS.has(event.kind)
    ) {
      compacted.push(event);
      i++;
      continue;
    }

    // Try to fold consecutive same-kind + same-stepId events
    const foldable = _collectFoldGroup(session.events, i, event.kind, event.stepId, config.foldThreshold);
    if (foldable.length >= 3) {
      compacted.push(_foldGroup(event.kind, foldable));
      foldedGroups++;
      i += foldable.length;
    } else {
      compacted.push(event);
      i++;
    }
  }

  const compactedCount = compacted.length;

  return {
    runId: session.runId,
    collectionId: session.collectionId,
    originalEventCount: session.eventCount,
    events: compacted,
    compactionResult: {
      strategy: config.strategy,
      originalEventCount: session.eventCount,
      compactedEventCount: compactedCount,
      foldedGroups,
      compressionRatio: session.eventCount > 0
        ? Math.round((compactedCount / session.eventCount) * 100) / 100
        : 1,
      deterministicGuarantee: true,
    },
  };
}

function _collectFoldGroup(
  events: readonly ReplayEvent[],
  startIdx: number,
  kind: string,
  stepId: string,
  maxCount: number
): readonly ReplayEvent[] {
  const group: ReplayEvent[] = [];
  let j = startIdx;
  while (
    j < events.length &&
    events[j].kind === kind &&
    events[j].stepId === stepId &&
    group.length < maxCount
  ) {
    group.push(events[j]);
    j++;
  }
  return group;
}

function _foldGroup(
  originalKind: string,
  group: readonly ReplayEvent[]
): CompactedEventSummary {
  const first = group[0];
  const last = group[group.length - 1];
  const totalDurationMs = group.reduce((acc, e) => acc + (e.durationMs ?? 0), 0);

  return {
    kind: 'compacted-summary',
    originalKind,
    stepId: first.stepId,
    stepName: first.stepName,
    foldedCount: group.length,
    firstTimestamp: first.timestamp,
    lastTimestamp: last.timestamp,
    totalDurationMs: totalDurationMs > 0 ? totalDurationMs : undefined,
  };
}
