export type GovernanceMemoryType =
  | 'policy-decision'
  | 'compliance-event'
  | 'audit-record'
  | 'trust-signal'
  | 'governance-anomaly'
  | 'waiver-record';

export interface GovernanceMemoryRecord {
  recordId: string;
  orgId: string;
  collectionId?: string;
  memoryType: GovernanceMemoryType;
  governanceSignal: string;
  policyReasoning: string;
  confidence: number;
  occurrenceCount: number;
  isAnonymized: true;
  isExplainable: true;
  retentionExpiresAt: string;
  createdAt: string;
  governanceNote: string;
}

export interface GovernanceMemoryIndex {
  indexId: string;
  orgId: string;
  collectionId?: string;
  totalRecords: number;
  avgConfidence: number;
  dominantMemoryType: GovernanceMemoryType | null;
  strongestSignal: string | null;
  recordsByMemoryType: Record<string, number>;
  complianceHealthScore: number;
  indexedAt: string;
}

export interface ComplianceAntiPatternRecord {
  patternId: string;
  patternKey: string;
  complianceSignal: string;
  policyViolationChain: string[];
  crossOrgFrequency: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  knownRemediations: string[];
  confidenceScore: number;
  isAnonymized: true;
  firstObservedAt: string;
}

export interface GovernanceRetentionPolicy {
  policyId: string;
  orgId: string;
  retentionDays: number;
  anonymizeAfterDays: number;
  requireExplainability: boolean;
  auditAllRecords: boolean;
}

export interface IFederatedGovernanceMemoryFabric {
  addRecord(record: GovernanceMemoryRecord): void;
  buildIndex(orgId: string, collectionId?: string): GovernanceMemoryIndex;
  addComplianceAntiPattern(pattern: ComplianceAntiPatternRecord): void;
  getComplianceAntiPattern(patternKey: string): ComplianceAntiPatternRecord | null;
  listComplianceAntiPatterns(): ComplianceAntiPatternRecord[];
  registerRetentionPolicy(policy: GovernanceRetentionPolicy): void;
  getRetentionPolicy(orgId: string): GovernanceRetentionPolicy | null;
  evictExpired(): number;
}
