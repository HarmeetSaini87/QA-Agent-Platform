// src/api-runtime/environment-isolation/in-memory-env-lock-registry.ts
// Phase D Step 12 — In-memory environment lock registry.
// Singleton via getEnvLockRegistrySingleton(). Reset via _resetEnvLockRegistrySingleton() for tests.

import { randomUUID } from 'crypto';
import type { EnvironmentLock, EnvironmentLockMode, IEnvironmentLockRegistry, LockAcquisitionResult } from './env-isolation.contracts';

export class InMemoryEnvironmentLockRegistry implements IEnvironmentLockRegistry {
  // key: `${environmentId}::${runId}`
  private readonly _locks = new Map<string, EnvironmentLock>();

  acquire(environmentId: string, runId: string, workerId: string, mode: EnvironmentLockMode): LockAcquisitionResult {
    const existing = this.getLocksForEnvironment(environmentId);

    if (mode === 'exclusive') {
      if (existing.length > 0) {
        return { success: false, reason: `Environment ${environmentId} is already locked` };
      }
    } else {
      // shared: blocked only if an exclusive lock exists
      const exclusiveLock = existing.find(l => l.mode === 'exclusive');
      if (exclusiveLock) {
        return { success: false, reason: `Environment ${environmentId} has an exclusive lock held by run ${exclusiveLock.runId}` };
      }
    }

    const lock: EnvironmentLock = {
      lockId: randomUUID(),
      environmentId,
      runId,
      workerId,
      mode,
      acquiredAt: new Date().toISOString(),
    };
    this._locks.set(`${environmentId}::${runId}`, lock);
    return { success: true, lock };
  }

  release(environmentId: string, runId: string): boolean {
    return this._locks.delete(`${environmentId}::${runId}`);
  }

  getLocksForEnvironment(environmentId: string): EnvironmentLock[] {
    return [...this._locks.values()].filter(l => l.environmentId === environmentId);
  }

  listAllLocks(): EnvironmentLock[] {
    return [...this._locks.values()];
  }
}

let _singleton: InMemoryEnvironmentLockRegistry | null = null;

export function getEnvLockRegistrySingleton(): InMemoryEnvironmentLockRegistry {
  if (!_singleton) _singleton = new InMemoryEnvironmentLockRegistry();
  return _singleton;
}

export function _resetEnvLockRegistrySingleton(): void {
  _singleton = null;
}
