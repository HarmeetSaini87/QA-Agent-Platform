/**
 * environment.governance.ts — EnvironmentGovernancePolicy and maskSensitiveVariables.
 * No changes to existing environment store or runtime.
 * All types JSON-serialisable.
 */

import { Role } from '../data/types';

export interface EnvironmentGovernancePolicy {
  environmentId:    string;
  isSensitive:      boolean;
  requiresApproval: boolean;
  allowedRoles:     Role[];
  auditAccess:      boolean;
}

export interface MaskedVariable {
  name:     string;
  value:    string;
  isMasked: boolean;
}

const environmentPolicies = new Map<string, EnvironmentGovernancePolicy>();

export function registerEnvironmentPolicy(policy: EnvironmentGovernancePolicy): void {
  environmentPolicies.set(policy.environmentId, policy);
}

export function getEnvironmentPolicy(environmentId: string): EnvironmentGovernancePolicy {
  return environmentPolicies.get(environmentId) ?? {
    environmentId,
    isSensitive:      false,
    requiresApproval: false,
    allowedRoles:     ['admin', 'editor', 'tester', 'viewer'],
    auditAccess:      false,
  };
}

export function removeEnvironmentPolicy(environmentId: string): boolean {
  return environmentPolicies.delete(environmentId);
}

export function listEnvironmentPolicies(): EnvironmentGovernancePolicy[] {
  return Array.from(environmentPolicies.values());
}

export function maskSensitiveVariables(
  variables: Array<{ name: string; value: string }>,
  policy: EnvironmentGovernancePolicy,
): MaskedVariable[] {
  return variables.map(v => ({
    name:     v.name,
    value:    policy.isSensitive ? '***' : v.value,
    isMasked: policy.isSensitive,
  }));
}
