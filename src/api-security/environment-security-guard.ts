// src/api-security/environment-security-guard.ts
// Phase E Step 4: Environment-level security policy registry and access control.

import type {
  IEnvironmentSecurityPolicy,
  EnvironmentSecurityPolicy,
  EnvironmentAccessDecision,
} from './contracts/environment-security.contracts';

export class EnvironmentSecurityGuard implements IEnvironmentSecurityPolicy {
  private readonly _policies = new Map<string, EnvironmentSecurityPolicy>();

  registerPolicy(policy: EnvironmentSecurityPolicy): void {
    this._policies.set(policy.environmentId, policy);
  }

  getPolicy(environmentId: string): EnvironmentSecurityPolicy | null {
    return this._policies.get(environmentId) ?? null;
  }

  checkAccess(environmentId: string, actorRole: string): EnvironmentAccessDecision {
    const policy = this._policies.get(environmentId);
    const decidedAt = new Date().toISOString();

    if (!policy) {
      // No policy = open access (default for non-registered envs)
      return { environmentId, actorRole, allowed: true, requiresApproval: false, reason: 'no-policy-registered', decidedAt };
    }

    const allowed = policy.allowedRoles.includes(actorRole);
    const requiresApproval = allowed && policy.approvalRequirement !== 'none';

    if (!allowed) {
      return {
        environmentId, actorRole, allowed: false, requiresApproval: false,
        reason: `Role "${actorRole}" not in allowedRoles for environment "${environmentId}".`,
        decidedAt,
      };
    }

    return {
      environmentId, actorRole, allowed: true,
      requiresApproval,
      reason: requiresApproval
        ? `Execution allowed but requires ${policy.approvalRequirement}.`
        : 'Role permitted, no approval required.',
      decidedAt,
    };
  }

  listPolicies(): EnvironmentSecurityPolicy[] {
    return Array.from(this._policies.values());
  }
}

export const globalEnvironmentSecurityGuard = new EnvironmentSecurityGuard();

// Register default production policy
globalEnvironmentSecurityGuard.registerPolicy({
  environmentId: 'production',
  isProduction: true,
  allowedRoles: ['admin'],
  approvalRequirement: 'single-approver',
  restrictSecretDecryption: true,
  blockReplaySynthesis: false,
});
