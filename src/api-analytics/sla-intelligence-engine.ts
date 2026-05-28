// src/api-analytics/sla-intelligence-engine.ts
// Phase E Step 7: SLA intelligence — advisory scorecards, breach detection. Never auto-remediates.

import { randomUUID } from 'crypto';
import type {
  ISlaIntelligenceEngine,
  SlaPolicy,
  SlaBreachRecord,
  SlaScorecard,
} from './contracts/sla-intelligence.contracts';

export class SlaIntelligenceEngine implements ISlaIntelligenceEngine {
  private readonly _policies = new Map<string, SlaPolicy>();
  private readonly _breaches = new Map<string, SlaBreachRecord[]>();

  registerPolicy(policy: SlaPolicy): void {
    this._policies.set(policy.policyId, policy);
  }

  getPolicy(policyId: string): SlaPolicy | null {
    return this._policies.get(policyId) ?? null;
  }

  evaluate(
    collectionId: string,
    policyId: string,
    metrics: { avgLatencyMs: number; retryRate: number; passRate: number; teardownFailureRate: number },
  ): SlaScorecard {
    const policy = this._policies.get(policyId);
    const evaluatedAt = new Date().toISOString();
    const breaches: SlaBreachRecord[] = [];

    if (!policy) {
      return { collectionId, policyId, score: 100, breaches: [], healthy: true, evaluatedAt };
    }

    const check = (
      type: SlaBreachRecord['breachType'],
      observed: number,
      threshold: number,
      isOver: boolean,
    ) => {
      if (isOver) {
        const record: SlaBreachRecord = {
          breachId: randomUUID(),
          collectionId,
          policyId,
          breachType: type,
          observed,
          threshold,
          detectedAt: evaluatedAt,
          advisoryNote: `${type} breach: observed=${observed.toFixed(2)}, threshold=${threshold.toFixed(2)}. Advisory only.`,
        };
        breaches.push(record);
        const existing = this._breaches.get(collectionId) ?? [];
        existing.push(record);
        this._breaches.set(collectionId, existing);
      }
    };

    check('latency', metrics.avgLatencyMs, policy.maxLatencyMs, metrics.avgLatencyMs > policy.maxLatencyMs);
    check('retry-rate', metrics.retryRate, policy.maxRetryRate, metrics.retryRate > policy.maxRetryRate);
    check('pass-rate', metrics.passRate, policy.minPassRate, metrics.passRate < policy.minPassRate);
    check('teardown-failure', metrics.teardownFailureRate, policy.maxTeardownFailureRate, metrics.teardownFailureRate > policy.maxTeardownFailureRate);

    // Score: 100 minus 25 per breach type
    const score = Math.max(0, 100 - breaches.length * 25);

    return { collectionId, policyId, score, breaches, healthy: breaches.length === 0, evaluatedAt };
  }

  listBreaches(collectionId: string): SlaBreachRecord[] {
    return this._breaches.get(collectionId) ?? [];
  }
}

export const globalSlaIntelligenceEngine = new SlaIntelligenceEngine();

// Default SLA policy
globalSlaIntelligenceEngine.registerPolicy({
  policyId: 'default',
  maxLatencyMs: 30_000,
  maxRetryRate: 0.2,
  minPassRate: 0.8,
  maxTeardownFailureRate: 0.1,
});
