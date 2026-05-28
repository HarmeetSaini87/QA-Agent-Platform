export type ReasoningContextDimension =
  | 'orchestration-context'
  | 'dependency-meaning'
  | 'rca-reasoning'
  | 'anomaly-semantics'
  | 'optimization-context'
  | 'resilience-context';

export type ReasoningConfidenceLevel = 'low' | 'medium' | 'high' | 'definitive';

export interface ContextualReasoningStep {
  stepId: string;
  dimension: ReasoningContextDimension;
  contextObservation: string;
  semanticInference: string;
  confidence: number;
}

export interface ContextualReasoningTrail {
  trailId: string;
  collectionId: string;
  dimensions: ReasoningContextDimension[];
  steps: ContextualReasoningStep[];
  overallConfidence: number;
  confidenceLevel: ReasoningConfidenceLevel;
  isExplainable: true;
  createdAt: string;
  governanceNote: string;
}

export interface OperationalAnomalySemantics {
  anomalyId: string;
  collectionId: string;
  anomalyType: string;
  semanticInterpretation: string;
  contextualFactors: string[];
  remediationSemantics: string;
  confidence: number;
  isExplainable: true;
}

export interface OrchestrationOptimizationSemantics {
  optimizationId: string;
  collectionId: string;
  optimizationContext: string;
  semanticOpportunity: string;
  contextualReasoning: string[];
  confidenceScore: number;
  isExplainable: true;
  governanceNote: string;
}

export interface IContextualOperationalReasoningEngine {
  buildReasoningTrail(collectionId: string, dimensions: ReasoningContextDimension[]): ContextualReasoningTrail;
  analyzeAnomalySemantics(collectionId: string, anomalyType: string, signals: string[]): OperationalAnomalySemantics;
  deriveOptimizationSemantics(collectionId: string, context: string): OrchestrationOptimizationSemantics;
}
