// src/api-runtime/environment-isolation/env-isolation.contracts.ts
// Phase D Step 12 — Environment isolation lock contracts.
// Prevents concurrent run collisions per environment.
// All types are JSON-serialisable (IPC-ready).

export type EnvironmentLockMode = 'exclusive' | 'shared';

export interface EnvironmentLock {
  readonly lockId: string;
  readonly environmentId: string;
  readonly runId: string;
  readonly workerId: string;
  readonly mode: EnvironmentLockMode;
  readonly acquiredAt: string;  // ISO-8601
}

export interface EnvironmentIsolationPolicy {
  readonly defaultMode: EnvironmentLockMode;
  readonly allowSharedForEnvironmentIds: readonly string[];
}

export interface LockAcquisitionResult {
  readonly success: boolean;
  readonly lock?: EnvironmentLock;
  readonly reason?: string;
}

export interface IEnvironmentLockRegistry {
  acquire(environmentId: string, runId: string, workerId: string, mode: EnvironmentLockMode): LockAcquisitionResult;
  release(environmentId: string, runId: string): boolean;
  getLocksForEnvironment(environmentId: string): EnvironmentLock[];
  listAllLocks(): EnvironmentLock[];
}
