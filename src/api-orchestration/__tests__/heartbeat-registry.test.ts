// src/api-orchestration/__tests__/heartbeat-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryHeartbeatRegistry } from '../heartbeat-registry';

describe('InMemoryHeartbeatRegistry', () => {
  let registry: InMemoryHeartbeatRegistry;
  beforeEach(() => { registry = new InMemoryHeartbeatRegistry(); });

  it('latest: returns null for unknown worker', () => {
    expect(registry.latest('w1')).toBeNull();
  });

  it('record + latest roundtrip', () => {
    registry.record({ workerId: 'w1', timestamp: new Date().toISOString(), activeRunCount: 2, status: 'running' });
    expect(registry.latest('w1')?.activeRunCount).toBe(2);
  });

  it('detectDead: includes worker with old heartbeat', async () => {
    registry.record({ workerId: 'w1', timestamp: new Date(Date.now() - 10_000).toISOString(), activeRunCount: 0, status: 'idle' });
    const dead = registry.detectDead(5_000); // 5s threshold
    expect(dead).toContain('w1');
  });

  it('detectDead: excludes live worker', () => {
    registry.record({ workerId: 'w2', timestamp: new Date().toISOString(), activeRunCount: 0, status: 'idle' });
    const dead = registry.detectDead(60_000);
    expect(dead).not.toContain('w2');
  });

  it('snapshot: counts live vs dead correctly', async () => {
    registry.record({ workerId: 'w-live', timestamp: new Date().toISOString(), activeRunCount: 0, status: 'idle' });
    registry.record({ workerId: 'w-dead', timestamp: new Date(Date.now() - 120_000).toISOString(), activeRunCount: 0, status: 'unhealthy' });
    const snap = registry.snapshot();
    expect(snap.totalWorkers).toBe(2);
    expect(snap.deadWorkers).toContain('w-dead');
    expect(snap.liveWorkers).toBe(1);
  });
});
