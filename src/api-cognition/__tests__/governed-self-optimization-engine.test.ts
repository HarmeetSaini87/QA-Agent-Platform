import { describe, it, expect, beforeEach } from 'vitest';
import { GovernedSelfOptimizationEngine } from '../governed-self-optimization-engine';

describe('GovernedSelfOptimizationEngine', () => {
  let engine: GovernedSelfOptimizationEngine;

  beforeEach(() => {
    engine = new GovernedSelfOptimizationEngine();
    engine._reset();
  });

  const propose = () => engine.propose(
    'col1', 'retry-effectiveness',
    'maxRetries=5', 'maxRetries=2',
    '40% reduction in retry volume',
    80, 'Retry storm signals detected across 5 runs',
    'actor1'
  );

  it('propose returns pending-review status', () => {
    expect(propose().status).toBe('pending-review');
  });

  it('propose has governance note', () => {
    expect(propose().governanceNote).toBeTruthy();
  });

  it('propose isExplainable implied by reasoning field', () => {
    const p = propose();
    expect(p.reasoning).toBeTruthy();
  });

  it('propose sets expiresAt in future', () => {
    const p = propose();
    expect(new Date(p.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('approve changes status to applied-advisory', () => {
    const p = propose();
    const approved = engine.approve(p.proposalId, 'admin');
    expect(approved.status).toBe('applied-advisory');
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
    engine.propose('col1', 'sla-optimization', 'a', 'b', 'c', 75, 'r', 'u1');
    engine.propose('col2', 'sla-optimization', 'a', 'b', 'c', 75, 'r', 'u1');
    expect(engine.listProposals('col1')).toHaveLength(1);
  });

  it('listProposals filters by status', () => {
    const p = propose();
    engine.approve(p.proposalId, 'admin');
    expect(engine.listProposals('col1', 'applied-advisory')).toHaveLength(1);
    expect(engine.listProposals('col1', 'pending-review')).toHaveLength(0);
  });

  it('getPolicy returns default when no specific policy', () => {
    expect(engine.getPolicy().policyId).toBe('default');
  });

  it('registerPolicy and retrieve by collectionId', () => {
    engine.registerPolicy({
      policyId: 'pol-col1', collectionId: 'col1',
      enabledDomains: ['retry-effectiveness'],
      minConfidenceForApproval: 80,
      requiredApproverRoles: ['admin'],
      auditAllOptimizations: true,
      maxActiveProposals: 5,
    });
    expect(engine.getPolicy('col1')?.policyId).toBe('pol-col1');
  });
});
