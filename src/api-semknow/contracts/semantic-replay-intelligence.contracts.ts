export type SemanticReplayCategory =
  | 'execution-context'
  | 'dependency-semantic'
  | 'orchestration-intent'
  | 'retry-semantic'
  | 'remediation-cluster'
  | 'sla-semantic';

export interface SemanticReplayCorrelation {
  correlationId: string;
  collectionId: string;
  runId: string;
  category: SemanticReplayCategory;
  semanticSignal: string;
  contextualReasoning: string[];
  confidence: number;
  isAnonymized: true;
  isExplainable: true;
  createdAt: string;
  governanceNote: string;
}

export interface OrchestrationIntentInference {
  inferenceId: string;
  collectionId: string;
  inferredIntent: string;
  evidenceSignals: string[];
  confidence: number;
  isExplainable: true;
  governanceNote: string;
}

export interface RetrySemanticCategorization {
  categorizationId: string;
  collectionId: string;
  retryCategory: 'transient-failure' | 'dependency-cascade' | 'environment-instability' | 'configuration-drift' | 'unknown';
  semanticSignals: string[];
  confidence: number;
  recommendedSemanticAction: string;
  isExplainable: true;
}

export interface SlaSemanticIntelligence {
  intelligenceId: string;
  collectionId: string;
  slaContext: string;
  semanticGap: string;
  optimizationSemantics: string[];
  confidence: number;
  isExplainable: true;
}

export interface ISemanticReplayIntelligenceEngine {
  correlateSemantics(collectionId: string, runId: string, categories: SemanticReplayCategory[]): SemanticReplayCorrelation[];
  inferOrchestrationIntent(collectionId: string, signals: string[]): OrchestrationIntentInference;
  categorizeRetrySemantics(collectionId: string, retrySignals: string[]): RetrySemanticCategorization;
  analyzeSlaSemantics(collectionId: string, currentScore: number): SlaSemanticIntelligence;
}
