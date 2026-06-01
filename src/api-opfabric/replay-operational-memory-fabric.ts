import { randomUUID } from 'crypto';
import type {
  ReplayOperationalMemoryEntry,
  OperationalMemoryFederationIndex,
  ReplayBackedRemediationMemory,
  FederatedRetryStabilizationRecord,
  IReplayOperationalMemoryFabric,
} from './contracts/replay-operational-memory-federation.contracts';

const GOVERNANCE_NOTE = 'Advisory only — replay operational memory is read-only federation context; replay determinism is preserved.';

export class ReplayOperationalMemoryFabric implements IReplayOperationalMemoryFabric {
  private _entries: ReplayOperationalMemoryEntry[] = [];
  private _remediationMemory: ReplayBackedRemediationMemory[] = [];
  private _retryStabilization = new Map<string, FederatedRetryStabilizationRecord>();

  _reset(): void {
    this._entries = [];
    this._remediationMemory = [];
    this._retryStabilization.clear();
  }

  addEntry(entry: ReplayOperationalMemoryEntry): void {
    this._entries.push(entry);
  }

  buildIndex(orgId: string, collectionId?: string): OperationalMemoryFederationIndex {
    const filtered = this._entries.filter(
      e => collectionId == null || e.collectionId === collectionId,
    );
    const totalEntries = filtered.length;
    const avgConfidence =
      totalEntries === 0
        ? 0
        : Math.round(filtered.reduce((s, e) => s + e.confidence, 0) / totalEntries);

    // strongest signal = max (confidence × occurrenceCount)
    let strongestSignal: string | null = null;
    let maxScore = -1;
    for (const e of filtered) {
      const score = e.confidence * e.occurrenceCount;
      if (score > maxScore) { maxScore = score; strongestSignal = e.memorySignal; }
    }

    const entriesByFederationType: Record<string, number> = {};
    for (const e of filtered) {
      entriesByFederationType[e.federationType] = (entriesByFederationType[e.federationType] ?? 0) + 1;
    }

    return {
      indexId: randomUUID(),
      orgId,
      collectionId,
      totalEntries,
      avgConfidence,
      strongestSignal,
      entriesByFederationType,
      indexedAt: new Date().toISOString(),
    };
  }

  addRemediationMemory(memory: ReplayBackedRemediationMemory): void {
    this._remediationMemory.push(memory);
  }

  listRemediationMemory(collectionId: string): ReplayBackedRemediationMemory[] {
    return this._remediationMemory.filter(m => m.collectionId === collectionId);
  }

  addRetryStabilizationRecord(record: FederatedRetryStabilizationRecord): void {
    this._retryStabilization.set(record.patternKey, record);
  }

  getRetryStabilizationRecord(patternKey: string): FederatedRetryStabilizationRecord | null {
    return this._retryStabilization.get(patternKey) ?? null;
  }

  evictExpired(): number {
    const now = Date.now();
    const before = this._entries.length;
    this._entries = this._entries.filter(
      e => new Date(e.retentionExpiresAt).getTime() > now,
    );
    return before - this._entries.length;
  }
}

export const globalReplayOperationalMemoryFabric = new ReplayOperationalMemoryFabric();
