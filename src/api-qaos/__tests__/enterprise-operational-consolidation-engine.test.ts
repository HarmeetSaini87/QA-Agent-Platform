import { describe, it, expect, beforeEach } from 'vitest';
import { EnterpriseOperationalConsolidationEngine } from '../enterprise-operational-consolidation-engine';

describe('EnterpriseOperationalConsolidationEngine', () => {
  let engine: EnterpriseOperationalConsolidationEngine;

  beforeEach(() => {
    engine = new EnterpriseOperationalConsolidationEngine();
    engine._reset();
  });

  it('propose creates pending-review proposal', () => {
    const p = engine.propose('col-1', 'orchestration-federation', 'unify', 'reason', 75);
    expect(p.status).toBe('pending-review');
    expect(p.isExplainable).toBe(true);
    expect(p.proposalId).toBeTruthy();
  });

  it('propose sets expiry and createdAt', () => {
    const p = engine.propose('col-1', 'replay-continuity', 'unify', 'reason', 80);
    expect(p.expiresAt).toBeTruthy();
    expect(p.createdAt).toBeTruthy();
    expect(new Date(p.expiresAt) > new Date(p.createdAt)).toBe(true);
  });

  it('approve transitions to consolidating-advisory', () => {
    const p = engine.propose('col-1', 'operational-memory', 'unify', 'reason', 80);
    const approved = engine.approve(p.proposalId, 'admin');
    expect(approved.status).toBe('consolidating-advisory');
    expect(approved.approvedBy).toBe('admin');
  });

  it('reject transitions to rolled-back', () => {
    const p = engine.propose('col-1', 'trust-coordination', 'unify', 'reason', 80);
    const rejected = engine.reject(p.proposalId);
    expect(rejected.status).toBe('rolled-back');
  });

  it('approve throws if not pending', () => {
    const p = engine.propose('col-1', 'reliability-fabric', 'unify', 'reason', 80);
    engine.approve(p.proposalId, 'admin');
    expect(() => engine.approve(p.proposalId, 'admin')).toThrow();
  });

  it('reject throws if not pending', () => {
    const p = engine.propose('col-1', 'cognition-unification', 'unify', 'reason', 80);
    engine.reject(p.proposalId);
    expect(() => engine.reject(p.proposalId)).toThrow();
  });

  it('listProposals filters by collectionId', () => {
    engine.propose('col-1', 'orchestration-federation', 'unify', 'r', 70);
    engine.propose('col-2', 'orchestration-federation', 'unify', 'r', 70);
    expect(engine.listProposals('col-1')).toHaveLength(1);
  });

  it('scoreConsolidation returns 6 domain scores', () => {
    const scorecard = engine.scoreConsolidation('col-1');
    expect(scorecard.domainScores).toHaveLength(6);
  });

  it('scoreConsolidation has platform readiness', () => {
    const scorecard = engine.scoreConsolidation('col-1');
    expect(['unified', 'substantially-unified', 'partially-unified', 'fragmented']).toContain(scorecard.platformReadiness);
  });

  it('scoreConsolidation structure', () => {
    const scorecard = engine.scoreConsolidation('col-1');
    expect(scorecard.scorecardId).toBeTruthy();
    expect(scorecard.overallUnificationScore).toBeGreaterThanOrEqual(0);
    expect(scorecard.scoredAt).toBeTruthy();
    expect(scorecard.governanceNote).toBeTruthy();
  });

  it('getPolicy returns default when no override', () => {
    const policy = engine.getPolicy('col-x');
    expect(policy.policyId).toBe('default');
    expect(policy.enabledDomains.length).toBeGreaterThan(0);
  });

  it('setPolicy overrides for collection', () => {
    engine.setPolicy('col-1', { policyId: 'custom', minConfidence: 80, approverRoles: ['admin'], enabledDomains: ['orchestration-federation'], requireExplainability: true });
    expect(engine.getPolicy('col-1').policyId).toBe('custom');
    expect(engine.getPolicy('col-2').policyId).toBe('default');
  });

  it('domainScores all have isExplainable', () => {
    const scorecard = engine.scoreConsolidation('col-1');
    scorecard.domainScores.forEach(d => expect(d.isExplainable).toBe(true));
  });
});
