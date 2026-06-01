// src/api-cloud/contracts/elastic-scaling.contracts.ts
// Phase E Step 6: Elastic scaling strategy contracts — advisory-only, no auto-scale nondeterminism.

export type ScalingDirection = 'scale-up' | 'scale-down' | 'hold';

export interface ScalingPolicy {
  readonly policyId: string;
  readonly tenantId?: string;
  readonly minWorkers: number;
  readonly maxWorkers: number;
  /** Queue depth threshold that triggers a scale-up advisory. */
  readonly scaleUpThreshold: number;
  /** Queue depth below which scale-down is advised. */
  readonly scaleDownThreshold: number;
  /** Max concurrent runs per worker before burst containment advisory. */
  readonly burstContainmentLimit: number;
}

export interface ScalingDecision {
  readonly policyId: string;
  readonly direction: ScalingDirection;
  readonly currentWorkers: number;
  readonly recommendedWorkers: number;
  readonly queueDepth: number;
  readonly reason: string;
  readonly advisoryNote: string;
  readonly decidedAt: string;
}

export interface IElasticScalingAdvisor {
  registerPolicy(policy: ScalingPolicy): void;
  getPolicy(policyId: string): ScalingPolicy | null;
  /** Advisory-only — returns scaling recommendation. Never triggers auto-scale. */
  advise(policyId: string, currentWorkers: number, queueDepth: number): ScalingDecision;
  listPolicies(): ScalingPolicy[];
}
