// src/api-federation/cross-org-intelligence-hub.ts
// Phase E Step 12: Cross-org intelligence hub. Anonymized records only — no tenant-sensitive data shared.

import { randomUUID } from 'crypto';
import {
  AnonymizedIntelligenceRecord,
  SharedInsightBundle,
  IntelligenceAggregationResult,
  IntelligenceCategory,
  ICrossOrgIntelligenceHub,
} from './contracts/cross-org-intelligence.contracts';

const GOVERNANCE_NOTE =
  'All shared intelligence is anonymized. Tenant-sensitive execution data is never exposed.';

export class CrossOrgIntelligenceHub implements ICrossOrgIntelligenceHub {
  private readonly _records: AnonymizedIntelligenceRecord[] = [];
  private readonly _bundles = new Map<string, SharedInsightBundle[]>();

  publishRecord(record: AnonymizedIntelligenceRecord): void {
    this._records.push(record);
  }

  listRecords(category?: IntelligenceCategory): AnonymizedIntelligenceRecord[] {
    return category ? this._records.filter((r) => r.category === category) : [...this._records];
  }

  createBundle(
    fromOrgId: string,
    toOrgId: string,
    category: IntelligenceCategory,
    approvedBy?: string
  ): SharedInsightBundle {
    const records = this._records.filter(
      (r) => r.category === category && r.isAnonymized
    );
    const bundle: SharedInsightBundle = {
      bundleId: randomUUID(),
      fromOrgId,
      toOrgId,
      category,
      records,
      totalRecords: records.length,
      approvedBy,
      sharedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    const prev = this._bundles.get(toOrgId) ?? [];
    this._bundles.set(toOrgId, [...prev, bundle]);
    return bundle;
  }

  listBundles(orgId: string): SharedInsightBundle[] {
    return this._bundles.get(orgId) ?? [];
  }

  aggregate(category: IntelligenceCategory): IntelligenceAggregationResult {
    const records = this._records.filter((r) => r.category === category);
    const orgIds = new Set(records.map((r) => r.sourceOrgId));
    const avgWeight =
      records.length > 0
        ? records.reduce((s, r) => s + r.weight, 0) / records.length
        : 0;
    const topSignal = records.length > 0 ? records[0].signal : `No ${category} signals yet`;

    return {
      collectionId: 'federation-wide',
      category,
      aggregatedSignal: topSignal,
      contributingOrgs: orgIds.size,
      avgWeight,
      generatedAt: new Date().toISOString(),
    };
  }

  _reset(): void {
    this._records.length = 0;
    this._bundles.clear();
  }
}

export const globalCrossOrgIntelligenceHub = new CrossOrgIntelligenceHub();
