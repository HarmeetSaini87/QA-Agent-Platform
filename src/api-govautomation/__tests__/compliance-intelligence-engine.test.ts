import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceIntelligenceEngine } from '../compliance-intelligence-engine';

describe('ComplianceIntelligenceEngine', () => {
  let engine: ComplianceIntelligenceEngine;

  beforeEach(() => {
    engine = new ComplianceIntelligenceEngine();
    engine._reset();
  });

  it('evaluateDimension returns result with isExplainable', () => {
    const result = engine.evaluateDimension('col-1', 'replay-traceability', ['sig-a']);
    expect(result.isExplainable).toBe(true);
    expect(result.dimension).toBe('replay-traceability');
    expect(result.collectionId).toBe('col-1');
  });

  it('evaluateDimension score increases with signals', () => {
    const few = engine.evaluateDimension('col-1', 'policy-adherence', ['a']);
    const more = engine.evaluateDimension('col-1', 'policy-adherence', ['a', 'b', 'c']);
    expect(more.score).toBeGreaterThan(few.score);
  });

  it('evaluateDimension with no signals returns baseline score', () => {
    const result = engine.evaluateDimension('col-1', 'audit-continuity', []);
    expect(result.score).toBe(50);
    expect(result.trend).toBe('stable');
  });

  it('evaluateDimension trend improving for high score', () => {
    const signals = ['a', 'b', 'c', 'd', 'e', 'f'];
    const result = engine.evaluateDimension('col-1', 'execution-governance', signals);
    expect(result.trend).toBe('improving');
  });

  it('evaluateDimension has evidenceSignals', () => {
    const result = engine.evaluateDimension('col-1', 'trust-integrity', ['trust-ok']);
    expect(result.evidenceSignals).toContain('trust-ok');
  });

  it('buildScorecard produces 6 dimensions', () => {
    const scorecard = engine.buildScorecard('col-1');
    expect(scorecard.dimensionScores).toHaveLength(6);
  });

  it('buildScorecard has compliance level', () => {
    const scorecard = engine.buildScorecard('col-1');
    expect(['fully-compliant', 'substantially-compliant', 'partially-compliant', 'non-compliant']).toContain(scorecard.complianceLevel);
  });

  it('buildScorecard structure', () => {
    const scorecard = engine.buildScorecard('col-1');
    expect(scorecard.scorecardId).toBeTruthy();
    expect(scorecard.overallComplianceScore).toBeGreaterThanOrEqual(0);
    expect(scorecard.scoredAt).toBeTruthy();
    expect(scorecard.governanceNote).toBeTruthy();
  });

  it('buildScorecard criticalGaps for low-score dimensions', () => {
    const scorecard = engine.buildScorecard('col-1');
    expect(Array.isArray(scorecard.criticalGaps)).toBe(true);
  });

  it('scoreExecutionGovernance returns score with isExplainable', () => {
    const score = engine.scoreExecutionGovernance('col-1', 'run-1', ['violation-x']);
    expect(score.isExplainable).toBe(true);
    expect(score.policyViolations).toContain('violation-x');
  });

  it('scoreExecutionGovernance with no violations', () => {
    const score = engine.scoreExecutionGovernance('col-1', 'run-1', ['clean-signal']);
    expect(score.policyViolations).toHaveLength(0);
    expect(score.trustIndicators).toContain('clean-signal');
  });

  it('assessEnterpriseTrust returns trustLevel', () => {
    const trust = engine.assessEnterpriseTrust('org-1', ['col-1', 'col-2', 'col-3']);
    expect(['high', 'medium', 'low', 'critical']).toContain(trust.trustLevel);
    expect(trust.isExplainable).toBe(true);
  });

  it('assessEnterpriseTrust with no collections returns low or critical trust', () => {
    const trust = engine.assessEnterpriseTrust('org-1', []);
    expect(['low', 'critical']).toContain(trust.trustLevel);
  });

  it('assessEnterpriseTrust structure', () => {
    const trust = engine.assessEnterpriseTrust('org-1', ['col-1']);
    expect(trust.trustId).toBeTruthy();
    expect(trust.orgId).toBe('org-1');
    expect(trust.assessedAt).toBeTruthy();
    expect(trust.trustFactors.length).toBeGreaterThan(0);
  });
});
