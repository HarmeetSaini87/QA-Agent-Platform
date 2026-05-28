// src/api-cloud/__tests__/cloud-worker-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CloudWorkerRegistry } from '../cloud-worker-registry';
import type { CloudWorkerSpec } from '../contracts/cloud-worker.contracts';

function makeSpec(id: string, status: CloudWorkerSpec['status'] = 'running'): CloudWorkerSpec {
  return { workerId: id, provider: 'local', status, startedAt: new Date().toISOString() };
}

describe('CloudWorkerRegistry', () => {
  let registry: CloudWorkerRegistry;
  beforeEach(() => { registry = new CloudWorkerRegistry(); });

  it('register + get roundtrip', () => {
    registry.register(makeSpec('w1'));
    expect(registry.get('w1')?.workerId).toBe('w1');
  });

  it('get: returns null for unknown worker', () => {
    expect(registry.get('ghost')).toBeNull();
  });

  it('update: patches status', () => {
    registry.register(makeSpec('w1', 'idle'));
    registry.update('w1', { status: 'running' });
    expect(registry.get('w1')?.status).toBe('running');
  });

  it('update: returns false for unknown worker', () => {
    expect(registry.update('ghost', { status: 'running' })).toBe(false);
  });

  it('listActive: excludes terminated workers', () => {
    registry.register(makeSpec('w1', 'running'));
    registry.register(makeSpec('w2', 'terminated'));
    const active = registry.listActive();
    expect(active.map(w => w.workerId)).toContain('w1');
    expect(active.map(w => w.workerId)).not.toContain('w2');
  });

  it('terminate: sets status to terminated and returns lifecycle event', () => {
    registry.register(makeSpec('w1'));
    const event = registry.terminate('w1', 'test-reason');
    expect(event.event).toBe('terminated');
    expect(event.workerId).toBe('w1');
    expect(registry.get('w1')?.status).toBe('terminated');
  });

  it('snapshot: counts by status', () => {
    registry.register(makeSpec('w1', 'running'));
    registry.register(makeSpec('w2', 'idle'));
    registry.register(makeSpec('w3', 'terminated'));
    const snap = registry.snapshot();
    expect(snap.running).toBe(1);
    expect(snap.idle).toBe(1);
    expect(snap.terminated).toBe(1);
    expect(snap.total).toBe(3);
  });
});
