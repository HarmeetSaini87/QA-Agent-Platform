// src/api-runtime/orchestration/in-memory-execution-queue.ts
// Phase D Step 12 — In-memory priority execution queue.
// Priority FIFO: higher priority number dequeued first; equal priority preserves insertion order.

import type { IExecutionQueue, QueuedExecutionRequest, QueueMetrics } from './queue.contracts';

export class InMemoryExecutionQueue implements IExecutionQueue {
  private readonly _queue: QueuedExecutionRequest[] = [];

  enqueue(request: QueuedExecutionRequest): void {
    // Insert in priority order (descending), preserving FIFO for equal priority
    let insertAt = this._queue.length;
    for (let i = 0; i < this._queue.length; i++) {
      if (request.priority > this._queue[i].priority) {
        insertAt = i;
        break;
      }
    }
    this._queue.splice(insertAt, 0, request);
  }

  dequeue(): QueuedExecutionRequest | null {
    return this._queue.shift() ?? null;
  }

  peek(): QueuedExecutionRequest | null {
    return this._queue[0] ?? null;
  }

  remove(requestId: string): boolean {
    const idx = this._queue.findIndex(r => r.requestId === requestId);
    if (idx === -1) return false;
    this._queue.splice(idx, 1);
    return true;
  }

  getMetrics(): QueueMetrics {
    const oldest = this._queue.length > 0
      ? this._queue.reduce((min, r) =>
          new Date(r.enqueuedAt) < new Date(min.enqueuedAt) ? r : min
        ).enqueuedAt
      : null;
    return {
      depth: this._queue.length,
      oldestEnqueuedAt: oldest,
      capturedAt: new Date().toISOString(),
    };
  }

  get depth(): number {
    return this._queue.length;
  }
}
