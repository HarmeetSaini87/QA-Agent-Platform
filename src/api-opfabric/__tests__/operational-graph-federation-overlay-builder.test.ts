import { describe, it, expect, beforeEach } from 'vitest';
import { OperationalFederationGraphOverlayBuilder } from '../operational-graph-federation-overlay-builder';

describe('OperationalFederationGraphOverlayBuilder', () => {
  let builder: OperationalFederationGraphOverlayBuilder;

  beforeEach(() => {
    builder = new OperationalFederationGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.overallFederationScore).toBe(100);
    expect(overlay.totalExplainableSignals).toBe(0);
    expect(overlay.fabricGovernanceScore).toBe(100);
  });

  it('propagations with orchestration-governance produce orchestration-federation overlay', () => {
    const overlay = builder.build('col1', {
      propagations: [{ stepId: 's1', scope: 'orchestration-governance', confidence: 80 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('orchestration-federation');
  });

  it('propagations with replay-governance produce replay-optimization-reasoning overlay', () => {
    const overlay = builder.build('col1', {
      propagations: [{ stepId: 's1', scope: 'replay-governance', confidence: 70 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('replay-optimization-reasoning');
  });

  it('memoryEntries with retry-stabilization produce adaptive-stabilization-federation', () => {
    const overlay = builder.build('col1', {
      memoryEntries: [{ stepId: 's1', federationType: 'retry-stabilization', confidence: 75, signal: 'Retry' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('adaptive-stabilization-federation');
  });

  it('federationProposals produce explainable-governance-trail overlay', () => {
    const overlay = builder.build('col1', {
      federationProposals: [{ stepId: 's1', domain: 'retry-governance', confidence: 78 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('explainable-governance-trail');
  });

  it('antiPatterns always produce degrading governanceTrend', () => {
    const overlay = builder.build('col1', {
      antiPatterns: [{ stepId: 's1', severity: 'high', confidence: 70 }],
    });
    expect(overlay.indicators[0].governanceTrend).toBe('degrading');
    expect(overlay.indicators[0].overlayType).toBe('resilience-federation-cognition');
  });

  it('all indicators have isExplainable true', () => {
    const overlay = builder.build('col1', {
      propagations: [{ stepId: 's1', scope: 'reliability-governance', confidence: 70 }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.isExplainable).toBe(true);
    }
  });

  it('totalExplainableSignals equals indicator count', () => {
    const overlay = builder.build('col1', {
      propagations: [{ stepId: 's1', scope: 'orchestration-governance', confidence: 70 }],
      memoryEntries: [{ stepId: 's2', federationType: 'sla-governance', confidence: 80, signal: 'SLA' }],
    });
    expect(overlay.totalExplainableSignals).toBe(2);
  });

  it('overallFederationScore is average of indicator federationScores', () => {
    const overlay = builder.build('col1', {
      propagations: [
        { stepId: 's1', scope: 'orchestration-governance', confidence: 60 },
        { stepId: 's2', scope: 'replay-governance', confidence: 80 },
      ],
    });
    expect(overlay.overallFederationScore).toBe(70);
  });

  it('fabricGovernanceScore is 0 when all indicators degrading', () => {
    const overlay = builder.build('col1', {
      antiPatterns: [
        { stepId: 's1', severity: 'critical', confidence: 40 },
        { stepId: 's2', severity: 'high', confidence: 45 },
      ],
    });
    expect(overlay.fabricGovernanceScore).toBe(0);
  });

  it('overlay has governanceNote', () => {
    expect(builder.build('col1', {}).governanceNote).toBeTruthy();
  });
});
