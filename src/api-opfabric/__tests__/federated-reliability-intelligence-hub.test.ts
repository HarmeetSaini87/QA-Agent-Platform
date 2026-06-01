import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedReliabilityIntelligenceHub } from '../federated-reliability-intelligence-hub';
import type { FederatedReliabilityIntelligenceRecord } from '../contracts/federated-reliability-intelligence.contracts';
import type { OrchestrationAntiPatternFederationMemory } from '../contracts/federated-reliability-intelligence.contracts';

function makeRecord(overrides: Partial<FederatedReliabilityIntelligenceRecord> = {}): FederatedReliabilityIntelligenceRecord {
  return {
    recordId: 'r1', orgId: 'org1',
    category: 'retry-anti-pattern',
    intelligenceSignal: 'Retry cascade detected',
    confidence: 75,
    crossOrgWeight: 0.8,
    isAnonymized: true,
    isExplainable: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAntiPattern(overrides: Partial<OrchestrationAntiPatternFederationMemory> = {}): OrchestrationAntiPatternFederationMemory {
  return {
    patternId: 'p1', patternKey: 'cascade-retry',
    orchestrationSignal: 'Step cascade on retry',
    reasoningChain: ['Step A fails', 'Step B depends on A'],
    crossOrgFrequency: 7,
    severity: 'high',
    knownEffectiveRemedies: ['circuit-breaker'],
    confidenceScore: 82,
    isAnonymized: true,
    firstObservedAt: new Date().toISOString(),
    lastObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedReliabilityIntelligenceHub', () => {
  let hub: FederatedReliabilityIntelligenceHub;

  beforeEach(() => {
    hub = new FederatedReliabilityIntelligenceHub();
    hub._reset();
  });

  it('publishRecord stores anonymized records', () => {
    hub.publishRecord(makeRecord());
    const idx = hub.buildIndex('org1');
    expect(idx.totalRecords).toBe(1);
  });

  it('publishRecord rejects non-anonymized records', () => {
    hub.publishRecord({ ...makeRecord(), isAnonymized: false as unknown as true });
    expect(hub.buildIndex('org1').totalRecords).toBe(0);
  });

  it('buildIndex avgConfidence is correct', () => {
    hub.publishRecord(makeRecord({ confidence: 60 }));
    hub.publishRecord(makeRecord({ recordId: 'r2', confidence: 80 }));
    expect(hub.buildIndex('org1').avgConfidence).toBe(70);
  });

  it('buildIndex strongestSignal is max confidence record', () => {
    hub.publishRecord(makeRecord({ confidence: 60, intelligenceSignal: 'Weak' }));
    hub.publishRecord(makeRecord({ recordId: 'r2', confidence: 90, intelligenceSignal: 'Strong' }));
    expect(hub.buildIndex('org1').strongestSignal).toBe('Strong');
  });

  it('buildIndex strongestSignal is null for empty', () => {
    expect(hub.buildIndex('org1').strongestSignal).toBeNull();
  });

  it('buildIndex categoryBreakdown aggregates', () => {
    hub.publishRecord(makeRecord({ category: 'retry-anti-pattern' }));
    hub.publishRecord(makeRecord({ recordId: 'r2', category: 'retry-anti-pattern' }));
    hub.publishRecord(makeRecord({ recordId: 'r3', category: 'sla-resilience' }));
    const idx = hub.buildIndex('org1');
    expect(idx.categoryBreakdown['retry-anti-pattern']).toBe(2);
    expect(idx.categoryBreakdown['sla-resilience']).toBe(1);
  });

  it('bundleByCategory computes topSignals sorted by confidence', () => {
    hub.publishRecord(makeRecord({ confidence: 90, intelligenceSignal: 'Top' }));
    hub.publishRecord(makeRecord({ recordId: 'r2', confidence: 50, intelligenceSignal: 'Bottom' }));
    const bundle = hub.bundleByCategory('org1', 'retry-anti-pattern');
    expect(bundle.topSignals[0]).toBe('Top');
  });

  it('bundleByCategory has governanceNote', () => {
    const bundle = hub.bundleByCategory('org1', 'retry-anti-pattern');
    expect(bundle.governanceNote).toBeTruthy();
  });

  it('addAntiPattern and getAntiPattern', () => {
    hub.addAntiPattern(makeAntiPattern());
    expect(hub.getAntiPattern('cascade-retry')).not.toBeNull();
  });

  it('getAntiPattern returns null for unknown', () => {
    expect(hub.getAntiPattern('unknown')).toBeNull();
  });

  it('listAntiPatterns returns all', () => {
    hub.addAntiPattern(makeAntiPattern({ patternKey: 'p1' }));
    hub.addAntiPattern(makeAntiPattern({ patternKey: 'p2' }));
    expect(hub.listAntiPatterns()).toHaveLength(2);
  });
});
