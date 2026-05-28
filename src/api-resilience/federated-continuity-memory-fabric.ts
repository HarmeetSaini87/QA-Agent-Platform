import { randomUUID } from 'crypto';
import type {
  ContinuityMemoryRecord,
  ContinuityMemoryType,
  ContinuityMemoryIndex,
  OutagePatternRecord,
  ContinuityRetentionPolicy,
  IFederatedContinuityMemoryFabric,
} from './contracts/federated-continuity-memory.contracts';

export class FederatedContinuityMemoryFabric implements IFederatedContinuityMemoryFabric {
  private _records: ContinuityMemoryRecord[] = [];
  private _outagePatterns = new Map<string, OutagePatternRecord>();
  private _policies = new Map<string, ContinuityRetentionPolicy>();

  _reset(): void {
    this._records = [];
    this._outagePatterns.clear();
    this._policies.clear();
  }

  addRecord(record: ContinuityMemoryRecord): void {
    this._records.push(record);
  }

  buildIndex(orgId: string, collectionId?: string): ContinuityMemoryIndex {
    const filtered = this._records.filter(
      r => r.orgId === orgId && (collectionId == null || r.collectionId === collectionId),
    );
    const totalRecords = filtered.length;
    const avgConfidence =
      totalRecords === 0
        ? 0
        : Math.round(filtered.reduce((s, r) => s + r.confidence, 0) / totalRecords);

    let strongestSignal: string | null = null;
    let maxScore = -1;
    for (const r of filtered) {
      const score = r.confidence * r.occurrenceCount;
      if (score > maxScore) { maxScore = score; strongestSignal = r.continuitySignal; }
    }

    const recordsByMemoryType: Record<string, number> = {};
    for (const r of filtered) {
      recordsByMemoryType[r.memoryType] = (recordsByMemoryType[r.memoryType] ?? 0) + 1;
    }

    let dominantMemoryType: ContinuityMemoryType | null = null;
    let maxTypeCount = 0;
    for (const [type, count] of Object.entries(recordsByMemoryType)) {
      if (count > maxTypeCount) { maxTypeCount = count; dominantMemoryType = type as ContinuityMemoryType; }
    }

    return {
      indexId: randomUUID(),
      orgId,
      collectionId,
      totalRecords,
      avgConfidence,
      dominantMemoryType,
      strongestSignal,
      recordsByMemoryType,
      indexedAt: new Date().toISOString(),
    };
  }

  addOutagePattern(pattern: OutagePatternRecord): void {
    this._outagePatterns.set(pattern.patternKey, pattern);
  }

  getOutagePattern(patternKey: string): OutagePatternRecord | null {
    return this._outagePatterns.get(patternKey) ?? null;
  }

  listOutagePatterns(): OutagePatternRecord[] {
    return [...this._outagePatterns.values()];
  }

  registerRetentionPolicy(policy: ContinuityRetentionPolicy): void {
    this._policies.set(policy.orgId, policy);
  }

  getRetentionPolicy(orgId: string): ContinuityRetentionPolicy | null {
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

export const globalFederatedContinuityMemoryFabric = new FederatedContinuityMemoryFabric();
