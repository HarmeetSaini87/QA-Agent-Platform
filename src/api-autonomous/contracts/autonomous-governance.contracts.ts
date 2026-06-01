// src/api-autonomous/contracts/autonomous-governance.contracts.ts
// Phase E Step 11: Autonomous operations governance. Policy-governed, auditable, never bypasses security.

export type AutonomyTier = 'advisory-only' | 'approval-required' | 'confidence-gated' | 'fully-governed';

export type AutonomyActionCategory =
  | 'retry-tuning'
  | 'dependency-stabilization'
  | 'environment-correction'
  | 'flakiness-quarantine'
  | 'orchestration-optimization'
  | 'worker-scaling-hint';

export interface AutonomyConfidenceThreshold {
  readonly actionCategory: AutonomyActionCategory;
  readonly minConfidence: number;       // 0–100 — below this, escalate to human
  readonly maxAutonomyTier: AutonomyTier;
  readonly requiresApproverRole: readonly string[];
}

export interface ApprovalEscalationRule {
  readonly ruleId: string;
  readonly actionCategory: AutonomyActionCategory;
  readonly escalateWhenConfidenceBelow: number;
  readonly escalateToRoles: readonly string[];
  readonly expiryHours: number;
}

export interface AutonomyPolicy {
  readonly policyId: string;
  readonly tenantId?: string;
  readonly tier: AutonomyTier;
  readonly enabledCategories: readonly AutonomyActionCategory[];
  readonly confidenceThresholds: readonly AutonomyConfidenceThreshold[];
  readonly escalationRules: readonly ApprovalEscalationRule[];
  readonly auditAllActions: boolean;
  readonly governanceNote: string;
}

export interface TenantAutonomyControl {
  readonly tenantId: string;
  readonly maxTier: AutonomyTier;
  readonly blockedCategories: readonly AutonomyActionCategory[];
  readonly overridePolicy?: AutonomyPolicy;
}

export interface IAutonomyGovernanceRegistry {
  registerPolicy(policy: AutonomyPolicy): void;
  getPolicy(policyId: string): AutonomyPolicy | null;
  getEffectivePolicy(tenantId?: string): AutonomyPolicy;
  registerTenantControl(control: TenantAutonomyControl): void;
  getTenantControl(tenantId: string): TenantAutonomyControl | null;
  /** Check whether an action is permitted under current policy. Never executes the action. */
  checkPermission(
    actionCategory: AutonomyActionCategory,
    confidence: number,
    actorRole: string,
    tenantId?: string
  ): { permitted: boolean; reason: string; requiredTier: AutonomyTier };
}
