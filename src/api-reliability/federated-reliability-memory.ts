import { randomUUID } from 'crypto';
import type {
  ReliabilityMemoryRecord,
  ReliabilityMemoryIndex,
  ResilienceAntiPatternRecord,
  ReliabilityRetentionPolicy,
  IFederatedReliabilityMemory,
} from './contracts/federated-reliability-memory.contracts';

export class FederatedReliabilityMemory implements IFederatedReliabilityMemory {
  private _records: ReliabilityMemoryRecord[] = [];
  private _antiPatterns = new Map<string, ResilienceAntiPatternRecord>();
  private _policies = new Map<string, ReliabilityRetentionPolicy>();

  _reset(): void {
    this._records = [];
    this._antiPatterns.clear();
    this._policies.clear();
  }

  addMemoryRecord(record: ReliabilityMemoryRecord): void {
    this._records.push(record);
  }

  buildIndex(orgId: string, collectionId?: string): ReliabilityMemoryIndex {
    const filtered = this._records.filter(
      r => collectionId == null || r.collectionId === collectionId,
    );
    const totalRecords = filtered.length;
    const avgConfidence =
      totalRecords === 0
        ? 0
        : Math.round(filtered.reduce((s, r) => s + r.confidence, 0) / totalRecords);
    const strongest =
      totalRecords === 0
        ? null
        : filtered.reduce((best, r) => (r.confidence > best.confidence ? r : best)).reasoning;

    const recordsByMemoryType: Record<string, number> = {};
    for (const r of filtered) {
      recordsByMemoryType[r.memoryType] = (recordsByMemoryType[r.memoryType] ?? 0) + 1;
    }

    return {
      indexId: randomUUID(),
      orgId,
      collectionId,
      totalRecords,
      avgConfidence,
      strongestReasoning: strongest,
      recordsByMemoryType,
      indexedAt: new Date().toISOString(),
    };
  }

  addAntiPattern(pattern: ResilienceAntiPatternRecord): void {
    this._antiPatterns.set(pattern.patternKey, pattern);
  }

  getAntiPattern(patternKey: string): ResilienceAntiPatternRecord | null {
    return this._antiPatterns.get(patternKey) ?? null;
  }

  listAntiPatterns(): ResilienceAntiPatternRecord[] {
    return [...this._antiPatterns.values()];
  }

  registerRetentionPolicy(policy: ReliabilityRetentionPolicy): void {
    this._policies.set(policy.orgId, policy);
  }

  getRetentionPolicy(orgId: string): ReliabilityRetentionPolicy | null {
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

export const globalFederatedReliabilityMemory = new FederatedReliabilityMemory();
