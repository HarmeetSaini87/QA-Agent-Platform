// src/api-analytics/__tests__/sla-intelligence-engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SlaIntelligenceEngine } from '../sla-intelligence-engine';

describe('SlaIntelligenceEngine', () => {
  let engine: SlaIntelligenceEngine;

  beforeEach(() => {
    engine = new SlaIntelligenceEngine();
    engine.registerPolicy({
      policyId: 'p1',
      maxLatencyMs: 5000,
      maxRetryRate: 0.2,
      minPassRate: 0.8,
      maxTeardownFailureRate: 0.1,
    });
  });

  it('evaluate: healthy scorecard when all within thresholds', () => {
    const card = engine.evaluate('col-1', 'p1', { avgLatencyMs: 1000, retryRate: 0.05, passRate: 0.95, teardownFailureRate: 0.02 });
    expect(card.healthy).toBe(true);
    expect(card.score).toBe(100);
    expect(card.breaches).toHaveLength(0);
  });

  it('evaluate: latency breach detected', () => {
    const card = engine.evaluate('col-1', 'p1', { avgLatencyMs: 8000, retryRate: 0.05, passRate: 0.95, teardownFailureRate: 0.02 });
    expect(card.healthy).toBe(false);
    expect(card.breaches.some(b => b.breachType === 'latency')).toBe(true);
    expect(card.score).toBe(75);
  });

  it('evaluate: pass-rate breach detected', () => {
    const card = engine.evaluate('col-1', 'p1', { avgLatencyMs: 1000, retryRate: 0.05, passRate: 0.5, teardownFailureRate: 0.02 });
    expect(card.breaches.some(b => b.breachType === 'pass-rate')).toBe(true);
  });

  it('evaluate: multiple breaches reduce score proportionally', () => {
    const card = engine.evaluate('col-1', 'p1', { avgLatencyMs: 9000, retryRate: 0.5, passRate: 0.3, teardownFailureRate: 0.5 });
    expect(card.breaches.length).toBe(4);
    expect(card.score).toBe(0);
  });

  it('evaluate: no policy = healthy by default', () => {
    const card = engine.evaluate('col-1', 'ghost-policy', { avgLatencyMs: 99999, retryRate: 1, passRate: 0, teardownFailureRate: 1 });
    expect(card.healthy).toBe(true);
  });

  it('listBreaches: returns recorded breaches for collection', () => {
    engine.evaluate('col-1', 'p1', { avgLatencyMs: 9000, retryRate: 0.05, passRate: 0.95, teardownFailureRate: 0.02 });
    expect(engine.listBreaches('col-1').length).toBeGreaterThan(0);
  });
});
