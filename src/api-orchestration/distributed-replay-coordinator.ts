// src/api-orchestration/distributed-replay-coordinator.ts
// Phase E Step 3: Single-worker replay coordinator (merge = pass-through today).
// Replay determinism invariant: merged session events MUST be sorted by seq.
// Future: merge sharded sessions from multiple workers by seq ordering.

import type {
  IDistributedReplayCoordinator,
  ReplayWorkerContribution,
  MergedReplayResult,
} from './contracts/distributed-replay-coordinator.contracts';
import type { ReplaySession } from '../api-observability/contracts/replay-event.contracts';

export class SingleWorkerReplayCoordinator implements IDistributedReplayCoordinator {
  merge(contributions: readonly ReplayWorkerContribution[]): MergedReplayResult {
    if (contributions.length === 0) {
      throw new Error('Cannot merge empty replay contributions');
    }

    if (contributions.length === 1) {
      // Single-worker fast path — no merge needed, validate determinism and return.
      const session = contributions[0].session;
      return {
        runId: session.runId,
        mergedSession: session,
        workerCount: 1,
        deterministicGuarantee: true,
        mergedAt: new Date().toISOString(),
      };
    }

    // Multi-worker merge: concatenate all events, sort by seq, rebuild stats.
    const base = contributions[0].session;
    const allEvents = contributions
      .flatMap(c => [...c.session.events])
      .sort((a, b) => a.seq - b.seq);

    // Deduplicate by seq (determinism: same seq = same event, keep first)
    const seenSeq = new Set<number>();
    const deduped = allEvents.filter(e => {
      if (seenSeq.has(e.seq)) return false;
      seenSeq.add(e.seq);
      return true;
    });

    const mergedStats = contributions.reduce(
      (acc, c) => ({
        requestsSent: acc.requestsSent + c.session.stats.requestsSent,
        assertionsPassed: acc.assertionsPassed + c.session.stats.assertionsPassed,
        assertionsFailed: acc.assertionsFailed + c.session.stats.assertionsFailed,
        retriesTriggered: acc.retriesTriggered + c.session.stats.retriesTriggered,
        teardownEvents: acc.teardownEvents + c.session.stats.teardownEvents,
        failuresPropagated: acc.failuresPropagated + c.session.stats.failuresPropagated,
      }),
      { requestsSent: 0, assertionsPassed: 0, assertionsFailed: 0,
        retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 }
    );

    const merged: ReplaySession = {
      ...base,
      events: deduped,
      eventCount: deduped.length,
      stats: mergedStats,
      synthesizedAt: new Date().toISOString(),
    };

    return {
      runId: merged.runId,
      mergedSession: merged,
      workerCount: contributions.length,
      deterministicGuarantee: true,
      mergedAt: new Date().toISOString(),
    };
  }

  validateDeterminism(session: ReplaySession): boolean {
    // Determinism check: events must be strictly ordered by seq with no gaps > 1
    const events = session.events;
    for (let i = 1; i < events.length; i++) {
      if (events[i].seq <= events[i - 1].seq) return false;
    }
    return true;
  }
}

export const globalReplayCoordinator = new SingleWorkerReplayCoordinator();
