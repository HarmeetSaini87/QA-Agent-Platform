import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveReliabilityIntelligence } from '../adaptive-reliability-intelligence';

describe('AdaptiveReliabilityIntelligence', () => {
  let engine: AdaptiveReliabilityIntelligence;

  beforeEach(() => {
    engine = new AdaptiveReliabilityIntelligence();
  });

  it('scoreReliability returns composite score 0–100', () => {
    const score = engine.scoreReliability('col1', { 'orchestration-stability': 80, 'retry-effectiveness': 70 });
    expect(score.compositeScore).toBeGreaterThanOrEqual(0);
    expect(score.compositeScore).toBeLessThanOrEqual(100);
  });

  it('scoreReliability returns one dimension per defined dimension', () => {
    const score = engine.scoreReliability('col1', {});
    expect(score.dimensions).toHaveLength(6);
  });

  it('scoreReliability uses provided input scores', () => {
    const score = engine.scoreReliability('col1', { 'sla-compliance': 40 });
    const sla = score.dimensions.find((d) => d.dimension === 'sla-compliance');
    expect(sla?.score).toBe(40);
  });

  it('dimensions with score >= 75 have improving trend', () => {
    const score = engine.scoreReliability('col1', { 'orchestration-stability': 90 });
    const d = score.dimensions.find((d) => d.dimension === 'orchestration-stability')!;
    expect(d.trend).toBe('improving');
  });

  it('dimensions with score < 50 have degrading trend', () => {
    const score = engine.scoreReliability('col1', { 'retry-effectiveness': 30 });
    const d = score.dimensions.find((d) => d.dimension === 'retry-effectiveness')!;
    expect(d.trend).toBe('degrading');
  });

  it('scoreReliability has governance note', () => {
    const score = engine.scoreReliability('col1', {});
    expect(score.governanceNote).toBeTruthy();
  });

  it('forecastReliability predicted score <= current for degrading dimensions', () => {
    const score = engine.scoreReliability('col1', { 'orchestration-stability': 30, 'sla-compliance': 25 });
    const forecast = engine.forecastReliability('col1', score, 24);
    expect(forecast.predictedCompositeScore).toBeLessThanOrEqual(score.compositeScore);
  });

  it('forecastReliability has advisory note', () => {
    const score = engine.scoreReliability('col1', {});
    const forecast = engine.forecastReliability('col1', score, 24);
    expect(forecast.advisoryNote).toBeTruthy();
  });

  it('assessSlaAlignment breachRiskScore > 0 when below target', () => {
    const result = engine.assessSlaAlignment('col1', 'p95', 60, 90);
    expect(result.breachRiskScore).toBeGreaterThan(0);
    expect(result.adaptationHints.length).toBeGreaterThan(0);
  });

  it('assessSlaAlignment breachRiskScore is 0 when above target', () => {
    const result = engine.assessSlaAlignment('col1', 'p95', 95, 90);
    expect(result.breachRiskScore).toBe(0);
  });
});
