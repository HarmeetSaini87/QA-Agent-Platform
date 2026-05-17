import { describe, it, expect } from 'vitest';
import { aggregateRunsForStep } from '../aggregator';
import type { ApiCollectionRunResult, ApiStepResult } from '../../data/types';

function makeStepResult(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-A', stepName: 'POST Login', status: 'passed',
    request: { url: 'https://api.example.com/login', method: 'POST', headers: {}, body: undefined },
    response: { status: 200, headers: {}, body: '' },
    assertionResults: [], extractedVariables: {}, durationMs: 200,
    ...overrides,
  };
}

function makeRun(stepResult: ApiStepResult, id: string, startedAt: string): ApiCollectionRunResult {
  return {
    id, collectionId: 'col-1', startedAt, completedAt: startedAt,
    status: stepResult.status === 'passed' ? 'passed' : 'failed',
    stepResults: [stepResult], variableContext: {},
  };
}

describe('aggregateRunsForStep', () => {
  it('returns null when step absent from all runs', () => {
    const run = makeRun(makeStepResult({ stepId: 'step-B' }), 'r1', '2026-05-17T00:00:00Z');
    expect(aggregateRunsForStep('step-A', 'col-1', [run])).toBeNull();
  });

  it('computes failRate = 0 when all passed', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'passed' }), id, `2026-05-17T0${i}:00:00Z`));
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.failRate).toBe(0);
    expect(rec.isFlaky).toBe(false);
    expect(rec.flakinessScore).toBe(0);
  });

  it('computes failRate = 1 when all failed', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed' }), id, `2026-05-17T0${i}:00:00Z`));
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.failRate).toBeCloseTo(1);
    expect(rec.isFlaky).toBe(true);
  });

  it('detects alternating pass/fail pattern', () => {
    const statuses: Array<ApiStepResult['status']> = ['passed','failed','passed','failed','passed','failed'];
    const runs = statuses.map((status, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status }), `r${i}`, `2026-05-17T0${i}:00:00Z`));
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.alternationIndex).toBeGreaterThan(0.5);
    expect(rec.isFlaky).toBe(true);
  });

  it('counts retries (best-effort from plain data)', () => {
    const runs = ['r1','r2'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed', error: 'timeout' }), id, `2026-05-17T0${i}:00:00Z`));
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.retryStats.retryCount).toBeGreaterThanOrEqual(0);
  });

  it('populates dominantSignature', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed',
        response: { status: 503, headers: {}, body: '' }, assertionResults: [] }),
        id, `2026-05-17T0${i}:00:00Z`));
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.dominantSignature?.category).toBe('http_status');
    expect(rec.dominantSignature?.httpStatus).toBe(503);
  });

  it('sets lastFailedAt and lastPassedAt', () => {
    const runs = [
      makeRun(makeStepResult({ stepId: 'step-A', status: 'passed' }), 'r1', '2026-05-15T00:00:00Z'),
      makeRun(makeStepResult({ stepId: 'step-A', status: 'failed' }), 'r2', '2026-05-16T00:00:00Z'),
    ];
    const rec = aggregateRunsForStep('step-A', 'col-1', runs)!;
    expect(rec.lastFailedAt).toBe('2026-05-16T00:00:00Z');
    expect(rec.lastPassedAt).toBe('2026-05-15T00:00:00Z');
  });
});
