// src/api-autonomous/contracts/replay-autonomous-intelligence.contracts.ts
// Phase E Step 11: Replay-driven autonomous intelligence. Read-only analysis — replay determinism preserved.

export interface ReplayRemediationCorrelation {
  readonly correlationId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly linkedPlanId?: string;
  readonly rcaConfidence: number;       // 0–100
  readonly stabilizationSignals: readonly string[];
  readonly predictedEffectiveness: number;   // 0–1
  readonly advisoryNote: string;
  readonly generatedAt: string;
}

export interface OrchestrationStabilizationInsight {
  readonly collectionId: string;
  readonly instabilityScore: number;    // 0–100
  readonly primaryDrivers: readonly string[];
  readonly stabilizationHints: readonly string[];
  readonly historicalRemedyEffectiveness: number;   // 0–1 avg of past remediation records
  readonly generatedAt: string;
}

export interface AdaptiveFailurePreventionInsight {
  readonly collectionId: string;
  readonly stepId: string;
  readonly failureProbability: number;  // 0–1
  readonly preventionHints: readonly string[];
  readonly evidenceRunIds: readonly string[];
  readonly confidence: number;          // 0–100
  readonly generatedAt: string;
}

export interface IReplayAutonomousIntelligence {
  correlateReplayWithRemediation(
    runId: string,
    collectionId: string,
    linkedPlanId?: string
  ): ReplayRemediationCorrelation;
  computeStabilizationInsight(
    collectionId: string,
    recentRunIds: readonly string[]
  ): OrchestrationStabilizationInsight;
  generateFailurePreventionInsights(
    collectionId: string,
    stepIds: readonly string[]
  ): AdaptiveFailurePreventionInsight[];
}
