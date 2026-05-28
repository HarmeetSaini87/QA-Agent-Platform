// src/api-federation/contracts/federated-graph-overlay.contracts.ts
// Phase E Step 12: Federated graph overlay contracts. Additive indicators — graph never mutated.

export type FederatedOverlayType =
  | 'cross-org-instability'
  | 'federated-retry-pattern'
  | 'global-health-signal'
  | 'federation-optimization-hint'
  | 'cross-team-dependency-risk';

export interface FederatedOverlayIndicator {
  readonly nodeId: string;
  readonly overlayType: FederatedOverlayType;
  readonly label: string;
  readonly crossOrgConfidence: number;    // 0–100
  readonly contributingOrgCount: number;
  readonly advisoryNote: string;
}

export interface FederatedGraphOverlay {
  readonly collectionId: string;
  readonly orgId: string;
  readonly indicators: readonly FederatedOverlayIndicator[];
  readonly globalHealthScore: number;     // 0–100
  readonly federatedInsightCount: number;
  readonly generatedAt: string;
  readonly governanceNote: string;
}

/** No-op stub for future enterprise-wide orchestration mesh federation. */
export class NoOpOrchestrationMeshFederation {
  readonly isNoOp = true as const;
  readonly governanceNote = 'Orchestration mesh federation requires multi-org approval chain. Not active.';
}

/** No-op stub for future cross-enterprise replay intelligence network. */
export class NoOpCrossEnterpriseReplayNetwork {
  readonly isNoOp = true as const;
  readonly governanceNote = 'Cross-enterprise replay intelligence sharing is opt-in and approval-gated.';
}

export interface IFederatedGraphOverlayBuilder {
  build(
    collectionId: string,
    orgId: string,
    input: {
      crossOrgPatterns?: Array<{ stepId: string; patternType: string; confidence: number; orgCount: number }>;
      globalHealthSignals?: Array<{ stepId: string; healthScore: number }>;
      federationOptimizationHints?: Array<{ stepId: string; hint: string }>;
    }
  ): FederatedGraphOverlay;
}
