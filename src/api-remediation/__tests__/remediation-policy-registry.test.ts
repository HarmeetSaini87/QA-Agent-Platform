import { describe, it, expect, beforeEach } from 'vitest';
import { RemediationPolicyRegistry } from '../remediation-policy-registry';

describe('RemediationPolicyRegistry', () => {
  let registry: RemediationPolicyRegistry;

  beforeEach(() => { registry = new RemediationPolicyRegistry(); });

  it('empty registry allows propose for editor at any confidence', () => {
    const result = registry.checkPropose('editor', 80);
    expect(result.canPropose).toBe(true);
  });

  it('policy with confidenceThreshold blocks proposal when confidence is below threshold', () => {
    registry.register({
      policyId: 'p1',
      name: 'High Confidence Only',
      confidenceThreshold: 70,
      approverRoles: ['admin', 'editor'],
      restrictedEnvironmentIds: [],
      allowProposalGeneration: true,
      maxProposalsPerCollection: 10,
    });
    const result = registry.checkPropose('editor', 50);
    expect(result.canPropose).toBe(false);
    expect(result.reason).toContain('50');
    expect(result.reason).toContain('70');
  });

  it('policy with restrictedEnvironmentIds blocks proposal for that environment', () => {
    registry.register({
      policyId: 'p2',
      name: 'No Prod Remediation',
      confidenceThreshold: 0,
      approverRoles: ['admin'],
      restrictedEnvironmentIds: ['env-prod'],
      allowProposalGeneration: true,
      maxProposalsPerCollection: 10,
    });
    const result = registry.checkPropose('admin', 95, 'env-prod');
    expect(result.canPropose).toBe(false);
    expect(result.reason).toContain('env-prod');
  });
});
