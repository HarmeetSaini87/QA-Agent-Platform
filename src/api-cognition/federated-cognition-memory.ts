// src/api-cognition/federated-cognition-memory.ts
// Phase E Step 14: Federated cognition memory. Explainable, anonymized retention.

import {
  CognitionMemoryIndex,
  AntiPatternCognitionRecord,
  CognitionRetentionPolicy,
  IFederatedCognitionMemory,
} from './contracts/federated-cognition-memory.contracts';
import { CognitionMemoryRecord } from './contracts/cognition-layer.contracts';

export class FederatedCognitionMemory implements IFederatedCognitionMemory {
  private readonly _records: CognitionMemoryRecord[] = [];
  private readonly _antiPatterns = new Map<string, AntiPatternCognitionRecord>();
  private readonly _retentionPolicies = new Map<string, CognitionRetentionPolicy>();

  addCognitionRecord(record: CognitionMemoryRecord): void {
    this._records.push(record);
  }

  buildIndex(orgId: string, collectionId?: string): CognitionMemoryIndex {
    const filtered = collectionId
      ? this._records.filter((r) => r.collectionId === collectionId)
      : this._records;

    const byType: Partial<Record<string, number>> = {};
    for (const r of filtered) {
      byType[r.memoryType] = (byType[r.memoryType] ?? 0) + 1;
    }

    const avgConfidence = filtered.length > 0
      ? Math.round(filtered.reduce((s, r) => s + r.confidence, 0) / filtered.length)
      : 0;

    let strongest: CognitionMemoryRecord | null = null;
    for (const r of filtered) {
      if (!strongest || r.confidence > strongest.confidence) strongest = r;
    }

    return {
      indexId: randomId(orgId, collectionId),
      orgId,
      totalRecords: filtered.length,
      recordsByMemoryType: byType,
      avgConfidence,
      strongestReasoning: strongest?.reasoning ?? null,
      indexedAt: new Date().toISOString(),
    };
  }

  addAntiPatternCognition(record: AntiPatternCognitionRecord): void {
    this._antiPatterns.set(record.patternKey, record);
  }

  getAntiPatternCognition(patternKey: string): AntiPatternCognitionRecord | null {
    return this._antiPatterns.get(patternKey) ?? null;
  }

  listAntiPatternCognitions(): AntiPatternCognitionRecord[] {
    return [...this._antiPatterns.values()];
  }

  registerRetentionPolicy(policy: CognitionRetentionPolicy): void {
    this._retentionPolicies.set(policy.orgId, policy);
  }

  getRetentionPolicy(orgId: string): CognitionRetentionPolicy | null {
    return this._retentionPolicies.get(orgId) ?? null;
  }

  _reset(): void {
    this._records.length = 0;
    this._antiPatterns.clear();
    this._retentionPolicies.clear();
  }
}

function randomId(orgId: string, collectionId?: string): string {
  return `${orgId}${collectionId ? `-${collectionId}` : ''}-cidx`;
}

export const globalFederatedCognitionMemory = new FederatedCognitionMemory();
