// src/api-cloud/contracts/cloud-worker.contracts.ts
// Phase E Step 6: Cloud worker abstraction — containerised, ephemeral, isolation-first.
// WorkflowEnvelope remains authoritative. Workers are execution containers only.

export type CloudWorkerStatus =
  | 'pending'
  | 'running'
  | 'idle'
  | 'draining'
  | 'terminated';

export type CloudWorkerProvider = 'local' | 'kubernetes' | 'azure-container-apps' | 'aws-ecs' | 'gcp-cloud-run';

export interface CloudWorkerSpec {
  readonly workerId: string;
  readonly provider: CloudWorkerProvider;
  readonly tenantId?: string;
  readonly collectionId?: string;
  readonly runId?: string;
  readonly status: CloudWorkerStatus;
  readonly startedAt: string;
  readonly terminatedAt?: string;
  /** Resource limits advisory — not enforced locally. */
  readonly resourceHints?: { memoryMb?: number; cpuMillicores?: number };
}

export interface CloudWorkerLifecycleEvent {
  readonly workerId: string;
  readonly event: 'started' | 'assigned' | 'drained' | 'terminated' | 'force-terminated';
  readonly timestamp: string;
  readonly metadata: Record<string, unknown>;
}

export interface ICloudWorkerRegistry {
  register(spec: CloudWorkerSpec): void;
  update(workerId: string, patch: Partial<Pick<CloudWorkerSpec, 'status' | 'terminatedAt' | 'runId'>>): boolean;
  get(workerId: string): CloudWorkerSpec | null;
  listActive(): CloudWorkerSpec[];
  terminate(workerId: string, reason?: string): CloudWorkerLifecycleEvent;
  snapshot(): { total: number; running: number; idle: number; draining: number; terminated: number };
}
