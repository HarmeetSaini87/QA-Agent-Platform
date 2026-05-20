// src/api-runtime/orchestration/__tests__/execution-queue.test.ts
// Phase D Step 12 — Tests for InMemoryExecutionQueue

import { describe, it, expect } from 'vitest';
import { InMemoryExecutionQueue } from '../in-memory-execution-queue';
import type { QueuedExecutionRequest } from '../queue.contracts';

function createRequest(
  requestId: string,
  priority: number = 0,
  enqueuedAt?: string
): QueuedExecutionRequest {
  return {
    requestId,
    collectionId: 'col-' + requestId,
    runId: 'run-' + requestId,
    priority,
    enqueuedAt: enqueuedAt || new Date().toISOString(),
    payload: { test: true },
  };
}

describe('InMemoryExecutionQueue', () => {
  it('dequeue returns null on empty queue', () => {
    const queue = new InMemoryExecutionQueue();
    expect(queue.dequeue()).toBeNull();
  });

  it('enqueue + dequeue returns correct item', () => {
    const queue = new InMemoryExecutionQueue();
    const req = createRequest('req-1');
    queue.enqueue(req);
    const dequeued = queue.dequeue();
    expect(dequeued).toEqual(req);
  });

  it('higher priority item dequeued before lower priority', () => {
    const queue = new InMemoryExecutionQueue();
    const lowPriority = createRequest('low', 1);
    const highPriority = createRequest('high', 10);
    queue.enqueue(lowPriority);
    queue.enqueue(highPriority);
    expect(queue.dequeue()).toEqual(highPriority);
    expect(queue.dequeue()).toEqual(lowPriority);
  });

  it('equal priority items follow FIFO order', () => {
    const queue = new InMemoryExecutionQueue();
    const first = createRequest('first', 5, new Date('2026-01-01T10:00:00Z').toISOString());
    const second = createRequest('second', 5, new Date('2026-01-01T10:01:00Z').toISOString());
    const third = createRequest('third', 5, new Date('2026-01-01T10:02:00Z').toISOString());
    queue.enqueue(first);
    queue.enqueue(second);
    queue.enqueue(third);
    expect(queue.dequeue()).toEqual(first);
    expect(queue.dequeue()).toEqual(second);
    expect(queue.dequeue()).toEqual(third);
  });

  it('peek returns first item without removing it', () => {
    const queue = new InMemoryExecutionQueue();
    const req = createRequest('req-peek');
    queue.enqueue(req);
    const peeked = queue.peek();
    expect(peeked).toEqual(req);
    expect(queue.depth).toBe(1);
    const dequeued = queue.dequeue();
    expect(dequeued).toEqual(req);
  });

  it('remove by requestId returns true and item is gone', () => {
    const queue = new InMemoryExecutionQueue();
    const req1 = createRequest('req-1');
    const req2 = createRequest('req-2');
    queue.enqueue(req1);
    queue.enqueue(req2);
    const removed = queue.remove('req-1');
    expect(removed).toBe(true);
    expect(queue.depth).toBe(1);
    expect(queue.dequeue()).toEqual(req2);
  });

  it('remove with unknown requestId returns false', () => {
    const queue = new InMemoryExecutionQueue();
    const req = createRequest('req-exists');
    queue.enqueue(req);
    const removed = queue.remove('req-does-not-exist');
    expect(removed).toBe(false);
    expect(queue.depth).toBe(1);
  });

  it('depth reflects current queue size', () => {
    const queue = new InMemoryExecutionQueue();
    expect(queue.depth).toBe(0);
    queue.enqueue(createRequest('req-1'));
    expect(queue.depth).toBe(1);
    queue.enqueue(createRequest('req-2'));
    expect(queue.depth).toBe(2);
    queue.dequeue();
    expect(queue.depth).toBe(1);
  });

  it('getMetrics returns correct depth and non-null oldestEnqueuedAt when queue has items', () => {
    const queue = new InMemoryExecutionQueue();
    const now = new Date().toISOString();
    const earlier = new Date(new Date().getTime() - 10000).toISOString();
    const req1 = createRequest('req-1', 5, now);
    const req2 = createRequest('req-2', 10, earlier);
    queue.enqueue(req1);
    queue.enqueue(req2);
    const metrics = queue.getMetrics();
    expect(metrics.depth).toBe(2);
    expect(metrics.oldestEnqueuedAt).toBe(earlier);
    expect(metrics.capturedAt).toBeTruthy();
  });
});
