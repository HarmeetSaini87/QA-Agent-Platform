// src/api-autonomous/contracts/adaptive-retry.contracts.ts
// Phase E Step 11: Adaptive retry intelligence contracts. Advisory recommendations — never alters retry semantics.

export type RetryAdaptationSignal =
  | 'retry-storm-detected'
  | 'sla-breach-risk'
  | 'dependency-cascade'
  | 'environment-instability'
  | 'flakiness-pattern';

export interface AdaptiveRetryRecommendation {
  readonly stepId: string;
  readonly currentMaxRetries: number;
  readonly recommendedMaxRetries: number;
  readonly currentIntervalMs: number;
  readonly recommendedIntervalMs: number;
  readonly signals: readonly RetryAdaptationSignal[];
  readonly rationale: string;
  readonly confidence: number;         // 0–100
  readonly advisoryNote: string;
}

export interface RetryStormContainmentAdvice {
  readonly collectionId: string;
  readonly stormDetected: boolean;
  readonly affectedStepIds: readonly string[];
  readonly containmentAction: 'reduce-retries' | 'add-backoff' | 'isolate-step' | 'none';
  readonly recommendedGlobalMaxRetries?: number;
  readonly advisoryNote: string;
}

export interface SlaAwareRetryGovernance {
  readonly collectionId: string;
  readonly slaMetric: string;
  readonly slaThreshold: number;
  readonly currentRetryBudgetMs: number;
  readonly recommendedRetryBudgetMs: number;
  readonly breachRisk: number;         // 0–1
  readonly advisoryNote: string;
}

export interface IAdaptiveRetryIntelligence {
  /** Returns per-step retry recommendations. Never modifies runtime retry config. */
  recommendRetryAdaptations(
    collectionId: string,
    stepRetryStats: readonly { stepId: string; retryCount: number; avgDurationMs: number }[]
  ): AdaptiveRetryRecommendation[];
  adviseStormContainment(collectionId: string, retryRateByStep: Record<string, number>): RetryStormContainmentAdvice;
  governSlaRetries(collectionId: string, slaMetric: string, slaThreshold: number, currentRetryBudgetMs: number): SlaAwareRetryGovernance;
}
