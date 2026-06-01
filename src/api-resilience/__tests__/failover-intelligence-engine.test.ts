import { describe, it, expect, beforeEach } from 'vitest';
import { FailoverIntelligenceEngine } from '../failover-intelligence-engine';

describe('FailoverIntelligenceEngine', () => {
  let engine: FailoverIntelligenceEngine;

  beforeEach(() => {
    engine = new FailoverIntelligenceEngine();
  });

  it('buildIntelligenceTrail returns isExplainable true', () => {
    expect(engine.buildIntelligenceTrail('col1', ['replay-safety']).isExplainable).toBe(true);
  });

  it('buildIntelligenceTrail steps count matches dimensions', () => {
    const trail = engine.buildIntelligenceTrail('col1', ['orchestration-continuity', 'replay-safety', 'worker-redundancy']);
    expect(trail.steps).toHaveLength(3);
  });

  it('buildIntelligenceTrail overallSurvivabilityScore is average of step confidences', () => {
    const trail = engine.buildIntelligenceTrail('col1', ['orchestration-continuity', 'replay-safety']);
    const avg = Math.round(trail.steps.reduce((s, st) => s + st.confidence, 0) / trail.steps.length);
    expect(trail.overallSurvivabilityScore).toBe(avg);
  });

  it('buildIntelligenceTrail empty dimensions returns 0 score', () => {
    expect(engine.buildIntelligenceTrail('col1', []).overallSurvivabilityScore).toBe(0);
  });

  it('buildIntelligenceTrail unique trailId each call', () => {
    const t1 = engine.buildIntelligenceTrail('col1', ['queue-durability']);
    const t2 = engine.buildIntelligenceTrail('col1', ['queue-durability']);
    expect(t1.trailId).not.toBe(t2.trailId);
  });

  it('buildIntelligenceTrail steps have observation and recoveryInference', () => {
    const trail = engine.buildIntelligenceTrail('col1', ['dependency-resilience']);
    expect(trail.steps[0].observation).toBeTruthy();
    expect(trail.steps[0].recoveryInference).toBeTruthy();
  });

  it('buildIntelligenceTrail has governanceNote', () => {
    expect(engine.buildIntelligenceTrail('col1', ['regional-isolation']).governanceNote).toBeTruthy();
  });

  it('scoreSurvivability returns 6 dimension scores', () => {
    expect(engine.scoreSurvivability('col1').dimensionScores).toHaveLength(6);
  });

  it('scoreSurvivability overallScore is between 0 and 100', () => {
    const score = engine.scoreSurvivability('col1').overallScore;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scoreSurvivability has valid survivabilityLevel', () => {
    const level = engine.scoreSurvivability('col1').survivabilityLevel;
    expect(['excellent', 'good', 'at-risk', 'critical']).toContain(level);
  });

  it('scoreSurvivability has governanceNote', () => {
    expect(engine.scoreSurvivability('col1').governanceNote).toBeTruthy();
  });

  it('analyzeResilienceAnomaly returns isExplainable true', () => {
    expect(engine.analyzeResilienceAnomaly('col1', 'region-outage', []).isExplainable).toBe(true);
  });

  it('analyzeResilienceAnomaly with many signals gets critical impact', () => {
    const result = engine.analyzeResilienceAnomaly('col1', 'outage', ['s1', 's2', 's3', 's4']);
    expect(result.survivabilityImpact).toBe('critical');
  });

  it('analyzeResilienceAnomaly with no signals gets low impact', () => {
    expect(engine.analyzeResilienceAnomaly('col1', 'minor', []).survivabilityImpact).toBe('low');
  });

  it('analyzeResilienceAnomaly includes anomalyType in recoveryRecommendation', () => {
    const result = engine.analyzeResilienceAnomaly('col1', 'region-failover', []);
    expect(result.recoveryRecommendation).toContain('region-failover');
  });
});
