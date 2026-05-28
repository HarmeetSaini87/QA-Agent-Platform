// src/api-cloud/resource-governance-registry.ts
// Phase E Step 6: Worker quota policies + tenant resource tracking. Advisory only.

import type {
  IResourceGovernanceRegistry,
  WorkerQuotaPolicy,
  TenantResourceUsage,
  ResourceBudgetCheck,
} from './contracts/resource-governance.contracts';

export class ResourceGovernanceRegistry implements IResourceGovernanceRegistry {
  private readonly _policies = new Map<string, WorkerQuotaPolicy>();
  private readonly _usage = new Map<string, TenantResourceUsage>();

  registerPolicy(policy: WorkerQuotaPolicy): void {
    this._policies.set(policy.policyId, policy);
  }

  getPolicy(policyId: string): WorkerQuotaPolicy | null {
    return this._policies.get(policyId) ?? null;
  }

  checkBudget(
    policyId: string,
    currentActiveRuns: number,
    currentQueueDepth: number,
  ): ResourceBudgetCheck {
    const policy = this._policies.get(policyId);
    const checkedAt = new Date().toISOString();

    if (!policy) {
      return {
        tenantId: undefined, withinBudget: true,
        activeRuns: currentActiveRuns, maxConcurrentRuns: Infinity,
        queueDepth: currentQueueDepth, maxQueueDepth: Infinity,
        advisoryNote: 'No quota policy registered — open budget.',
        checkedAt,
      };
    }

    const burstMax = Math.floor(policy.maxConcurrentRuns * (1 + policy.burstAllowancePercent / 100));
    const withinBudget = currentActiveRuns <= burstMax && currentQueueDepth <= policy.maxQueueDepth;

    return {
      tenantId: policy.tenantId,
      withinBudget,
      activeRuns: currentActiveRuns,
      maxConcurrentRuns: policy.maxConcurrentRuns,
      queueDepth: currentQueueDepth,
      maxQueueDepth: policy.maxQueueDepth,
      advisoryNote: withinBudget
        ? 'Within budget — execution permitted.'
        : `Budget advisory: active=${currentActiveRuns} (max=${burstMax}), queue=${currentQueueDepth} (max=${policy.maxQueueDepth}).`,
      checkedAt,
    };
  }

  recordUsage(usage: TenantResourceUsage): void {
    this._usage.set(usage.tenantId, usage);
  }

  getUsage(tenantId: string): TenantResourceUsage | null {
    return this._usage.get(tenantId) ?? null;
  }

  listPolicies(): WorkerQuotaPolicy[] {
    return Array.from(this._policies.values());
  }
}

export const globalResourceGovernanceRegistry = new ResourceGovernanceRegistry();

// Default quota policy
globalResourceGovernanceRegistry.registerPolicy({
  policyId: 'default',
  maxConcurrentRuns: 5,
  maxQueueDepth: 50,
  maxRetriesPerRun: 3,
  burstAllowancePercent: 20,
});
