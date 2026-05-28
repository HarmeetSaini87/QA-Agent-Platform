export type SemanticOverlayType =
  | 'orchestration-semantic'
  | 'dependency-semantic'
  | 'retry-semantic-cluster'
  | 'remediation-semantic'
  | 'operational-intent'
  | 'semantic-evolution-trail';

export interface SemanticOverlayIndicator {
  indicatorId: string;
  stepId: string;
  overlayType: SemanticOverlayType;
  semanticScore: number;
  semanticTrend: 'improving' | 'stable' | 'degrading';
  semanticSummary: string;
  isExplainable: true;
  governanceNote: string;
}

export interface SemanticGraphOverlay {
  collectionId: string;
  indicators: SemanticOverlayIndicator[];
  overallSemanticScore: number;
  totalExplainableSignals: number;
  semanticHealthScore: number;
  governanceNote: string;
}

export interface SemanticOverlayInput {
  knowledgeNodes?: Array<{ stepId: string; nodeType: string; confidence: number; label: string }>;
  replayCorrelations?: Array<{ stepId: string; category: string; confidence: number }>;
  reasoningTrails?: Array<{ stepId: string; dimension: string; confidence: number }>;
  antiPatterns?: Array<{ stepId: string; severity: string; confidence: number }>;
}

export class NoOpSemanticOrchestrationEnricher {
  enrichSemantics(_collectionId: string): void { /* advisory no-op */ }
}

export class NoOpEnterpriseKnowledgeGraphFabric {
  buildKnowledgeFabric(_orgId: string): void { /* advisory no-op */ }
}

export interface ISemanticGraphOverlayBuilder {
  build(collectionId: string, input: SemanticOverlayInput): SemanticGraphOverlay;
}
