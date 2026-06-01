export type EnterpriseMemoryType =
  | 'orchestration-federation-memory'
  | 'replay-continuity-memory'
  | 'operational-trust-signal'
  | 'reliability-coordination-memory'
  | 'platform-anomaly'
  | 'consolidation-record';

export interface EnterpriseMemoryRecord {
  recordId: string;
  orgId: string;
  collectionId?: string;
  memoryType: EnterpriseMemoryType;
  operationalSignal: string;
  platformReasoning: string;
  confidence: number;
  occurrenceCount: number;
  isAnonymized: true;
  isExplainable: true;
  retentionExpiresAt: string;
  createdAt: string;
  governanceNote: string;
}

export interface EnterpriseMemoryIndex {
  indexId: string;
  orgId: string;
  collectionId?: string;
  totalRecords: number;
  avgConfidence: number;
  dominantMemoryType: EnterpriseMemoryType | null;
  strongestSignal: string | null;
  recordsByMemoryType: Record<string, number>;
  operationalHealthScore: number;
  indexedAt: string;
}

export interface OrchestrationAntiPatternRecord {
  patternId: string;
  patternKey: string;
  platformSignal: string;
  governanceViolationChain: string[];
  crossOrgFrequency: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  knownUnificationStrategies: string[];
  confidenceScore: number;
  isAnonymized: true;
  firstObservedAt: string;
}

export interface EnterpriseRetentionPolicy {
  policyId: string;
  orgId: string;
  retentionDays: number;
  anonymizeAfterDays: number;
  requireExplainability: boolean;
  auditAllRecords: boolean;
}

export interface IFederatedEnterpriseMemoryFabric {
  addRecord(record: EnterpriseMemoryRecord): void;
  buildIndex(orgId: string, collectionId?: string): EnterpriseMemoryIndex;
  addOrchestrationAntiPattern(pattern: OrchestrationAntiPatternRecord): void;
  getOrchestrationAntiPattern(patternKey: string): OrchestrationAntiPatternRecord | null;
  listOrchestrationAntiPatterns(): OrchestrationAntiPatternRecord[];
  registerRetentionPolicy(policy: EnterpriseRetentionPolicy): void;
  getRetentionPolicy(orgId: string): EnterpriseRetentionPolicy | null;
  evictExpired(): number;
}
