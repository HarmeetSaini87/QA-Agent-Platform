// src/api-performance/contracts/safeguard.contracts.ts
// Phase E Step 1: Performance safeguard threshold contracts — warnings only, no auto-throttling.

export type SafeguardSeverity = 'info' | 'warning' | 'critical';

export type SafeguardCode =
  | 'LARGE_GRAPH_NODE_COUNT'
  | 'RETRY_STORM_DETECTED'
  | 'POLLING_OVERLOAD'
  | 'REPLAY_EVENT_GROWTH'
  | 'MEMORY_PRESSURE'
  | 'PROJECTION_CACHE_MISS_RATE';

export interface SafeguardViolation {
  readonly code: SafeguardCode;
  readonly severity: SafeguardSeverity;
  readonly message: string;
  readonly measuredValue: number;
  readonly threshold: number;
  /** Advisory only — platform does NOT auto-throttle based on this. */
  readonly advisoryNote: string;
}

export interface SafeguardCheckResult {
  readonly checkedAt: string;
  readonly violations: readonly SafeguardViolation[];
  readonly healthy: boolean;
}

export interface SafeguardThresholds {
  readonly maxGraphNodeCountWarning: number;
  readonly maxGraphNodeCountCritical: number;
  readonly maxReplayEventsWarning: number;
  readonly maxReplayEventsCritical: number;
  readonly maxPollsPerMinuteWarning: number;
  readonly maxRetryRatePerMinuteWarning: number;
  readonly maxHeapUsedMbWarning: number;
  readonly projectionCacheMissRateWarningPct: number;
}
