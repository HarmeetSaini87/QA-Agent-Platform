export type ExplainabilityDimension =
  | 'retry-evolution'
  | 'dependency-stabilization'
  | 'sla-optimization'
  | 'remediation-effectiveness'
  | 'orchestration-resilience'
  | 'environment-adaptation';

export interface ExplainabilityTrailStep {
  stepId: string;
  dimension: ExplainabilityDimension;
  observation: string;
  inference: string;
  confidence: number;
}

export interface ReplayExplainabilityTrail {
  trailId: string;
  collectionId: string;
  runId: string;
  steps: ExplainabilityTrailStep[];
  overallConfidence: number;
  isExplainable: true;
  governanceNote: string;
  createdAt: string;
}

export interface RetryEvolutionExplanation {
  explanationId: string;
  collectionId: string;
  currentRetryBehavior: string;
  recommendedEvolution: string;
  evidenceSignals: string[];
  confidence: number;
  isExplainable: true;
  governanceNote: string;
}

export interface DependencyStabilizationExplanation {
  explanationId: string;
  collectionId: string;
  dependencyId: string;
  instabilitySignals: string[];
  stabilizationRationale: string;
  confidence: number;
  isExplainable: true;
}

export interface SlaOptimizationExplanation {
  explanationId: string;
  collectionId: string;
  currentSlaScore: number;
  optimizationOpportunity: string;
  reasoningChain: string[];
  confidence: number;
  isExplainable: true;
}

export interface IReplayExplainabilityEngine {
  buildTrail(collectionId: string, runId: string, dimensions: ExplainabilityDimension[]): ReplayExplainabilityTrail;
  explainRetryEvolution(collectionId: string, signals: string[]): RetryEvolutionExplanation;
  explainDependencyStabilization(collectionId: string, dependencyId: string, signals: string[]): DependencyStabilizationExplanation;
  explainSlaOptimization(collectionId: string, currentScore: number): SlaOptimizationExplanation;
}
