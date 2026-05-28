// src/api-security/contracts/worker-security.contracts.ts
// Phase E Step 4: Worker secret isolation and teardown cleanup contracts.

export interface SecretCleanupRecord {
  readonly workerId: string;
  readonly runId: string;
  readonly cleanedAt: string;
  readonly fieldsCleared: number;
  readonly headersCleared: number;
  /** Advisory note — e.g. "teardown completed" or "forced cleanup after timeout". */
  readonly advisoryNote: string;
}

export interface WorkerSecuritySnapshot {
  readonly workerId: string;
  readonly snapshotAt: string;
  readonly activeRunIds: string[];
  readonly pendingCleanups: number;
  readonly lastCleanupAt: string | null;
}

export interface IWorkerSecurityBoundary {
  /** Called at start of run to mark worker as holding secrets for runId. */
  markSecretsActive(workerId: string, runId: string): void;
  /** Called at end of run (including teardown) to clear all secret state for runId. */
  clearSecrets(workerId: string, runId: string): SecretCleanupRecord;
  /** Force cleanup for a stuck/dead worker (advisory). */
  forceCleanup(workerId: string): SecretCleanupRecord[];
  snapshot(workerId: string): WorkerSecuritySnapshot;
}
