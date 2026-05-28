// src/api-cognition/contracts/federated-cognition-memory.contracts.ts
// Phase E Step 14: Federated cognition memory. Anonymized retention — replay determinism preserved.

export interface CognitionMemoryIndex {
  readonly indexId: string;
  readonly orgId: string;
  readonly totalRecords: number;
  readonly recordsByMemoryType: Partial<Record<string, number>>;
  readonly avgConfidence: number;
  readonly strongestReasoning: string | null;
  readonly indexedAt: string;
}

export interface AntiPatternCognitionRecord {
  readonly patternId: string;
  readonly patternKey: string;
  readonly cognitionSignal: string;
  readonly reasoningChain: readonly string[];    // explainable steps
  readonly crossOrgFrequency: number;
  readonly recommendedCognitionAction: string;
  readonly knownEffectiveReasonings: readonly string[];
  readonly confidenceScore: number;              // 0–100
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
}

export interface CognitionRetentionPolicy {
  readonly policyId: string;
  readonly orgId: string;
  readonly retentionDays: number;
  readonly anonymizeAfterDays: number;
  readonly requireExplainability: boolean;       // all retained records must have reasoning
}

export interface IFederatedCognitionMemory {
  addCognitionRecord(record: import('./cognition-layer.contracts').CognitionMemoryRecord): void;
  buildIndex(orgId: string, collectionId?: string): CognitionMemoryIndex;
  addAntiPatternCognition(record: AntiPatternCognitionRecord): void;
  getAntiPatternCognition(patternKey: string): AntiPatternCognitionRecord | null;
  listAntiPatternCognitions(): AntiPatternCognitionRecord[];
  registerRetentionPolicy(policy: CognitionRetentionPolicy): void;
  getRetentionPolicy(orgId: string): CognitionRetentionPolicy | null;
}
