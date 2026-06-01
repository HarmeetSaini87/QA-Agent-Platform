// src/api-mesh/replay-knowledge-fabric.ts
// Phase E Step 13: Replay knowledge fabric. Operational memory — replay data never modified.

import {
  ReplayKnowledgeEntry,
  KnowledgeMemoryType,
  OperationalMemoryIndex,
  ReplayOptimizationMemory,
  IReplayKnowledgeFabric,
} from './contracts/replay-knowledge-fabric.contracts';

export class ReplayKnowledgeFabric implements IReplayKnowledgeFabric {
  private readonly _entries = new Map<string, ReplayKnowledgeEntry>();
  private readonly _optimizationMemory = new Map<string, ReplayOptimizationMemory[]>();

  addEntry(entry: ReplayKnowledgeEntry): void {
    this._entries.set(entry.entryId, entry);
  }

  getEntry(entryId: string): ReplayKnowledgeEntry | null {
    return this._entries.get(entryId) ?? null;
  }

  listEntries(collectionId: string, memoryType?: KnowledgeMemoryType): ReplayKnowledgeEntry[] {
    const all = [...this._entries.values()].filter((e) => e.collectionId === collectionId);
    return memoryType ? all.filter((e) => e.memoryType === memoryType) : all;
  }

  buildIndex(collectionId: string): OperationalMemoryIndex {
    const entries = this.listEntries(collectionId);
    const countByType: Partial<Record<KnowledgeMemoryType, number>> = {};
    for (const e of entries) {
      countByType[e.memoryType] = (countByType[e.memoryType] ?? 0) + 1;
    }

    // strongest signal = entry with highest avgConfidence × occurrenceCount
    let strongest: ReplayKnowledgeEntry | null = null;
    let maxScore = -1;
    for (const e of entries) {
      const score = e.avgConfidence * e.occurrenceCount;
      if (score > maxScore) { maxScore = score; strongest = e; }
    }

    return {
      indexId: `${collectionId}-idx`,
      collectionId,
      totalEntries: entries.length,
      entryCountByType: countByType,
      strongestSignal: strongest?.signal ?? null,
      indexedAt: new Date().toISOString(),
    };
  }

  recordOptimizationMemory(record: ReplayOptimizationMemory): void {
    const prev = this._optimizationMemory.get(record.collectionId) ?? [];
    this._optimizationMemory.set(record.collectionId, [...prev, record]);
  }

  listOptimizationMemory(collectionId: string): ReplayOptimizationMemory[] {
    return this._optimizationMemory.get(collectionId) ?? [];
  }

  _reset(): void {
    this._entries.clear();
    this._optimizationMemory.clear();
  }
}

export const globalReplayKnowledgeFabric = new ReplayKnowledgeFabric();
