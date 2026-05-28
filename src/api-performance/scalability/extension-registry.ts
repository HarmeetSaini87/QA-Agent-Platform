// src/api-performance/scalability/extension-registry.ts
// Phase E Step 1: Registry wiring all scalability extension points to their default no-op stubs.
// Future Phase E steps swap stubs for real implementations without touching call sites.

import {
  NoOpWebSocketOverlayChannel,
  NoOpGraphVirtualizer,
  NoOpAdaptivePoller,
  NoOpCloudTelemetryEmitter,
  type IWebSocketOverlayChannel,
  type IGraphVirtualizer,
  type IAdaptivePoller,
  type ICloudTelemetryEmitter,
} from '../contracts/scalability-hooks.contracts';

export interface ScalabilityExtensionRegistry {
  readonly wsOverlayChannel: IWebSocketOverlayChannel;
  readonly graphVirtualizer: IGraphVirtualizer;
  readonly adaptivePoller: IAdaptivePoller;
  readonly cloudTelemetry: ICloudTelemetryEmitter;
}

export const globalScalabilityRegistry: ScalabilityExtensionRegistry = {
  wsOverlayChannel: new NoOpWebSocketOverlayChannel(),
  graphVirtualizer: new NoOpGraphVirtualizer(),
  adaptivePoller: new NoOpAdaptivePoller(),
  cloudTelemetry: new NoOpCloudTelemetryEmitter(),
};
