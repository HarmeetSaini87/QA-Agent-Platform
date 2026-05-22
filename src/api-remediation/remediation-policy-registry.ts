import type { Role } from '../data/types';
import type { RemediationPolicy, RemediationPolicyCheckResult } from './contracts/remediation-policy.contracts';

export class RemediationPolicyRegistry {
  private readonly policies = new Map<string, RemediationPolicy>();

  register(policy: RemediationPolicy): void {
    this.policies.set(policy.policyId, policy);
  }

  list(): RemediationPolicy[] {
    return Array.from(this.policies.values());
  }

  remove(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  checkPropose(role: Role, confidence: number, environmentId?: string): RemediationPolicyCheckResult {
    const all = this.list();
    if (all.length === 0) {
      return { canPropose: true, canApprove: role === 'admin' || role === 'editor' };
    }

    for (const policy of all) {
      if (!policy.allowProposalGeneration) {
        return { canPropose: false, canApprove: false, reason: `Policy '${policy.name}' disables proposal generation.` };
      }
      if (confidence < policy.confidenceThreshold) {
        return {
          canPropose: false,
          canApprove: false,
          reason: `Confidence ${confidence} is below threshold ${policy.confidenceThreshold} set by policy '${policy.name}'.`,
        };
      }
      if (environmentId && policy.restrictedEnvironmentIds.includes(environmentId)) {
        return {
          canPropose: false,
          canApprove: false,
          reason: `Policy '${policy.name}' restricts remediation in environment '${environmentId}'.`,
        };
      }
    }

    const canApprove = all.every(p => p.approverRoles.includes(role));
    return { canPropose: true, canApprove };
  }
}

export const globalRemediationPolicyRegistry = new RemediationPolicyRegistry();
