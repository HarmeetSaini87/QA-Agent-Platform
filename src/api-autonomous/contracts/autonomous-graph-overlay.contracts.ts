// src/api-autonomous/contracts/autonomous-graph-overlay.contracts.ts
// Phase E Step 11: Autonomous graph overlay contracts. Additive indicators only — graph never mutated.

export type AutonomousOverlayType =
  | 'remediation-pending'
  | 'remediation-approved'
  | 'stabilization-candidate'
  | 'retry-adaptation-hint'
  | 'orchestration-risk'
  | 'dependency-auto-stabilization';

export interface AutonomousOverlayIndicator {
  readonly nodeId: string;
  readonly overlayType: AutonomousOverlayType;
  readonly label: string;
  readonly stabilizationConfidence: number;   // 0–100
  readonly linkedPlanId?: string;
  readonly advisoryNote: string;
}

export interface AutonomousGraphOverlay {
  readonly collectionId: string;
  readonly indicators: readonly AutonomousOverlayIndicator[];
  readonly totalRemediationPending: number;
  readonly totalStabilizationCandidates: number;
  readonly generatedAt: string;
  readonly governanceNote: string;
}

/** No-op extension point for future adaptive orchestration overlay federation. */
export class NoOpAdaptiveOrchestrationFederation {
  readonly isNoOp = true as const;
  readonly governanceNote = 'Adaptive orchestration federation requires cross-tenant approval. Not active.';
}

export interface IAutonomousGraphOverlayBuilder {
  build(
    collectionId: string,
    input: {
      remediationPlans?: Array<{ stepId: string; planId: string; status: string; confidence: number }>;
      stabilizationInsights?: Array<{ stepId: string; instabilityScore: number }>;
      retryAdaptations?: Array<{ stepId: string; confidence: number }>;
    }
  ): AutonomousGraphOverlay;
}
