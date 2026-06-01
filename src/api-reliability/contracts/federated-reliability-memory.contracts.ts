export type ReliabilityMemoryType =
  | 'retry-pattern'
  | 'dependency-failure'
  | 'sla-breach'
  | 'remediation-outcome'
  | 'resilience-signal'
  | 'stabilization-event';

export type ResilienceAntiPatternSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ReliabilityMemoryRecord {
  recordId: string;
  collectionId: string;
  memoryType: ReliabilityMemoryType;
  signal: string;
  reasoning: string;
  confidence: number;
  isExplainable: true;
  createdAt: string;
  retentionExpiresAt: string;
  governanceNote: string;
}

export interface ReliabilityMemoryIndex {
  indexId: string;
  orgId: string;
  collectionId?: string;
  totalRecords: number;
  avgConfidence: number;
  strongestReasoning: string | null;
  recordsByMemoryType: Record<string, number>;
  indexedAt: string;
}

export interface ResilienceAntiPatternRecord {
  patternId: string;
  patternKey: string;
  resilienceSignal: string;
  reasoningChain: string[];
  crossOrgFrequency: number;
  severity: ResilienceAntiPatternSeverity;
  knownEffectiveRemedies: string[];
  confidenceScore: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface ReliabilityRetentionPolicy {
  policyId: string;
  orgId: string;
  retentionDays: number;
  anonymizeAfterDays: number;
  requireExplainability: boolean;
}

export interface IFederatedReliabilityMemory {
  addMemoryRecord(record: ReliabilityMemoryRecord): void;
  buildIndex(orgId: string, collectionId?: string): ReliabilityMemoryIndex;
  addAntiPattern(pattern: ResilienceAntiPatternRecord): void;
  getAntiPattern(patternKey: string): ResilienceAntiPatternRecord | null;
  listAntiPatterns(): ResilienceAntiPatternRecord[];
  registerRetentionPolicy(policy: ReliabilityRetentionPolicy): void;
  getRetentionPolicy(orgId: string): ReliabilityRetentionPolicy | null;
  evictExpired(): number;
}
