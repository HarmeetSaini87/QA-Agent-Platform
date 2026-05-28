// src/api-security/__tests__/worker-security-boundary.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkerSecurityBoundary } from '../worker-security-boundary';

describe('WorkerSecurityBoundary', () => {
  let boundary: WorkerSecurityBoundary;
  beforeEach(() => { boundary = new WorkerSecurityBoundary(); });

  it('snapshot: unknown worker has no active runs', () => {
    const snap = boundary.snapshot('w1');
    expect(snap.activeRunIds).toHaveLength(0);
    expect(snap.pendingCleanups).toBe(0);
    expect(snap.lastCleanupAt).toBeNull();
  });

  it('markSecretsActive + snapshot: tracks active run', () => {
    boundary.markSecretsActive('w1', 'run-1');
    const snap = boundary.snapshot('w1');
    expect(snap.activeRunIds).toContain('run-1');
    expect(snap.pendingCleanups).toBe(1);
  });

  it('clearSecrets: removes run and returns record', () => {
    boundary.markSecretsActive('w1', 'run-1');
    const record = boundary.clearSecrets('w1', 'run-1');
    expect(record.runId).toBe('run-1');
    expect(record.workerId).toBe('w1');
    expect(record.advisoryNote).toContain('teardown completed');
    expect(boundary.snapshot('w1').activeRunIds).not.toContain('run-1');
  });

  it('clearSecrets: advisory note if run was not active', () => {
    const record = boundary.clearSecrets('w1', 'ghost-run');
    expect(record.advisoryNote).toContain('not active');
  });

  it('forceCleanup: clears all active runs', () => {
    boundary.markSecretsActive('w2', 'run-a');
    boundary.markSecretsActive('w2', 'run-b');
    const records = boundary.forceCleanup('w2');
    expect(records).toHaveLength(2);
    expect(boundary.snapshot('w2').pendingCleanups).toBe(0);
    records.forEach(r => expect(r.advisoryNote).toContain('forced cleanup'));
  });

  it('forceCleanup: returns empty for idle worker', () => {
    expect(boundary.forceCleanup('idle-worker')).toHaveLength(0);
  });
});
