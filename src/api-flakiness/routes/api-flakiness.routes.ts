// src/api-flakiness/routes/api-flakiness.routes.ts
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { getReport, recomputeAndSave } from '../flakiness-service';

export function registerFlakinessRoutes(app: Express): void {
  const noCache = (res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  };

  /**
   * GET /api/flakiness/:collectionId
   * Returns cached CollectionFlakinessReport (computes if not cached).
   */
  app.get('/api/flakiness/:collectionId', requireAuth, (req: Request, res: Response) => {
    noCache(res);
    try {
      const report = getReport(req.params.collectionId);
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: 'FLAKINESS_ERROR', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/flakiness/:collectionId/recompute
   * Forces a fresh scan of all runs for the collection.
   */
  app.post('/api/flakiness/:collectionId/recompute', requireAuth, (req: Request, res: Response) => {
    noCache(res);
    try {
      const report = recomputeAndSave(req.params.collectionId);
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: 'FLAKINESS_RECOMPUTE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  });
}
