import { randomUUID } from 'crypto';
import type {
  GovernanceMemoryRecord, GovernanceMemoryType, GovernanceMemoryIndex,
  ComplianceAntiPatternRecord, GovernanceRetentionPolicy, IFederatedGovernanceMemoryFabric
} from './contracts/federated-governance-memory.contracts';

const GOVERNANCE_NOTE = 'Federated governance memory fabric — advisory only, no runtime mutations.';

export class FederatedGovernanceMemoryFabric implements IFederatedGovernanceMemoryFabric {
  private _records: GovernanceMemoryRecord[] = [];
  private _antiPatterns = new Map<string, ComplianceAntiPatternRecord>();
  private _retentionPolicies = new Map<string, GovernanceRetentionPolicy>();

  _reset(): void {
    this._records = [];
    this._antiPatterns.clear();
    this._retentionPolicies.clear();
  }

  addRecord(record: GovernanceMemoryRecord): void { this._records.push(record); }

  buildIndex(orgId: string, collectionId?: string): GovernanceMemoryIndex {
    const filtered = this._records.filter(
      r => r.orgId === orgId && (!collectionId || r.collectionId === collectionId)
    );

    const typeCount = new Map<string, number>();
    filtered.forEach(r => typeCount.set(r.memoryType, (typeCount.get(r.memoryType) ?? 0) + 1));

    let dominantMemoryType: GovernanceMemoryType | null = null;
    let maxCount = 0;
    typeCount.forEach((count, type) => { if (count > maxCount) { maxCount = count; dominantMemoryType = type as GovernanceMemoryType; } });

    let strongestSignal: string | null = null;
    let maxStrength = -1;
    filtered.forEach(r => {
      const strength = r.confidence * r.occurrenceCount;
      if (strength > maxStrength) { maxStrength = strength; strongestSignal = r.governanceSignal; }
    });

    const avgConfidence = filtered.length
      ? filtered.reduce((s, r) => s + r.confidence, 0) / filtered.length
      : 0;

    const nonAnomaly = filtered.filter(r => r.memoryType !== 'governance-anomaly').length;
    const complianceHealthScore = filtered.length
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
      complianceHealthScore,
      indexedAt: new Date().toISOString(),
    };
  }

  addComplianceAntiPattern(pattern: ComplianceAntiPatternRecord): void {
    this._antiPatterns.set(pattern.patternKey, pattern);
  }

  getComplianceAntiPattern(patternKey: string): ComplianceAntiPatternRecord | null {
    return this._antiPatterns.get(patternKey) ?? null;
  }

  listComplianceAntiPatterns(): ComplianceAntiPatternRecord[] {
    return Array.from(this._antiPatterns.values());
  }

  registerRetentionPolicy(policy: GovernanceRetentionPolicy): void {
    this._retentionPolicies.set(policy.orgId, policy);
  }

  getRetentionPolicy(orgId: string): GovernanceRetentionPolicy | null {
    return this._retentionPolicies.get(orgId) ?? null;
  }

  evictExpired(): number {
    const now = Date.now();
    const before = this._records.length;
    this._records = this._records.filter(r => new Date(r.retentionExpiresAt).getTime() > now);
    return before - this._records.length;
  }
}

export const globalFederatedGovernanceMemoryFabric = new FederatedGovernanceMemoryFabric();
