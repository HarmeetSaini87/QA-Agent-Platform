// src/api-flakiness/contracts/flakiness.contracts.ts

export type FailureCategory =
  | 'assertion'
  | 'http_status'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'dependency_propagation'
  | 'unknown';

export interface FailureSignature {
  /** Normalized identifier — used as cluster key */
  readonly signatureKey: string;
  readonly category: FailureCategory;
  /** HTTP status if available */
  readonly httpStatus?: number;
  /** Normalized assertion field path e.g. "body.id" */
  readonly assertionField?: string;
  readonly assertionOperator?: string;
  /** Transport error class e.g. "ECONNREFUSED", "ETIMEDOUT" */
  readonly transportError?: string;
  /** Step that caused propagation failure (if category=dependency_propagation) */
  readonly propagatedFromStepId?: string;
}

export interface RetryStats {
  readonly retryCount: number;
  readonly maxRetryAttempt: number;
  /** Average duration across all attempts (ms) */
  readonly avgAttemptDurationMs: number;
  /** Did the final attempt pass after retries? */
  readonly recoveredAfterRetry: boolean;
}

export interface StepFlakinessRecord {
  readonly stepId: string;
  readonly stepName: string;
  readonly collectionId: string;
  /** Total runs observed (all statuses) */
  readonly totalRuns: number;
  readonly failedRuns: number;
  readonly passedRuns: number;
  readonly skippedRuns: number;
  /** 0.0–1.0 */
  readonly failRate: number;
  /** 0.0–1.0 — how often runs alternate pass/fail (instability signal) */
  readonly alternationIndex: number;
  /** Composite instability score: 0.7*failRate + 0.3*alternationIndex */
  readonly flakinessScore: number;
  readonly isFlaky: boolean;
  /** Threshold used to decide isFlaky */
  readonly flakinessThreshold: number;
  readonly retryStats: RetryStats;
  /** Dominant failure signature across all failed runs */
  readonly dominantSignature?: FailureSignature;
  /** All unique signatures seen */
  readonly signatures: readonly FailureSignature[];
  readonly lastFailedAt?: string;
  readonly lastPassedAt?: string;
  readonly computedAt: string;
}

export type ClusterDimension =
  | 'endpoint'
  | 'http_status'
  | 'assertion_type'
  | 'transport_error'
  | 'dependency_chain';

export interface ClusterGroup {
  readonly clusterId: string;       // `${dimension}:${key}`
  readonly dimension: ClusterDimension;
  readonly dimensionKey: string;    // e.g. "GET /api/users", "404", "body.id eq"
  readonly stepIds: readonly string[];
  readonly stepNames: readonly string[];
  readonly totalFailures: number;
  readonly avgFlakinessScore: number;
}

export interface CollectionFlakinessReport {
  readonly collectionId: string;
  readonly computedAt: string;
  readonly runsAnalyzed: number;
  readonly stepRecords: readonly StepFlakinessRecord[];
  readonly clusters: readonly ClusterGroup[];
  /** Steps with flakinessScore >= threshold, sorted descending */
  readonly hotspots: readonly string[];
  /** Collection-level stability: 1 - avgFailRate across all steps */
  readonly stabilityScore: number;
}
