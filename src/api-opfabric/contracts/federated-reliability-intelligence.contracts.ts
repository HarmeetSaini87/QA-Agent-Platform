export type ReliabilityIntelligenceCategory =
  | 'retry-anti-pattern'
  | 'dependency-instability'
  | 'orchestration-bottleneck'
  | 'remediation-effectiveness'
  | 'sla-resilience'
  | 'stabilization-signal';

export interface FederatedReliabilityIntelligenceRecord {
  recordId: string;
  orgId: string;
  category: ReliabilityIntelligenceCategory;
  intelligenceSignal: string;
  confidence: number;
  crossOrgWeight: number;
  isAnonymized: true;
  isExplainable: true;
  createdAt: string;
}

export interface ReliabilityIntelligenceBundleResult {
  bundleId: string;
  orgId: string;
  category: ReliabilityIntelligenceCategory;
  contributingOrgs: number;
  avgConfidence: number;
  avgCrossOrgWeight: number;
  topSignals: string[];
  governanceNote: string;
  bundledAt: string;
}

export interface OrchestrationAntiPatternFederationMemory {
  patternId: string;
  patternKey: string;
  orchestrationSignal: string;
  reasoningChain: string[];
  crossOrgFrequency: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  knownEffectiveRemedies: string[];
  confidenceScore: number;
  isAnonymized: true;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface FederatedReliabilityIntelligenceIndex {
  indexId: string;
  orgId: string;
  totalRecords: number;
  avgConfidence: number;
  categoryBreakdown: Record<string, number>;
  strongestSignal: string | null;
  indexedAt: string;
}

export interface IFederatedReliabilityIntelligenceHub {
  publishRecord(record: FederatedReliabilityIntelligenceRecord): void;
  bundleByCategory(orgId: string, category: ReliabilityIntelligenceCategory): ReliabilityIntelligenceBundleResult;
  addAntiPattern(pattern: OrchestrationAntiPatternFederationMemory): void;
  getAntiPattern(patternKey: string): OrchestrationAntiPatternFederationMemory | null;
  listAntiPatterns(): OrchestrationAntiPatternFederationMemory[];
  buildIndex(orgId: string): FederatedReliabilityIntelligenceIndex;
}
