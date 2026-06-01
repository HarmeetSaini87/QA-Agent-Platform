// src/api-orchestration/contracts/worker-heartbeat.contracts.ts
// Phase E Step 3: Worker heartbeat protocol contracts.
// Heartbeats are used to renew leases and detect dead workers.
// No automatic restart — advisory detection only.

export interface WorkerHeartbeat {
  readonly workerId: string;
  readonly runId?: string;
  readonly timestamp: string;
  readonly activeRunCount: number;
  readonly heapUsedMb?: number;
  readonly status: 'idle' | 'running' | 'draining' | 'unhealthy';
}

export interface HeartbeatRegistrySnapshot {
  readonly capturedAt: string;
  readonly totalWorkers: number;
  readonly liveWorkers: number;
  readonly deadWorkers: readonly string[];
  readonly heartbeats: readonly WorkerHeartbeat[];
}

export interface IHeartbeatRegistry {
  /** Record a heartbeat from a worker. */
  record(heartbeat: WorkerHeartbeat): void;
  /** Get latest heartbeat for a worker — null if never heard from. */
  latest(workerId: string): WorkerHeartbeat | null;
  /** Workers with no heartbeat within deadThresholdMs are considered dead. */
  detectDead(deadThresholdMs: number): readonly string[];
  snapshot(): HeartbeatRegistrySnapshot;
}
