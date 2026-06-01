// src/api-federation/contracts/cross-org-intelligence.contracts.ts
// Phase E Step 12: Cross-org intelligence sharing. Anonymized only — no tenant-sensitive data exposed.

export type IntelligenceCategory =
  | 'flakiness-pattern'
  | 'retry-anti-pattern'
  | 'orchestration-anti-pattern'
  | 'rca-knowledge'
  | 'workflow-optimization'
  | 'dependency-instability';

export interface AnonymizedIntelligenceRecord {
  readonly recordId: string;
  readonly category: IntelligenceCategory;
  readonly sourceOrgId: string;          // anonymized hash in cross-org contexts
  readonly signal: string;               // human-readable pattern description
  readonly weight: number;               // 0–1: strength of signal
  readonly sampleSize: number;           // how many runs contributed
  readonly isAnonymized: boolean;
  readonly sharedAt: string;
}

export interface SharedInsightBundle {
  readonly bundleId: string;
  readonly fromOrgId: string;
  readonly toOrgId: string;
  readonly category: IntelligenceCategory;
  readonly records: readonly AnonymizedIntelligenceRecord[];
  readonly totalRecords: number;
  readonly approvedBy?: string;
  readonly sharedAt: string;
  readonly governanceNote: string;
}

export interface IntelligenceAggregationResult {
  readonly collectionId: string;
  readonly category: IntelligenceCategory;
  readonly aggregatedSignal: string;
  readonly contributingOrgs: number;
  readonly avgWeight: number;
  readonly generatedAt: string;
}

export interface ICrossOrgIntelligenceHub {
  publishRecord(record: AnonymizedIntelligenceRecord): void;
  listRecords(category?: IntelligenceCategory): AnonymizedIntelligenceRecord[];
  createBundle(fromOrgId: string, toOrgId: string, category: IntelligenceCategory, approvedBy?: string): SharedInsightBundle;
  listBundles(orgId: string): SharedInsightBundle[];
  aggregate(category: IntelligenceCategory): IntelligenceAggregationResult;
}
