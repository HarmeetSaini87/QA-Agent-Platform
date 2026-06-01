// src/api-security/contracts/environment-security.contracts.ts
// Phase E Step 4: Environment-level security controls.

export type ExecutionApprovalRequirement = 'none' | 'single-approver' | 'dual-approver';

export interface EnvironmentSecurityPolicy {
  readonly environmentId: string;
  readonly isProduction: boolean;
  /** Roles allowed to execute against this environment. */
  readonly allowedRoles: string[];
  readonly approvalRequirement: ExecutionApprovalRequirement;
  /** If true, restrict secret decryption to approved runners only. */
  readonly restrictSecretDecryption: boolean;
  /** If true, replay synthesis is blocked for this environment. */
  readonly blockReplaySynthesis: boolean;
}

export interface EnvironmentAccessDecision {
  readonly environmentId: string;
  readonly actorRole: string;
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
  readonly decidedAt: string;
}

export interface IEnvironmentSecurityPolicy {
  getPolicy(environmentId: string): EnvironmentSecurityPolicy | null;
  registerPolicy(policy: EnvironmentSecurityPolicy): void;
  checkAccess(environmentId: string, actorRole: string): EnvironmentAccessDecision;
  listPolicies(): EnvironmentSecurityPolicy[];
}
