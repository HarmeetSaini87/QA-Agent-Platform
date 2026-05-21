// src/api-intelligence/routes/ai-intelligence.routes.ts

import { Router, Request, Response, Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { readAll, API_COLLECTIONS } from '../../data/store';
import type { ApiCollection } from '../../data/types';
import { buildRecommendationBundle, buildGraphOverlayBundle } from '../recommendation-service';
import { generateRcaHints } from '../engines/rca-hint-engine';
import { logApiAudit } from '../../api-governance/audit.helper';
import { loadReplaySession } from '../../api-observability/replay-event-store';
import { loadRunsForCollection, getReport } from '../../api-flakiness/flakiness-service';

const router = Router();

// GET /api/ai-intelligence/collections/:collectionId/recommendations
router.get('/collections/:collectionId/recommendations', requireAuth, async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params;
    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });

    const recentRuns = loadRunsForCollection(collectionId).slice(0, 20);

    let flakinessReport = null;
    try {
      flakinessReport = getReport(collectionId);
    } catch { /* graceful degrade — flakiness optional */ }

    const bundle = buildRecommendationBundle({ collection, recentRuns, flakinessReport }, req);
    res.json(bundle);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-intelligence/collections/:collectionId/graph-overlay
router.get('/collections/:collectionId/graph-overlay', requireAuth, async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params;
    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });

    const recentRuns = loadRunsForCollection(collectionId).slice(0, 10);

    let flakinessReport = null;
    try {
      flakinessReport = getReport(collectionId);
    } catch { /* graceful degrade */ }

    const bundle = buildGraphOverlayBundle({ collection, recentRuns, flakinessReport }, req);
    res.json(bundle);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-intelligence/runs/:runId/rca-hints
router.get('/runs/:runId/rca-hints', requireAuth, async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const session = loadReplaySession(runId);
    if (!session) {
      return res.status(404).json({ error: 'No replay session found for this run. Run the collection first to generate replay data.' });
    }
    logApiAudit('api:intelligence:rca:accessed', runId, req);
    const bundle = generateRcaHints(session);
    res.json(bundle);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerAiIntelligenceRoutes(app: Express): void {
  app.use('/api/ai-intelligence', router);
}
