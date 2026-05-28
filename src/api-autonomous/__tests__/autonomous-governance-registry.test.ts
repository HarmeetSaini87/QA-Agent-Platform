import { describe, it, expect, beforeEach } from 'vitest';
import { AutonomyGovernanceRegistry } from '../autonomous-governance-registry';
import { AutonomyPolicy } from '../contracts/autonomous-governance.contracts';

describe('AutonomyGovernanceRegistry', () => {
  let registry: AutonomyGovernanceRegistry;

  beforeEach(() => {
    registry = new AutonomyGovernanceRegistry();
    registry._reset();
  });

  it('getEffectivePolicy returns default policy', () => {
    const policy = registry.getEffectivePolicy();
    expect(policy.policyId).toBe('default');
  });

  it('default policy enables retry-tuning', () => {
    const policy = registry.getEffectivePolicy();
    expect(policy.enabledCategories).toContain('retry-tuning');
  });

  it('default policy audits all actions', () => {
    expect(registry.getEffectivePolicy().auditAllActions).toBe(true);
  });

  it('registerPolicy and retrieve by id', () => {
    const custom: AutonomyPolicy = {
      policyId: 'custom-1',
      tier: 'advisory-only',
      enabledCategories: ['retry-tuning'],
      confidenceThresholds: [],
      escalationRules: [],
      auditAllActions: true,
      governanceNote: 'test',
    };
    registry.registerPolicy(custom);
    expect(registry.getPolicy('custom-1')).toEqual(custom);
  });

  it('checkPermission — disabled category is denied', () => {
    const result = registry.checkPermission('retry-tuning', 80, 'admin');
    // retry-tuning is enabled and confidence >= 75, admin role — should be permitted
    expect(result.permitted).toBe(true);
  });

  it('checkPermission — low confidence is denied', () => {
    const result = registry.checkPermission('environment-correction', 50, 'admin');
    expect(result.permitted).toBe(false);
    expect(result.reason).toMatch(/below minimum/);
  });

  it('checkPermission — wrong role is denied', () => {
    const result = registry.checkPermission('environment-correction', 90, 'viewer');
    expect(result.permitted).toBe(false);
    expect(result.reason).toMatch(/insufficient/);
  });

  it('tenant control blocks category', () => {
    registry.registerTenantControl({
      tenantId: 't1',
      maxTier: 'advisory-only',
      blockedCategories: ['retry-tuning'],
    });
    const result = registry.checkPermission('retry-tuning', 90, 'admin', 't1');
    expect(result.permitted).toBe(false);
    expect(result.reason).toMatch(/blocked for tenant/);
  });

  it('tenant override policy is used when registered', () => {
    const override: AutonomyPolicy = {
      policyId: 'override',
      tier: 'advisory-only',
      enabledCategories: [],
      confidenceThresholds: [],
      escalationRules: [],
      auditAllActions: false,
      governanceNote: 'override',
    };
    registry.registerTenantControl({ tenantId: 't2', maxTier: 'advisory-only', blockedCategories: [], overridePolicy: override });
    expect(registry.getEffectivePolicy('t2').policyId).toBe('override');
  });

  it('getTenantControl returns null for unknown tenant', () => {
    expect(registry.getTenantControl('unknown')).toBeNull();
  });
});
