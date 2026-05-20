// src/api-runtime/execution-leasing/in-memory-lease-registry.ts
// Phase D Step 12 — In-memory lease registry.
// Singleton via getLeaseRegistrySingleton(). Reset via _resetLeaseRegistrySingleton() for tests.

import { randomUUID } from 'crypto';
import type { ExecutionLease, ILeaseRegistry, LeaseAcquisitionResult } from './lease.contracts';

export class InMemoryLeaseRegistry implements ILeaseRegistry {
  private readonly _leases = new Map<string, ExecutionLease>();

  acquire(runId: string, workerId: string, ttlMs: number): LeaseAcquisitionResult {
    // evict expired first
    this.evictExpired();
    const existing = this._leases.get(runId);
    if (existing && existing.status === 'active') {
      return { success: false, reason: `Run ${runId} already leased by worker ${existing.workerId}` };
    }
    const now = Date.now();
    const lease: ExecutionLease = {
      leaseId: randomUUID(),
      runId,
      workerId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      ttlMs,
      status: 'active',
    };
    this._leases.set(runId, lease);
    return { success: true, lease };
  }

  release(runId: string, workerId: string): boolean {
    const lease = this._leases.get(runId);
    if (!lease || lease.workerId !== workerId) return false;
    this._leases.set(runId, { ...lease, status: 'released' });
    return true;
  }

  getActiveLease(runId: string): ExecutionLease | null {
    this.evictExpired();
    const lease = this._leases.get(runId);
    return lease?.status === 'active' ? lease : null;
  }

  listActiveLeases(): ExecutionLease[] {
    this.evictExpired();
    return [...this._leases.values()].filter(l => l.status === 'active');
  }

  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [runId, lease] of this._leases) {
      if (lease.status === 'active' && new Date(lease.expiresAt).getTime() <= now) {
        this._leases.set(runId, { ...lease, status: 'expired' });
        count++;
      }
    }
    return count;
  }
}

let _singleton: InMemoryLeaseRegistry | null = null;

export function getLeaseRegistrySingleton(): InMemoryLeaseRegistry {
  if (!_singleton) _singleton = new InMemoryLeaseRegistry();
  return _singleton;
}

export function _resetLeaseRegistrySingleton(): void {
  _singleton = null;
}
