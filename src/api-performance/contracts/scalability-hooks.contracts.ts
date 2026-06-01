// src/api-performance/contracts/scalability-hooks.contracts.ts
// Phase E Step 1: Extension point interfaces for future scalability capabilities.
// All are no-op stubs today — wire up in later Phase E steps.

import type { AiGraphOverlayBundle } from '../../api-intelligence/contracts/graph-overlay-ai.contracts';
import type { ReplaySession } from '../../api-observability/contracts/replay-event.contracts';

/** E.3 — Future WebSocket-based incremental overlay push. */
export interface IWebSocketOverlayChannel {
  pushOverlayUpdate(collectionId: string, overlay: Partial<AiGraphOverlayBundle>): void;
  isConnected(): boolean;
}

/** E.3 — Future distributed replay index for sharded execution history. */
export interface IDistributedReplayIndex {
  index(session: ReplaySession): Promise<void>;
  lookup(runId: string): Promise<ReplaySession | null>;
}

/** E.1 — Future execution shard projection cache. */
export interface IShardCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V, ttlMs?: number): void;
  invalidate(key: K): void;
  clear(): void;
}

/** E.1 — Future adaptive polling rate manager. */
export interface IAdaptivePoller {
  recommendIntervalMs(currentIntervalMs: number, idleTickCount: number): number;
}

/** E.2 — Future replay session archival to persistent store. */
export interface IReplayArchiver {
  archive(session: ReplaySession): Promise<void>;
  restore(runId: string): Promise<ReplaySession | null>;
}

/** E.7 — Future cloud-native telemetry emitter. */
export interface ICloudTelemetryEmitter {
  emit(event: Record<string, unknown>): void;
  flush(): Promise<void>;
}

/** No-op implementations for all extension points (safe defaults). */
export class NoOpWebSocketOverlayChannel implements IWebSocketOverlayChannel {
  pushOverlayUpdate(_collectionId: string, _overlay: Partial<AiGraphOverlayBundle>): void {}
  isConnected(): boolean { return false; }
}

export class NoOpAdaptivePoller implements IAdaptivePoller {
  recommendIntervalMs(currentIntervalMs: number, _idleTickCount: number): number {
    return currentIntervalMs;
  }
}

export class NoOpCloudTelemetryEmitter implements ICloudTelemetryEmitter {
  emit(_event: Record<string, unknown>): void {}
  async flush(): Promise<void> {}
}
