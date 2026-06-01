export type SemanticMemoryType =
  | 'orchestration-semantic'
  | 'dependency-semantic'
  | 'retry-semantic'
  | 'remediation-semantic'
  | 'sla-semantic'
  | 'anomaly-semantic';

export interface SemanticMemoryRecord {
  recordId: string;
  collectionId: string;
  memoryType: SemanticMemoryType;
  semanticSignal: string;
  contextualReasoning: string;
  confidence: number;
  occurrenceCount: number;
  isAnonymized: true;
  isExplainable: true;
  retentionExpiresAt: string;
  createdAt: string;
  governanceNote: string;
}

export interface SemanticMemoryIndex {
  indexId: string;
  orgId: string;
  collectionId?: string;
  totalRecords: number;
  avgConfidence: number;
  dominantMemoryType: SemanticMemoryType | null;
  strongestSemanticSignal: string | null;
  recordsByMemoryType: Record<string, number>;
  indexedAt: string;
}

export interface OrchestrationAntiPatternSemantics {
  patternId: string;
  patternKey: string;
  semanticDescription: string;
  contextualReasoningChain: string[];
  crossOrgFrequency: number;
  semanticSeverity: 'low' | 'medium' | 'high' | 'critical';
  knownSemanticRemedies: string[];
  confidenceScore: number;
  isAnonymized: true;
  firstObservedAt: string;
}

export interface SemanticRetentionPolicy {
  policyId: string;
  orgId: string;
  retentionDays: number;
  requireExplainability: boolean;
  anonymizeAfterDays: number;
}

export interface IFederatedSemanticMemoryFabric {
  addRecord(record: SemanticMemoryRecord): void;
  buildIndex(orgId: string, collectionId?: string): SemanticMemoryIndex;
  addAntiPatternSemantics(pattern: OrchestrationAntiPatternSemantics): void;
  getAntiPatternSemantics(patternKey: string): OrchestrationAntiPatternSemantics | null;
  listAntiPatternSemantics(): OrchestrationAntiPatternSemantics[];
  registerRetentionPolicy(policy: SemanticRetentionPolicy): void;
  getRetentionPolicy(orgId: string): SemanticRetentionPolicy | null;
  evictExpired(): number;
}
