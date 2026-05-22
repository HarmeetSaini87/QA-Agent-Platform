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
    // canApprove is independent: admin/editor in approverRoles can still approve
    expect(result.canApprove).toBe(true); // 'editor' is in policy.approverRoles
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
    // canApprove is independent: admin is in approverRoles even when env is restricted
    expect(result.canApprove).toBe(true); // 'admin' is in policy.approverRoles: ['admin']
  });

  it('policy with allowProposalGeneration=false blocks propose but canApprove reflects role', () => {
    registry.register({
      policyId: 'p3',
      name: 'Generation Disabled',
      confidenceThreshold: 0,
      approverRoles: ['admin'],
      restrictedEnvironmentIds: [],
      allowProposalGeneration: false,
      maxProposalsPerCollection: 10,
    });
    const adminResult = registry.checkPropose('admin', 90);
    expect(adminResult.canPropose).toBe(false);
    expect(adminResult.canApprove).toBe(true);  // admin is in approverRoles

    const testerResult = registry.checkPropose('tester', 90);
    expect(testerResult.canPropose).toBe(false);
    expect(testerResult.canApprove).toBe(false); // tester is NOT in approverRoles
  });
});
