// src/api-runtime/debugger-engine/routes/debugger-engine.routes.ts
// Phase F — Debugger Engine REST endpoints.

import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../../auth/middleware';
import { captureTimeline } from '../timeline-capture';
import { buildVariableTrace } from '../variable-snapshot-viewer';
import { buildNodeReplayContext } from '../node-replay';
import { buildWorkflowReplayPlan } from '../workflow-replay';

export function registerDebuggerEngineRoutes(app: Express): void {

  // GET /api/api-runs/:runId/timeline
  app.get('/api/api-runs/:runId/timeline', requireAuth, async (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const result = await captureTimeline(runId);
    if (!result) {
      res.status(404).json({ error: 'No timeline or snapshot found for this run.' });
      return;
    }
    res.json(result);
  });

  // GET /api/api-runs/:runId/variable-trace
  app.get('/api/api-runs/:runId/variable-trace', requireAuth, async (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const trace = await buildVariableTrace(runId);
    if (!trace) {
      res.status(404).json({ error: 'No execution snapshot found for this run.' });
      return;
    }
    res.json(trace);
  });

  // POST /api/api-runs/:runId/replay-node
  // Body: { nodeId: string }
  app.post('/api/api-runs/:runId/replay-node', requireAuth, async (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const { nodeId } = req.body as { nodeId?: string };
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId required' });
      return;
    }
    const context = await buildNodeReplayContext(runId, nodeId);
    if (!context) {
      res.status(404).json({ error: 'No snapshot found or nodeId not in snapshot.' });
      return;
    }
    res.json(context);
  });

  // POST /api/api-runs/:runId/replay-workflow
  // Body: { targetNodeIds?: string[] }
  app.post('/api/api-runs/:runId/replay-workflow', requireAuth, async (req: Request, res: Response) => {
    const { runId } = req.params as { runId: string };
    const { targetNodeIds } = req.body as { targetNodeIds?: string[] };
    const plan = await buildWorkflowReplayPlan(runId, targetNodeIds);
    if (!plan) {
      res.status(404).json({ error: 'No execution snapshot found for this run.' });
      return;
    }
    res.json(plan);
  });
}
