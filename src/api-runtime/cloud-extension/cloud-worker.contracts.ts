// src/api-runtime/cloud-extension/cloud-worker.contracts.ts
// Phase D Step 12 — Cloud worker extension point contracts.
// ADVISORY ONLY — stubs for future K8s/Azure Container Apps worker provisioning.
// No cloud calls, no runtime side effects today.

export interface CloudWorkerConfig {
  readonly providerType: 'kubernetes' | 'azure-container-apps' | 'none';
  readonly maxWorkers: number;
  readonly workerImageTag: string;
  readonly namespace?: string;
}

export interface WorkerProvisionRequest {
  readonly requestId: string;
  readonly collectionId: string;
  readonly runId: string;
  readonly requiredCapabilities: readonly string[];
}

export interface WorkerProvisionResult {
  readonly requestId: string;
  readonly success: boolean;
  readonly workerId?: string;
  readonly reason?: string;
  readonly provisionedAt?: string;  // ISO-8601
}

export interface IWorkerProvider {
  readonly providerName: string;
  readonly config: CloudWorkerConfig;
  provision(request: WorkerProvisionRequest): Promise<WorkerProvisionResult>;
  deprovision(workerId: string): Promise<boolean>;
}

export class NoOpWorkerProvider implements IWorkerProvider {
  readonly providerName = 'no-op';
  readonly config: CloudWorkerConfig = {
    providerType: 'none',
    maxWorkers: 0,
    workerImageTag: 'n/a',
  };

  async provision(request: WorkerProvisionRequest): Promise<WorkerProvisionResult> {
    return { requestId: request.requestId, success: false, reason: 'No cloud provider configured' };
  }

  async deprovision(_workerId: string): Promise<boolean> {
    return false;
  }
}
