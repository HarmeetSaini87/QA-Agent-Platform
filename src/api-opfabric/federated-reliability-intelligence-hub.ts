import { randomUUID } from 'crypto';
import type {
  ReliabilityIntelligenceCategory,
  FederatedReliabilityIntelligenceRecord,
  ReliabilityIntelligenceBundleResult,
  OrchestrationAntiPatternFederationMemory,
  FederatedReliabilityIntelligenceIndex,
  IFederatedReliabilityIntelligenceHub,
} from './contracts/federated-reliability-intelligence.contracts';

const GOVERNANCE_NOTE = 'Advisory only — federated reliability intelligence is anonymized observational data; tenant execution data is never exposed.';

export class FederatedReliabilityIntelligenceHub implements IFederatedReliabilityIntelligenceHub {
  private _records: FederatedReliabilityIntelligenceRecord[] = [];
  private _antiPatterns = new Map<string, OrchestrationAntiPatternFederationMemory>();

  _reset(): void {
    this._records = [];
    this._antiPatterns.clear();
  }

  publishRecord(record: FederatedReliabilityIntelligenceRecord): void {
    if (!record.isAnonymized) return; // enforce anonymization
    this._records.push(record);
  }

  bundleByCategory(
    orgId: string,
    category: ReliabilityIntelligenceCategory,
  ): ReliabilityIntelligenceBundleResult {
    const filtered = this._records.filter(r => r.orgId === orgId && r.category === category);
    const contributingOrgs = new Set(this._records.filter(r => r.category === category).map(r => r.orgId)).size;
    const avgConfidence =
      filtered.length === 0 ? 0 : Math.round(filtered.reduce((s, r) => s + r.confidence, 0) / filtered.length);
    const avgCrossOrgWeight =
      filtered.length === 0 ? 0 : Math.round(filtered.reduce((s, r) => s + r.crossOrgWeight, 0) / filtered.length * 100) / 100;
    const topSignals = filtered
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map(r => r.intelligenceSignal);
    return {
      bundleId: randomUUID(),
      orgId,
      category,
      contributingOrgs,
      avgConfidence,
      avgCrossOrgWeight,
      topSignals,
      governanceNote: GOVERNANCE_NOTE,
      bundledAt: new Date().toISOString(),
    };
  }

  addAntiPattern(pattern: OrchestrationAntiPatternFederationMemory): void {
    this._antiPatterns.set(pattern.patternKey, pattern);
  }

  getAntiPattern(patternKey: string): OrchestrationAntiPatternFederationMemory | null {
    return this._antiPatterns.get(patternKey) ?? null;
  }

  listAntiPatterns(): OrchestrationAntiPatternFederationMemory[] {
    return [...this._antiPatterns.values()];
  }

  buildIndex(orgId: string): FederatedReliabilityIntelligenceIndex {
    const filtered = this._records.filter(r => r.orgId === orgId);
    const totalRecords = filtered.length;
    const avgConfidence =
      totalRecords === 0 ? 0 : Math.round(filtered.reduce((s, r) => s + r.confidence, 0) / totalRecords);
    const categoryBreakdown: Record<string, number> = {};
    for (const r of filtered) {
      categoryBreakdown[r.category] = (categoryBreakdown[r.category] ?? 0) + 1;
    }
    let strongestSignal: string | null = null;
    let maxConf = -1;
    for (const r of filtered) {
      if (r.confidence > maxConf) { maxConf = r.confidence; strongestSignal = r.intelligenceSignal; }
    }
    return {
      indexId: randomUUID(),
      orgId,
      totalRecords,
      avgConfidence,
      categoryBreakdown,
      strongestSignal,
      indexedAt: new Date().toISOString(),
    };
  }
}

export const globalFederatedReliabilityIntelligenceHub = new FederatedReliabilityIntelligenceHub();
