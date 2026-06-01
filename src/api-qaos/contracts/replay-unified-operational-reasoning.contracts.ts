export type OperationalReasoningDimension =
  | 'orchestration-continuity'
  | 'replay-governance-trace'
  | 'dependency-continuity'
  | 'retry-harmonization'
  | 'trust-federation-scoring'
  | 'operational-anomaly-governance';

export interface OperationalReasoningStep {
  stepId: string;
  dimension: OperationalReasoningDimension;
  continuityObservation: string;
  governanceInference: string;
  confidence: number;
}

export interface UnifiedOperationalReasoningTrail {
  trailId: string;
  collectionId: string;
  runId?: string;
  steps: OperationalReasoningStep[];
  overallContinuityConfidence: number;
  isExplainable: true;
  createdAt: string;
  governanceNote: string;
}

export interface OrchestrationAnomalyIntelligence {
  anomalyId: string;
  collectionId: string;
  anomalyType: string;
  platformImpact: 'none' | 'low' | 'medium' | 'high' | 'critical';
  governanceSignals: string[];
  unificationRecommendation: string;
  confidence: number;
  isExplainable: true;
}

export interface RetryGovernanceHarmonization {
  harmonizationId: string;
  collectionId: string;
  harmonizationCategory: 'within-unified-policy' | 'borderline-unified' | 'policy-fragmentation' | 'escalation-required';
  platformContext: string;
  harmonizationAction: string;
  confidence: number;
  isExplainable: true;
  governanceNote: string;
}

export interface IReplayUnifiedOperationalReasoningEngine {
  buildReasoningTrail(collectionId: string, dimensions: OperationalReasoningDimension[], runId?: string): UnifiedOperationalReasoningTrail;
  analyzeOrchestrationAnomaly(collectionId: string, anomalyType: string, signals: string[]): OrchestrationAnomalyIntelligence;
  harmonizeRetryGovernance(collectionId: string, retryCount: number, maxAllowed: number): RetryGovernanceHarmonization;
}
