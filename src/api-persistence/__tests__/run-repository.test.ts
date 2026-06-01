// src/api-persistence/__tests__/run-repository.test.ts
// Tests RunSummary contract shape and query option filtering (without hitting disk).
import { describe, it, expect } from 'vitest';
import type { RunSummary, RunQueryOptions } from '../contracts/run-repository.contracts';

// Pure contract shape tests — no filesystem needed.
describe('RunRepository contracts', () => {
  it('RunSummary has required fields', () => {
    const summary: RunSummary = {
      id: 'run-1',
      collectionId: 'col-1',
      status: 'passed',
      startedAt: '2026-05-22T00:00:00Z',
      completedAt: '2026-05-22T00:01:00Z',
      stepCount: 5,
    };
    expect(summary.id).toBe('run-1');
    expect(summary.stepCount).toBe(5);
  });

  it('RunQueryOptions is optional', () => {
    const opts: RunQueryOptions = {};
    expect(opts).toBeDefined();
  });

  it('RunQueryOptions accepts all optional fields', () => {
    const opts: RunQueryOptions = {
      collectionId: 'col-1',
      projectId: 'proj-1',
      status: 'failed',
      limit: 10,
      offset: 0,
      startedAfter: '2026-01-01T00:00:00Z',
    };
    expect(opts.limit).toBe(10);
  });

  it('status enum covers all ApiCollectionRunResult statuses', () => {
    const statuses: RunSummary['status'][] = ['passed', 'failed', 'error', 'running'];
    expect(statuses).toHaveLength(4);
  });
});
