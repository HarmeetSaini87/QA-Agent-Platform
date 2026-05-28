import { describe, it, expect, beforeEach } from 'vitest';
import { AiGraphOverlayBuilder } from '../ai-graph-overlay-builder';

describe('AiGraphOverlayBuilder', () => {
  let builder: AiGraphOverlayBuilder;

  beforeEach(() => {
    builder = new AiGraphOverlayBuilder();
  });

  it('builds overlay with empty context', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.collectionId).toBe('col1');
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.dependencyRisk.riskEdges).toHaveLength(0);
  });

  it('flakinessForecast produces predicted-flakiness indicators', () => {
    const overlay = builder.build('col1', {
      flakinessForecast: [{ stepId: 's1', score: 80, confidence: 75 }],
    });
    expect(overlay.indicators).toHaveLength(1);
    expect(overlay.indicators[0].indicatorType).toBe('predicted-flakiness');
    expect(overlay.indicators[0].nodeId).toBe('s1');
  });

  it('retryHotspots produces retry-storm-risk indicators', () => {
    const overlay = builder.build('col1', {
      retryHotspots: [{ stepId: 's2', retryRate: 0.6 }],
    });
    expect(overlay.indicators[0].indicatorType).toBe('retry-storm-risk');
  });

  it('rcaCorrelations produces rca-hotspot indicators', () => {
    const overlay = builder.build('col1', {
      rcaCorrelations: [{ stepId: 's3', confidence: 85, hypothesis: 'Step failed due to env' }],
    });
    expect(overlay.indicators[0].indicatorType).toBe('rca-hotspot');
  });

  it('dependencyEdges appear in riskEdges', () => {
    const overlay = builder.build('col1', {
      dependencyEdges: [{ from: 'a', to: 'b' }],
    });
    expect(overlay.dependencyRisk.riskEdges).toHaveLength(1);
    expect(overlay.dependencyRisk.riskEdges[0].fromStepId).toBe('a');
  });

  it('overlay has advisory note', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.advisoryNote).toBeTruthy();
  });

  it('indicator scores are 0–100', () => {
    const overlay = builder.build('col1', {
      flakinessForecast: [{ stepId: 's1', score: 50, confidence: 70 }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.score).toBeGreaterThanOrEqual(0);
      expect(ind.score).toBeLessThanOrEqual(100);
    }
  });

  it('indicator advisoryNote is set', () => {
    const overlay = builder.build('col1', {
      flakinessForecast: [{ stepId: 's1', score: 40, confidence: 60 }],
    });
    expect(overlay.indicators[0].advisoryNote).toBeTruthy();
  });
});
