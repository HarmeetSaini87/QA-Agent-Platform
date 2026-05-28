import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayGovernanceReasoningEngine } from '../replay-governance-reasoning-engine';
import type { GovernanceReasoningDimension } from '../contracts/replay-governance-reasoning.contracts';

const ALL_DIMS: GovernanceReasoningDimension[] = [
  'audit-trail-integrity', 'policy-adherence-trace', 'retry-governance-semantics',
  'dependency-compliance', 'trust-scoring', 'anomaly-governance',
];

describe('ReplayGovernanceReasoningEngine', () => {
  let engine: ReplayGovernanceReasoningEngine;

  beforeEach(() => {
    engine = new ReplayGovernanceReasoningEngine();
    engine._reset();
  });

  it('buildGovernanceTrail returns isExplainable', () => {
    const trail = engine.buildGovernanceTrail('col-1', ['audit-trail-integrity']);
    expect(trail.isExplainable).toBe(true);
  });

  it('buildGovernanceTrail produces correct step count', () => {
    const trail = engine.buildGovernanceTrail('col-1', ALL_DIMS);
    expect(trail.steps).toHaveLength(6);
  });

  it('buildGovernanceTrail confidence follows 65+(i%4)*8 pattern', () => {
    const trail = engine.buildGovernanceTrail('col-1', ALL_DIMS.slice(0, 4));
    expect(trail.steps[0].confidence).toBe(65);
    expect(trail.steps[1].confidence).toBe(73);
    expect(trail.steps[2].confidence).toBe(81);
    expect(trail.steps[3].confidence).toBe(89);
  });

  it('buildGovernanceTrail with runId', () => {
    const trail = engine.buildGovernanceTrail('col-1', ['audit-trail-integrity'], 'run-x');
    expect(trail.runId).toBe('run-x');
  });

  it('buildGovernanceTrail overallGovernanceConfidence is average', () => {
    const trail = engine.buildGovernanceTrail('col-1', ['audit-trail-integrity', 'policy-adherence-trace']);
    const expected = Math.round((65 + 73) / 2);
    expect(trail.overallGovernanceConfidence).toBe(expected);
  });

  it('buildGovernanceTrail has trailId and createdAt', () => {
    const trail = engine.buildGovernanceTrail('col-1', ['trust-scoring']);
    expect(trail.trailId).toBeTruthy();
    expect(trail.createdAt).toBeTruthy();
    expect(trail.governanceNote).toBeTruthy();
  });

  it('analyzeGovernanceAnomaly complianceImpact none for 0 signals', () => {
    const analysis = engine.analyzeGovernanceAnomaly('col-1', 'retry-storm', []);
    expect(analysis.complianceImpact).toBe('none');
  });

  it('analyzeGovernanceAnomaly complianceImpact low for 1 signal', () => {
    const analysis = engine.analyzeGovernanceAnomaly('col-1', 'retry-storm', ['sig1']);
    expect(analysis.complianceImpact).toBe('low');
  });

  it('analyzeGovernanceAnomaly complianceImpact critical for 6 signals', () => {
    const analysis = engine.analyzeGovernanceAnomaly('col-1', 'retry-storm', Array(6).fill('s'));
    expect(analysis.complianceImpact).toBe('critical');
  });

  it('analyzeGovernanceAnomaly has isExplainable', () => {
    const analysis = engine.analyzeGovernanceAnomaly('col-1', 'test-type', ['sig']);
    expect(analysis.isExplainable).toBe(true);
    expect(analysis.anomalyId).toBeTruthy();
  });

  it('classifyRetryGovernance within-policy for low count', () => {
    const semantics = engine.classifyRetryGovernance('col-1', 1, 5);
    expect(semantics.retryGovernanceCategory).toBe('within-policy');
  });

  it('classifyRetryGovernance borderline at threshold', () => {
    const semantics = engine.classifyRetryGovernance('col-1', 5, 5);
    expect(semantics.retryGovernanceCategory).toBe('borderline');
  });

  it('classifyRetryGovernance policy-breach slightly over', () => {
    const semantics = engine.classifyRetryGovernance('col-1', 6, 4);
    expect(semantics.retryGovernanceCategory).toBe('policy-breach');
  });

  it('classifyRetryGovernance escalation-required far over', () => {
    const semantics = engine.classifyRetryGovernance('col-1', 20, 4);
    expect(semantics.retryGovernanceCategory).toBe('escalation-required');
  });

  it('classifyRetryGovernance has isExplainable', () => {
    const semantics = engine.classifyRetryGovernance('col-1', 2, 3);
    expect(semantics.isExplainable).toBe(true);
    expect(semantics.semanticsId).toBeTruthy();
    expect(semantics.governanceNote).toBeTruthy();
  });
});
