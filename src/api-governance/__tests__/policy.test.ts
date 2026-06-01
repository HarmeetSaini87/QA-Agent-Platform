import { describe, it, expect, beforeEach } from 'vitest';
import { GovernancePolicy } from '../policy.contracts';
import { InMemoryGovernancePolicyRegistry } from '../policy.registry';

function makePolicy(overrides: Partial<GovernancePolicy> = {}): GovernancePolicy {
  return {
    policyId:                 'p1',
    name:                     'Test Policy',
    requiresApproval:         false,
    allowedRoles:             ['admin', 'editor', 'tester'],
    restrictedEnvironmentIds: [],
    teardownProtected:        false,
    ...overrides,
  };
}

describe('InMemoryGovernancePolicyRegistry', () => {
  let registry: InMemoryGovernancePolicyRegistry;

  beforeEach(() => {
    registry = new InMemoryGovernancePolicyRegistry();
  });

  it('allows all when no policies registered', () => {
    const result = registry.checkPolicy('col-1', 'u1', 'viewer');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('denies when role not in allowedRoles', () => {
    registry.registerPolicy(makePolicy({ allowedRoles: ['admin', 'editor'] }));
    const result = registry.checkPolicy('col-1', 'u1', 'viewer');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('viewer');
  });

  it('denies when environmentId is restricted', () => {
    registry.registerPolicy(makePolicy({ restrictedEnvironmentIds: ['env-prod'] }));
    const result = registry.checkPolicy('col-1', 'u1', 'tester', 'env-prod');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('env-prod');
  });

  it('allows when environmentId is not restricted', () => {
    registry.registerPolicy(makePolicy({ restrictedEnvironmentIds: ['env-prod'] }));
    const result = registry.checkPolicy('col-1', 'u1', 'tester', 'env-staging');
    expect(result.allowed).toBe(true);
  });

  it('surfaces requiresApproval flag when policy requires it', () => {
    registry.registerPolicy(makePolicy({ requiresApproval: true }));
    const result = registry.checkPolicy('col-1', 'u1', 'admin');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it('listPolicies returns all registered policies', () => {
    registry.registerPolicy(makePolicy({ policyId: 'p1' }));
    registry.registerPolicy(makePolicy({ policyId: 'p2', name: 'Policy 2' }));
    expect(registry.listPolicies().length).toBe(2);
  });

  it('removePolicy removes a policy and subsequent check is permissive', () => {
    registry.registerPolicy(makePolicy({ allowedRoles: ['admin'] }));
    registry.removePolicy('p1');
    const result = registry.checkPolicy('col-1', 'u1', 'viewer');
    expect(result.allowed).toBe(true);
  });

});
