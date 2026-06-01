// src/api-cloud/cloud-worker-registry.ts
// Phase E Step 6: Cloud worker registry — track ephemeral workers across lifecycle states.

import type {
  ICloudWorkerRegistry,
  CloudWorkerSpec,
  CloudWorkerLifecycleEvent,
} from './contracts/cloud-worker.contracts';

export class CloudWorkerRegistry implements ICloudWorkerRegistry {
  private readonly _workers = new Map<string, CloudWorkerSpec>();

  register(spec: CloudWorkerSpec): void {
    this._workers.set(spec.workerId, spec);
  }

  update(
    workerId: string,
    patch: Partial<Pick<CloudWorkerSpec, 'status' | 'terminatedAt' | 'runId'>>,
  ): boolean {
    const existing = this._workers.get(workerId);
    if (!existing) return false;
    this._workers.set(workerId, { ...existing, ...patch });
    return true;
  }

  get(workerId: string): CloudWorkerSpec | null {
    return this._workers.get(workerId) ?? null;
  }

  listActive(): CloudWorkerSpec[] {
    return Array.from(this._workers.values()).filter(
      w => w.status !== 'terminated',
    );
  }

  terminate(workerId: string, reason = 'requested'): CloudWorkerLifecycleEvent {
    const terminatedAt = new Date().toISOString();
    this.update(workerId, { status: 'terminated', terminatedAt });
    return {
      workerId,
      event: 'terminated',
      timestamp: terminatedAt,
      metadata: { reason },
    };
  }

  snapshot(): { total: number; running: number; idle: number; draining: number; terminated: number } {
    const all = Array.from(this._workers.values());
    return {
      total: all.length,
      running: all.filter(w => w.status === 'running').length,
      idle: all.filter(w => w.status === 'idle').length,
      draining: all.filter(w => w.status === 'draining').length,
      terminated: all.filter(w => w.status === 'terminated').length,
    };
  }
}

export const globalCloudWorkerRegistry = new CloudWorkerRegistry();
