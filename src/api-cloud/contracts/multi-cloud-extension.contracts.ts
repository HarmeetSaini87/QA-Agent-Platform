// src/api-cloud/contracts/multi-cloud-extension.contracts.ts
// Phase E Step 6: Future multi-cloud extension points.
// Stubs only — wire in future cloud migration (Azure Container Apps, AWS ECS/EKS, GCP Cloud Run).

export interface ICloudOrchestrationProvider {
  readonly providerName: string;
  /** Submit a run to the cloud provider (stub). */
  submitRun(runId: string, collectionId: string, tenantId?: string): Promise<{ submitted: boolean; providerRunId?: string }>;
  /** Cancel a run (stub). */
  cancelRun(providerRunId: string): Promise<boolean>;
  /** Health check for the provider (stub). */
  health(): Promise<{ healthy: boolean; latencyMs?: number }>;
}

export interface IDistributedReplayIndex {
  /** Index a replay session for distributed search (stub). */
  index(runId: string, collectionId: string, eventCount: number): Promise<void>;
  /** Search the distributed replay index (stub). */
  search(query: string): Promise<string[]>;
}

export interface IMultiRegionOrchestrator {
  /** Route a run to the appropriate region (stub). */
  route(runId: string, preferredRegion?: string): Promise<{ region: string; workerId: string }>;
}

/** No-op stubs for future multi-cloud. */
export class NoOpCloudOrchestrationProvider implements ICloudOrchestrationProvider {
  readonly providerName = 'noop';
  async submitRun(_runId: string, _collectionId: string): Promise<{ submitted: boolean }> { return { submitted: false }; }
  async cancelRun(_providerRunId: string): Promise<boolean> { return false; }
  async health(): Promise<{ healthy: boolean }> { return { healthy: false }; }
}

export class NoOpDistributedReplayIndex implements IDistributedReplayIndex {
  async index(_runId: string, _collectionId: string, _eventCount: number): Promise<void> { /* no-op */ }
  async search(_query: string): Promise<string[]> { return []; }
}
