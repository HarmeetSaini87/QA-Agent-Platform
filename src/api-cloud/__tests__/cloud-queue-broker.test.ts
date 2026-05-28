// src/api-cloud/__tests__/cloud-queue-broker.test.ts
import { describe, it, expect } from 'vitest';
import { LocalInProcessBroker, NoOpRedisBroker } from '../contracts/cloud-queue-broker.contracts';
import type { CloudQueueMessage } from '../contracts/cloud-queue-broker.contracts';

function makeMsg(id: string): CloudQueueMessage {
  return {
    messageId: id,
    runId: `run-${id}`,
    collectionId: 'col-1',
    priority: 5,
    enqueuedAt: new Date().toISOString(),
    payload: {},
  };
}

describe('LocalInProcessBroker', () => {
  it('enqueue + dequeue roundtrip', async () => {
    const broker = new LocalInProcessBroker();
    await broker.enqueue(makeMsg('m1'));
    const msg = await broker.dequeue();
    expect(msg?.messageId).toBe('m1');
  });

  it('dequeue: returns null when empty', async () => {
    const broker = new LocalInProcessBroker();
    expect(await broker.dequeue()).toBeNull();
  });

  it('FIFO order preserved', async () => {
    const broker = new LocalInProcessBroker();
    await broker.enqueue(makeMsg('first'));
    await broker.enqueue(makeMsg('second'));
    expect((await broker.dequeue())?.messageId).toBe('first');
    expect((await broker.dequeue())?.messageId).toBe('second');
  });

  it('stats: depth reflects queue size', async () => {
    const broker = new LocalInProcessBroker();
    await broker.enqueue(makeMsg('a'));
    await broker.enqueue(makeMsg('b'));
    const stats = await broker.stats();
    expect(stats.depth).toBe(2);
    expect(stats.healthy).toBe(true);
    expect(stats.brokerType).toBe('local');
  });

  it('ack and nack: no-op, no throw', async () => {
    const broker = new LocalInProcessBroker();
    await expect(broker.ack('any')).resolves.toBeUndefined();
    await expect(broker.nack('any')).resolves.toBeUndefined();
  });
});

describe('NoOpRedisBroker', () => {
  it('dequeue: always null', async () => {
    const broker = new NoOpRedisBroker();
    expect(await broker.dequeue()).toBeNull();
  });

  it('stats: healthy=false (not yet wired)', async () => {
    const broker = new NoOpRedisBroker();
    const stats = await broker.stats();
    expect(stats.healthy).toBe(false);
    expect(stats.brokerType).toBe('redis');
  });
});
