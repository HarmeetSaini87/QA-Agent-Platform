// src/api-cognition/contracts/replay-operational-reasoning.contracts.ts
// Phase E Step 14: Replay-backed operational reasoning. Read-only analysis — replay determinism preserved.

export type ReasoningDimension =
  | 'dependency-cognition'
  | 'retry-cognition'
  | 'remediation-effectiveness'
  | 'environment-cognition'
  | 'orchestration-bottleneck'
  | 'stabilization-reasoning';

export interface ReasoningTrailStep {
  readonly stepId: string;
  readonly dimension: ReasoningDimension;
  readonly observation: string;
  readonly inference: string;
  readonly confidence: number;         // 0–100
}

export interface ReasoningTrail {
  readonly trailId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly steps: readonly ReasoningTrailStep[];
  readonly overallConclusion: string;
  readonly overallConfidence: number;  // 0–100
  readonly isExplainable: true;
  readonly generatedAt: string;
  readonly advisoryNote: string;
}

export interface OptimizationReasoningRecord {
  readonly recordId: string;
  readonly collectionId: string;
  readonly dimension: ReasoningDimension;
  readonly currentState: string;
  readonly optimizedState: string;
  readonly rationale: string;
  readonly expectedImprovement: number;  // 0–1
  readonly confidence: number;
  readonly generatedAt: string;
}

export interface IReplayOperationalReasoning {
  /** Produces an explainable reasoning trail from run data. Never modifies replay. */
  buildReasoningTrail(
    runId: string,
    collectionId: string,
    dimensions: readonly ReasoningDimension[]
  ): ReasoningTrail;
  recordOptimizationReasoning(record: OptimizationReasoningRecord): void;
  listOptimizationReasoning(collectionId: string): OptimizationReasoningRecord[];
}
