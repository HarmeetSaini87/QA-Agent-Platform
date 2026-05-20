// src/api-observability/contracts/distributed-replay.contracts.ts
// Phase D Step 12 — Distributed replay compatibility contracts.
// Forward-compatible: today only single-worker merge is implemented.
// All types are JSON-serialisable (IPC-ready).

import type { ReplayEvent, ReplaySession } from './replay-event.contracts';

export interface WorkerReplayFragment {
  readonly workerId: string;
  readonly runId: string;
  readonly events: readonly ReplayEvent[];
  readonly capturedAt: string;  // ISO-8601
}

export type ReplayMergeStrategy = 'single-worker' | 'multi-worker-sequential' | 'multi-worker-parallel';

export interface DistributedReplayManifest {
  readonly runId: string;
  readonly strategy: ReplayMergeStrategy;
  readonly workerFragments: readonly WorkerReplayFragment[];
  readonly mergedAt: string | null;   // null until merge is complete
}

export interface IReplayMergeEngine {
  readonly engineName: string;
  merge(manifest: DistributedReplayManifest): ReplaySession;
}

export class SingleWorkerReplayMerger implements IReplayMergeEngine {
  readonly engineName = 'single-worker';

  merge(manifest: DistributedReplayManifest): ReplaySession {
    if (manifest.workerFragments.length !== 1) {
      throw new Error(
        `SingleWorkerReplayMerger requires exactly 1 fragment, got ${manifest.workerFragments.length}`
      );
    }

    const fragment = manifest.workerFragments[0];
    const sortedEvents = [...fragment.events].sort((a, b) => a.seq - b.seq);

    // Count events by type for stats calculation
    const requestsSentCount = sortedEvents.filter(e => e.kind === 'request-sent').length;
    const assertionsPassedCount = sortedEvents.filter(
      e => e.kind === 'assertion-evaluated' && e.assertion?.passed === true
    ).length;
    const assertionsFailedCount = sortedEvents.filter(
      e => e.kind === 'assertion-evaluated' && e.assertion?.passed === false
    ).length;
    const retriesTriggeredCount = sortedEvents.filter(e => e.kind === 'retry-triggered').length;
    const teardownEventsCount = sortedEvents.filter(e => e.isTeardown === true).length;
    const failuresPropagatedCount = sortedEvents.filter(e => e.kind === 'failure-propagated').length;

    return {
      runId: manifest.runId,
      collectionId: fragment.events[0]?.stepId ?? '',
      synthesizedAt: fragment.capturedAt,
      _schemaVersion: 1,
      events: sortedEvents,
      eventCount: sortedEvents.length,
      stats: {
        requestsSent: requestsSentCount,
        assertionsPassed: assertionsPassedCount,
        assertionsFailed: assertionsFailedCount,
        retriesTriggered: retriesTriggeredCount,
        teardownEvents: teardownEventsCount,
        failuresPropagated: failuresPropagatedCount,
      },
    };
  }
}
