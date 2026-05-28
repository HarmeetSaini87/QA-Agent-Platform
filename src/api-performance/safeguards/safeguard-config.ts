// src/api-performance/safeguards/safeguard-config.ts
// Phase E Step 1: Default performance thresholds. All advisory — no auto-throttling.

import type { SafeguardThresholds } from '../contracts/safeguard.contracts';

export const DEFAULT_SAFEGUARD_THRESHOLDS: SafeguardThresholds = {
  maxGraphNodeCountWarning: 200,
  maxGraphNodeCountCritical: 500,
  maxReplayEventsWarning: 5_000,
  maxReplayEventsCritical: 20_000,
  maxPollsPerMinuteWarning: 120,
  maxRetryRatePerMinuteWarning: 60,
  maxHeapUsedMbWarning: 512,
  projectionCacheMissRateWarningPct: 80,
};
