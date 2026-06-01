// src/api-performance/index.ts
// Phase E Step 1: Public API for the performance hardening module.

export type { ProfilingSpan, ProfilingSnapshot, PhaseStats, ProfilingPhase } from './contracts/profiling.contracts';
export type { CompactionConfig, CompactedEventSummary, CompactionResult } from './contracts/compaction.contracts';
export type { SafeguardViolation, SafeguardCheckResult, SafeguardThresholds, SafeguardCode } from './contracts/safeguard.contracts';
export type {
  IWebSocketOverlayChannel,
  IAdaptivePoller,
  ICloudTelemetryEmitter,
  IShardCache,
  IReplayArchiver,
  IDistributedReplayIndex,
} from './contracts/scalability-hooks.contracts';

export { globalProfilerRegistry } from './profiling/profiler-registry';
export { withProfilingSync, withProfilingAsync, recordSpan } from './profiling/execution-profiler';
export { profiledReplaySynthesis, buildReplayCostReport } from './profiling/replay-profiler';

export { globalProjectionCache } from './optimization/graph-projection-cache';
export { diffOverlays } from './optimization/overlay-differ';
export { compactReplaySession } from './optimization/event-compactor';

export { globalPerformanceSafeguards, PerformanceSafeguards } from './safeguards/performance-safeguards';
export { DEFAULT_SAFEGUARD_THRESHOLDS } from './safeguards/safeguard-config';

export { globalScalabilityRegistry } from './scalability/extension-registry';

export { registerPerformanceRoutes } from './routes/performance.routes';
