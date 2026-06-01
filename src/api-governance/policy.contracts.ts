/**
 * policy.contracts.ts — GovernancePolicy, ExecutionGate, PolicyCheckResult.
 * Approval engine is NOT implemented here — requiresApproval is a flag only.
 * All types are JSON-serialisable.
 */

import { Role } from '../data/types';

export interface GovernancePolicy {
  policyId:                 string;
  name:                     string;
  requiresApproval:         boolean;
  allowedRoles:             Role[];
  restrictedEnvironmentIds: string[];
  maxRetries?:              number;
  teardownProtected:        boolean;
}

export interface PolicyCheckResult {
  allowed:          boolean;
  reason?:          string;
  requiresApproval: boolean;
}

export interface ExecutionGate {
  checkPolicy(
    collectionId: string,
    userId:       string,
    role:         Role,
    environmentId?: string,
  ): PolicyCheckResult;
}
