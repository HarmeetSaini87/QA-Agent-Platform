// src/api-plugins/contracts/sdk-extension.contracts.ts
// Phase E Step 8: SDK access layer — read-only surfaces exposed to plugins.
// No unsafe runtime internals. WorkflowEnvelope internals never exposed.

export interface SdkWorkflowInfo {
  readonly collectionId: string;
  readonly stepCount: number;
  readonly executionMode: string;
  readonly tags: readonly string[];
  readonly tenantId?: string;
}

export interface SdkReplayAccess {
  readonly runId: string;
  readonly eventCount: number;
  readonly deterministicGuarantee: boolean;
  /** Full event payloads are NOT exposed — only summary. */
  readonly summary: Record<string, unknown>;
}

export interface SdkAnalyticsAccess {
  readonly collectionId: string;
  readonly avgPassRate?: number;
  readonly flakinessScore?: number;
  readonly slaScore?: number;
}

export interface SdkGraphAccess {
  readonly collectionId: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly overlayBadgeCount: number;
}

export interface ISdkAccessLayer {
  /** Read-only workflow info — no WorkflowEnvelope internals. */
  getWorkflowInfo(collectionId: string): SdkWorkflowInfo | null;
  /** Read-only replay summary — no full event payloads. */
  getReplaySummary(runId: string): SdkReplayAccess | null;
  /** Read-only analytics summary. */
  getAnalyticsSummary(collectionId: string): SdkAnalyticsAccess | null;
  /** Read-only graph summary. */
  getGraphSummary(collectionId: string): SdkGraphAccess | null;
}
