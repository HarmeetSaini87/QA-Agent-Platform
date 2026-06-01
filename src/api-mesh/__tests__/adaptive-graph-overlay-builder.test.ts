import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveMeshGraphOverlayBuilder } from '../adaptive-graph-overlay-builder';

describe('AdaptiveMeshGraphOverlayBuilder', () => {
  let builder: AdaptiveMeshGraphOverlayBuilder;

  beforeEach(() => {
    builder = new AdaptiveMeshGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.collectionId).toBe('col1');
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.totalMemorySignals).toBe(0);
    expect(overlay.meshHealthScore).toBe(100);
  });

  it('knowledgeEntries produce orchestration-memory indicators by default', () => {
    const overlay = builder.build('col1', {
      knowledgeEntries: [{ stepId: 's1', memoryType: 'rca-recurring', score: 60 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('orchestration-memory');
  });

  it('retry-optimization memoryType produces replay-optimization-trail', () => {
    const overlay = builder.build('col1', {
      knowledgeEntries: [{ stepId: 's1', memoryType: 'retry-optimization', score: 70 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('replay-optimization-trail');
  });

  it('dependency-instability memoryType produces dependency-learning', () => {
    const overlay = builder.build('col1', {
      knowledgeEntries: [{ stepId: 's1', memoryType: 'dependency-instability', score: 55 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('dependency-learning');
  });

  it('reliabilityScores produce reliability-trend indicators', () => {
    const overlay = builder.build('col1', {
      reliabilityScores: [{ stepId: 's1', score: 80, trend: 'improving' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('reliability-trend');
    expect(overlay.indicators[0].reliabilityTrend).toBe('improving');
  });

  it('antiPatternAlerts produce anti-pattern-alert indicators with degrading trend', () => {
    const overlay = builder.build('col1', {
      antiPatternAlerts: [{ stepId: 's1', severity: 'high', patternKey: 'retry-storm' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('anti-pattern-alert');
    expect(overlay.indicators[0].reliabilityTrend).toBe('degrading');
  });

  it('critical severity anti-pattern has high memoryScore', () => {
    const overlay = builder.build('col1', {
      antiPatternAlerts: [{ stepId: 's1', severity: 'critical', patternKey: 'p1' }],
    });
    expect(overlay.indicators[0].memoryScore).toBe(90);
  });

  it('totalMemorySignals equals indicator count', () => {
    const overlay = builder.build('col1', {
      knowledgeEntries: [{ stepId: 's1', memoryType: 'rca-recurring', score: 60 }],
      reliabilityScores: [{ stepId: 's2', score: 70, trend: 'stable' }],
    });
    expect(overlay.totalMemorySignals).toBe(2);
  });

  it('meshHealthScore is average of memoryScores', () => {
    const overlay = builder.build('col1', {
      reliabilityScores: [
        { stepId: 's1', score: 60, trend: 'stable' },
        { stepId: 's2', score: 80, trend: 'improving' },
      ],
    });
    expect(overlay.meshHealthScore).toBe(70);
  });

  it('all indicators have advisory note', () => {
    const overlay = builder.build('col1', {
      antiPatternAlerts: [{ stepId: 's1', severity: 'medium', patternKey: 'p1' }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.advisoryNote).toBeTruthy();
    }
  });
});
