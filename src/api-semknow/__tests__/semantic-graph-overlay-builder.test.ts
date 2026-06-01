import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraphOverlayBuilder } from '../semantic-graph-overlay-builder';

describe('SemanticGraphOverlayBuilder', () => {
  let builder: SemanticGraphOverlayBuilder;

  beforeEach(() => {
    builder = new SemanticGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.overallSemanticScore).toBe(100);
    expect(overlay.totalExplainableSignals).toBe(0);
    expect(overlay.semanticHealthScore).toBe(100);
  });

  it('knowledgeNodes with orchestration-step produce orchestration-semantic overlay', () => {
    const overlay = builder.build('col1', {
      knowledgeNodes: [{ stepId: 's1', nodeType: 'orchestration-step', confidence: 80, label: 'Auth step' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('orchestration-semantic');
  });

  it('knowledgeNodes with dependency produce dependency-semantic overlay', () => {
    const overlay = builder.build('col1', {
      knowledgeNodes: [{ stepId: 's1', nodeType: 'dependency', confidence: 70, label: 'Dep A' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('dependency-semantic');
  });

  it('knowledgeNodes with retry-pattern produce retry-semantic-cluster overlay', () => {
    const overlay = builder.build('col1', {
      knowledgeNodes: [{ stepId: 's1', nodeType: 'retry-pattern', confidence: 65, label: 'Retry' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('retry-semantic-cluster');
  });

  it('replayCorrelations with retry-semantic produce retry-semantic-cluster', () => {
    const overlay = builder.build('col1', {
      replayCorrelations: [{ stepId: 's1', category: 'retry-semantic', confidence: 75 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('retry-semantic-cluster');
  });

  it('reasoningTrails produce semantic-evolution-trail overlay', () => {
    const overlay = builder.build('col1', {
      reasoningTrails: [{ stepId: 's1', dimension: 'orchestration-context', confidence: 80 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('semantic-evolution-trail');
  });

  it('antiPatterns produce remediation-semantic with degrading trend', () => {
    const overlay = builder.build('col1', {
      antiPatterns: [{ stepId: 's1', severity: 'high', confidence: 60 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('remediation-semantic');
    expect(overlay.indicators[0].semanticTrend).toBe('degrading');
  });

  it('all indicators have isExplainable true', () => {
    const overlay = builder.build('col1', {
      knowledgeNodes: [{ stepId: 's1', nodeType: 'sla-constraint', confidence: 70, label: 'SLA' }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.isExplainable).toBe(true);
    }
  });

  it('totalExplainableSignals equals indicator count', () => {
    const overlay = builder.build('col1', {
      knowledgeNodes: [{ stepId: 's1', nodeType: 'orchestration-step', confidence: 70, label: 'A' }],
      replayCorrelations: [{ stepId: 's2', category: 'execution-context', confidence: 80 }],
    });
    expect(overlay.totalExplainableSignals).toBe(2);
  });

  it('overallSemanticScore is average of semanticScores', () => {
    const overlay = builder.build('col1', {
      replayCorrelations: [
        { stepId: 's1', category: 'execution-context', confidence: 60 },
        { stepId: 's2', category: 'orchestration-intent', confidence: 80 },
      ],
    });
    expect(overlay.overallSemanticScore).toBe(70);
  });

  it('semanticHealthScore is 0 when all degrading', () => {
    const overlay = builder.build('col1', {
      antiPatterns: [
        { stepId: 's1', severity: 'critical', confidence: 40 },
        { stepId: 's2', severity: 'high', confidence: 45 },
      ],
    });
    expect(overlay.semanticHealthScore).toBe(0);
  });

  it('overlay has governanceNote', () => {
    expect(builder.build('col1', {}).governanceNote).toBeTruthy();
  });
});
