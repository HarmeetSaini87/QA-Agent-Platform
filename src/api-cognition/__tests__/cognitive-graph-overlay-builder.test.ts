import { describe, it, expect, beforeEach } from 'vitest';
import { CognitiveGraphOverlayBuilder } from '../cognitive-graph-overlay-builder';

describe('CognitiveGraphOverlayBuilder', () => {
  let builder: CognitiveGraphOverlayBuilder;

  beforeEach(() => {
    builder = new CognitiveGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.overallCognitionScore).toBe(100);
    expect(overlay.totalExplainableSignals).toBe(0);
  });

  it('cognitionRecords produce cognition-memory indicators by default', () => {
    const overlay = builder.build('col1', {
      cognitionRecords: [{ stepId: 's1', memoryType: 'orchestration-cognition', confidence: 70, signal: 'Retry storm' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('cognition-memory');
  });

  it('reliability-cognition memoryType produces reliability-cognition overlay', () => {
    const overlay = builder.build('col1', {
      cognitionRecords: [{ stepId: 's1', memoryType: 'reliability-cognition', confidence: 80, signal: 'SLA risk' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('reliability-cognition');
  });

  it('remediation-trail memoryType produces stabilization-history overlay', () => {
    const overlay = builder.build('col1', {
      cognitionRecords: [{ stepId: 's1', memoryType: 'remediation-trail', confidence: 75, signal: 'Healed' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('stabilization-history');
  });

  it('reasoningTrails produce reasoning-trail indicators', () => {
    const overlay = builder.build('col1', {
      reasoningTrails: [{ stepId: 's1', conclusion: 'No critical issues', confidence: 85 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('reasoning-trail');
  });

  it('optimizationProposals produce optimization-cognition indicators', () => {
    const overlay = builder.build('col1', {
      optimizationProposals: [{ stepId: 's1', domain: 'retry-effectiveness', confidence: 78 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('optimization-cognition');
  });

  it('all indicators have isExplainable true', () => {
    const overlay = builder.build('col1', {
      reasoningTrails: [{ stepId: 's1', conclusion: 'ok', confidence: 70 }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.isExplainable).toBe(true);
    }
  });

  it('totalExplainableSignals equals indicator count', () => {
    const overlay = builder.build('col1', {
      cognitionRecords: [{ stepId: 's1', memoryType: 'orchestration-cognition', confidence: 70, signal: 's' }],
      reasoningTrails: [{ stepId: 's2', conclusion: 'ok', confidence: 80 }],
    });
    expect(overlay.totalExplainableSignals).toBe(2);
  });

  it('overallCognitionScore is average of cognitionScores', () => {
    const overlay = builder.build('col1', {
      reasoningTrails: [
        { stepId: 's1', conclusion: 'ok', confidence: 60 },
        { stepId: 's2', conclusion: 'ok', confidence: 80 },
      ],
    });
    expect(overlay.overallCognitionScore).toBe(70);
  });

  it('overlay has governance note', () => {
    expect(builder.build('col1', {}).governanceNote).toBeTruthy();
  });
});
