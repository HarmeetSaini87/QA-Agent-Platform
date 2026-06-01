// src/api-autonomous/adaptive-retry-intelligence.ts
// Phase E Step 11: Adaptive retry intelligence. Advisory recommendations only — never alters retry semantics.

import {
  AdaptiveRetryRecommendation,
  RetryAdaptationSignal,
  RetryStormContainmentAdvice,
  SlaAwareRetryGovernance,
  IAdaptiveRetryIntelligence,
} from './contracts/adaptive-retry.contracts';

const ADVISORY_NOTE = 'Recommendations are advisory only. Retry semantics are never altered automatically.';

const RETRY_STORM_THRESHOLD = 0.5;
const BACKOFF_INTERVAL_MULTIPLIER = 1.5;

export class AdaptiveRetryIntelligence implements IAdaptiveRetryIntelligence {
  recommendRetryAdaptations(
    collectionId: string,
    stepRetryStats: readonly { stepId: string; retryCount: number; avgDurationMs: number }[]
  ): AdaptiveRetryRecommendation[] {
    return stepRetryStats.map((stat) => {
      const signals: RetryAdaptationSignal[] = [];
      let recommendedMax = stat.retryCount;
      let recommendedInterval = 1000;

      if (stat.retryCount > 3) {
        signals.push('retry-storm-detected');
        recommendedMax = Math.max(1, Math.floor(stat.retryCount * 0.6));
      }
      if (stat.avgDurationMs > 5000) {
        signals.push('sla-breach-risk');
        recommendedInterval = Math.round(stat.avgDurationMs * BACKOFF_INTERVAL_MULTIPLIER);
      }

      const confidence = signals.length > 0 ? 75 : 60;
      return {
        stepId: stat.stepId,
        currentMaxRetries: stat.retryCount,
        recommendedMaxRetries: recommendedMax,
        currentIntervalMs: 1000,
        recommendedIntervalMs: recommendedInterval,
        signals,
        rationale: signals.length > 0
          ? `Detected: ${signals.join(', ')}. Adjusting retry parameters for ${collectionId}.`
          : `No anomalies detected for step ${stat.stepId}.`,
        confidence,
        advisoryNote: ADVISORY_NOTE,
      };
    });
  }

  adviseStormContainment(
    collectionId: string,
    retryRateByStep: Record<string, number>
  ): RetryStormContainmentAdvice {
    const stormSteps = Object.entries(retryRateByStep)
      .filter(([, rate]) => rate >= RETRY_STORM_THRESHOLD)
      .map(([stepId]) => stepId);

    const stormDetected = stormSteps.length > 0;
    const maxRate = stormSteps.length > 0
      ? Math.max(...stormSteps.map((s) => retryRateByStep[s]))
      : 0;

    const containmentAction = !stormDetected
      ? 'none'
      : maxRate > 0.8 ? 'isolate-step'
      : maxRate > 0.6 ? 'reduce-retries'
      : 'add-backoff';

    return {
      collectionId,
      stormDetected,
      affectedStepIds: stormSteps,
      containmentAction,
      recommendedGlobalMaxRetries: stormDetected ? 2 : undefined,
      advisoryNote: ADVISORY_NOTE,
    };
  }

  governSlaRetries(
    collectionId: string,
    slaMetric: string,
    slaThreshold: number,
    currentRetryBudgetMs: number
  ): SlaAwareRetryGovernance {
    const safeRetryBudget = Math.floor(slaThreshold * 0.3);
    const breachRisk = currentRetryBudgetMs > safeRetryBudget
      ? Math.min(1, (currentRetryBudgetMs - safeRetryBudget) / slaThreshold)
      : 0;

    return {
      collectionId,
      slaMetric,
      slaThreshold,
      currentRetryBudgetMs,
      recommendedRetryBudgetMs: safeRetryBudget,
      breachRisk,
      advisoryNote: ADVISORY_NOTE,
    };
  }
}

export const globalAdaptiveRetryIntelligence = new AdaptiveRetryIntelligence();
