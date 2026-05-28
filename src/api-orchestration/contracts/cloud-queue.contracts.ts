// src/api-orchestration/contracts/cloud-queue.contracts.ts
// Phase E Step 3: Cloud-native queue extension point stubs.
// Redis, Azure Service Bus, and K8s job runner interfaces for future phases.
// All are no-op today — wire in Phase E Steps 7+ for real cloud orchestration.

import type { QueuedExecutionRequest, QueueMetrics } from '../../api-runtime/orchestration/queue.contracts';

/** Future Redis-backed execution queue. */
export interface IRedisExecutionQueue {
  readonly queueName: string;
  enqueue(request: QueuedExecutionRequest): Promise<void>;
  dequeue(timeoutMs?: number): Promise<QueuedExecutionRequest | null>;
  getMetrics(): Promise<QueueMetrics>;
  purge(): Promise<number>;
}

/** Future Azure Service Bus queue integration. */
export interface IAzureServiceBusQueue {
  readonly topicName: string;
  sendMessage(request: QueuedExecutionRequest): Promise<void>;
  receiveMessage(): Promise<QueuedExecutionRequest | null>;
  abandonMessage(messageId: string): Promise<void>;
  completeMessage(messageId: string): Promise<void>;
}

/** Future Kubernetes job runner — submits execution as a K8s Job. */
export interface IKubernetesJobRunner {
  readonly namespace: string;
  submitJob(runId: string, collectionId: string, imageTag: string): Promise<string>;
  getJobStatus(jobId: string): Promise<'pending' | 'running' | 'succeeded' | 'failed' | 'unknown'>;
  deleteJob(jobId: string): Promise<boolean>;
}

/** No-op implementations for safe defaults. */
export class NoOpRedisQueue implements Partial<IRedisExecutionQueue> {
  readonly queueName = 'no-op';
  async enqueue(_req: QueuedExecutionRequest): Promise<void> {}
  async dequeue(): Promise<QueuedExecutionRequest | null> { return null; }
  async getMetrics(): Promise<QueueMetrics> {
    return { depth: 0, oldestEnqueuedAt: null, capturedAt: new Date().toISOString() };
  }
  async purge(): Promise<number> { return 0; }
}

export class NoOpKubernetesJobRunner implements IKubernetesJobRunner {
  readonly namespace = 'no-op';
  async submitJob(_runId: string, _collectionId: string, _imageTag: string): Promise<string> { return ''; }
  async getJobStatus(_jobId: string): Promise<'unknown'> { return 'unknown'; }
  async deleteJob(_jobId: string): Promise<boolean> { return false; }
}
