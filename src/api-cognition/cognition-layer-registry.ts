// src/api-cognition/cognition-layer-registry.ts
// Phase E Step 14: Cognition layer registry. Explainable, governed records only.

import {
  CognitionMemoryRecord,
  CognitionMemoryType,
  OrchestrationCognitionSummary,
  ICognitionLayerRegistry,
} from './contracts/cognition-layer.contracts';

export class CognitionLayerRegistry implements ICognitionLayerRegistry {
  private readonly _records = new Map<string, CognitionMemoryRecord>();

  addRecord(record: CognitionMemoryRecord): void {
    this._records.set(record.recordId, record);
  }

  getRecord(recordId: string): CognitionMemoryRecord | null {
    return this._records.get(recordId) ?? null;
  }

  listRecords(collectionId: string, memoryType?: CognitionMemoryType): CognitionMemoryRecord[] {
    const all = [...this._records.values()].filter((r) => r.collectionId === collectionId);
    return memoryType ? all.filter((r) => r.memoryType === memoryType) : all;
  }

  summarize(collectionId: string): OrchestrationCognitionSummary {
    const records = this.listRecords(collectionId);
    if (records.length === 0) {
      return {
        collectionId,
        totalCognitionRecords: 0,
        dominantMemoryType: null,
        avgConfidence: 0,
        topSignals: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const typeCounts = new Map<CognitionMemoryType, number>();
    for (const r of records) {
      typeCounts.set(r.memoryType, (typeCounts.get(r.memoryType) ?? 0) + 1);
    }
    let dominant: CognitionMemoryType | null = null;
    let maxCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > maxCount) { maxCount = count; dominant = type; }
    }

    const avgConfidence = Math.round(
      records.reduce((s, r) => s + r.confidence, 0) / records.length
    );

    // top 3 unique signals by confidence
    const topSignals = [...records]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map((r) => r.signal);

    return {
      collectionId,
      totalCognitionRecords: records.length,
      dominantMemoryType: dominant,
      avgConfidence,
      topSignals,
      generatedAt: new Date().toISOString(),
    };
  }

  _reset(): void {
    this._records.clear();
  }
}

export const globalCognitionLayerRegistry = new CognitionLayerRegistry();
