// src/api-federation/federated-graph-overlay-builder.ts
// Phase E Step 12: Federated graph overlay builder. Additive indicators only — graph never mutated.

import {
  FederatedGraphOverlay,
  FederatedOverlayIndicator,
  FederatedOverlayType,
  IFederatedGraphOverlayBuilder,
} from './contracts/federated-graph-overlay.contracts';

const GOVERNANCE_NOTE =
  'Federated graph indicators are advisory only. Graph structure and execution runtime are never modified.';

export class FederatedGraphOverlayBuilder implements IFederatedGraphOverlayBuilder {
  build(
    collectionId: string,
    orgId: string,
    input: {
      crossOrgPatterns?: Array<{ stepId: string; patternType: string; confidence: number; orgCount: number }>;
      globalHealthSignals?: Array<{ stepId: string; healthScore: number }>;
      federationOptimizationHints?: Array<{ stepId: string; hint: string }>;
    }
  ): FederatedGraphOverlay {
    const indicators: FederatedOverlayIndicator[] = [];

    for (const p of input.crossOrgPatterns ?? []) {
      const overlayType: FederatedOverlayType =
        p.patternType === 'retry' ? 'federated-retry-pattern' : 'cross-org-instability';
      indicators.push({
        nodeId: p.stepId,
        overlayType,
        label: `${p.patternType} — ${p.orgCount} org(s) (confidence: ${p.confidence})`,
        crossOrgConfidence: p.confidence,
        contributingOrgCount: p.orgCount,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const h of input.globalHealthSignals ?? []) {
      indicators.push({
        nodeId: h.stepId,
        overlayType: 'global-health-signal',
        label: `Global health score: ${h.healthScore}`,
        crossOrgConfidence: h.healthScore,
        contributingOrgCount: 0,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    for (const opt of input.federationOptimizationHints ?? []) {
      indicators.push({
        nodeId: opt.stepId,
        overlayType: 'federation-optimization-hint',
        label: opt.hint.slice(0, 80),
        crossOrgConfidence: 70,
        contributingOrgCount: 0,
        advisoryNote: GOVERNANCE_NOTE,
      });
    }

    const avgHealth =
      indicators.length > 0
        ? Math.round(
            indicators.reduce((s, i) => s + i.crossOrgConfidence, 0) / indicators.length
          )
        : 100;

    return {
      collectionId,
      orgId,
      indicators,
      globalHealthScore: Math.min(100, avgHealth),
      federatedInsightCount: indicators.length,
      generatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalFederatedGraphOverlayBuilder = new FederatedGraphOverlayBuilder();
