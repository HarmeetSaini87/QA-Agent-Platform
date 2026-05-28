// src/api-autonomous/autonomous-governance-registry.ts
// Phase E Step 11: Governance registry for autonomous operations policy enforcement.

import {
  AutonomyPolicy,
  AutonomyActionCategory,
  AutonomyTier,
  TenantAutonomyControl,
  IAutonomyGovernanceRegistry,
} from './contracts/autonomous-governance.contracts';

const GOVERNANCE_NOTE =
  'All autonomous actions are policy-governed, auditable, and require appropriate approval.';

const TIER_ORDER: AutonomyTier[] = ['advisory-only', 'approval-required', 'confidence-gated', 'fully-governed'];

function _tierRank(tier: AutonomyTier): number {
  return TIER_ORDER.indexOf(tier);
}

const DEFAULT_POLICY: AutonomyPolicy = {
  policyId: 'default',
  tier: 'approval-required',
  enabledCategories: [
    'retry-tuning',
    'dependency-stabilization',
    'environment-correction',
    'flakiness-quarantine',
    'orchestration-optimization',
    'worker-scaling-hint',
  ],
  confidenceThresholds: [
    { actionCategory: 'retry-tuning', minConfidence: 75, maxAutonomyTier: 'confidence-gated', requiresApproverRole: ['admin', 'editor'] },
    { actionCategory: 'dependency-stabilization', minConfidence: 80, maxAutonomyTier: 'approval-required', requiresApproverRole: ['admin'] },
    { actionCategory: 'environment-correction', minConfidence: 85, maxAutonomyTier: 'approval-required', requiresApproverRole: ['admin'] },
    { actionCategory: 'flakiness-quarantine', minConfidence: 70, maxAutonomyTier: 'confidence-gated', requiresApproverRole: ['admin', 'editor'] },
    { actionCategory: 'orchestration-optimization', minConfidence: 80, maxAutonomyTier: 'approval-required', requiresApproverRole: ['admin'] },
    { actionCategory: 'worker-scaling-hint', minConfidence: 60, maxAutonomyTier: 'advisory-only', requiresApproverRole: [] },
  ],
  escalationRules: [
    { ruleId: 'esc-1', actionCategory: 'environment-correction', escalateWhenConfidenceBelow: 85, escalateToRoles: ['admin'], expiryHours: 24 },
    { ruleId: 'esc-2', actionCategory: 'dependency-stabilization', escalateWhenConfidenceBelow: 80, escalateToRoles: ['admin'], expiryHours: 48 },
  ],
  auditAllActions: true,
  governanceNote: GOVERNANCE_NOTE,
};

export class AutonomyGovernanceRegistry implements IAutonomyGovernanceRegistry {
  private readonly _policies = new Map<string, AutonomyPolicy>([[DEFAULT_POLICY.policyId, DEFAULT_POLICY]]);
  private readonly _tenantControls = new Map<string, TenantAutonomyControl>();

  registerPolicy(policy: AutonomyPolicy): void {
    this._policies.set(policy.policyId, policy);
  }

  getPolicy(policyId: string): AutonomyPolicy | null {
    return this._policies.get(policyId) ?? null;
  }

  getEffectivePolicy(tenantId?: string): AutonomyPolicy {
    if (tenantId) {
      const ctrl = this._tenantControls.get(tenantId);
      if (ctrl?.overridePolicy) return ctrl.overridePolicy;
    }
    return this._policies.get('default') ?? DEFAULT_POLICY;
  }

  registerTenantControl(control: TenantAutonomyControl): void {
    this._tenantControls.set(control.tenantId, control);
  }

  getTenantControl(tenantId: string): TenantAutonomyControl | null {
    return this._tenantControls.get(tenantId) ?? null;
  }

  checkPermission(
    actionCategory: AutonomyActionCategory,
    confidence: number,
    actorRole: string,
    tenantId?: string
  ): { permitted: boolean; reason: string; requiredTier: AutonomyTier } {
    const policy = this.getEffectivePolicy(tenantId);

    if (!policy.enabledCategories.includes(actionCategory)) {
      return { permitted: false, reason: `Category '${actionCategory}' not enabled in policy`, requiredTier: policy.tier };
    }

    if (tenantId) {
      const ctrl = this._tenantControls.get(tenantId);
      if (ctrl?.blockedCategories.includes(actionCategory)) {
        return { permitted: false, reason: `Category '${actionCategory}' blocked for tenant ${tenantId}`, requiredTier: policy.tier };
      }
    }

    const threshold = policy.confidenceThresholds.find((t) => t.actionCategory === actionCategory);
    if (threshold) {
      if (confidence < threshold.minConfidence) {
        return {
          permitted: false,
          reason: `Confidence ${confidence} below minimum ${threshold.minConfidence} for '${actionCategory}'`,
          requiredTier: threshold.maxAutonomyTier,
        };
      }
      if (threshold.requiresApproverRole.length > 0 && !threshold.requiresApproverRole.includes(actorRole)) {
        return {
          permitted: false,
          reason: `Role '${actorRole}' insufficient; requires one of [${threshold.requiresApproverRole.join(', ')}]`,
          requiredTier: threshold.maxAutonomyTier,
        };
      }
      const effectiveTier = _tierRank(policy.tier) <= _tierRank(threshold.maxAutonomyTier)
        ? policy.tier
        : threshold.maxAutonomyTier;
      return { permitted: true, reason: 'Permitted under policy', requiredTier: effectiveTier };
    }

    return { permitted: true, reason: 'No specific threshold — default policy permits', requiredTier: policy.tier };
  }

  _reset(): void {
    this._policies.clear();
    this._policies.set(DEFAULT_POLICY.policyId, DEFAULT_POLICY);
    this._tenantControls.clear();
  }
}

export const globalAutonomyGovernanceRegistry = new AutonomyGovernanceRegistry();
