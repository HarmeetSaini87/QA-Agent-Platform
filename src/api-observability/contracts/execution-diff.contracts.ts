// src/api-observability/contracts/execution-diff.contracts.ts
// Spec req F: execution diff foundation contracts.
// ADVISORY ONLY — no diff engine implemented yet.

export interface RunDiffRequest {
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly collectionId: string;
  readonly stepIds?: string[];
  readonly includeLatencyDrift: boolean;
  readonly includeBodyDiff: boolean;
}

export type StepDiffKind =
  | 'status-changed'
  | 'latency-drift'
  | 'retry-count-changed'
  | 'assertion-drift'
  | 'error-changed'
  | 'new-step'
  | 'removed-step';

export interface StepDiff {
  readonly stepId: string;
  readonly stepName: string;
  readonly kind: StepDiffKind;
  readonly baseline?: {
    readonly status: string;
    readonly durationMs: number;
    readonly retryCount: number;
    readonly error?: string;
  };
  readonly candidate?: {
    readonly status: string;
    readonly durationMs: number;
    readonly retryCount: number;
    readonly error?: string;
  };
  readonly latencyDriftMs?: number;
  readonly latencyDriftPercent?: number;
}

export interface RunDiffSummary {
  readonly request: RunDiffRequest;
  readonly computedAt: string;
  readonly baselineStatus: string;
  readonly candidateStatus: string;
  readonly stepDiffs: readonly StepDiff[];
  readonly statusChanged: boolean;
  readonly regressedStepIds: string[];
  readonly improvedStepIds: string[];
  readonly bodyDiffs: readonly never[];
}
