// src/api-analytics/contracts/rca-analytics.contracts.ts
// Phase E Step 7: Replay-driven RCA analytics — failure trends, retry hotspots, env drift.

export interface FailureTrend {
  readonly stepId: string;
  readonly stepName: string;
  readonly collectionId: string;
  readonly failureCount: number;
  readonly retryCount: number;
  readonly lastFailedAt: string;
  readonly recurrencePattern: 'isolated' | 'periodic' | 'escalating' | 'stable';
  readonly dependencyInstabilityScore: number;   // 0–100
}

export interface RetryHotspot {
  readonly stepId: string;
  readonly collectionId: string;
  readonly retryRate: number;    // fraction of runs where this step retried
  readonly avgRetriesPerRun: number;
  readonly isRetryStorm: boolean;
  readonly advisoryNote: string;
}

export interface TeardownInstabilityRecord {
  readonly stepId: string;
  readonly collectionId: string;
  readonly teardownFailureRate: number;
  readonly lastInstabilityAt: string;
  readonly advisoryNote: string;
}

export interface IRcaAnalyticsEngine {
  /** Compute failure trends from a sequence of step outcomes. */
  computeFailureTrends(
    collectionId: string,
    stepOutcomes: Array<{ stepId: string; stepName: string; failed: boolean; retries: number; timestamp: string }>,
  ): FailureTrend[];
  /** Identify retry hotspots (steps retrying at abnormal rates). */
  identifyRetryHotspots(
    collectionId: string,
    stepRetries: Array<{ stepId: string; retriesInWindow: number; runsInWindow: number }>,
    retryStormThreshold?: number,
  ): RetryHotspot[];
  /** Identify unstable teardown steps. */
  identifyTeardownInstability(
    collectionId: string,
    teardownOutcomes: Array<{ stepId: string; failed: boolean; timestamp: string }>,
  ): TeardownInstabilityRecord[];
}
