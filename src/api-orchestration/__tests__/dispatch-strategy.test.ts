// src/api-orchestration/__tests__/dispatch-strategy.test.ts
import { describe, it, expect } from 'vitest';
import { LocalDispatchStrategy, AffinityDispatchStrategy } from '../local-dispatch-strategy';

const req = { collectionId: 'col-1', runId: 'run-1', priority: 5, payload: {} };

describe('LocalDispatchStrategy', () => {
  const strategy = new LocalDispatchStrategy('worker-local');

  it('always dispatches to local target', () => {
    const decision = strategy.decide(req);
    expect(decision.target).toBe('local');
    expect(decision.workerId).toBe('worker-local');
  });

  it('includes reason in decision', () => {
    const decision = strategy.decide(req);
    expect(decision.reason).toBeTruthy();
    expect(decision.decidedAt).toBeTruthy();
  });

  it('tenant routing falls back to local with note', () => {
    const decision = strategy.decide(req, { tenantId: 'tenant-acme' });
    expect(decision.target).toBe('local');
    expect(decision.reason).toContain('tenant-acme');
  });
});

describe('AffinityDispatchStrategy', () => {
  const local = new LocalDispatchStrategy('worker-local');
  const affinity = new AffinityDispatchStrategy('worker-local', local);

  it('falls through to local (stub behaviour)', () => {
    const decision = affinity.decide(req, { preferEnvironmentId: 'env-prod' });
    expect(decision.target).toBe('local');
  });
});
