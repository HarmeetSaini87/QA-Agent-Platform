// src/api-runtime/orchestration/queue.contracts.ts
// Phase D Step 12 — Execution queue and orchestration broker contracts.
// IOrchestrationBroker is a stub contract only — no implementation needed yet.
// All types are JSON-serialisable (IPC-ready).

export interface QueuedExecutionRequest {
  readonly requestId: string;
  readonly collectionId: string;
  readonly runId: string;
  readonly priority: number;        // higher = dequeued first
  readonly enqueuedAt: string;      // ISO-8601
  readonly payload: Record<string, unknown>;
}

export interface QueueMetrics {
  readonly depth: number;
  readonly oldestEnqueuedAt: string | null;   // ISO-8601 or null if empty
  readonly capturedAt: string;                // ISO-8601
}

export interface IExecutionQueue {
  enqueue(request: QueuedExecutionRequest): void;
  dequeue(): QueuedExecutionRequest | null;
  peek(): QueuedExecutionRequest | null;
  remove(requestId: string): boolean;
  getMetrics(): QueueMetrics;
  readonly depth: number;
}

export interface IOrchestrationBroker {
  readonly brokerName: string;
  submitRun(request: QueuedExecutionRequest): Promise<void>;
  cancelRun(runId: string): Promise<boolean>;
}
