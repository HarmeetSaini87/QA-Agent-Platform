import { describe, it, expect, beforeEach } from 'vitest';
import { ResilienceGraphOverlayBuilder } from '../resilience-graph-overlay-builder';

describe('ResilienceGraphOverlayBuilder', () => {
  let builder: ResilienceGraphOverlayBuilder;

  beforeEach(() => {
    builder = new ResilienceGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.overallSurvivabilityScore).toBe(100);
    expect(overlay.totalExplainableSignals).toBe(0);
    expect(overlay.continuityHealthScore).toBe(100);
  });

  it('failoverRecords produce failover-reasoning-trail overlay', () => {
    const overlay = builder.build('col1', {
      failoverRecords: [{ stepId: 's1', triggerReason: 'region degraded', confidence: 80 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('failover-reasoning-trail');
  });

  it('continuityMemory with failover-event produces failover-reasoning-trail', () => {
    const overlay = builder.build('col1', {
      continuityMemory: [{ stepId: 's1', memoryType: 'failover-event', confidence: 75, signal: 'Failover' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('failover-reasoning-trail');
  });

  it('continuityMemory with replay-continuity produces continuity-evolution-trail', () => {
    const overlay = builder.build('col1', {
      continuityMemory: [{ stepId: 's1', memoryType: 'replay-continuity', confidence: 70, signal: 'Replay' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('continuity-evolution-trail');
  });

  it('survivabilityScores with dependency-resilience produce dependency-survivability', () => {
    const overlay = builder.build('col1', {
      survivabilityScores: [{ stepId: 's1', dimension: 'dependency-resilience', score: 72 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('dependency-survivability');
  });

  it('outagePatterns always produce degrading resilienceTrend', () => {
    const overlay = builder.build('col1', {
      outagePatterns: [{ stepId: 's1', severity: 'critical', confidence: 55 }],
    });
    expect(overlay.indicators[0].resilienceTrend).toBe('degrading');
    expect(overlay.indicators[0].overlayType).toBe('outage-pattern-signal');
  });

  it('all indicators have isExplainable true', () => {
    const overlay = builder.build('col1', {
      failoverRecords: [{ stepId: 's1', triggerReason: 'test', confidence: 70 }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.isExplainable).toBe(true);
    }
  });

  it('totalExplainableSignals equals indicator count', () => {
    const overlay = builder.build('col1', {
      failoverRecords: [{ stepId: 's1', triggerReason: 'r', confidence: 70 }],
      continuityMemory: [{ stepId: 's2', memoryType: 'worker-recovery', confidence: 80, signal: 'W' }],
    });
    expect(overlay.totalExplainableSignals).toBe(2);
  });

  it('overallSurvivabilityScore is average of survivabilityScores', () => {
    const overlay = builder.build('col1', {
      failoverRecords: [
        { stepId: 's1', triggerReason: 'r', confidence: 60 },
        { stepId: 's2', triggerReason: 'r', confidence: 80 },
      ],
    });
    expect(overlay.overallSurvivabilityScore).toBe(70);
  });

  it('continuityHealthScore is 0 when all indicators degrading', () => {
    const overlay = builder.build('col1', {
      outagePatterns: [
        { stepId: 's1', severity: 'critical', confidence: 40 },
        { stepId: 's2', severity: 'high', confidence: 45 },
      ],
    });
    expect(overlay.continuityHealthScore).toBe(0);
  });

  it('overlay has governanceNote', () => {
    expect(builder.build('col1', {}).governanceNote).toBeTruthy();
  });
});
