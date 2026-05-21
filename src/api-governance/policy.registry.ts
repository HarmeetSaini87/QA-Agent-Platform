/**
 * policy.registry.ts — InMemoryGovernancePolicyRegistry.
 * Stores policies in-memory; evaluates role + restricted-env checks.
 * No approval engine — requiresApproval is a passthrough flag.
 */

import { GovernancePolicy, PolicyCheckResult, ExecutionGate } from './policy.contracts';
import { Role } from '../data/types';

export class InMemoryGovernancePolicyRegistry implements ExecutionGate {
  private readonly policies = new Map<string, GovernancePolicy>();

  registerPolicy(policy: GovernancePolicy): void {
    this.policies.set(policy.policyId, policy);
  }

  getPolicy(policyId: string): GovernancePolicy | undefined {
    return this.policies.get(policyId);
  }

  listPolicies(): GovernancePolicy[] {
    return Array.from(this.policies.values());
  }

  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  checkPolicy(
    collectionId: string,
    userId:       string,
    role:         Role,
    environmentId?: string,
  ): PolicyCheckResult {
    const allPolicies = this.listPolicies();

    if (allPolicies.length === 0) {
      return { allowed: true, requiresApproval: false };
    }

    let requiresApproval = false;

    for (const policy of allPolicies) {
      if (!policy.allowedRoles.includes(role)) {
        return {
          allowed:          false,
          requiresApproval: policy.requiresApproval,
          reason:           `Policy '${policy.name}' does not allow role '${role}'. Allowed: ${policy.allowedRoles.join(', ')}.`,
        };
      }

      if (environmentId && policy.restrictedEnvironmentIds.includes(environmentId)) {
        return {
          allowed:          false,
          requiresApproval: policy.requiresApproval,
          reason:           `Policy '${policy.name}' restricts environment '${environmentId}'.`,
        };
      }

      if (policy.requiresApproval) requiresApproval = true;
    }

    return { allowed: true, requiresApproval };
  }
}

export const globalPolicyRegistry = new InMemoryGovernancePolicyRegistry();
