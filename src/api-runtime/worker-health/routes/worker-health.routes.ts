// src/api-runtime/worker-health/routes/worker-health.routes.ts
// Phase D Step 12 — Worker pool health routes.
// GET /api/worker-pool/health — full report
// GET /api/worker-pool/health/stuck-runs — stuck runs only

import type { Express } from 'express';
import { requireAuth } from '../../../auth/middleware';
import { aggregatePoolHealth } from '../worker-health-aggregator';
import { getWorkerHealthLeaseRegistry } from '../worker-health-singleton';

export function registerWorkerHealthRoutes(app: Express): void {
  app.get('/api/worker-pool/health', requireAuth, (_req, res) => {
    const registry = getWorkerHealthLeaseRegistry();
    const report = aggregatePoolHealth(null, registry);
    void res.json(report);
  });

  app.get('/api/worker-pool/health/stuck-runs', requireAuth, (_req, res) => {
    const registry = getWorkerHealthLeaseRegistry();
    const report = aggregatePoolHealth(null, registry);
    void res.json({ stuckRuns: report.stuckRuns });
  });
}
