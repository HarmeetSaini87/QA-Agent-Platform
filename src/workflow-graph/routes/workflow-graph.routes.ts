// src/workflow-graph/routes/workflow-graph.routes.ts
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { getProjection } from '../service/projection-service';

export function registerWorkflowGraphRoutes(app: Express): void {
  /**
   * GET /api/workflows/:collectionId/graph
   * Returns a read-only GraphProjection for the given collection.
   * Never cached — always computed fresh from the live WorkflowEnvelope.
   */
  app.get('/api/workflows/:collectionId/graph', requireAuth, (req: Request, res: Response) => {
    const { collectionId } = req.params;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    const result = getProjection(collectionId);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.code, message: result.message });
    }

    return res.json(result.projection);
  });
}
