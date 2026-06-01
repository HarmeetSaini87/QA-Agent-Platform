// src/api-mesh/federated-operational-memory.ts
// Phase E Step 13: Federated operational memory. Anonymized retention — governance-safe intelligence.

import {
  OperationalMemoryRecord,
  AntiPatternMemory,
  AntiPatternSeverity,
  OperationalMemoryRetentionPolicy,
  IFederatedOperationalMemory,
} from './contracts/federated-operational-memory.contracts';

export class FederatedOperationalMemory implements IFederatedOperationalMemory {
  private readonly _records = new Map<string, OperationalMemoryRecord>();
  private readonly _antiPatterns = new Map<string, AntiPatternMemory>();  // keyed by patternKey
  private readonly _retentionPolicies = new Map<string, OperationalMemoryRetentionPolicy>();

  addRecord(record: OperationalMemoryRecord): void {
    this._records.set(record.recordId, record);
  }

  getRecord(recordId: string): OperationalMemoryRecord | null {
    return this._records.get(recordId) ?? null;
  }

  listRecords(orgId?: string): OperationalMemoryRecord[] {
    const all = [...this._records.values()];
    return orgId ? all.filter((r) => r.orgId === orgId) : all;
  }

  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [id, record] of this._records) {
      if (new Date(record.retentionExpiresAt).getTime() <= now) {
        this._records.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  addAntiPattern(pattern: AntiPatternMemory): void {
    this._antiPatterns.set(pattern.patternKey, pattern);
  }

  getAntiPattern(patternKey: string): AntiPatternMemory | null {
    return this._antiPatterns.get(patternKey) ?? null;
  }

  listAntiPatterns(severity?: AntiPatternSeverity): AntiPatternMemory[] {
    const all = [...this._antiPatterns.values()];
    return severity ? all.filter((p) => p.severity === severity) : all;
  }

  registerRetentionPolicy(policy: OperationalMemoryRetentionPolicy): void {
    this._retentionPolicies.set(policy.orgId, policy);
  }

  getRetentionPolicy(orgId: string): OperationalMemoryRetentionPolicy | null {
    return this._retentionPolicies.get(orgId) ?? null;
  }

  _reset(): void {
    this._records.clear();
    this._antiPatterns.clear();
    this._retentionPolicies.clear();
  }
}

export const globalFederatedOperationalMemory = new FederatedOperationalMemory();
