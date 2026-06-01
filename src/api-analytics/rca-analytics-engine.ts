// src/api-analytics/rca-analytics-engine.ts
// Phase E Step 7: Replay-driven RCA analytics — pure functions, observational only.

import type {
  IRcaAnalyticsEngine,
  FailureTrend,
  RetryHotspot,
  TeardownInstabilityRecord,
} from './contracts/rca-analytics.contracts';

const DEFAULT_RETRY_STORM_THRESHOLD = 0.5;

export class RcaAnalyticsEngine implements IRcaAnalyticsEngine {
  computeFailureTrends(
    collectionId: string,
    stepOutcomes: Array<{ stepId: string; stepName: string; failed: boolean; retries: number; timestamp: string }>,
  ): FailureTrend[] {
    // Group by stepId
    const byStep = new Map<string, typeof stepOutcomes>();
    for (const o of stepOutcomes) {
      const list = byStep.get(o.stepId) ?? [];
      list.push(o);
      byStep.set(o.stepId, list);
    }

    const trends: FailureTrend[] = [];
    for (const [stepId, outcomes] of byStep) {
      const failures = outcomes.filter(o => o.failed);
      if (failures.length === 0) continue;

      const retryCount = outcomes.reduce((a, o) => a + o.retries, 0);
      const failureCount = failures.length;
      const failureRate = failureCount / outcomes.length;

      // Pattern classification
      let recurrencePattern: FailureTrend['recurrencePattern'] = 'isolated';
      if (failureRate > 0.7) recurrencePattern = 'escalating';
      else if (failureRate > 0.3) recurrencePattern = 'periodic';
      else if (failureRate > 0) recurrencePattern = 'stable';

      const sorted = failures.map(f => f.timestamp).sort();
      const lastFailedAt = sorted[sorted.length - 1];
      const dependencyInstabilityScore = Math.min(100, Math.round(failureRate * 100 + (retryCount / outcomes.length) * 20));

      trends.push({
        stepId,
        stepName: outcomes[0].stepName,
        collectionId,
        failureCount,
        retryCount,
        lastFailedAt,
        recurrencePattern,
        dependencyInstabilityScore,
      });
    }

    return trends.sort((a, b) => b.dependencyInstabilityScore - a.dependencyInstabilityScore);
  }

  identifyRetryHotspots(
    collectionId: string,
    stepRetries: Array<{ stepId: string; retriesInWindow: number; runsInWindow: number }>,
    retryStormThreshold = DEFAULT_RETRY_STORM_THRESHOLD,
  ): RetryHotspot[] {
    return stepRetries
      .filter(s => s.runsInWindow > 0)
      .map(s => {
        const retryRate = s.retriesInWindow / s.runsInWindow;
        const avgRetriesPerRun = s.retriesInWindow / s.runsInWindow;
        const isRetryStorm = retryRate >= retryStormThreshold;
        return {
          stepId: s.stepId,
          collectionId,
          retryRate,
          avgRetriesPerRun,
          isRetryStorm,
          advisoryNote: isRetryStorm
            ? `Retry storm detected on step "${s.stepId}" (rate=${retryRate.toFixed(2)}). Advisory only.`
            : `Elevated retry rate on step "${s.stepId}" (rate=${retryRate.toFixed(2)}).`,
        };
      })
      .filter(h => h.retryRate > 0)
      .sort((a, b) => b.retryRate - a.retryRate);
  }

  identifyTeardownInstability(
    collectionId: string,
    teardownOutcomes: Array<{ stepId: string; failed: boolean; timestamp: string }>,
  ): TeardownInstabilityRecord[] {
    const byStep = new Map<string, typeof teardownOutcomes>();
    for (const o of teardownOutcomes) {
      const list = byStep.get(o.stepId) ?? [];
      list.push(o);
      byStep.set(o.stepId, list);
    }

    const records: TeardownInstabilityRecord[] = [];
    for (const [stepId, outcomes] of byStep) {
      const failures = outcomes.filter(o => o.failed);
      const rate = failures.length / outcomes.length;
      if (rate === 0) continue;

      const sorted = failures.map(f => f.timestamp).sort();
      records.push({
        stepId,
        collectionId,
        teardownFailureRate: rate,
        lastInstabilityAt: sorted[sorted.length - 1],
        advisoryNote: `Teardown step "${stepId}" failing at rate=${rate.toFixed(2)}. Advisory only.`,
      });
    }

    return records.sort((a, b) => b.teardownFailureRate - a.teardownFailureRate);
  }
}

export const globalRcaAnalyticsEngine = new RcaAnalyticsEngine();
