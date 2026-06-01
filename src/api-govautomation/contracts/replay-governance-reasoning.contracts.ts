export type GovernanceReasoningDimension =
  | 'audit-trail-integrity'
  | 'policy-adherence-trace'
  | 'retry-governance-semantics'
  | 'dependency-compliance'
  | 'trust-scoring'
  | 'anomaly-governance';

export interface GovernanceReasoningStep {
  stepId: string;
  dimension: GovernanceReasoningDimension;
  auditObservation: string;
  complianceInference: string;
  confidence: number;
}

export interface ReplayGovernanceReasoningTrail {
  trailId: string;
  collectionId: string;
  runId?: string;
  steps: GovernanceReasoningStep[];
  overallGovernanceConfidence: number;
  isExplainable: true;
  createdAt: string;
  governanceNote: string;
}

export interface GovernanceAnomalyAnalysis {
  anomalyId: string;
  collectionId: string;
  anomalyType: string;
  complianceImpact: 'none' | 'low' | 'medium' | 'high' | 'critical';
  policyViolationSignals: string[];
  governanceRecommendation: string;
  confidence: number;
  isExplainable: true;
}

export interface RetryGovernanceSemantics {
  semanticsId: string;
  collectionId: string;
  retryGovernanceCategory: 'within-policy' | 'borderline' | 'policy-breach' | 'escalation-required';
  policyContext: string;
  governanceAction: string;
  confidence: number;
  isExplainable: true;
  governanceNote: string;
}

export interface IReplayGovernanceReasoningEngine {
  buildGovernanceTrail(collectionId: string, dimensions: GovernanceReasoningDimension[], runId?: string): ReplayGovernanceReasoningTrail;
  analyzeGovernanceAnomaly(collectionId: string, anomalyType: string, signals: string[]): GovernanceAnomalyAnalysis;
  classifyRetryGovernance(collectionId: string, retryCount: number, maxAllowed: number): RetryGovernanceSemantics;
}
