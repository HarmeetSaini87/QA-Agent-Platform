import { randomUUID } from 'crypto';
import type {
  EnterpriseMemoryRecord, EnterpriseMemoryType, EnterpriseMemoryIndex,
  OrchestrationAntiPatternRecord, EnterpriseRetentionPolicy, IFederatedEnterpriseMemoryFabric
} from './contracts/federated-enterprise-memory.contracts';

const GOVERNANCE_NOTE = 'Federated enterprise memory fabric — advisory only, no runtime mutations.';

export class FederatedEnterpriseMemoryFabric implements IFederatedEnterpriseMemoryFabric {
  private _records: EnterpriseMemoryRecord[] = [];
  private _antiPatterns = new Map<string, OrchestrationAntiPatternRecord>();
  private _retentionPolicies = new Map<string, EnterpriseRetentionPolicy>();

  _reset(): void {
    this._records = [];
    this._antiPatterns.clear();
    this._retentionPolicies.clear();
  }

  addRecord(record: EnterpriseMemoryRecord): void { this._records.push(record); }

  buildIndex(orgId: string, collectionId?: string): EnterpriseMemoryIndex {
    const filtered = this._records.filter(
      r => r.orgId === orgId && (!collectionId || r.collectionId === collectionId)
    );

    const typeCount = new Map<string, number>();
    filtered.forEach(r => typeCount.set(r.memoryType, (typeCount.get(r.memoryType) ?? 0) + 1));

    let dominantMemoryType: EnterpriseMemoryType | null = null;
    let maxCount = 0;
    typeCount.forEach((count, type) => { if (count > maxCount) { maxCount = count; dominantMemoryType = type as EnterpriseMemoryType; } });

    let strongestSignal: string | null = null;
    let maxStrength = -1;
    filtered.forEach(r => {
      const strength = r.confidence * r.occurrenceCount;
      if (strength > maxStrength) { maxStrength = strength; strongestSignal = r.operationalSignal; }
    });

    const avgConfidence = filtered.length
      ? filtered.reduce((s, r) => s + r.confidence, 0) / filtered.length
      : 0;

    const nonAnomaly = filtered.filter(r => r.memoryType !== 'platform-anomaly').length;
    const operationalHealthScore = filtered.length
      ? Math.round((nonAnomaly / filtered.length) * 100)
      : 100;

    const recordsByMemoryType: Record<string, number> = {};
    typeCount.forEach((count, type) => { recordsByMemoryType[type] = count; });

    return {
      indexId: randomUUID(),
      orgId,
      collectionId,
      totalRecords: filtered.length,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      dominantMemoryType,
      strongestSignal,
      recordsByMemoryType,
      operationalHealthScore,
      indexedAt: new Date().toISOString(),
    };
  }

  addOrchestrationAntiPattern(pattern: OrchestrationAntiPatternRecord): void {
    this._antiPatterns.set(pattern.patternKey, pattern);
  }

  getOrchestrationAntiPattern(patternKey: string): OrchestrationAntiPatternRecord | null {
    return this._antiPatterns.get(patternKey) ?? null;
  }

  listOrchestrationAntiPatterns(): OrchestrationAntiPatternRecord[] {
    return Array.from(this._antiPatterns.values());
  }

  registerRetentionPolicy(policy: EnterpriseRetentionPolicy): void {
    this._retentionPolicies.set(policy.orgId, policy);
  }

  getRetentionPolicy(orgId: string): EnterpriseRetentionPolicy | null {
    return this._retentionPolicies.get(orgId) ?? null;
  }

  evictExpired(): number {
    const now = Date.now();
    const before = this._records.length;
    this._records = this._records.filter(r => new Date(r.retentionExpiresAt).getTime() > now);
    return before - this._records.length;
  }
}

export const globalFederatedEnterpriseMemoryFabric = new FederatedEnterpriseMemoryFabric();
