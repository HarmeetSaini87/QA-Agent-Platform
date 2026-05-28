// src/api-cognition/contracts/cognitive-graph-overlay.contracts.ts
// Phase E Step 14: Cognitive graph overlay contracts. Additive explainable indicators — graph never mutated.

export type CognitiveOverlayType =
  | 'cognition-memory'
  | 'reasoning-trail'
  | 'optimization-cognition'
  | 'reliability-cognition'
  | 'stabilization-history'
  | 'anti-pattern-cognition';

export interface CognitiveOverlayIndicator {
  readonly nodeId: string;
  readonly overlayType: CognitiveOverlayType;
  readonly label: string;
  readonly cognitionScore: number;       // 0–100
  readonly reasoningSummary: string;     // one-line explainable summary
  readonly isExplainable: true;
  readonly advisoryNote: string;
}

export interface CognitiveGraphOverlay {
  readonly collectionId: string;
  readonly indicators: readonly CognitiveOverlayIndicator[];
  readonly overallCognitionScore: number;     // 0–100 composite
  readonly totalExplainableSignals: number;
  readonly generatedAt: string;
  readonly governanceNote: string;
}

/** No-op stub for future governed self-optimizing QA infrastructure. */
export class NoOpGovernedSelfOptimizingInfrastructure {
  readonly isNoOp = true as const;
  readonly governanceNote = 'Governed self-optimization infrastructure requires multi-layer approval chain.';
}

/** No-op stub for future enterprise operational reasoning platform. */
export class NoOpOperationalReasoningPlatform {
  readonly isNoOp = true as const;
  readonly governanceNote = 'Operational reasoning platform requires explainability audit sign-off.';
}

export interface ICognitiveGraphOverlayBuilder {
  build(
    collectionId: string,
    input: {
      cognitionRecords?: Array<{ stepId: string; memoryType: string; confidence: number; signal: string }>;
      reasoningTrails?: Array<{ stepId: string; conclusion: string; confidence: number }>;
      optimizationProposals?: Array<{ stepId: string; domain: string; confidence: number }>;
    }
  ): CognitiveGraphOverlay;
}
