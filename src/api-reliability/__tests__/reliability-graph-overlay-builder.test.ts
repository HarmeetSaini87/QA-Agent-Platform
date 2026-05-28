import { describe, it, expect, beforeEach } from 'vitest';
import { ReliabilityGraphOverlayBuilder } from '../reliability-graph-overlay-builder';

describe('ReliabilityGraphOverlayBuilder', () => {
  let builder: ReliabilityGraphOverlayBuilder;

  beforeEach(() => {
    builder = new ReliabilityGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.overallResilienceScore).toBe(100);
    expect(overlay.totalExplainableSignals).toBe(0);
    expect(overlay.fabricHealthScore).toBe(100);
  });

  it('memoryRecords produce indicators', () => {
    const overlay = builder.build('col1', {
      memoryRecords: [{ stepId: 's1', memoryType: 'retry-pattern', confidence: 75, signal: 'Retry storm' }],
    });
    expect(overlay.indicators).toHaveLength(1);
    expect(overlay.indicators[0].overlayType).toBe('retry-evolution-trail');
  });

  it('sla-breach memoryType produces sla-optimization-signal overlay', () => {
    const overlay = builder.build('col1', {
      memoryRecords: [{ stepId: 's1', memoryType: 'sla-breach', confidence: 60, signal: 'SLA risk' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('sla-optimization-signal');
  });

  it('dependency-failure memoryType produces dependency-reliability overlay', () => {
    const overlay = builder.build('col1', {
      memoryRecords: [{ stepId: 's1', memoryType: 'dependency-failure', confidence: 55, signal: 'dep fail' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('dependency-reliability');
  });

  it('explainabilityTrails produce resilience-cognition indicators', () => {
    const overlay = builder.build('col1', {
      explainabilityTrails: [{ stepId: 's1', dimension: 'retry-evolution', confidence: 80 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('resilience-cognition');
  });

  it('optimizationProposals produce sla-optimization-signal indicators', () => {
    const overlay = builder.build('col1', {
      optimizationProposals: [{ stepId: 's1', domain: 'retry-evolution', confidence: 78 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('sla-optimization-signal');
  });

  it('antiPatterns always produce degrading trend', () => {
    const overlay = builder.build('col1', {
      antiPatterns: [{ stepId: 's1', severity: 'high', confidence: 70 }],
    });
    expect(overlay.indicators[0].reliabilityTrend).toBe('degrading');
    expect(overlay.indicators[0].overlayType).toBe('remediation-reasoning');
  });

  it('all indicators have isExplainable true', () => {
    const overlay = builder.build('col1', {
      explainabilityTrails: [{ stepId: 's1', dimension: 'sla-optimization', confidence: 70 }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.isExplainable).toBe(true);
    }
  });

  it('totalExplainableSignals equals indicator count', () => {
    const overlay = builder.build('col1', {
      memoryRecords: [{ stepId: 's1', memoryType: 'retry-pattern', confidence: 70, signal: 's' }],
      explainabilityTrails: [{ stepId: 's2', dimension: 'sla-optimization', confidence: 80 }],
    });
    expect(overlay.totalExplainableSignals).toBe(2);
  });

  it('overallResilienceScore is average of indicator resilienceScores', () => {
    const overlay = builder.build('col1', {
      explainabilityTrails: [
        { stepId: 's1', dimension: 'retry-evolution', confidence: 60 },
        { stepId: 's2', dimension: 'sla-optimization', confidence: 80 },
      ],
    });
    expect(overlay.overallResilienceScore).toBe(70);
  });

  it('overlay has governanceNote', () => {
    expect(builder.build('col1', {}).governanceNote).toBeTruthy();
  });
});
