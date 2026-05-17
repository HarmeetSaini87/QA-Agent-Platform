import { describe, it, expect } from 'vitest';
import { clusterFailures } from '../cluster-engine';
import type { StepFlakinessRecord } from '../contracts/flakiness.contracts';

function makeRecord(overrides: Partial<StepFlakinessRecord> = {}): StepFlakinessRecord {
  return {
    stepId: 'step-1', stepName: 'GET Users', collectionId: 'col-1',
    totalRuns: 10, failedRuns: 5, passedRuns: 5, skippedRuns: 0,
    failRate: 0.5, alternationIndex: 0.5, flakinessScore: 0.5,
    isFlaky: true, flakinessThreshold: 0.2,
    retryStats: { retryCount: 3, maxRetryAttempt: 2, avgAttemptDurationMs: 300, recoveredAfterRetry: false },
    signatures: [], computedAt: '2026-05-17T00:00:00Z',
    ...overrides,
  };
}

describe('clusterFailures', () => {
  it('returns empty array for empty input', () => {
    expect(clusterFailures([])).toEqual([]);
  });

  it('clusters by http_status', () => {
    const records = [
      makeRecord({ stepId: 's1', stepName: 'GET /a', dominantSignature: { signatureKey: 'http_status:503', category: 'http_status', httpStatus: 503 } }),
      makeRecord({ stepId: 's2', stepName: 'GET /b', dominantSignature: { signatureKey: 'http_status:503', category: 'http_status', httpStatus: 503 } }),
    ];
    const clusters = clusterFailures(records);
    const httpCluster = clusters.find(c => c.dimension === 'http_status');
    expect(httpCluster).toBeDefined();
    expect(httpCluster!.stepIds).toContain('s1');
    expect(httpCluster!.stepIds).toContain('s2');
    expect(httpCluster!.dimensionKey).toBe('503');
  });

  it('clusters by assertion_type', () => {
    const records = [
      makeRecord({ stepId: 's1', dominantSignature: { signatureKey: 'assertion:body.id:eq', category: 'assertion', assertionField: 'body.id', assertionOperator: 'eq' } }),
      makeRecord({ stepId: 's2', dominantSignature: { signatureKey: 'assertion:body.id:eq', category: 'assertion', assertionField: 'body.id', assertionOperator: 'eq' } }),
    ];
    const clusters = clusterFailures(records);
    const ac = clusters.find(c => c.dimension === 'assertion_type');
    expect(ac).toBeDefined();
    expect(ac!.dimensionKey).toBe('body.id eq');
    expect(ac!.stepIds).toHaveLength(2);
  });

  it('clusters by transport_error', () => {
    const records = [
      makeRecord({ stepId: 's1', dominantSignature: { signatureKey: 'network:ECONNREFUSED', category: 'network', transportError: 'ECONNREFUSED' } }),
      makeRecord({ stepId: 's2', dominantSignature: { signatureKey: 'network:ECONNREFUSED', category: 'network', transportError: 'ECONNREFUSED' } }),
    ];
    const clusters = clusterFailures(records);
    const nc = clusters.find(c => c.dimension === 'transport_error');
    expect(nc).toBeDefined();
    expect(nc!.dimensionKey).toBe('ECONNREFUSED');
  });

  it('does not cluster records with no dominant signature', () => {
    const records = [makeRecord({ dominantSignature: undefined })];
    expect(clusterFailures(records)).toHaveLength(0);
  });

  it('computes avgFlakinessScore per cluster', () => {
    const records = [
      makeRecord({ stepId: 's1', flakinessScore: 0.8, dominantSignature: { signatureKey: 'http_status:500', category: 'http_status', httpStatus: 500 } }),
      makeRecord({ stepId: 's2', flakinessScore: 0.4, dominantSignature: { signatureKey: 'http_status:500', category: 'http_status', httpStatus: 500 } }),
    ];
    const clusters = clusterFailures(records);
    const c = clusters.find(c => c.dimension === 'http_status')!;
    expect(c.avgFlakinessScore).toBeCloseTo(0.6);
  });
});
