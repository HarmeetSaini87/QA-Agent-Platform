export type RecommendationCategory =
  | 'dependency'
  | 'retry'
  | 'flakiness'
  | 'healing'
  | 'assertion'
  | 'environment'
  | 'replay-rca'
  | 'workflow-quality';

export type RecommendationSeverity = 'info' | 'warning' | 'critical';

export type RecommendationBasis = 'heuristic' | 'deterministic' | 'replay-evidence';

export interface RecommendationProvenance {
  source: string;
  basis: RecommendationBasis;
  evidenceRefs: string[];
  generatedAt: string;
}

export interface AiRecommendation {
  id: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  /** 0–100 heuristic confidence that this recommendation is actionable */
  confidence: number;
  actionHint: string;
  provenance: RecommendationProvenance;
  collectionId?: string;
  runId?: string;
  stepId?: string;
  tenantId?: string;
}

export interface RecommendationBundle {
  collectionId?: string;
  runId?: string;
  generatedAt: string;
  recommendations: AiRecommendation[];
  /** Always present — reminds callers that AI is advisory only */
  advisoryNote: string;
}
