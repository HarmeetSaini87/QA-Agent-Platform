import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayExplainabilityEngine } from '../replay-explainability-engine';

describe('ReplayExplainabilityEngine', () => {
  let engine: ReplayExplainabilityEngine;

  beforeEach(() => {
    engine = new ReplayExplainabilityEngine();
  });

  it('buildTrail returns isExplainable true', () => {
    const trail = engine.buildTrail('col1', 'run1', ['retry-evolution']);
    expect(trail.isExplainable).toBe(true);
  });

  it('buildTrail has unique trailId each call', () => {
    const t1 = engine.buildTrail('col1', 'run1', ['retry-evolution']);
    const t2 = engine.buildTrail('col1', 'run1', ['retry-evolution']);
    expect(t1.trailId).not.toBe(t2.trailId);
  });

  it('buildTrail steps count matches dimensions', () => {
    const trail = engine.buildTrail('col1', 'run1', ['retry-evolution', 'dependency-stabilization', 'sla-optimization']);
    expect(trail.steps).toHaveLength(3);
  });

  it('buildTrail overallConfidence is average of step confidences', () => {
    const trail = engine.buildTrail('col1', 'run1', ['retry-evolution', 'dependency-stabilization']);
    const avg = Math.round(trail.steps.reduce((s, st) => s + st.confidence, 0) / trail.steps.length);
    expect(trail.overallConfidence).toBe(avg);
  });

  it('buildTrail empty dimensions returns 0 confidence', () => {
    const trail = engine.buildTrail('col1', 'run1', []);
    expect(trail.overallConfidence).toBe(0);
    expect(trail.steps).toHaveLength(0);
  });

  it('buildTrail steps have observation and inference', () => {
    const trail = engine.buildTrail('col1', 'run1', ['orchestration-resilience']);
    expect(trail.steps[0].observation).toBeTruthy();
    expect(trail.steps[0].inference).toBeTruthy();
  });

  it('explainRetryEvolution returns isExplainable true', () => {
    const exp = engine.explainRetryEvolution('col1', ['retry-storm']);
    expect(exp.isExplainable).toBe(true);
  });

  it('explainRetryEvolution has governanceNote', () => {
    expect(engine.explainRetryEvolution('col1', []).governanceNote).toBeTruthy();
  });

  it('explainRetryEvolution uses provided signals', () => {
    const exp = engine.explainRetryEvolution('col1', ['signal-a', 'signal-b']);
    expect(exp.evidenceSignals).toContain('signal-a');
  });

  it('explainDependencyStabilization sets dependencyId', () => {
    const exp = engine.explainDependencyStabilization('col1', 'dep-x', []);
    expect(exp.dependencyId).toBe('dep-x');
    expect(exp.isExplainable).toBe(true);
  });

  it('explainSlaOptimization returns isExplainable true', () => {
    const exp = engine.explainSlaOptimization('col1', 60);
    expect(exp.isExplainable).toBe(true);
  });

  it('explainSlaOptimization reasoningChain has entries', () => {
    const exp = engine.explainSlaOptimization('col1', 70);
    expect(exp.reasoningChain.length).toBeGreaterThan(0);
  });

  it('explainSlaOptimization reflects currentSlaScore', () => {
    const exp = engine.explainSlaOptimization('col1', 55);
    expect(exp.currentSlaScore).toBe(55);
  });
});
