import { randomUUID } from 'crypto';
import type {
  SemanticMemoryRecord,
  SemanticMemoryType,
  SemanticMemoryIndex,
  OrchestrationAntiPatternSemantics,
  SemanticRetentionPolicy,
  IFederatedSemanticMemoryFabric,
} from './contracts/federated-semantic-memory.contracts';

export class FederatedSemanticMemoryFabric implements IFederatedSemanticMemoryFabric {
  private _records: SemanticMemoryRecord[] = [];
  private _antiPatterns = new Map<string, OrchestrationAntiPatternSemantics>();
  private _policies = new Map<string, SemanticRetentionPolicy>();

  _reset(): void {
    this._records = [];
    this._antiPatterns.clear();
    this._policies.clear();
  }

  addRecord(record: SemanticMemoryRecord): void {
    this._records.push(record);
  }

  buildIndex(orgId: string, collectionId?: string): SemanticMemoryIndex {
    const filtered = this._records.filter(
      r => collectionId == null || r.collectionId === collectionId,
    );
    const totalRecords = filtered.length;
    const avgConfidence =
      totalRecords === 0
        ? 0
        : Math.round(filtered.reduce((s, r) => s + r.confidence, 0) / totalRecords);

    // strongest = max(confidence × occurrenceCount)
    let strongestSemanticSignal: string | null = null;
    let maxScore = -1;
    for (const r of filtered) {
      const score = r.confidence * r.occurrenceCount;
      if (score > maxScore) { maxScore = score; strongestSemanticSignal = r.semanticSignal; }
    }

    const recordsByMemoryType: Record<string, number> = {};
    for (const r of filtered) {
      recordsByMemoryType[r.memoryType] = (recordsByMemoryType[r.memoryType] ?? 0) + 1;
    }

    // dominant memory type by count
    let dominantMemoryType: SemanticMemoryType | null = null;
    let maxTypeCount = 0;
    for (const [type, count] of Object.entries(recordsByMemoryType)) {
      if (count > maxTypeCount) { maxTypeCount = count; dominantMemoryType = type as SemanticMemoryType; }
    }

    return {
      indexId: randomUUID(),
      orgId,
      collectionId,
      totalRecords,
      avgConfidence,
      dominantMemoryType,
      strongestSemanticSignal,
      recordsByMemoryType,
      indexedAt: new Date().toISOString(),
    };
  }

  addAntiPatternSemantics(pattern: OrchestrationAntiPatternSemantics): void {
    this._antiPatterns.set(pattern.patternKey, pattern);
  }

  getAntiPatternSemantics(patternKey: string): OrchestrationAntiPatternSemantics | null {
    return this._antiPatterns.get(patternKey) ?? null;
  }

  listAntiPatternSemantics(): OrchestrationAntiPatternSemantics[] {
    return [...this._antiPatterns.values()];
  }

  registerRetentionPolicy(policy: SemanticRetentionPolicy): void {
    this._policies.set(policy.orgId, policy);
  }

  getRetentionPolicy(orgId: string): SemanticRetentionPolicy | null {
    return this._policies.get(orgId) ?? null;
  }

  evictExpired(): number {
    const now = Date.now();
    const before = this._records.length;
    this._records = this._records.filter(
      r => new Date(r.retentionExpiresAt).getTime() > now,
    );
    return before - this._records.length;
  }
}

export const globalFederatedSemanticMemoryFabric = new FederatedSemanticMemoryFabric();
