// src/api-orchestration/lease-renewer.ts
// Phase E Step 3: In-memory lease renewer + stuck-run recovery.
// Renewal extends TTL on active leases. Force-release is advisory — does NOT restart runs.

import type {
  ILeaseRenewer,
  LeaseRenewalRequest,
  LeaseRenewalResult,
  StuckRunRecoveryRecord,
} from './contracts/lease-renewal.contracts';
import type { ILeaseRegistry } from '../api-runtime/execution-leasing/lease.contracts';

const ADVISORY = 'Forced lease release is advisory. Platform does NOT automatically restart the run.';

export class InMemoryLeaseRenewer implements ILeaseRenewer {
  constructor(private readonly _registry: ILeaseRegistry) {}

  renew(request: LeaseRenewalRequest): LeaseRenewalResult {
    const lease = this._registry.getActiveLease(request.runId);

    if (!lease) {
      return { runId: request.runId, outcome: 'not-found' };
    }
    if (lease.workerId !== request.workerId) {
      return { runId: request.runId, outcome: 'worker-mismatch',
        reason: `Lease held by worker ${lease.workerId}` };
    }

    // Re-acquire with extended TTL — releases old, acquires new
    this._registry.release(request.runId, request.workerId);
    const result = this._registry.acquire(
      request.runId,
      request.workerId,
      lease.ttlMs + request.extensionMs
    );

    if (!result.success) {
      return { runId: request.runId, outcome: 'already-expired', reason: result.reason };
    }

    return {
      runId: request.runId,
      outcome: 'renewed',
      newExpiresAt: result.lease!.expiresAt,
    };
  }

  forceRelease(runId: string, reason: string): StuckRunRecoveryRecord | null {
    const lease = this._registry.getActiveLease(runId);
    if (!lease) return null;

    const released = this._registry.release(runId, lease.workerId);
    if (!released) return null;

    return {
      runId,
      workerId: lease.workerId,
      leaseAcquiredAt: lease.acquiredAt,
      stuckForMs: Date.now() - new Date(lease.acquiredAt).getTime(),
      recoveredAt: new Date().toISOString(),
      advisoryNote: `${ADVISORY} Reason: ${reason}`,
    };
  }

  detectStuck(stuckThresholdMs: number): StuckRunRecoveryRecord[] {
    const now = Date.now();
    return this._registry.listActiveLeases()
      .filter(l => now - new Date(l.acquiredAt).getTime() > stuckThresholdMs)
      .map(l => ({
        runId: l.runId,
        workerId: l.workerId,
        leaseAcquiredAt: l.acquiredAt,
        stuckForMs: now - new Date(l.acquiredAt).getTime(),
        recoveredAt: new Date().toISOString(),
        advisoryNote: ADVISORY,
      }));
  }
}
