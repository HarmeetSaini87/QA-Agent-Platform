// src/api-security/__tests__/environment-security-guard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EnvironmentSecurityGuard } from '../environment-security-guard';

describe('EnvironmentSecurityGuard', () => {
  let guard: EnvironmentSecurityGuard;

  beforeEach(() => {
    guard = new EnvironmentSecurityGuard();
    guard.registerPolicy({
      environmentId: 'staging',
      isProduction: false,
      allowedRoles: ['admin', 'editor', 'tester'],
      approvalRequirement: 'none',
      restrictSecretDecryption: false,
      blockReplaySynthesis: false,
    });
    guard.registerPolicy({
      environmentId: 'production',
      isProduction: true,
      allowedRoles: ['admin'],
      approvalRequirement: 'single-approver',
      restrictSecretDecryption: true,
      blockReplaySynthesis: false,
    });
  });

  it('checkAccess: allowed role on open env', () => {
    const decision = guard.checkAccess('staging', 'tester');
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it('checkAccess: denied role on production', () => {
    const decision = guard.checkAccess('production', 'tester');
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(false);
  });

  it('checkAccess: admin on production — allowed but requires approval', () => {
    const decision = guard.checkAccess('production', 'admin');
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
  });

  it('checkAccess: unregistered env — open access by default', () => {
    const decision = guard.checkAccess('dev-local', 'viewer');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('no-policy-registered');
  });

  it('getPolicy: returns registered policy', () => {
    const p = guard.getPolicy('staging');
    expect(p?.environmentId).toBe('staging');
    expect(p?.isProduction).toBe(false);
  });

  it('listPolicies: returns all registered', () => {
    const policies = guard.listPolicies();
    expect(policies.map(p => p.environmentId)).toContain('staging');
    expect(policies.map(p => p.environmentId)).toContain('production');
  });
});
