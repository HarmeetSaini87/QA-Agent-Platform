export type OperationalMemoryFederationType =
  | 'orchestration-reasoning'
  | 'remediation-memory'
  | 'retry-stabilization'
  | 'dependency-resilience'
  | 'sla-governance'
  | 'optimization-memory';

export interface ReplayOperationalMemoryEntry {
  entryId: string;
  collectionId: string;
  federationType: OperationalMemoryFederationType;
  memorySignal: string;
  reasoningTrace: string[];
  confidence: number;
  occurrenceCount: number;
  isAnonymized: true;
  isExplainable: true;
  retentionExpiresAt: string;
  createdAt: string;
  governanceNote: string;
}

export interface OperationalMemoryFederationIndex {
  indexId: string;
  orgId: string;
  collectionId?: string;
  totalEntries: number;
  avgConfidence: number;
  strongestSignal: string | null;
  entriesByFederationType: Record<string, number>;
  indexedAt: string;
}

export interface ReplayBackedRemediationMemory {
  memoryId: string;
  collectionId: string;
  runId: string;
  remediationOutcome: string;
  effectivenessScore: number;
  reasoningChain: string[];
  isExplainable: true;
  createdAt: string;
}

export interface FederatedRetryStabilizationRecord {
  recordId: string;
  patternKey: string;
  retrySignal: string;
  crossOrgFrequency: number;
  stabilizationHints: string[];
  avgEffectiveness: number;
  isAnonymized: true;
}

export interface IReplayOperationalMemoryFabric {
  addEntry(entry: ReplayOperationalMemoryEntry): void;
  buildIndex(orgId: string, collectionId?: string): OperationalMemoryFederationIndex;
  addRemediationMemory(memory: ReplayBackedRemediationMemory): void;
  listRemediationMemory(collectionId: string): ReplayBackedRemediationMemory[];
  addRetryStabilizationRecord(record: FederatedRetryStabilizationRecord): void;
  getRetryStabilizationRecord(patternKey: string): FederatedRetryStabilizationRecord | null;
  evictExpired(): number;
}
