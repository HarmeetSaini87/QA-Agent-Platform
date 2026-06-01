import { describe, it, expect, beforeEach } from 'vitest';
import { GovernedAdaptiveFederationEngine } from '../governed-adaptive-federation-engine';

describe('GovernedAdaptiveFederationEngine', () => {
  let engine: GovernedAdaptiveFederationEngine;

  beforeEach(() => {
    engine = new GovernedAdaptiveFederationEngine();
    engine._reset();
  });

  const propose = () =>
    engine.propose('col1', 'retry-governance', 'retries=5', 'retries=2',
      '40% reduction', 80, 'Retry federation signals detected', 'actor1');

  it('propose returns pending-review status', () => {
    expect(propose().status).toBe('pending-review');
  });

  it('propose sets isExplainable true', () => {
    expect(propose().isExplainable).toBe(true);
  });

  it('propose has governanceNote', () => {
    expect(propose().governanceNote).toBeTruthy();
  });

  it('propose expiresAt is in the future', () => {
    expect(new Date(propose().expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('approve changes status to propagated-advisory', () => {
    const p = propose();
    const approved = engine.approve(p.proposalId, 'admin');
    expect(approved.status).toBe('propagated-advisory');
    expect(approved.approvedBy).toBe('admin');
  });

  it('reject changes status to rejected', () => {
    const p = propose();
    const rejected = engine.reject(p.proposalId, 'confidence too low');
    expect(rejected.status).toBe('rejected');
  });

  it('approve throws on non-pending proposal', () => {
    const p = propose();
    engine.approve(p.proposalId, 'admin');
    expect(() => engine.approve(p.proposalId, 'admin')).toThrow();
  });

  it('reject throws on non-pending proposal', () => {
    const p = propose();
    engine.reject(p.proposalId, 'reason');
    expect(() => engine.reject(p.proposalId, 'reason')).toThrow();
  });

  it('listProposals filters by collectionId', () => {
    engine.propose('col1', 'orchestration-stabilization', 'a', 'b', 'c', 75, 'r', 'u1');
    engine.propose('col2', 'orchestration-stabilization', 'a', 'b', 'c', 75, 'r', 'u1');
    expect(engine.listProposals('col1')).toHaveLength(1);
  });

  it('listProposals filters by status', () => {
    const p = propose();
    engine.approve(p.proposalId, 'admin');
    expect(engine.listProposals('col1', 'propagated-advisory')).toHaveLength(1);
    expect(engine.listProposals('col1', 'pending-review')).toHaveLength(0);
  });

  it('scoreStabilization returns 6 domain scores', () => {
    expect(engine.scoreStabilization('col1').federationDomainScores).toHaveLength(6);
  });

  it('scoreStabilization stabilizationScore is between 0 and 100', () => {
    const score = engine.scoreStabilization('col1').stabilizationScore;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scoreStabilization has governanceNote', () => {
    expect(engine.scoreStabilization('col1').governanceNote).toBeTruthy();
  });

  it('getPolicy returns default policyId when none registered', () => {
    expect(engine.getPolicy().policyId).toBe('default');
  });

  it('registerPolicy and retrieve by collectionId', () => {
    engine.registerPolicy({
      policyId: 'pol-col1', collectionId: 'col1',
      enabledDomains: ['retry-governance'],
      minConfidenceForPropagation: 80,
      requiredApproverRoles: ['admin'],
      maxActiveFederationProposals: 5,
    });
    expect(engine.getPolicy('col1')?.policyId).toBe('pol-col1');
  });
});
