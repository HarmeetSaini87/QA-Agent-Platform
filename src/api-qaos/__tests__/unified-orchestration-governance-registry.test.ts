import { describe, it, expect, beforeEach } from 'vitest';
import { UnifiedOrchestrationGovernanceRegistry } from '../unified-orchestration-governance-registry';
import type { UnifiedOrchestrationRule, UnifiedOrchestrationDecision } from '../contracts/unified-orchestration-governance.contracts';

function makeRule(overrides: Partial<UnifiedOrchestrationRule> = {}): UnifiedOrchestrationRule {
  return {
    ruleId: 'rule-1',
    scope: 'orchestration-federation',
    ruleDescription: 'Test rule',
    governanceThreshold: 70,
    requireExplainability: true,
    requireApprovalForWaiver: true,
    isActive: true,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<UnifiedOrchestrationDecision> = {}): Omit<UnifiedOrchestrationDecision, 'decisionId' | 'evaluatedAt' | 'governanceNote'> {
  return {
    collectionId: 'col-1',
    scope: 'orchestration-federation',
    ruleId: 'rule-1',
    status: 'governed',
    governanceScore: 85,
    evidenceSignals: ['signal-a'],
    isExplainable: true,
    ...overrides,
  };
}

describe('UnifiedOrchestrationGovernanceRegistry', () => {
  let registry: UnifiedOrchestrationGovernanceRegistry;

  beforeEach(() => {
    registry = new UnifiedOrchestrationGovernanceRegistry();
    registry._reset();
  });

  it('registers and retrieves a rule', () => {
    registry.registerRule(makeRule());
    expect(registry.getRule('rule-1')).toBeTruthy();
  });

  it('returns null for unknown rule', () => {
    expect(registry.getRule('nope')).toBeNull();
  });

  it('lists all rules', () => {
    registry.registerRule(makeRule({ ruleId: 'r1' }));
    const all = registry.listRules();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('filters rules by orgId', () => {
    registry.registerRule(makeRule({ ruleId: 'r1', orgId: 'org-A' }));
    registry.registerRule(makeRule({ ruleId: 'r2', orgId: 'org-B' }));
    const filtered = registry.listRules('org-A');
    expect(filtered.every(r => r.orgId === 'org-A')).toBe(true);
  });

  it('recordDecision returns full decision with ids', () => {
    const decision = registry.recordDecision(makeDecision());
    expect(decision.decisionId).toBeTruthy();
    expect(decision.evaluatedAt).toBeTruthy();
    expect(decision.governanceNote).toBeTruthy();
    expect(decision.isExplainable).toBe(true);
  });

  it('listDecisions filters by collectionId', () => {
    registry.recordDecision(makeDecision({ collectionId: 'col-1' }));
    registry.recordDecision(makeDecision({ collectionId: 'col-2' }));
    expect(registry.listDecisions('col-1')).toHaveLength(1);
    expect(registry.listDecisions('col-2')).toHaveLength(1);
  });

  it('listDecisions filters by status', () => {
    registry.recordDecision(makeDecision({ status: 'governed' }));
    registry.recordDecision(makeDecision({ status: 'non-governed' }));
    expect(registry.listDecisions('col-1', 'governed')).toHaveLength(1);
  });

  it('summarize overallPlatformTrustLevel unified for high score', () => {
    registry.recordDecision(makeDecision({ governanceScore: 90 }));
    registry.recordDecision(makeDecision({ governanceScore: 85 }));
    const summary = registry.summarize('org-1');
    expect(summary.overallPlatformTrustLevel).toBe('unified');
  });

  it('summarize fragmented for zero decisions', () => {
    const summary = registry.summarize('org-empty');
    expect(summary.overallPlatformTrustLevel).toBe('fragmented');
    expect(summary.totalDecisions).toBe(0);
  });

  it('summarize counts governed vs non-governed', () => {
    registry.recordDecision(makeDecision({ status: 'governed' }));
    registry.recordDecision(makeDecision({ status: 'non-governed' }));
    const summary = registry.summarize('org-1');
    expect(summary.governedCount).toBe(1);
    expect(summary.nonGovernedCount).toBe(1);
  });

  it('summarize dominantScope reflects most frequent', () => {
    for (let i = 0; i < 3; i++) registry.recordDecision(makeDecision({ scope: 'replay-continuity' }));
    registry.recordDecision(makeDecision({ scope: 'trust-coordination' }));
    const summary = registry.summarize('org-1');
    expect(summary.dominantScope).toBe('replay-continuity');
  });

  it('_reset clears decisions but restores defaults', () => {
    registry.recordDecision(makeDecision());
    registry._reset();
    expect(registry.listDecisions('col-1')).toHaveLength(0);
    expect(registry.listRules().length).toBeGreaterThanOrEqual(3);
  });

  it('default rules pre-loaded', () => {
    expect(registry.listRules().length).toBeGreaterThanOrEqual(3);
  });
});
