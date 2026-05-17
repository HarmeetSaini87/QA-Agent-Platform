import { describe, it, expect } from 'vitest';
import { computeReport } from '../flakiness-service';
import type { ApiCollectionRunResult, ApiStepResult } from '../../data/types';

function makeStep(id: string, status: ApiStepResult['status'], httpStatus = 200): ApiStepResult {
  return {
    stepId: id, stepName: `Step ${id}`, status,
    request: { url: `https://api.example.com/${id}`, method: 'GET', headers: {}, body: undefined },
    response: { status: httpStatus, headers: {}, body: '' },
    assertionResults: [], extractedVariables: {}, durationMs: 100,
  };
}

function makeRun(id: string, steps: ApiStepResult[], startedAt: string): ApiCollectionRunResult {
  const allPassed = steps.every(s => s.status === 'passed');
  return {
    id, collectionId: 'col-test', startedAt, completedAt: startedAt,
    status: allPassed ? 'passed' : 'failed',
    stepResults: steps, variableContext: {},
  };
}

describe('computeReport', () => {
  it('returns empty report for no runs', () => {
    const report = computeReport('col-test', []);
    expect(report.collectionId).toBe('col-test');
    expect(report.stepRecords).toHaveLength(0);
    expect(report.clusters).toHaveLength(0);
    expect(report.runsAnalyzed).toBe(0);
    expect(report.stabilityScore).toBe(1);
  });

  it('detects flaky step with alternating results', () => {
    const statuses: ApiStepResult['status'][] = ['passed','failed','passed','failed','passed','failed'];
    const runs = statuses.map((s, i) =>
      makeRun(`r${i}`, [makeStep('step-A', s, s === 'failed' ? 503 : 200)], `2026-05-17T0${i}:00:00Z`));
    const report = computeReport('col-test', runs);
    const rec = report.stepRecords.find(r => r.stepId === 'step-A')!;
    expect(rec.isFlaky).toBe(true);
    expect(rec.dominantSignature?.category).toBe('http_status');
    expect(report.hotspots).toContain('step-A');
  });

  it('clusters steps by shared http_status', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(id, [makeStep('step-A', 'failed', 503), makeStep('step-B', 'failed', 503)], `2026-05-17T0${i}:00:00Z`));
    const report = computeReport('col-test', runs);
    const cluster = report.clusters.find(c => c.dimension === 'http_status' && c.dimensionKey === '503');
    expect(cluster).toBeDefined();
    expect(cluster!.stepIds).toContain('step-A');
    expect(cluster!.stepIds).toContain('step-B');
  });

  it('computes stabilityScore = 1 when all passed', () => {
    const runs = ['r1','r2'].map((id, i) =>
      makeRun(id, [makeStep('step-A', 'passed')], `2026-05-17T0${i}:00:00Z`));
    const report = computeReport('col-test', runs);
    expect(report.stabilityScore).toBeCloseTo(1);
  });

  it('stabilityScore < 1 when failures exist', () => {
    const runs = ['r1','r2','r3'].map((id, i) =>
      makeRun(id, [makeStep('step-A', i === 0 ? 'passed' : 'failed', 500)], `2026-05-17T0${i}:00:00Z`));
    const report = computeReport('col-test', runs);
    expect(report.stabilityScore).toBeLessThan(1);
  });
});
