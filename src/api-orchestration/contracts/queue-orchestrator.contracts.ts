// src/api-orchestration/contracts/queue-orchestrator.contracts.ts
// Phase E Step 3: High-level queue orchestration contracts.
// Wraps queue + lease + dispatch into a single deterministic coordination surface.
// Single-node default. Future: swap broker for Redis/Azure without changing callers.

import type { QueuedExecutionRequest } from '../../api-runtime/orchestration/queue.contracts';

export type OrchestrationOutcome =
  | 'dispatched'
  | 'queued'
  | 'lease-conflict'
  | 'rejected-capacity'
  | 'rejected-policy'
  | 'cancelled';

export interface OrchestrationRequest {
  readonly collectionId: string;
  readonly runId: string;
  readonly priority: number;
  readonly tenantId?: string;
  readonly requestedBy?: string;
  readonly payload: Record<string, unknown>;
}

export interface OrchestrationResult {
  readonly runId: string;
  readonly outcome: OrchestrationOutcome;
  readonly workerId?: string;
  readonly leaseId?: string;
  readonly queueDepthAfter?: number;
  readonly enqueuedAt: string;
  readonly reason?: string;
}

export interface OrchestrationQueueSnapshot {
  readonly capturedAt: string;
  readonly queueDepth: number;
  readonly activeLeaseCount: number;
  readonly workerCount: number;
  readonly oldestEnqueuedAt: string | null;
}

export interface IQueueOrchestrator {
  /** Submit a run — dispatches immediately if worker available, otherwise queues. */
  submit(request: OrchestrationRequest): OrchestrationResult;
  /** Cancel a queued or in-flight run. */
  cancel(runId: string, reason?: string): boolean;
  /** Drain next item from queue and attempt dispatch. */
  drainOne(): OrchestrationResult | null;
  /** Current state snapshot for health/observability. */
  snapshot(): OrchestrationQueueSnapshot;
}
