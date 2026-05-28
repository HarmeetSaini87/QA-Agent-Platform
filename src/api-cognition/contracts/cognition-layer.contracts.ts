// src/api-cognition/contracts/cognition-layer.contracts.ts
// Phase E Step 14: Operational cognition layer contracts. Governed, explainable — WorkflowEnvelope authoritative.

export type CognitionMemoryType =
  | 'orchestration-cognition'
  | 'replay-reasoning'
  | 'reliability-cognition'
  | 'remediation-trail'
  | 'optimization-cognition'
  | 'federated-cognition';

export type CognitionConfidenceLevel = 'low' | 'medium' | 'high' | 'very-high';

export interface CognitionMemoryRecord {
  readonly recordId: string;
  readonly collectionId: string;
  readonly memoryType: CognitionMemoryType;
  readonly signal: string;
  readonly reasoning: string;           // explainable rationale — required for governance
  readonly confidence: number;          // 0–100
  readonly confidenceLevel: CognitionConfidenceLevel;
  readonly evidenceSources: readonly string[];
  readonly isExplainable: true;         // cognition must always be explainable
  readonly createdAt: string;
  readonly governanceNote: string;
}

export interface OrchestrationCognitionSummary {
  readonly collectionId: string;
  readonly totalCognitionRecords: number;
  readonly dominantMemoryType: CognitionMemoryType | null;
  readonly avgConfidence: number;
  readonly topSignals: readonly string[];
  readonly generatedAt: string;
}

export interface ICognitionLayerRegistry {
  addRecord(record: CognitionMemoryRecord): void;
  getRecord(recordId: string): CognitionMemoryRecord | null;
  listRecords(collectionId: string, memoryType?: CognitionMemoryType): CognitionMemoryRecord[];
  summarize(collectionId: string): OrchestrationCognitionSummary;
}
