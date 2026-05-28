// src/api-performance/profiling/replay-profiler.ts
// Phase E Step 1: Replay event generation cost measurement.
// Observational — wraps synthesis calls only, never alters replay content.

import type { ReplaySession } from '../../api-observability/contracts/replay-event.contracts';
import { withProfilingSync } from './execution-profiler';

export function profiledReplaySynthesis(
  runId: string,
  synthesizeFn: () => ReplaySession
): ReplaySession {
  return withProfilingSync(
    'replay-synthesis',
    `synthesize:${runId}`,
    synthesizeFn,
    { runId }
  );
}

export interface ReplayGenerationCostReport {
  readonly runId: string;
  readonly eventCount: number;
  readonly retriesTriggered: number;
  readonly durationMs: number;
  readonly eventsPerMs: number;
}

export function buildReplayCostReport(
  runId: string,
  session: ReplaySession,
  durationMs: number
): ReplayGenerationCostReport {
  return {
    runId,
    eventCount: session.eventCount,
    retriesTriggered: session.stats.retriesTriggered,
    durationMs,
    eventsPerMs: durationMs > 0 ? Math.round(session.eventCount / durationMs * 100) / 100 : 0,
  };
}
