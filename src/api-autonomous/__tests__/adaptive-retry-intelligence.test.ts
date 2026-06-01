import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveRetryIntelligence } from '../adaptive-retry-intelligence';

describe('AdaptiveRetryIntelligence', () => {
  let engine: AdaptiveRetryIntelligence;

  beforeEach(() => {
    engine = new AdaptiveRetryIntelligence();
  });

  it('returns one recommendation per step', () => {
    const recs = engine.recommendRetryAdaptations('col1', [
      { stepId: 's1', retryCount: 1, avgDurationMs: 500 },
      { stepId: 's2', retryCount: 2, avgDurationMs: 1000 },
    ]);
    expect(recs).toHaveLength(2);
  });

  it('high retryCount triggers retry-storm-detected signal', () => {
    const recs = engine.recommendRetryAdaptations('col1', [
      { stepId: 's1', retryCount: 5, avgDurationMs: 500 },
    ]);
    expect(recs[0].signals).toContain('retry-storm-detected');
    expect(recs[0].recommendedMaxRetries).toBeLessThan(5);
  });

  it('high avgDurationMs triggers sla-breach-risk signal', () => {
    const recs = engine.recommendRetryAdaptations('col1', [
      { stepId: 's1', retryCount: 1, avgDurationMs: 8000 },
    ]);
    expect(recs[0].signals).toContain('sla-breach-risk');
    expect(recs[0].recommendedIntervalMs).toBeGreaterThan(1000);
  });

  it('recommendations have advisory note', () => {
    const recs = engine.recommendRetryAdaptations('col1', [
      { stepId: 's1', retryCount: 2, avgDurationMs: 300 },
    ]);
    expect(recs[0].advisoryNote).toBeTruthy();
  });

  it('confidence is 0–100', () => {
    const recs = engine.recommendRetryAdaptations('col1', [
      { stepId: 's1', retryCount: 5, avgDurationMs: 6000 },
    ]);
    expect(recs[0].confidence).toBeGreaterThanOrEqual(0);
    expect(recs[0].confidence).toBeLessThanOrEqual(100);
  });

  it('adviseStormContainment — no storm when all rates low', () => {
    const advice = engine.adviseStormContainment('col1', { s1: 0.1, s2: 0.2 });
    expect(advice.stormDetected).toBe(false);
    expect(advice.containmentAction).toBe('none');
  });

  it('adviseStormContainment — storm detected above threshold', () => {
    const advice = engine.adviseStormContainment('col1', { s1: 0.9, s2: 0.1 });
    expect(advice.stormDetected).toBe(true);
    expect(advice.affectedStepIds).toContain('s1');
    expect(['reduce-retries', 'add-backoff', 'isolate-step']).toContain(advice.containmentAction);
  });

  it('governSlaRetries — breach risk > 0 when budget exceeds safe limit', () => {
    const gov = engine.governSlaRetries('col1', 'p95Latency', 5000, 4000);
    expect(gov.breachRisk).toBeGreaterThan(0);
    expect(gov.recommendedRetryBudgetMs).toBeLessThan(gov.currentRetryBudgetMs);
  });

  it('governSlaRetries — no breach risk when within budget', () => {
    const gov = engine.governSlaRetries('col1', 'p95Latency', 5000, 100);
    expect(gov.breachRisk).toBe(0);
  });
});
