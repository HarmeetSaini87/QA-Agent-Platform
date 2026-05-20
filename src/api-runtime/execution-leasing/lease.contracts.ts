// src/api-runtime/execution-leasing/lease.contracts.ts
// Phase D Step 12 — Execution lease contracts.
// Leases are time-bounded ownership tokens for in-flight runs.
// All types are JSON-serialisable (IPC-ready).

export type LeaseStatus = 'active' | 'expired' | 'released';

export interface ExecutionLease {
  readonly leaseId: string;
  readonly runId: string;
  readonly workerId: string;
  readonly acquiredAt: string;   // ISO-8601
  readonly expiresAt: string;    // ISO-8601
  readonly ttlMs: number;
  readonly status: LeaseStatus;
}

export interface LeaseAcquisitionResult {
  readonly success: boolean;
  readonly lease?: ExecutionLease;
  readonly reason?: string;
}

export interface ILeaseRegistry {
  acquire(runId: string, workerId: string, ttlMs: number): LeaseAcquisitionResult;
  release(runId: string, workerId: string): boolean;
  getActiveLease(runId: string): ExecutionLease | null;
  listActiveLeases(): ExecutionLease[];
  evictExpired(): number;  // returns count of evicted leases
}
