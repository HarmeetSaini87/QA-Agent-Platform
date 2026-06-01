import type { Role } from '../../data/types';

export interface RemediationPolicy {
  policyId: string;
  name: string;
  /** Proposals with confidence below this value are blocked from generation */
  confidenceThreshold: number;
  /** Roles permitted to approve/reject proposals */
  approverRoles: Role[];
  /** Environment IDs where remediation proposals are blocked */
  restrictedEnvironmentIds: string[];
  /** When false, POST /proposals returns 403 regardless of role */
  allowProposalGeneration: boolean;
  /** Guard against proposal spam per collection */
  maxProposalsPerCollection: number;
}

export interface RemediationPolicyCheckResult {
  canPropose: boolean;
  canApprove: boolean;
  reason?: string;
}
