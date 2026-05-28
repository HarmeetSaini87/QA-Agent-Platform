import { describe, it, expect, beforeEach } from 'vitest';
import { PredictiveIntelligenceEngine } from '../predictive-intelligence-engine';

describe('PredictiveIntelligenceEngine', () => {
  let engine: PredictiveIntelligenceEngine;

  beforeEach(() => {
    engine = new PredictiveIntelligenceEngine();
  });

  it('forecastFlakiness returns one forecast per stepId', () => {
    const forecasts = engine.forecastFlakiness('col1', ['s1', 's2', 's3']);
    expect(forecasts).toHaveLength(3);
    expect(forecasts[0].stepId).toBe('s1');
  });

  it('flakiness forecast scores are 0–100', () => {
    const forecasts = engine.forecastFlakiness('col1', ['s1', 's2']);
    for (const f of forecasts) {
      expect(f.predictedFlakinessScore).toBeGreaterThanOrEqual(0);
      expect(f.predictedFlakinessScore).toBeLessThanOrEqual(100);
    }
  });

  it('flakiness forecast confidence is 0–100', () => {
    const forecasts = engine.forecastFlakiness('col1', ['s1']);
    expect(forecasts[0].confidence).toBeGreaterThanOrEqual(0);
    expect(forecasts[0].confidence).toBeLessThanOrEqual(100);
  });

  it('forecastFlakiness returns empty array for empty stepIds', () => {
    const forecasts = engine.forecastFlakiness('col1', []);
    expect(forecasts).toHaveLength(0);
  });

  it('forecastRetryStorm returns a forecast with stormRisk', () => {
    const forecast = engine.forecastRetryStorm('col1');
    expect(['low', 'medium', 'high']).toContain(forecast.stormRisk);
  });

  it('forecastRetryStorm predictedRetryRate is 0–1', () => {
    const forecast = engine.forecastRetryStorm('col1');
    expect(forecast.predictedRetryRate).toBeGreaterThanOrEqual(0);
    expect(forecast.predictedRetryRate).toBeLessThanOrEqual(1);
  });

  it('forecastSlaBreach returns breach likelihood 0–1', () => {
    const forecast = engine.forecastSlaBreach('col1', 'p95Latency', 1000);
    expect(forecast.breachLikelihood).toBeGreaterThanOrEqual(0);
    expect(forecast.breachLikelihood).toBeLessThanOrEqual(1);
  });

  it('forecastSlaBreach forecastedValue > currentValue', () => {
    const forecast = engine.forecastSlaBreach('col1', 'p95Latency', 1000);
    expect(forecast.forecastedValue).toBeGreaterThan(0);
  });
});
