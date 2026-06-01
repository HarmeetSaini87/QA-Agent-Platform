import { describe, it, expect, beforeEach } from 'vitest';
import { OperationalIntelligenceGovernanceRegistry } from '../operational-intelligence-governance-registry';

function makePropagation(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org1',
    scope: 'orchestration-governance' as const,
    policyTier: 'tenant-scoped' as const,
    intelligencePayload: { confidence: 75 },
    isAnonymized: true as const,
    isExplainable: true as const,
    governanceNote: 'Advisory',
    ...overrides,
  };
}

function makeDecision(overrides: Record<string, unknown> = {}) {
  return {
    collectionId: 'col1',
    scope: 'reliability-governance' as const,
    rationale: 'Reliability signals elevated',
    status: 'pending' as const,
    requestedBy: 'actor1',
    confidence: 78,
    isExplainable: true as const,
    ...overrides,
  };
}

describe('OperationalIntelligenceGovernanceRegistry', () => {
  let registry: OperationalIntelligenceGovernanceRegistry;

  beforeEach(() => {
    registry = new OperationalIntelligenceGovernanceRegistry();
    registry._reset();
  });

  it('publishPropagation assigns propagationId and createdAt', () => {
    const p = registry.publishPropagation(makePropagation());
    expect(p.propagationId).toBeTruthy();
    expect(p.createdAt).toBeTruthy();
  });

  it('publishPropagation preserves isAnonymized and isExplainable', () => {
    const p = registry.publishPropagation(makePropagation());
    expect(p.isAnonymized).toBe(true);
    expect(p.isExplainable).toBe(true);
  });

  it('listPropagations filters by orgId', () => {
    registry.publishPropagation(makePropagation({ orgId: 'org1' }));
    registry.publishPropagation(makePropagation({ orgId: 'org2' }));
    expect(registry.listPropagations('org1')).toHaveLength(1);
  });

  it('listPropagations filters by scope', () => {
    registry.publishPropagation(makePropagation({ scope: 'orchestration-governance' }));
    registry.publishPropagation(makePropagation({ scope: 'replay-governance' }));
    expect(registry.listPropagations('org1', 'orchestration-governance')).toHaveLength(1);
  });

  it('recordDecision assigns decisionId and expiresAt in future', () => {
    const d = registry.recordDecision(makeDecision());
    expect(d.decisionId).toBeTruthy();
    expect(new Date(d.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('approveDecision changes status to approved', () => {
    const d = registry.recordDecision(makeDecision());
    const approved = registry.approveDecision(d.decisionId, 'admin');
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('admin');
  });

  it('rejectDecision changes status to rejected', () => {
    const d = registry.recordDecision(makeDecision());
    const rejected = registry.rejectDecision(d.decisionId);
    expect(rejected.status).toBe('rejected');
  });

  it('approveDecision throws on non-pending decision', () => {
    const d = registry.recordDecision(makeDecision());
    registry.approveDecision(d.decisionId, 'admin');
    expect(() => registry.approveDecision(d.decisionId, 'admin')).toThrow();
  });

  it('rejectDecision throws on non-pending decision', () => {
    const d = registry.recordDecision(makeDecision());
    registry.rejectDecision(d.decisionId);
    expect(() => registry.rejectDecision(d.decisionId)).toThrow();
  });

  it('summarize returns governanceNote', () => {
    expect(registry.summarize('org1').governanceNote).toBeTruthy();
  });

  it('summarize dominantScope reflects most published scope', () => {
    registry.publishPropagation(makePropagation({ scope: 'reliability-governance' }));
    registry.publishPropagation(makePropagation({ scope: 'reliability-governance' }));
    registry.publishPropagation(makePropagation({ scope: 'replay-governance' }));
    expect(registry.summarize('org1').dominantScope).toBe('reliability-governance');
  });

  it('summarize dominantScope is null for empty', () => {
    expect(registry.summarize('empty-org').dominantScope).toBeNull();
  });

  it('getPolicy returns default policyId when none registered', () => {
    expect(registry.getPolicy().policyId).toBe('default');
  });

  it('registerPolicy and retrieve by orgId', () => {
    registry.registerPolicy({
      policyId: 'pol-org1', orgId: 'org1',
      allowedScopes: ['orchestration-governance'],
      minConfidenceForPropagation: 80,
      requireApprovalForFederation: true,
      auditAllDecisions: true,
    });
    expect(registry.getPolicy('org1')?.policyId).toBe('pol-org1');
  });
});
