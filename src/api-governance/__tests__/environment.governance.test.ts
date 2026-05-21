import { describe, it, expect, beforeEach } from 'vitest';
import {
  EnvironmentGovernancePolicy,
  registerEnvironmentPolicy,
  getEnvironmentPolicy,
  removeEnvironmentPolicy,
  maskSensitiveVariables,
  _clearEnvironmentPolicies,
} from '../environment.governance';

describe('Environment Governance', () => {

  beforeEach(() => {
    _clearEnvironmentPolicies();
  });

  it('getEnvironmentPolicy returns permissive default for unregistered environment', () => {
    const policy = getEnvironmentPolicy('env-unknown');
    expect(policy.isSensitive).toBe(false);
    expect(policy.requiresApproval).toBe(false);
    expect(policy.auditAccess).toBe(false);
    expect(policy.allowedRoles).toContain('viewer');
  });

  it('registerEnvironmentPolicy + getEnvironmentPolicy round-trip', () => {
    const p: EnvironmentGovernancePolicy = {
      environmentId:    'env-prod',
      isSensitive:      true,
      requiresApproval: true,
      allowedRoles:     ['admin', 'editor'],
      auditAccess:      true,
    };
    registerEnvironmentPolicy(p);
    const retrieved = getEnvironmentPolicy('env-prod');
    expect(retrieved.isSensitive).toBe(true);
    expect(retrieved.requiresApproval).toBe(true);
    expect(retrieved.allowedRoles).toEqual(['admin', 'editor']);
  });

  it('maskSensitiveVariables masks all values when isSensitive = true', () => {
    const vars = [{ name: 'API_KEY', value: 'secret123' }, { name: 'DB_PASS', value: 'pass99' }];
    const sensitivePolicy: EnvironmentGovernancePolicy = {
      environmentId: 'env-prod', isSensitive: true,
      requiresApproval: false, allowedRoles: ['admin'], auditAccess: false,
    };
    const masked = maskSensitiveVariables(vars, sensitivePolicy);
    expect(masked[0].value).toBe('***');
    expect(masked[0].isMasked).toBe(true);
    expect(masked[1].value).toBe('***');
  });

  it('maskSensitiveVariables preserves values when isSensitive = false', () => {
    const vars = [{ name: 'BASE_URL', value: 'https://staging.example.com' }];
    const policy: EnvironmentGovernancePolicy = {
      environmentId: 'env-staging', isSensitive: false,
      requiresApproval: false, allowedRoles: ['admin', 'tester'], auditAccess: false,
    };
    const masked = maskSensitiveVariables(vars, policy);
    expect(masked[0].value).toBe('https://staging.example.com');
    expect(masked[0].isMasked).toBe(false);
  });

  it('maskSensitiveVariables returns empty array for empty input', () => {
    const policy: EnvironmentGovernancePolicy = {
      environmentId: 'e1', isSensitive: true,
      requiresApproval: false, allowedRoles: ['admin'], auditAccess: false,
    };
    const masked = maskSensitiveVariables([], policy);
    expect(masked).toEqual([]);
  });

  it('removeEnvironmentPolicy reverts to default policy', () => {
    const p: EnvironmentGovernancePolicy = {
      environmentId: 'env-test', isSensitive: true,
      requiresApproval: true, allowedRoles: ['admin'], auditAccess: true,
    };
    registerEnvironmentPolicy(p);
    removeEnvironmentPolicy('env-test');
    const policy = getEnvironmentPolicy('env-test');
    expect(policy.isSensitive).toBe(false);
    expect(policy.requiresApproval).toBe(false);
  });

});
