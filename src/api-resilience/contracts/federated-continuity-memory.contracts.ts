export type ContinuityMemoryType =
  | 'failover-event'
  | 'replay-continuity'
  | 'worker-recovery'
  | 'queue-recovery'
  | 'outage-pattern'
  | 'resilience-signal';

export interface ContinuityMemoryRecord {
  recordId: string;
  orgId: string;
  collectionId?: string;
  memoryType: ContinuityMemoryType;
  continuitySignal: string;
  recoveryReasoning: string;
  confidence: number;
  occurrenceCount: number;
  isAnonymized: true;
  isExplainable: true;
  retentionExpiresAt: string;
  createdAt: string;
  governanceNote: string;
}

export interface ContinuityMemoryIndex {
  indexId: string;
  orgId: string;
  collectionId?: string;
  totalRecords: number;
  avgConfidence: number;
  dominantMemoryType: ContinuityMemoryType | null;
  strongestSignal: string | null;
  recordsByMemoryType: Record<string, number>;
  indexedAt: string;
}

export interface OutagePatternRecord {
  patternId: string;
  patternKey: string;
  outageSignal: string;
  recoveryChain: string[];
  crossOrgFrequency: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  knownRecoveryStrategies: string[];
  confidenceScore: number;
  isAnonymized: true;
  firstObservedAt: string;
}

export interface ContinuityRetentionPolicy {
  policyId: string;
  orgId: string;
  retentionDays: number;
  anonymizeAfterDays: number;
  requireExplainability: boolean;
}

export interface IFederatedContinuityMemoryFabric {
  addRecord(record: ContinuityMemoryRecord): void;
  buildIndex(orgId: string, collectionId?: string): ContinuityMemoryIndex;
  addOutagePattern(pattern: OutagePatternRecord): void;
  getOutagePattern(patternKey: string): OutagePatternRecord | null;
  listOutagePatterns(): OutagePatternRecord[];
  registerRetentionPolicy(policy: ContinuityRetentionPolicy): void;
  getRetentionPolicy(orgId: string): ContinuityRetentionPolicy | null;
  evictExpired(): number;
}
