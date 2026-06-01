// src/api-orchestration/__tests__/lease-renewer.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryLeaseRenewer } from '../lease-renewer';
import { InMemoryLeaseRegistry } from '../../api-runtime/execution-leasing/in-memory-lease-registry';

describe('InMemoryLeaseRenewer', () => {
  let registry: InMemoryLeaseRegistry;
  let renewer: InMemoryLeaseRenewer;

  beforeEach(() => {
    registry = new InMemoryLeaseRegistry();
    renewer = new InMemoryLeaseRenewer(registry);
  });

  it('renew: not-found when no active lease', () => {
    const result = renewer.renew({ runId: 'r1', workerId: 'w1', extensionMs: 1000 });
    expect(result.outcome).toBe('not-found');
  });

  it('renew: worker-mismatch for wrong worker', () => {
    registry.acquire('r1', 'w1', 30_000);
    const result = renewer.renew({ runId: 'r1', workerId: 'w2', extensionMs: 1000 });
    expect(result.outcome).toBe('worker-mismatch');
  });

  it('renew: renewed with new expiry', () => {
    registry.acquire('r1', 'w1', 30_000);
    const result = renewer.renew({ runId: 'r1', workerId: 'w1', extensionMs: 10_000 });
    expect(result.outcome).toBe('renewed');
    expect(result.newExpiresAt).toBeTruthy();
  });

  it('forceRelease: returns null for non-existent run', () => {
    expect(renewer.forceRelease('no-run', 'test')).toBeNull();
  });

  it('forceRelease: returns recovery record with advisoryNote', () => {
    registry.acquire('r1', 'w1', 300_000);
    const rec = renewer.forceRelease('r1', 'manual test');
    expect(rec).not.toBeNull();
    expect(rec!.runId).toBe('r1');
    expect(rec!.advisoryNote).toContain('advisory');
  });

  it('detectStuck: finds leases beyond threshold', async () => {
    registry.acquire('r1', 'w1', 300_000);
    await new Promise(r => setTimeout(r, 10));
    const stuck = renewer.detectStuck(5); // 5ms threshold — already stuck
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck[0].runId).toBe('r1');
  });
});
