import { describe, it, expect, beforeEach } from 'vitest';
import { AutonomousGraphOverlayBuilder } from '../autonomous-graph-overlay-builder';

describe('AutonomousGraphOverlayBuilder', () => {
  let builder: AutonomousGraphOverlayBuilder;

  beforeEach(() => {
    builder = new AutonomousGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.collectionId).toBe('col1');
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.totalRemediationPending).toBe(0);
    expect(overlay.totalStabilizationCandidates).toBe(0);
  });

  it('remediation-pending plan produces remediation-pending indicator', () => {
    const overlay = builder.build('col1', {
      remediationPlans: [{ stepId: 's1', planId: 'p1', status: 'pending-approval', confidence: 70 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('remediation-pending');
    expect(overlay.indicators[0].linkedPlanId).toBe('p1');
  });

  it('approved plan produces remediation-approved indicator', () => {
    const overlay = builder.build('col1', {
      remediationPlans: [{ stepId: 's1', planId: 'p1', status: 'approved', confidence: 85 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('remediation-approved');
  });

  it('stabilizationInsights produce stabilization-candidate indicators', () => {
    const overlay = builder.build('col1', {
      stabilizationInsights: [{ stepId: 's2', instabilityScore: 60 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('stabilization-candidate');
    expect(overlay.totalStabilizationCandidates).toBe(1);
  });

  it('retryAdaptations produce retry-adaptation-hint indicators', () => {
    const overlay = builder.build('col1', {
      retryAdaptations: [{ stepId: 's3', confidence: 75 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('retry-adaptation-hint');
  });

  it('totalRemediationPending counts only pending indicators', () => {
    const overlay = builder.build('col1', {
      remediationPlans: [
        { stepId: 's1', planId: 'p1', status: 'pending-approval', confidence: 70 },
        { stepId: 's2', planId: 'p2', status: 'approved', confidence: 80 },
      ],
    });
    expect(overlay.totalRemediationPending).toBe(1);
  });

  it('all indicators have advisory note', () => {
    const overlay = builder.build('col1', {
      remediationPlans: [{ stepId: 's1', planId: 'p1', status: 'pending-approval', confidence: 70 }],
      stabilizationInsights: [{ stepId: 's2', instabilityScore: 40 }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.advisoryNote).toBeTruthy();
    }
  });

  it('overlay has governance note', () => {
    const overlay = builder.build('col1', {});
    expect(overlay.governanceNote).toBeTruthy();
  });

  it('stabilizationConfidence is computed from instabilityScore', () => {
    const overlay = builder.build('col1', {
      stabilizationInsights: [{ stepId: 's1', instabilityScore: 40 }],
    });
    expect(overlay.indicators[0].stabilizationConfidence).toBe(60);
  });
});
