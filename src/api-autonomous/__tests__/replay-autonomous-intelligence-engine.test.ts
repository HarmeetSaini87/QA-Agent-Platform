import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayAutonomousIntelligenceEngine } from '../replay-autonomous-intelligence-engine';

describe('ReplayAutonomousIntelligenceEngine', () => {
  let engine: ReplayAutonomousIntelligenceEngine;

  beforeEach(() => {
    engine = new ReplayAutonomousIntelligenceEngine();
    engine._reset();
  });

  it('correlateReplayWithRemediation returns a correlation', () => {
    const corr = engine.correlateReplayWithRemediation('run1', 'col1');
    expect(corr.runId).toBe('run1');
    expect(corr.collectionId).toBe('col1');
  });

  it('correlation has advisory note', () => {
    const corr = engine.correlateReplayWithRemediation('run1', 'col1');
    expect(corr.advisoryNote).toBeTruthy();
  });

  it('correlation rcaConfidence is 0–100', () => {
    const corr = engine.correlateReplayWithRemediation('run1', 'col1');
    expect(corr.rcaConfidence).toBeGreaterThanOrEqual(0);
    expect(corr.rcaConfidence).toBeLessThanOrEqual(100);
  });

  it('correlation predictedEffectiveness is 0–1', () => {
    const corr = engine.correlateReplayWithRemediation('run1', 'col1');
    expect(corr.predictedEffectiveness).toBeGreaterThanOrEqual(0);
    expect(corr.predictedEffectiveness).toBeLessThanOrEqual(1);
  });

  it('linkedPlanId is preserved in correlation', () => {
    const corr = engine.correlateReplayWithRemediation('run1', 'col1', 'plan-42');
    expect(corr.linkedPlanId).toBe('plan-42');
  });

  it('computeStabilizationInsight — instabilityScore is 0–100', () => {
    const insight = engine.computeStabilizationInsight('col1', ['r1', 'r2', 'r3']);
    expect(insight.instabilityScore).toBeGreaterThanOrEqual(0);
    expect(insight.instabilityScore).toBeLessThanOrEqual(100);
  });

  it('computeStabilizationInsight has stabilization hints', () => {
    const insight = engine.computeStabilizationInsight('col1', []);
    expect(insight.stabilizationHints.length).toBeGreaterThan(0);
  });

  it('effectiveness ingestion raises rcaConfidence', () => {
    engine.ingestEffectiveness('col1', [
      { planId: 'p1', collectionId: 'col1', actionCategory: 'retry-tuning', wasEffective: true, preRemediationMetric: 0.8, postRemediationMetric: 0.2, measuredAt: new Date().toISOString() },
      { planId: 'p2', collectionId: 'col1', actionCategory: 'retry-tuning', wasEffective: true, preRemediationMetric: 0.6, postRemediationMetric: 0.1, measuredAt: new Date().toISOString() },
    ]);
    const corr = engine.correlateReplayWithRemediation('run1', 'col1');
    expect(corr.rcaConfidence).toBeGreaterThan(50);
  });

  it('generateFailurePreventionInsights returns one per stepId', () => {
    const insights = engine.generateFailurePreventionInsights('col1', ['s1', 's2', 's3']);
    expect(insights).toHaveLength(3);
  });

  it('failureProbability is 0–1', () => {
    const insights = engine.generateFailurePreventionInsights('col1', ['s1']);
    expect(insights[0].failureProbability).toBeGreaterThanOrEqual(0);
    expect(insights[0].failureProbability).toBeLessThanOrEqual(1);
  });

  it('each insight has prevention hints', () => {
    const insights = engine.generateFailurePreventionInsights('col1', ['s1']);
    expect(insights[0].preventionHints.length).toBeGreaterThan(0);
  });
});
