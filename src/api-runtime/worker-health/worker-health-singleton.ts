// src/api-runtime/worker-health/worker-health-singleton.ts
// Phase D Step 12 — Dedicated lease registry for the worker health route layer.
// Separate from getLeaseRegistrySingleton() to avoid circular deps between route layer and coordinator.

import { InMemoryLeaseRegistry } from '../execution-leasing/in-memory-lease-registry';

let _healthLeaseRegistry: InMemoryLeaseRegistry | null = null;

export function getWorkerHealthLeaseRegistry(): InMemoryLeaseRegistry {
  if (!_healthLeaseRegistry) _healthLeaseRegistry = new InMemoryLeaseRegistry();
  return _healthLeaseRegistry;
}

export function _resetWorkerHealthSingleton(): void {
  _healthLeaseRegistry = null;
}
