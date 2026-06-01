import { describe, it, expect, beforeEach } from 'vitest';
import { UnifiedGraphGovernanceOverlayBuilder } from '../unified-graph-governance-overlay-builder';
import type { UnifiedGovernanceOverlayInput } from '../contracts/unified-graph-governance-overlay.contracts';

describe('UnifiedGraphGovernanceOverlayBuilder', () => {
  let builder: UnifiedGraphGovernanceOverlayBuilder;

  beforeEach(() => {
    builder = new UnifiedGraphGovernanceOverlayBuilder();
    builder._reset();
  });

  it('builds empty overlay', () => {
    const overlay = builder.build('col-1', {});
    expect(overlay.collectionId).toBe('col-1');
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.overallPlatformScore).toBe(100);
    expect(overlay.platformHealthScore).toBe(100);
  });

  it('builds indicators from orchestrationDecisions', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationDecisions: [{ stepId: 's1', scope: 'trust-coordination', governanceScore: 80, status: 'governed' }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators).toHaveLength(1);
    expect(overlay.indicators[0].isExplainable).toBe(true);
    expect(overlay.indicators[0].overlayType).toBe('orchestration-trust-overlay');
  });

  it('builds indicators from consolidationScores', () => {
    const input: UnifiedGovernanceOverlayInput = {
      consolidationScores: [{ stepId: 's1', domain: 'replay-continuity', unificationScore: 75 }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators).toHaveLength(1);
    expect(overlay.indicators[0].overlayType).toBe('replay-governance-reasoning-trail');
  });

  it('builds indicators from enterpriseMemory', () => {
    const input: UnifiedGovernanceOverlayInput = {
      enterpriseMemory: [{ stepId: 's1', memoryType: 'orchestration-federation-memory', confidence: 0.8, signal: 'signal-a' }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators).toHaveLength(1);
  });

  it('anti-patterns always produce degrading trend', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationAntiPatterns: [{ stepId: 's1', severity: 'critical', confidence: 0.9 }],
    };
    expect(builder.build('col-1', input).indicators[0].governanceTrend).toBe('degrading');
  });

  it('platformHealthScore 0 when all degrading', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationAntiPatterns: [
        { stepId: 's1', severity: 'critical', confidence: 0.1 },
        { stepId: 's2', severity: 'high', confidence: 0.1 },
      ],
    };
    expect(builder.build('col-1', input).platformHealthScore).toBe(0);
  });

  it('platformHealthScore 100 when all improving', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationDecisions: [{ stepId: 's1', scope: 'orchestration-federation', governanceScore: 90, status: 'governed' }],
    };
    expect(builder.build('col-1', input).platformHealthScore).toBe(100);
  });

  it('totalExplainableSignals matches indicator count', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationDecisions: [{ stepId: 's1', scope: 'platform-consolidation', governanceScore: 80, status: 'governed' }],
      consolidationScores: [{ stepId: 's2', domain: 'trust-coordination', unificationScore: 70 }],
    };
    expect(builder.build('col-1', input).totalExplainableSignals).toBe(2);
  });

  it('overallPlatformScore is average of indicator scores', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationDecisions: [
        { stepId: 's1', scope: 'orchestration-federation', governanceScore: 80, status: 'governed' },
        { stepId: 's2', scope: 'orchestration-federation', governanceScore: 60, status: 'governed' },
      ],
    };
    expect(builder.build('col-1', input).overallPlatformScore).toBe(70);
  });

  it('scope routing: replay → replay-governance-reasoning-trail', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationDecisions: [{ stepId: 's1', scope: 'replay-continuity', governanceScore: 70, status: 'governed' }],
    };
    expect(builder.build('col-1', input).indicators[0].overlayType).toBe('replay-governance-reasoning-trail');
  });

  it('scope routing: platform → platform-consolidation-signal', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationDecisions: [{ stepId: 's1', scope: 'platform-consolidation', governanceScore: 70, status: 'governed' }],
    };
    expect(builder.build('col-1', input).indicators[0].overlayType).toBe('platform-consolidation-signal');
  });

  it('governanceNote present on all indicators and overlay', () => {
    const input: UnifiedGovernanceOverlayInput = {
      orchestrationDecisions: [{ stepId: 's1', scope: 'orchestration-federation', governanceScore: 75, status: 'governed' }],
    };
    const overlay = builder.build('col-1', input);
    overlay.indicators.forEach(i => expect(i.governanceNote).toBeTruthy());
    expect(overlay.governanceNote).toBeTruthy();
  });
});
