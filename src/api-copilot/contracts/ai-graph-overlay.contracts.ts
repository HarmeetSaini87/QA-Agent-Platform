// src/api-copilot/contracts/ai-graph-overlay.contracts.ts
// Phase E Step 10: AI graph overlay contracts. Additive badge annotations only — graph never mutated.

export type AiOverlayIndicatorType =
  | 'predicted-flakiness'
  | 'retry-storm-risk'
  | 'sla-breach-risk'
  | 'dependency-risk'
  | 'rca-hotspot'
  | 'optimization-opportunity';

export interface PredictiveInstabilityIndicator {
  readonly nodeId: string;
  readonly indicatorType: AiOverlayIndicatorType;
  readonly score: number;           // 0–100
  readonly confidence: number;      // 0–100
  readonly label: string;
  readonly advisoryNote: string;
  readonly evidenceRefs: readonly string[];
}

export interface DependencyRiskOverlay {
  readonly collectionId: string;
  readonly riskEdges: readonly {
    readonly fromStepId: string;
    readonly toStepId: string;
    readonly riskScore: number;     // 0–100
    readonly riskReason: string;
  }[];
  readonly generatedAt: string;
}

export interface AiGraphOverlay {
  readonly collectionId: string;
  readonly indicators: readonly PredictiveInstabilityIndicator[];
  readonly dependencyRisk: DependencyRiskOverlay;
  readonly generatedAt: string;
  readonly advisoryNote: string;
}

export interface IAiGraphOverlayBuilder {
  build(collectionId: string, context: {
    flakinessForecast?: { stepId: string; score: number; confidence: number }[];
    retryHotspots?: { stepId: string; retryRate: number }[];
    rcaCorrelations?: { stepId: string; confidence: number; hypothesis: string }[];
    dependencyEdges?: { from: string; to: string }[];
  }): AiGraphOverlay;
}
