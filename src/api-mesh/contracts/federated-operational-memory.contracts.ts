// src/api-mesh/contracts/federated-operational-memory.contracts.ts
// Phase E Step 13: Federated operational memory. Anonymized retention — replay determinism preserved.

export type AntiPatternSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface OperationalMemoryRecord {
  readonly recordId: string;
  readonly orgId: string;             // anonymized in federated contexts
  readonly memoryKey: string;         // normalized pattern key, non-tenant-sensitive
  readonly signal: string;
  readonly occurrenceCount: number;
  readonly avgRemedyEffectiveness: number;   // 0–1
  readonly retentionExpiresAt: string;
  readonly isAnonymized: boolean;
  readonly createdAt: string;
}

export interface AntiPatternMemory {
  readonly patternId: string;
  readonly patternKey: string;
  readonly severity: AntiPatternSeverity;
  readonly description: string;
  readonly crossOrgOccurrences: number;
  readonly recommendedMitigation: string;
  readonly knownEffectiveRemedies: readonly string[];
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
}

export interface OperationalMemoryRetentionPolicy {
  readonly policyId: string;
  readonly orgId: string;
  readonly retentionDays: number;
  readonly anonymizeAfterDays: number;
  readonly blockSensitiveSignals: readonly string[];
}

export interface IFederatedOperationalMemory {
  addRecord(record: OperationalMemoryRecord): void;
  getRecord(recordId: string): OperationalMemoryRecord | null;
  listRecords(orgId?: string): OperationalMemoryRecord[];
  evictExpired(): number;
  addAntiPattern(pattern: AntiPatternMemory): void;
  getAntiPattern(patternKey: string): AntiPatternMemory | null;
  listAntiPatterns(severity?: AntiPatternSeverity): AntiPatternMemory[];
  registerRetentionPolicy(policy: OperationalMemoryRetentionPolicy): void;
  getRetentionPolicy(orgId: string): OperationalMemoryRetentionPolicy | null;
}
