import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayUnifiedOperationalReasoningEngine } from '../replay-unified-operational-reasoning-engine';
import type { OperationalReasoningDimension } from '../contracts/replay-unified-operational-reasoning.contracts';

const ALL_DIMS: OperationalReasoningDimension[] = [
  'orchestration-continuity', 'replay-governance-trace', 'dependency-continuity',
  'retry-harmonization', 'trust-federation-scoring', 'operational-anomaly-governance',
];

describe('ReplayUnifiedOperationalReasoningEngine', () => {
  let engine: ReplayUnifiedOperationalReasoningEngine;

  beforeEach(() => {
    engine = new ReplayUnifiedOperationalReasoningEngine();
    engine._reset();
  });

  it('buildReasoningTrail returns isExplainable', () => {
    const trail = engine.buildReasoningTrail('col-1', ['orchestration-continuity']);
    expect(trail.isExplainable).toBe(true);
  });

  it('buildReasoningTrail produces correct step count', () => {
    const trail = engine.buildReasoningTrail('col-1', ALL_DIMS);
    expect(trail.steps).toHaveLength(6);
  });

  it('buildReasoningTrail confidence follows 65+(i%4)*8', () => {
    const trail = engine.buildReasoningTrail('col-1', ALL_DIMS.slice(0, 4));
    expect(trail.steps[0].confidence).toBe(65);
    expect(trail.steps[1].confidence).toBe(73);
    expect(trail.steps[2].confidence).toBe(81);
    expect(trail.steps[3].confidence).toBe(89);
  });

  it('buildReasoningTrail with runId', () => {
    const trail = engine.buildReasoningTrail('col-1', ['retry-harmonization'], 'run-x');
    expect(trail.runId).toBe('run-x');
  });

  it('buildReasoningTrail overallContinuityConfidence is average', () => {
    const trail = engine.buildReasoningTrail('col-1', ['orchestration-continuity', 'replay-governance-trace']);
    expect(trail.overallContinuityConfidence).toBe(Math.round((65 + 73) / 2));
  });

  it('buildReasoningTrail has trailId and createdAt', () => {
    const trail = engine.buildReasoningTrail('col-1', ['trust-federation-scoring']);
    expect(trail.trailId).toBeTruthy();
    expect(trail.createdAt).toBeTruthy();
    expect(trail.governanceNote).toBeTruthy();
  });

  it('analyzeOrchestrationAnomaly platformImpact none for 0 signals', () => {
    expect(engine.analyzeOrchestrationAnomaly('col-1', 'test', []).platformImpact).toBe('none');
  });

  it('analyzeOrchestrationAnomaly platformImpact low for 1 signal', () => {
    expect(engine.analyzeOrchestrationAnomaly('col-1', 'test', ['s1']).platformImpact).toBe('low');
  });

  it('analyzeOrchestrationAnomaly platformImpact critical for 6 signals', () => {
    expect(engine.analyzeOrchestrationAnomaly('col-1', 'test', Array(6).fill('s')).platformImpact).toBe('critical');
  });

  it('analyzeOrchestrationAnomaly has isExplainable and anomalyId', () => {
    const r = engine.analyzeOrchestrationAnomaly('col-1', 'retry-storm', ['sig']);
    expect(r.isExplainable).toBe(true);
    expect(r.anomalyId).toBeTruthy();
    expect(r.unificationRecommendation).toBeTruthy();
  });

  it('harmonizeRetryGovernance within-unified-policy for low count', () => {
    expect(engine.harmonizeRetryGovernance('col-1', 1, 5).harmonizationCategory).toBe('within-unified-policy');
  });

  it('harmonizeRetryGovernance borderline-unified at threshold', () => {
    expect(engine.harmonizeRetryGovernance('col-1', 5, 5).harmonizationCategory).toBe('borderline-unified');
  });

  it('harmonizeRetryGovernance policy-fragmentation slightly over', () => {
    expect(engine.harmonizeRetryGovernance('col-1', 6, 4).harmonizationCategory).toBe('policy-fragmentation');
  });

  it('harmonizeRetryGovernance escalation-required far over', () => {
    expect(engine.harmonizeRetryGovernance('col-1', 20, 4).harmonizationCategory).toBe('escalation-required');
  });

  it('harmonizeRetryGovernance has isExplainable and ids', () => {
    const h = engine.harmonizeRetryGovernance('col-1', 2, 3);
    expect(h.isExplainable).toBe(true);
    expect(h.harmonizationId).toBeTruthy();
    expect(h.governanceNote).toBeTruthy();
  });
});
