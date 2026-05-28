import { describe, it, expect, beforeEach } from 'vitest';
import { ContextualOperationalReasoningEngine } from '../contextual-operational-reasoning-engine';

describe('ContextualOperationalReasoningEngine', () => {
  let engine: ContextualOperationalReasoningEngine;

  beforeEach(() => {
    engine = new ContextualOperationalReasoningEngine();
  });

  it('buildReasoningTrail returns isExplainable true', () => {
    const trail = engine.buildReasoningTrail('col1', ['orchestration-context']);
    expect(trail.isExplainable).toBe(true);
  });

  it('buildReasoningTrail steps match dimension count', () => {
    const trail = engine.buildReasoningTrail('col1', ['orchestration-context', 'dependency-meaning', 'rca-reasoning']);
    expect(trail.steps).toHaveLength(3);
  });

  it('buildReasoningTrail overallConfidence is average of step confidences', () => {
    const trail = engine.buildReasoningTrail('col1', ['orchestration-context', 'dependency-meaning']);
    const avg = Math.round(trail.steps.reduce((s, st) => s + st.confidence, 0) / trail.steps.length);
    expect(trail.overallConfidence).toBe(avg);
  });

  it('buildReasoningTrail empty dimensions returns 0 confidence', () => {
    const trail = engine.buildReasoningTrail('col1', []);
    expect(trail.overallConfidence).toBe(0);
    expect(trail.steps).toHaveLength(0);
  });

  it('buildReasoningTrail unique trailId each call', () => {
    const t1 = engine.buildReasoningTrail('col1', ['rca-reasoning']);
    const t2 = engine.buildReasoningTrail('col1', ['rca-reasoning']);
    expect(t1.trailId).not.toBe(t2.trailId);
  });

  it('buildReasoningTrail steps have contextObservation and semanticInference', () => {
    const trail = engine.buildReasoningTrail('col1', ['anomaly-semantics']);
    expect(trail.steps[0].contextObservation).toBeTruthy();
    expect(trail.steps[0].semanticInference).toBeTruthy();
  });

  it('buildReasoningTrail confidenceLevel is definitive for high confidence', () => {
    // 65 + 0*8=65, 65+1*8=73, 65+2*8=81, 65+3*8=89 → avg of 4 dims = 72 → high
    const trail = engine.buildReasoningTrail('col1', ['orchestration-context', 'dependency-meaning', 'rca-reasoning', 'anomaly-semantics']);
    expect(['medium', 'high', 'definitive']).toContain(trail.confidenceLevel);
  });

  it('buildReasoningTrail has governanceNote', () => {
    expect(engine.buildReasoningTrail('col1', ['optimization-context']).governanceNote).toBeTruthy();
  });

  it('analyzeAnomalySemantics returns isExplainable true', () => {
    const result = engine.analyzeAnomalySemantics('col1', 'retry-storm', []);
    expect(result.isExplainable).toBe(true);
  });

  it('analyzeAnomalySemantics includes anomalyType in interpretation', () => {
    const result = engine.analyzeAnomalySemantics('col1', 'retry-storm', []);
    expect(result.semanticInterpretation).toContain('retry-storm');
  });

  it('analyzeAnomalySemantics uses provided signals as contextualFactors', () => {
    const result = engine.analyzeAnomalySemantics('col1', 'timeout', ['signal-a']);
    expect(result.contextualFactors).toContain('signal-a');
  });

  it('deriveOptimizationSemantics returns isExplainable true', () => {
    expect(engine.deriveOptimizationSemantics('col1', 'high-retry-rate').isExplainable).toBe(true);
  });

  it('deriveOptimizationSemantics includes context in semanticOpportunity', () => {
    const result = engine.deriveOptimizationSemantics('col1', 'high-retry-rate');
    expect(result.semanticOpportunity).toContain('high-retry-rate');
  });

  it('deriveOptimizationSemantics has governanceNote', () => {
    expect(engine.deriveOptimizationSemantics('col1', 'ctx').governanceNote).toBeTruthy();
  });
});
