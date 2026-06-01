// src/api-cloud/__tests__/resource-governance-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceGovernanceRegistry } from '../resource-governance-registry';

describe('ResourceGovernanceRegistry', () => {
  let registry: ResourceGovernanceRegistry;

  beforeEach(() => {
    registry = new ResourceGovernanceRegistry();
    registry.registerPolicy({
      policyId: 'p1',
      tenantId: 'acme',
      maxConcurrentRuns: 5,
      maxQueueDepth: 20,
      maxRetriesPerRun: 3,
      burstAllowancePercent: 20,
    });
  });

  it('checkBudget: within budget returns withinBudget=true', () => {
    const check = registry.checkBudget('p1', 3, 10);
    expect(check.withinBudget).toBe(true);
  });

  it('checkBudget: over maxConcurrentRuns (with burst) returns withinBudget=false', () => {
    // maxConcurrentRuns=5 + 20% burst = 6 max
    const check = registry.checkBudget('p1', 7, 5);
    expect(check.withinBudget).toBe(false);
    expect(check.advisoryNote).toContain('Budget advisory');
  });

  it('checkBudget: over maxQueueDepth returns withinBudget=false', () => {
    const check = registry.checkBudget('p1', 2, 25);
    expect(check.withinBudget).toBe(false);
  });

  it('checkBudget: no policy registered returns withinBudget=true', () => {
    const check = registry.checkBudget('unknown', 100, 100);
    expect(check.withinBudget).toBe(true);
  });

  it('recordUsage + getUsage roundtrip', () => {
    registry.recordUsage({ tenantId: 'acme', sampledAt: new Date().toISOString(), activeRunCount: 2, queuedRunCount: 3, totalRetriesTriggered: 1, workerCount: 1 });
    const usage = registry.getUsage('acme');
    expect(usage?.activeRunCount).toBe(2);
  });

  it('getUsage: returns null for unknown tenant', () => {
    expect(registry.getUsage('ghost')).toBeNull();
  });

  it('listPolicies: includes registered policies', () => {
    expect(registry.listPolicies().map(p => p.policyId)).toContain('p1');
  });
});
