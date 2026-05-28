// src/api-mesh/contracts/replay-knowledge-fabric.contracts.ts
// Phase E Step 13: Replay-driven operational memory. Read-only fabric — replay determinism preserved.

export type KnowledgeMemoryType =
  | 'rca-recurring'
  | 'stabilization-memory'
  | 'dependency-instability'
  | 'retry-optimization'
  | 'remediation-effectiveness'
  | 'environment-anomaly';

export interface ReplayKnowledgeEntry {
  readonly entryId: string;
  readonly memoryType: KnowledgeMemoryType;
  readonly collectionId: string;
  readonly signal: string;             // normalized, non-tenant-sensitive description
  readonly occurrenceCount: number;
  readonly avgConfidence: number;      // 0–100
  readonly lastObservedAt: string;
  readonly isAnonymized: boolean;
}

export interface OperationalMemoryIndex {
  readonly indexId: string;
  readonly collectionId: string;
  readonly totalEntries: number;
  readonly entryCountByType: Partial<Record<KnowledgeMemoryType, number>>;
  readonly strongestSignal: string | null;
  readonly indexedAt: string;
}

export interface ReplayOptimizationMemory {
  readonly collectionId: string;
  readonly stepId: string;
  readonly retryPatternHash: string;
  readonly recommendedAction: string;
  readonly effectivenessScore: number;    // 0–1
  readonly memorizedAt: string;
}

export interface IReplayKnowledgeFabric {
  addEntry(entry: ReplayKnowledgeEntry): void;
  getEntry(entryId: string): ReplayKnowledgeEntry | null;
  listEntries(collectionId: string, memoryType?: KnowledgeMemoryType): ReplayKnowledgeEntry[];
  buildIndex(collectionId: string): OperationalMemoryIndex;
  recordOptimizationMemory(record: ReplayOptimizationMemory): void;
  listOptimizationMemory(collectionId: string): ReplayOptimizationMemory[];
}
