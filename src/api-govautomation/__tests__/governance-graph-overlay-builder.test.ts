import { describe, it, expect, beforeEach } from 'vitest';
import { GovernanceGraphOverlayBuilder } from '../governance-graph-overlay-builder';
import type { GovernanceOverlayInput } from '../contracts/governance-graph-overlay.contracts';

describe('GovernanceGraphOverlayBuilder', () => {
  let builder: GovernanceGraphOverlayBuilder;

  beforeEach(() => {
    builder = new GovernanceGraphOverlayBuilder();
    builder._reset();
  });

  it('builds overlay for empty input', () => {
    const overlay = builder.build('col-1', {});
    expect(overlay.collectionId).toBe('col-1');
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.overallComplianceScore).toBe(100);
    expect(overlay.trustHealthScore).toBe(100);
  });

  it('builds indicators from automationDecisions', () => {
    const input: GovernanceOverlayInput = {
      automationDecisions: [{ stepId: 's1', scope: 'audit-governance', complianceScore: 80, status: 'compliant' }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators).toHaveLength(1);
    expect(overlay.indicators[0].isExplainable).toBe(true);
  });

  it('builds indicators from complianceEvaluations', () => {
    const input: GovernanceOverlayInput = {
      complianceEvaluations: [{ stepId: 's1', dimension: 'trust-integrity', score: 75 }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators).toHaveLength(1);
    expect(overlay.indicators[0].overlayType).toBe('trust-overlay');
  });

  it('builds indicators from governanceMemory', () => {
    const input: GovernanceOverlayInput = {
      governanceMemory: [{ stepId: 's1', memoryType: 'audit-record', confidence: 0.8, signal: 'audit-ok' }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators).toHaveLength(1);
  });

  it('anti-patterns always produce degrading trend', () => {
    const input: GovernanceOverlayInput = {
      antiPatterns: [{ stepId: 's1', severity: 'high', confidence: 0.9 }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators[0].governanceTrend).toBe('degrading');
  });

  it('trustHealthScore is 0 when all indicators degrading', () => {
    const input: GovernanceOverlayInput = {
      antiPatterns: [
        { stepId: 's1', severity: 'critical', confidence: 0.1 },
        { stepId: 's2', severity: 'high', confidence: 0.1 },
      ],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.trustHealthScore).toBe(0);
  });

  it('trustHealthScore is 100 when all improving', () => {
    const input: GovernanceOverlayInput = {
      automationDecisions: [{ stepId: 's1', scope: 'orchestration-policy', complianceScore: 90, status: 'compliant' }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.trustHealthScore).toBe(100);
  });

  it('totalExplainableSignals matches indicator count', () => {
    const input: GovernanceOverlayInput = {
      automationDecisions: [{ stepId: 's1', scope: 'orchestration-policy', complianceScore: 80, status: 'compliant' }],
      complianceEvaluations: [{ stepId: 's2', dimension: 'audit-continuity', score: 70 }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.totalExplainableSignals).toBe(2);
  });

  it('scope routing: replay → compliance-reasoning-trail', () => {
    const input: GovernanceOverlayInput = {
      automationDecisions: [{ stepId: 's1', scope: 'replay-governance', complianceScore: 70, status: 'compliant' }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators[0].overlayType).toBe('compliance-reasoning-trail');
  });

  it('scope routing: trust → trust-overlay', () => {
    const input: GovernanceOverlayInput = {
      automationDecisions: [{ stepId: 's1', scope: 'trust-orchestration', complianceScore: 70, status: 'compliant' }],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.indicators[0].overlayType).toBe('trust-overlay');
  });

  it('overallComplianceScore is average of indicator scores', () => {
    const input: GovernanceOverlayInput = {
      automationDecisions: [
        { stepId: 's1', scope: 'orchestration-policy', complianceScore: 80, status: 'compliant' },
        { stepId: 's2', scope: 'orchestration-policy', complianceScore: 60, status: 'compliant' },
      ],
    };
    const overlay = builder.build('col-1', input);
    expect(overlay.overallComplianceScore).toBe(70);
  });

  it('governanceNote is present on all indicators', () => {
    const input: GovernanceOverlayInput = {
      automationDecisions: [{ stepId: 's1', scope: 'audit-governance', complianceScore: 75, status: 'compliant' }],
    };
    const overlay = builder.build('col-1', input);
    overlay.indicators.forEach(i => expect(i.governanceNote).toBeTruthy());
    expect(overlay.governanceNote).toBeTruthy();
  });
});
