import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedGraphOverlayBuilder } from '../federated-graph-overlay-builder';

describe('FederatedGraphOverlayBuilder', () => {
  let builder: FederatedGraphOverlayBuilder;

  beforeEach(() => {
    builder = new FederatedGraphOverlayBuilder();
  });

  it('builds empty overlay for empty input', () => {
    const overlay = builder.build('col1', 'org1', {});
    expect(overlay.collectionId).toBe('col1');
    expect(overlay.orgId).toBe('org1');
    expect(overlay.indicators).toHaveLength(0);
    expect(overlay.federatedInsightCount).toBe(0);
  });

  it('globalHealthScore is 100 for empty input', () => {
    const overlay = builder.build('col1', 'org1', {});
    expect(overlay.globalHealthScore).toBe(100);
  });

  it('crossOrgPatterns produce cross-org-instability indicators', () => {
    const overlay = builder.build('col1', 'org1', {
      crossOrgPatterns: [{ stepId: 's1', patternType: 'failure', confidence: 70, orgCount: 3 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('cross-org-instability');
    expect(overlay.indicators[0].contributingOrgCount).toBe(3);
  });

  it('retry patternType produces federated-retry-pattern indicator', () => {
    const overlay = builder.build('col1', 'org1', {
      crossOrgPatterns: [{ stepId: 's1', patternType: 'retry', confidence: 80, orgCount: 2 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('federated-retry-pattern');
  });

  it('globalHealthSignals produce global-health-signal indicators', () => {
    const overlay = builder.build('col1', 'org1', {
      globalHealthSignals: [{ stepId: 's2', healthScore: 60 }],
    });
    expect(overlay.indicators[0].overlayType).toBe('global-health-signal');
  });

  it('federationOptimizationHints produce federation-optimization-hint indicators', () => {
    const overlay = builder.build('col1', 'org1', {
      federationOptimizationHints: [{ stepId: 's3', hint: 'Reduce retries federation-wide' }],
    });
    expect(overlay.indicators[0].overlayType).toBe('federation-optimization-hint');
  });

  it('federatedInsightCount matches indicator count', () => {
    const overlay = builder.build('col1', 'org1', {
      crossOrgPatterns: [{ stepId: 's1', patternType: 'failure', confidence: 70, orgCount: 2 }],
      globalHealthSignals: [{ stepId: 's2', healthScore: 80 }],
    });
    expect(overlay.federatedInsightCount).toBe(2);
    expect(overlay.indicators).toHaveLength(2);
  });

  it('all indicators have advisory note', () => {
    const overlay = builder.build('col1', 'org1', {
      crossOrgPatterns: [{ stepId: 's1', patternType: 'failure', confidence: 70, orgCount: 1 }],
    });
    for (const ind of overlay.indicators) {
      expect(ind.advisoryNote).toBeTruthy();
    }
  });

  it('overlay has governance note', () => {
    const overlay = builder.build('col1', 'org1', {});
    expect(overlay.governanceNote).toBeTruthy();
  });

  it('globalHealthScore is average of crossOrgConfidence values', () => {
    const overlay = builder.build('col1', 'org1', {
      crossOrgPatterns: [
        { stepId: 's1', patternType: 'failure', confidence: 60, orgCount: 1 },
        { stepId: 's2', patternType: 'failure', confidence: 80, orgCount: 1 },
      ],
    });
    expect(overlay.globalHealthScore).toBe(70);
  });
});
