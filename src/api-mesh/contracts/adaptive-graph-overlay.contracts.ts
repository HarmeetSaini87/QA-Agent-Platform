// src/api-mesh/contracts/adaptive-graph-overlay.contracts.ts
// Phase E Step 13: Adaptive mesh graph overlay contracts. Additive indicators — graph never mutated.

export type AdaptiveMeshOverlayType =
  | 'orchestration-memory'
  | 'reliability-trend'
  | 'replay-optimization-trail'
  | 'dependency-learning'
  | 'anti-pattern-alert'
  | 'mesh-health-signal';

export interface AdaptiveMeshOverlayIndicator {
  readonly nodeId: string;
  readonly overlayType: AdaptiveMeshOverlayType;
  readonly label: string;
  readonly memoryScore: number;       // 0–100: how strong the historical learning signal is
  readonly reliabilityTrend: 'improving' | 'stable' | 'degrading';
  readonly advisoryNote: string;
}

export interface AdaptiveMeshGraphOverlay {
  readonly collectionId: string;
  readonly indicators: readonly AdaptiveMeshOverlayIndicator[];
  readonly meshHealthScore: number;       // 0–100 composite
  readonly totalMemorySignals: number;
  readonly generatedAt: string;
  readonly governanceNote: string;
}

/** No-op stub for future enterprise-wide operational cognition layer. */
export class NoOpOperationalCognitionLayer {
  readonly isNoOp = true as const;
  readonly governanceNote = 'Operational cognition layer requires cross-mesh governance approval.';
}

/** No-op stub for future AI-assisted orchestration evolution. */
export class NoOpAiOrchestrationEvolution {
  readonly isNoOp = true as const;
  readonly governanceNote = 'AI-assisted orchestration evolution is approval-gated and not yet active.';
}

export interface IAdaptiveMeshGraphOverlayBuilder {
  build(
    collectionId: string,
    input: {
      knowledgeEntries?: Array<{ stepId: string; memoryType: string; score: number }>;
      reliabilityScores?: Array<{ stepId: string; score: number; trend: 'improving' | 'stable' | 'degrading' }>;
      antiPatternAlerts?: Array<{ stepId: string; severity: string; patternKey: string }>;
    }
  ): AdaptiveMeshGraphOverlay;
}
