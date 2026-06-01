// src/api-runtime/execution-leasing/__tests__/lease-registry.test.ts
// Phase D Step 12 — Execution lease registry tests.
// 8 test cases covering acquire, release, getActiveLease, evictExpired, and listActiveLeases.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryLeaseRegistry } from '../in-memory-lease-registry';

describe('InMemoryLeaseRegistry', () => {
  let registry: InMemoryLeaseRegistry;

  beforeEach(() => {
    registry = new InMemoryLeaseRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('acquire returns success with a lease', () => {
    const result = registry.acquire('run-1', 'worker-1', 5000);
    expect(result.success).toBe(true);
    expect(result.lease).toBeDefined();
    expect(result.lease!.leaseId).toBeTruthy();
    expect(result.lease!.runId).toBe('run-1');
    expect(result.lease!.workerId).toBe('worker-1');
    expect(result.lease!.ttlMs).toBe(5000);
    expect(result.lease!.status).toBe('active');
  });

  test('acquire fails when run already has an active lease', () => {
    const result1 = registry.acquire('run-1', 'worker-1', 5000);
    expect(result1.success).toBe(true);

    const result2 = registry.acquire('run-1', 'worker-2', 5000);
    expect(result2.success).toBe(false);
    expect(result2.reason).toContain('already leased');
    expect(result2.lease).toBeUndefined();
  });

  test('acquire allows re-lease after release', () => {
    const result1 = registry.acquire('run-1', 'worker-1', 5000);
    expect(result1.success).toBe(true);

    const released = registry.release('run-1', 'worker-1');
    expect(released).toBe(true);

    const result2 = registry.acquire('run-1', 'worker-2', 5000);
    expect(result2.success).toBe(true);
    expect(result2.lease!.workerId).toBe('worker-2');
  });

  test('release returns false for wrong workerId', () => {
    registry.acquire('run-1', 'worker-1', 5000);
    const released = registry.release('run-1', 'worker-2');
    expect(released).toBe(false);
  });

  test('getActiveLease returns null for unknown runId', () => {
    const lease = registry.getActiveLease('run-unknown');
    expect(lease).toBeNull();
  });

  test('getActiveLease returns null for released lease', () => {
    registry.acquire('run-1', 'worker-1', 5000);
    registry.release('run-1', 'worker-1');
    const lease = registry.getActiveLease('run-1');
    expect(lease).toBeNull();
  });

  test('evictExpired marks expired leases and returns count', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    registry.acquire('run-1', 'worker-1', 1000);
    registry.acquire('run-2', 'worker-2', 10000);

    // advance time by 2 seconds; run-1 should expire (1 second TTL)
    vi.setSystemTime(now + 2000);

    const count = registry.evictExpired();
    expect(count).toBe(1);

    // run-1 should now be expired
    const lease1 = registry.getActiveLease('run-1');
    expect(lease1).toBeNull();

    // run-2 should still be active
    const lease2 = registry.getActiveLease('run-2');
    expect(lease2).not.toBeNull();
    expect(lease2!.status).toBe('active');
  });

  test('listActiveLeases excludes expired/released leases', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    registry.acquire('run-1', 'worker-1', 1000);
    registry.acquire('run-2', 'worker-2', 10000);
    registry.acquire('run-3', 'worker-3', 500);

    // Release run-2
    registry.release('run-2', 'worker-2');

    // Advance time to expire run-1 and run-3
    vi.setSystemTime(now + 2000);

    const active = registry.listActiveLeases();
    expect(active.length).toBe(0);
  });
});
