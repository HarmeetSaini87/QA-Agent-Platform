// src/api-analytics/contracts/execution-trends.contracts.ts
// Phase E Step 7: Execution trend contracts — observational only, never alters execution.

export interface TrendSample {
  readonly collectionId: string;
  readonly runId: string;
  readonly sampledAt: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly totalSteps: number;
  readonly durationMs: number;
  readonly retriesTriggered: number;
  readonly teardownEvents: number;
  readonly tenantId?: string;
}

export interface ExecutionTrendWindow {
  readonly collectionId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly sampleCount: number;
  readonly avgPassRate: number;
  readonly avgFailRate: number;
  readonly avgRetryRate: number;
  readonly avgDurationMs: number;
  readonly p95DurationMs: number;
  readonly totalRuns: number;
  readonly flakinessScore: number;
}

export interface IExecutionTrendAggregator {
  record(sample: TrendSample): void;
  aggregate(collectionId: string, windowMs?: number): ExecutionTrendWindow | null;
  listCollectionIds(): string[];
  /** Remove samples older than retentionMs. */
  evict(retentionMs: number): number;
}
