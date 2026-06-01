// src/api-runtime/environment-isolation/__tests__/env-lock-registry.test.ts
// Phase D Step 12 — Environment lock registry tests.
// 8 tests covering acquire, release, and retrieval semantics.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEnvironmentLockRegistry } from '../in-memory-env-lock-registry';

describe('InMemoryEnvironmentLockRegistry', () => {
  let registry: InMemoryEnvironmentLockRegistry;

  beforeEach(() => {
    registry = new InMemoryEnvironmentLockRegistry();
  });

  describe('acquire', () => {
    // Test 1: acquire exclusive — succeeds when environment is free
    it('should acquire exclusive lock when environment is free', () => {
      const result = registry.acquire('env-prod', 'run-123', 'worker-1', 'exclusive');

      expect(result.success).toBe(true);
      expect(result.lock).toBeDefined();
      expect(result.lock?.lockId).toBeDefined();
      expect(result.lock?.environmentId).toBe('env-prod');
      expect(result.lock?.runId).toBe('run-123');
      expect(result.lock?.workerId).toBe('worker-1');
      expect(result.lock?.mode).toBe('exclusive');
      expect(result.lock?.acquiredAt).toBeDefined();
      expect(result.reason).toBeUndefined();
    });

    // Test 2: acquire exclusive — fails when environment already locked
    it('should fail to acquire exclusive lock when environment is already locked', () => {
      registry.acquire('env-prod', 'run-123', 'worker-1', 'exclusive');

      const result = registry.acquire('env-prod', 'run-456', 'worker-2', 'exclusive');

      expect(result.success).toBe(false);
      expect(result.lock).toBeUndefined();
      expect(result.reason).toContain('already locked');
    });

    // Test 3: acquire shared — succeeds when no exclusive lock exists
    it('should acquire shared lock when environment is free', () => {
      const result = registry.acquire('env-staging', 'run-123', 'worker-1', 'shared');

      expect(result.success).toBe(true);
      expect(result.lock).toBeDefined();
      expect(result.lock?.mode).toBe('shared');
    });

    // Test 4: acquire shared — multiple shared locks on same environment succeed
    it('should allow multiple shared locks on the same environment', () => {
      const result1 = registry.acquire('env-staging', 'run-123', 'worker-1', 'shared');
      const result2 = registry.acquire('env-staging', 'run-456', 'worker-2', 'shared');
      const result3 = registry.acquire('env-staging', 'run-789', 'worker-3', 'shared');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      const locks = registry.getLocksForEnvironment('env-staging');
      expect(locks).toHaveLength(3);
    });

    // Test 5: acquire shared — fails when exclusive lock exists
    it('should fail to acquire shared lock when exclusive lock exists', () => {
      registry.acquire('env-prod', 'run-123', 'worker-1', 'exclusive');

      const result = registry.acquire('env-prod', 'run-456', 'worker-2', 'shared');

      expect(result.success).toBe(false);
      expect(result.lock).toBeUndefined();
      expect(result.reason).toContain('exclusive lock');
    });
  });

  describe('release', () => {
    // Test 6: release — removes lock, returns true; subsequent acquire succeeds
    it('should release lock and allow subsequent acquire to succeed', () => {
      registry.acquire('env-prod', 'run-123', 'worker-1', 'exclusive');

      const releaseResult = registry.release('env-prod', 'run-123');
      expect(releaseResult).toBe(true);

      const reacquireResult = registry.acquire('env-prod', 'run-456', 'worker-2', 'exclusive');
      expect(reacquireResult.success).toBe(true);
    });

    // Test 7: release — returns false for unknown environmentId/runId pair
    it('should return false when releasing a non-existent lock', () => {
      const result = registry.release('env-unknown', 'run-unknown');

      expect(result).toBe(false);
    });
  });

  describe('getLocksForEnvironment', () => {
    // Test 8: getLocksForEnvironment — returns only locks for the specified environment
    it('should return only locks for the specified environment', () => {
      registry.acquire('env-prod', 'run-123', 'worker-1', 'exclusive');
      registry.acquire('env-staging', 'run-456', 'worker-2', 'shared');
      registry.acquire('env-staging', 'run-789', 'worker-3', 'shared');

      const prodLocks = registry.getLocksForEnvironment('env-prod');
      const stagingLocks = registry.getLocksForEnvironment('env-staging');

      expect(prodLocks).toHaveLength(1);
      expect(prodLocks[0].environmentId).toBe('env-prod');
      expect(stagingLocks).toHaveLength(2);
      expect(stagingLocks.every(l => l.environmentId === 'env-staging')).toBe(true);
    });
  });

  describe('listAllLocks', () => {
    it('should return all locks across all environments', () => {
      registry.acquire('env-prod', 'run-123', 'worker-1', 'exclusive');
      registry.acquire('env-staging', 'run-456', 'worker-2', 'shared');
      registry.acquire('env-dev', 'run-789', 'worker-3', 'shared');

      const allLocks = registry.listAllLocks();

      expect(allLocks).toHaveLength(3);
    });
  });
});
