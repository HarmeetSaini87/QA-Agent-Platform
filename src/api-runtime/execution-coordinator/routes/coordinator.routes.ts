// src/api-runtime/execution-coordinator/routes/coordinator.routes.ts
// Phase C Track 1 — ExecutionCoordinator REST endpoints.

import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../../auth/middleware';
import { getCoordinatorBridge, USE_COORDINATOR } from '../coordinator-bridge';

export function registerCoordinatorRoutes(app: Express): void {

  // GET /api/coordinator/health — coordinator + worker health
  app.get('/api/coordinator/health', requireAuth, (_req: Request, res: Response) => {
    const bridge = getCoordinatorBridge();
    res.json(bridge.health());
  });

  // GET /api/api-runs/:runId/coordinator-state — run lifecycle state
  app.get('/api/api-runs/:runId/coordinator-state', requireAuth, async (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const bridge = getCoordinatorBridge();
    const state = await bridge.getRunState(runId);
    if (!state) {
      res.status(404).json({ error: 'Run not found.', useCoordinator: USE_COORDINATOR });
      return;
    }
    res.json({ ...state, useCoordinator: USE_COORDINATOR });
  });

  // POST /api/api-runs/:runId/cancel — cancel in-flight run
  app.post('/api/api-runs/:runId/cancel', requireAuth, (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const { reason } = req.body as { reason?: string };
    const bridge = getCoordinatorBridge();
    bridge.cancelRun(runId, reason);
    res.json({ cancelled: true, runId });
  });

  // POST /api/api-runs/:runId/replay-node-context — advisory node replay context
  // (builds context only; does not trigger execution)
  app.post('/api/api-runs/:runId/replay-node-context', requireAuth, async (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const { nodeId } = req.body as { nodeId?: string };
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId required' });
      return;
    }
    const bridge = getCoordinatorBridge();
    const context = await bridge.replayNode(runId, nodeId);
    if (!context) {
      res.status(404).json({ error: 'Snapshot not found or nodeId missing from snapshot.' });
      return;
    }
    res.json(context);
  });
}
