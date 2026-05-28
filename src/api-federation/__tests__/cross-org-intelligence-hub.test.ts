import { describe, it, expect, beforeEach } from 'vitest';
import { CrossOrgIntelligenceHub } from '../cross-org-intelligence-hub';
import { AnonymizedIntelligenceRecord } from '../contracts/cross-org-intelligence.contracts';

function makeRecord(overrides: Partial<AnonymizedIntelligenceRecord> = {}): AnonymizedIntelligenceRecord {
  return {
    recordId: 'r1',
    category: 'flakiness-pattern',
    sourceOrgId: 'org1',
    signal: 'High flakiness in auth steps',
    weight: 0.8,
    sampleSize: 50,
    isAnonymized: true,
    sharedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CrossOrgIntelligenceHub', () => {
  let hub: CrossOrgIntelligenceHub;

  beforeEach(() => {
    hub = new CrossOrgIntelligenceHub();
    hub._reset();
  });

  it('publishRecord and listRecords', () => {
    hub.publishRecord(makeRecord());
    expect(hub.listRecords()).toHaveLength(1);
  });

  it('listRecords filters by category', () => {
    hub.publishRecord(makeRecord({ category: 'flakiness-pattern' }));
    hub.publishRecord(makeRecord({ recordId: 'r2', category: 'retry-anti-pattern' }));
    expect(hub.listRecords('flakiness-pattern')).toHaveLength(1);
  });

  it('createBundle includes anonymized records of matching category', () => {
    hub.publishRecord(makeRecord());
    const bundle = hub.createBundle('org1', 'org2', 'flakiness-pattern');
    expect(bundle.records).toHaveLength(1);
    expect(bundle.fromOrgId).toBe('org1');
    expect(bundle.toOrgId).toBe('org2');
  });

  it('createBundle only includes isAnonymized records', () => {
    hub.publishRecord(makeRecord({ isAnonymized: false }));
    const bundle = hub.createBundle('org1', 'org2', 'flakiness-pattern');
    expect(bundle.records).toHaveLength(0);
  });

  it('createBundle has governance note', () => {
    const bundle = hub.createBundle('org1', 'org2', 'flakiness-pattern');
    expect(bundle.governanceNote).toBeTruthy();
  });

  it('listBundles returns bundles for target org', () => {
    hub.publishRecord(makeRecord());
    hub.createBundle('org1', 'org2', 'flakiness-pattern');
    expect(hub.listBundles('org2')).toHaveLength(1);
    expect(hub.listBundles('org1')).toHaveLength(0);
  });

  it('aggregate returns contributingOrgs count', () => {
    hub.publishRecord(makeRecord({ sourceOrgId: 'org1' }));
    hub.publishRecord(makeRecord({ recordId: 'r2', sourceOrgId: 'org2' }));
    const agg = hub.aggregate('flakiness-pattern');
    expect(agg.contributingOrgs).toBe(2);
  });

  it('aggregate avgWeight is 0–1', () => {
    hub.publishRecord(makeRecord({ weight: 0.6 }));
    hub.publishRecord(makeRecord({ recordId: 'r2', weight: 0.8 }));
    const agg = hub.aggregate('flakiness-pattern');
    expect(agg.avgWeight).toBeGreaterThan(0);
    expect(agg.avgWeight).toBeLessThanOrEqual(1);
  });

  it('aggregate on empty returns 0 contributingOrgs', () => {
    const agg = hub.aggregate('rca-knowledge');
    expect(agg.contributingOrgs).toBe(0);
  });
});
