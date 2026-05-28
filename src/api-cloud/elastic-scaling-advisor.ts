// src/api-cloud/elastic-scaling-advisor.ts
// Phase E Step 6: Advisory-only scaling recommendations. Never triggers auto-scale.

import type {
  IElasticScalingAdvisor,
  ScalingPolicy,
  ScalingDecision,
} from './contracts/elastic-scaling.contracts';

const ADVISORY = 'Advisory only — scaling decisions require explicit operator action. No auto-scale.';

export class ElasticScalingAdvisor implements IElasticScalingAdvisor {
  private readonly _policies = new Map<string, ScalingPolicy>();

  registerPolicy(policy: ScalingPolicy): void {
    this._policies.set(policy.policyId, policy);
  }

  getPolicy(policyId: string): ScalingPolicy | null {
    return this._policies.get(policyId) ?? null;
  }

  advise(policyId: string, currentWorkers: number, queueDepth: number): ScalingDecision {
    const policy = this._policies.get(policyId);
    const decidedAt = new Date().toISOString();

    if (!policy) {
      return {
        policyId, direction: 'hold', currentWorkers,
        recommendedWorkers: currentWorkers, queueDepth,
        reason: 'no-policy-registered',
        advisoryNote: ADVISORY, decidedAt,
      };
    }

    let direction: ScalingDecision['direction'] = 'hold';
    let recommendedWorkers = currentWorkers;
    let reason = 'within-threshold';

    if (queueDepth >= policy.scaleUpThreshold && currentWorkers < policy.maxWorkers) {
      direction = 'scale-up';
      recommendedWorkers = Math.min(currentWorkers + 1, policy.maxWorkers);
      reason = `queue depth ${queueDepth} ≥ scale-up threshold ${policy.scaleUpThreshold}`;
    } else if (queueDepth <= policy.scaleDownThreshold && currentWorkers > policy.minWorkers) {
      direction = 'scale-down';
      recommendedWorkers = Math.max(currentWorkers - 1, policy.minWorkers);
      reason = `queue depth ${queueDepth} ≤ scale-down threshold ${policy.scaleDownThreshold}`;
    }

    return { policyId, direction, currentWorkers, recommendedWorkers, queueDepth, reason, advisoryNote: ADVISORY, decidedAt };
  }

  listPolicies(): ScalingPolicy[] {
    return Array.from(this._policies.values());
  }
}

export const globalElasticScalingAdvisor = new ElasticScalingAdvisor();

// Default policy
globalElasticScalingAdvisor.registerPolicy({
  policyId: 'default',
  minWorkers: 1,
  maxWorkers: 10,
  scaleUpThreshold: 5,
  scaleDownThreshold: 1,
  burstContainmentLimit: 3,
});
