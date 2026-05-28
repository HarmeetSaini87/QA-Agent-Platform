// src/api-orchestration/routes/orchestration.routes.ts
// Phase E Step 3: Orchestration observability endpoints — read-only health/snapshot routes.

import type { Express, Request, Response } from 'express';
import { getQueueOrchestratorSingleton } from '../queue-orchestrator';
import { globalHeartbeatRegistry } from '../heartbeat-registry';
import { InMemoryLeaseRenewer } from '../lease-renewer';
import { getLeaseRegistrySingleton } from '../../api-runtime/execution-leasing/in-memory-lease-registry';

export function registerOrchestrationRoutes(app: Express): void {
  // GET /api/orchestration/queue/snapshot — queue depth, leases, worker count
  app.get('/api/orchestration/queue/snapshot', (_req: Request, res: Response) => {
    const snapshot = getQueueOrchestratorSingleton().snapshot();
    res.json({ ok: true, snapshot });
  });

  // GET /api/orchestration/leases — list active execution leases
  app.get('/api/orchestration/leases', (_req: Request, res: Response) => {
    const registry = getLeaseRegistrySingleton();
    registry.evictExpired();
    const leases = registry.listActiveLeases();
    res.json({ ok: true, leases, count: leases.length });
  });

  // GET /api/orchestration/leases/stuck — leases stuck beyond threshold
  app.get('/api/orchestration/leases/stuck', (req: Request, res: Response) => {
    const thresholdMs = parseInt(req.query['thresholdMs'] as string, 10) || 300_000;
    const renewer = new InMemoryLeaseRenewer(getLeaseRegistrySingleton());
    const stuck = renewer.detectStuck(thresholdMs);
    res.json({ ok: true, stuckRuns: stuck, count: stuck.length, thresholdMs });
  });

  // POST /api/orchestration/leases/:runId/force-release — advisory forced release
  app.post('/api/orchestration/leases/:runId/force-release', (req: Request, res: Response) => {
    const { runId } = req.params;
    const reason = (req.body as { reason?: string })?.reason ?? 'manual-force-release';
    const renewer = new InMemoryLeaseRenewer(getLeaseRegistrySingleton());
    const record = renewer.forceRelease(runId, reason);
    if (!record) {
      res.status(404).json({ ok: false, error: `No active lease for run ${runId}` });
      return;
    }
    res.json({ ok: true, record });
  });

  // GET /api/orchestration/heartbeats — worker heartbeat snapshot
  app.get('/api/orchestration/heartbeats', (_req: Request, res: Response) => {
    const snapshot = globalHeartbeatRegistry.snapshot();
    res.json({ ok: true, snapshot });
  });

  // POST /api/orchestration/heartbeats — record a worker heartbeat
  app.post('/api/orchestration/heartbeats', (req: Request, res: Response) => {
    const beat = req.body as import('../contracts/worker-heartbeat.contracts').WorkerHeartbeat;
    if (!beat?.workerId) {
      res.status(400).json({ ok: false, error: 'workerId required' });
      return;
    }
    globalHeartbeatRegistry.record({ ...beat, timestamp: new Date().toISOString() });
    res.json({ ok: true, recorded: true, workerId: beat.workerId });
  });
}
