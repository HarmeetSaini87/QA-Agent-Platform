// src/api-orchestration/contracts/lease-renewal.contracts.ts
// Phase E Step 3: Lease renewal and stuck-run recovery contracts.
// Teardown ownership guarantee: teardown always runs on the lease holder.

export interface LeaseRenewalRequest {
  readonly runId: string;
  readonly workerId: string;
  /** How many ms to extend the lease by. */
  readonly extensionMs: number;
}

export type LeaseRenewalOutcome = 'renewed' | 'not-found' | 'worker-mismatch' | 'already-expired';

export interface LeaseRenewalResult {
  readonly runId: string;
  readonly outcome: LeaseRenewalOutcome;
  readonly newExpiresAt?: string;
  readonly reason?: string;
}

export interface StuckRunRecoveryRecord {
  readonly runId: string;
  readonly workerId: string;
  readonly leaseAcquiredAt: string;
  readonly stuckForMs: number;
  readonly recoveredAt: string;
  /** Advisory: platform logs the forced release but does NOT re-run automatically. */
  readonly advisoryNote: string;
}

export interface ILeaseRenewer {
  /** Extend an active lease — called by worker heartbeat to prevent expiry. */
  renew(request: LeaseRenewalRequest): LeaseRenewalResult;
  /** Force-release a stuck lease — advisory only, does NOT restart the run. */
  forceRelease(runId: string, reason: string): StuckRunRecoveryRecord | null;
  /** Return all leases that have been stuck beyond stuckThresholdMs. */
  detectStuck(stuckThresholdMs: number): StuckRunRecoveryRecord[];
}
