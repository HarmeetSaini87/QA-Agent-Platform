import { describe, it, expect, beforeEach } from 'vitest';
import { GovernanceAutomationRegistry } from '../governance-automation-registry';
import type { PolicyAutomationRule, GovernanceAutomationDecision } from '../contracts/governance-automation.contracts';

function makeRule(overrides: Partial<PolicyAutomationRule> = {}): PolicyAutomationRule {
  return {
    ruleId: 'rule-1',
    scope: 'orchestration-policy',
    policyName: 'Test Policy',
    policyDescription: 'Test description',
    complianceThreshold: 70,
    isActive: true,
    requiresApproval: true,
    createdAt: new Date().toISOString(),
    governanceNote: 'note',
    ...overrides,
  };
}

function makeDecision(overrides: Partial<GovernanceAutomationDecision> = {}): GovernanceAutomationDecision {
  return {
    decisionId: 'd1',
    collectionId: 'col-1',
    scope: 'orchestration-policy',
    ruleId: 'rule-1',
    status: 'compliant',
    complianceScore: 85,
    evidenceSignals: ['signal-a'],
    isExplainable: true,
    evaluatedAt: new Date().toISOString(),
    governanceNote: 'note',
    ...overrides,
  };
}

describe('GovernanceAutomationRegistry', () => {
  let registry: GovernanceAutomationRegistry;

  beforeEach(() => {
    registry = new GovernanceAutomationRegistry();
    registry._reset();
  });

  it('registers and retrieves a rule', () => {
    const rule = makeRule();
    registry.registerRule(rule);
    expect(registry.getRule('rule-1')).toEqual(rule);
  });

  it('returns null for unknown rule', () => {
    expect(registry.getRule('nope')).toBeNull();
  });

  it('lists all rules', () => {
    registry.registerRule(makeRule({ ruleId: 'r1', scope: 'orchestration-policy' }));
    registry.registerRule(makeRule({ ruleId: 'r2', scope: 'replay-governance' }));
    const all = registry.listRules();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('filters rules by scope', () => {
    registry.registerRule(makeRule({ ruleId: 'r1', scope: 'orchestration-policy' }));
    registry.registerRule(makeRule({ ruleId: 'r2', scope: 'replay-governance' }));
    const filtered = registry.listRules('replay-governance');
    expect(filtered.every(r => r.scope === 'replay-governance')).toBe(true);
  });

  it('records and lists decisions', () => {
    registry.recordDecision(makeDecision());
    const decisions = registry.listDecisions('col-1');
    expect(decisions).toHaveLength(1);
  });

  it('filters decisions by collectionId', () => {
    registry.recordDecision(makeDecision({ collectionId: 'col-1' }));
    registry.recordDecision(makeDecision({ collectionId: 'col-2' }));
    const filtered = registry.listDecisions('col-1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].collectionId).toBe('col-1');
  });

  it('summarize returns trusted for high compliance', () => {
    registry.recordDecision(makeDecision({ complianceScore: 90, status: 'compliant' }));
    registry.recordDecision(makeDecision({ complianceScore: 85, status: 'compliant' }));
    const summary = registry.summarize('org-1');
    expect(summary.overallTrustLevel).toBe('trusted');
  });

  it('summarize returns non-compliant for zero decisions', () => {
    const summary = registry.summarize('unknown-org');
    expect(summary.overallTrustLevel).toBe('non-compliant');
    expect(summary.totalEvaluations).toBe(0);
  });

  it('summarize counts compliant vs non-compliant', () => {
    registry.recordDecision(makeDecision({ status: 'compliant', complianceScore: 80 }));
    registry.recordDecision(makeDecision({ status: 'non-compliant', complianceScore: 30 }));
    const summary = registry.summarize('org-1');
    expect(summary.compliantCount).toBe(1);
    expect(summary.nonCompliantCount).toBe(1);
  });

  it('summarize has correct structure', () => {
    registry.recordDecision(makeDecision());
    const summary = registry.summarize('org-1');
    expect(summary.governanceNote).toBeTruthy();
    expect(summary.summarizedAt).toBeTruthy();
    expect(summary.orgId).toBe('org-1');
  });

  it('default rules are pre-loaded', () => {
    const all = registry.listRules();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('_reset clears decisions but restores default rules', () => {
    registry.recordDecision(makeDecision());
    registry._reset();
    expect(registry.listDecisions('col-1')).toHaveLength(0);
    expect(registry.listRules().length).toBeGreaterThanOrEqual(3);
  });

  it('summarize dominant scope reflects most frequent scope', () => {
    for (let i = 0; i < 3; i++) {
      registry.recordDecision(makeDecision({ scope: 'audit-governance' }));
    }
    registry.recordDecision(makeDecision({ scope: 'replay-governance' }));
    const summary = registry.summarize('org-1');
    expect(summary.dominantScope).toBe('audit-governance');
  });
});
