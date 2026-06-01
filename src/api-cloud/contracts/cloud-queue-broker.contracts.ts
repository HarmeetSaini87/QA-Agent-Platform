// src/api-cloud/contracts/cloud-queue-broker.contracts.ts
// Phase E Step 6: Cloud queue broker abstraction — Redis, Azure Service Bus, RabbitMQ stubs.
// No provider coupling today. Wire in future cloud migration steps.

export type CloudQueueBrokerType = 'local' | 'redis' | 'azure-service-bus' | 'rabbitmq' | 'kafka';

export interface CloudQueueBrokerConfig {
  readonly brokerType: CloudQueueBrokerType;
  readonly connectionString?: string;
  readonly queueName: string;
  readonly maxConcurrency: number;
  readonly visibilityTimeoutMs?: number;
}

export interface CloudQueueMessage {
  readonly messageId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly priority: number;
  readonly enqueuedAt: string;
  readonly payload: Record<string, unknown>;
}

export interface CloudQueueBrokerStats {
  readonly brokerType: CloudQueueBrokerType;
  readonly depth: number;
  readonly inFlight: number;
  readonly healthy: boolean;
  readonly sampledAt: string;
}

export interface ICloudQueueBroker {
  readonly config: CloudQueueBrokerConfig;
  enqueue(message: CloudQueueMessage): Promise<void>;
  dequeue(): Promise<CloudQueueMessage | null>;
  ack(messageId: string): Promise<void>;
  nack(messageId: string): Promise<void>;
  stats(): Promise<CloudQueueBrokerStats>;
}

/** No-op local broker — default until a cloud broker is wired. */
export class LocalInProcessBroker implements ICloudQueueBroker {
  private readonly _queue: CloudQueueMessage[] = [];
  readonly config: CloudQueueBrokerConfig;

  constructor(queueName = 'local-default') {
    this.config = { brokerType: 'local', queueName, maxConcurrency: 1 };
  }

  async enqueue(message: CloudQueueMessage): Promise<void> { this._queue.push(message); }
  async dequeue(): Promise<CloudQueueMessage | null> { return this._queue.shift() ?? null; }
  async ack(_messageId: string): Promise<void> { /* local — already removed at dequeue */ }
  async nack(_messageId: string): Promise<void> { /* no-op for local */ }
  async stats(): Promise<CloudQueueBrokerStats> {
    return { brokerType: 'local', depth: this._queue.length, inFlight: 0, healthy: true, sampledAt: new Date().toISOString() };
  }
}

/** Stub for Redis — wire connection string + ioredis in Phase E Step 7+. */
export class NoOpRedisBroker implements ICloudQueueBroker {
  readonly config: CloudQueueBrokerConfig;
  constructor(queueName = 'redis-queue') {
    this.config = { brokerType: 'redis', queueName, maxConcurrency: 10 };
  }
  async enqueue(_m: CloudQueueMessage): Promise<void> { /* no-op */ }
  async dequeue(): Promise<CloudQueueMessage | null> { return null; }
  async ack(_id: string): Promise<void> { /* no-op */ }
  async nack(_id: string): Promise<void> { /* no-op */ }
  async stats(): Promise<CloudQueueBrokerStats> {
    return { brokerType: 'redis', depth: 0, inFlight: 0, healthy: false, sampledAt: new Date().toISOString() };
  }
}
