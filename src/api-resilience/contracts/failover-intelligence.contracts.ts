export type SurvivabilityDimension =
  | 'orchestration-continuity'
  | 'replay-safety'
  | 'worker-redundancy'
  | 'queue-durability'
  | 'dependency-resilience'
  | 'regional-isolation';

export interface ContinuityReasoningStep {
  stepId: string;
  dimension: SurvivabilityDimension;
  observation: string;
  recoveryInference: string;
  confidence: number;
}

export interface FailoverIntelligenceTrail {
  trailId: string;
  collectionId: string;
  dimensions: SurvivabilityDimension[];
  steps: ContinuityReasoningStep[];
  overallSurvivabilityScore: number;
  isExplainable: true;
  createdAt: string;
  governanceNote: string;
}

export interface SurvivabilityScoringResult {
  collectionId: string;
  overallScore: number;
  dimensionScores: Array<{ dimension: SurvivabilityDimension; score: number; trend: 'improving' | 'stable' | 'degrading' }>;
  survivabilityLevel: 'excellent' | 'good' | 'at-risk' | 'critical';
  governanceNote: string;
  scoredAt: string;
}

export interface ResilienceAnomalyIntelligence {
  anomalyId: string;
  collectionId: string;
  anomalyType: string;
  survivabilityImpact: 'low' | 'medium' | 'high' | 'critical';
  continuityReasoning: string[];
  recoveryRecommendation: string;
  confidence: number;
  isExplainable: true;
}

export interface IFailoverIntelligenceEngine {
  buildIntelligenceTrail(collectionId: string, dimensions: SurvivabilityDimension[]): FailoverIntelligenceTrail;
  scoreSurvivability(collectionId: string): SurvivabilityScoringResult;
  analyzeResilienceAnomaly(collectionId: string, anomalyType: string, signals: string[]): ResilienceAnomalyIntelligence;
}
