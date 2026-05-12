/**
 * runtime-registry.ts
 * SKELETON — Phase C implementation target.
 *
 * RuntimeType enum and in-memory runtime descriptor registry.
 * Coordinator registers available runtimes at server boot.
 * Phase C: each descriptor gains a factory() that spawns a child_process worker.
 * Phase A: registry and lookup only — no worker spawning.
 */

import type { WorkerMetadata } from '../runtime-workers/contracts/worker.contract';

export enum RuntimeType {
  UI  = 'ui',
  API = 'api',
  // future: GRPC = 'grpc', MOCK = 'mock'
}

export interface IRuntimeDescriptor {
  runtimeType: RuntimeType;
  displayName: string;
  meta: WorkerMetadata;
  /** Phase C: factory spawns a child_process worker for this runtime type */
  // factory?(payload: ExecutionPayload): IRuntimeWorker;
}

const _registry = new Map<RuntimeType, IRuntimeDescriptor>();

export function registerRuntime(descriptor: IRuntimeDescriptor): void {
  _registry.set(descriptor.runtimeType, descriptor);
}

export function getRuntime(type: RuntimeType): IRuntimeDescriptor | undefined {
  return _registry.get(type);
}

export function listRuntimes(): IRuntimeDescriptor[] {
  return Array.from(_registry.values());
}

export function clearRuntimes(): void {
  _registry.clear();
}
