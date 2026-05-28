import { describe, it, expect, beforeEach } from 'vitest';
import { FederatedReplayIntelligenceEngine } from '../federated-replay-intelligence-engine';
import { AnonymizedReplayPattern } from '../contracts/federated-replay-intelligence.contracts';

function makePattern(overrides: Partial<AnonymizedReplayPattern> = {}): AnonymizedReplayPattern {
  return {
    patternId: 'pat1',
    sourceOrgId: 'org1',
    failureSignature: 'auth-timeout',
    retrySequenceHash: 'abc123',
    occurrenceCount: 5,
    avgRemediationEffectiveness: 0.7,
    contributingRunCount: 20,
    anonymizedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FederatedReplayIntelligenceEngine', () => {
  let engine: FederatedReplayIntelligenceEngine;

  beforeEach(() => {
    engine = new FederatedReplayIntelligenceEngine();
    engine._reset();
  });

  it('publishPattern and listPatterns', () => {
    engine.publishPattern(makePattern());
    expect(engine.listPatterns()).toHaveLength(1);
  });

  it('listPatterns filters by sourceOrgId', () => {
    engine.publishPattern(makePattern({ sourceOrgId: 'org1' }));
    engine.publishPattern(makePattern({ patternId: 'p2', sourceOrgId: 'org2' }));
    expect(engine.listPatterns('org1')).toHaveLength(1);
  });

  it('generateInsights returns empty when no patterns', () => {
    expect(engine.generateInsights()).toHaveLength(0);
  });

  it('generateInsights groups by failureSignature', () => {
    engine.publishPattern(makePattern({ patternId: 'p1', failureSignature: 'auth-timeout' }));
    engine.publishPattern(makePattern({ patternId: 'p2', failureSignature: 'auth-timeout', sourceOrgId: 'org2' }));
    engine.publishPattern(makePattern({ patternId: 'p3', failureSignature: 'db-timeout', sourceOrgId: 'org3' }));
    const insights = engine.generateInsights();
    expect(insights).toHaveLength(2);
  });

  it('insight confidence is 0–100', () => {
    engine.publishPattern(makePattern());
    const insights = engine.generateInsights();
    expect(insights[0].confidence).toBeGreaterThanOrEqual(0);
    expect(insights[0].confidence).toBeLessThanOrEqual(100);
  });

  it('insight has advisory note', () => {
    engine.publishPattern(makePattern());
    const insights = engine.generateInsights();
    expect(insights[0].advisoryNote).toBeTruthy();
  });

  it('detectFederatedAnomaly — no match returns isKnownPattern false', () => {
    const anomaly = engine.detectFederatedAnomaly('col1', 'unknown-error');
    expect(anomaly.isKnownPattern).toBe(false);
    expect(anomaly.crossOrgFrequency).toBe(0);
  });

  it('detectFederatedAnomaly — match returns isKnownPattern true', () => {
    engine.publishPattern(makePattern({ failureSignature: 'known-error', occurrenceCount: 10 }));
    const anomaly = engine.detectFederatedAnomaly('col1', 'known-error');
    expect(anomaly.isKnownPattern).toBe(true);
    expect(anomaly.crossOrgFrequency).toBe(10);
  });

  it('detectFederatedAnomaly has mitigation hint', () => {
    const anomaly = engine.detectFederatedAnomaly('col1', 'some-error');
    expect(anomaly.mitigationHint).toBeTruthy();
  });
});
