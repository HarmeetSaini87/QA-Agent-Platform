// src/api-intelligence/routes/ai-intelligence.routes.ts

import { Router, Request, Response, Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { readAll, API_COLLECTIONS } from '../../data/store';
import type { ApiCollection } from '../../data/types';
import { buildRecommendationBundle, buildGraphOverlayBundle } from '../recommendation-service';
import { generateRcaHints } from '../engines/rca-hint-engine';
import { generateNegativeTests } from '../engines/negative-test-generator';
import { generateTestsByCategory, ALL_TEST_CATEGORIES, TestCategory } from '../engines/unified-test-generator';
import { generateTestsWithAi } from '../engines/ai-test-generator';
import { suggestAssertions } from '../engines/assertion-suggester';
import { loadRunResult } from '../../api-runtime/artifact-engine/run-store';
import { logApiAudit } from '../../api-governance/audit.helper';
import { loadReplaySession } from '../../api-observability/replay-event-store';
import { loadRunsForCollection, getReport } from '../../api-flakiness/flakiness-service';
import { listProposalsByCollection } from '../../api-remediation/proposal-store';
import { annotateOverlayWithProposals } from '../../api-remediation/graph-overlay-remediator';

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
    const proposals = listProposalsByCollection(collectionId);
    const augmented = annotateOverlayWithProposals(bundle, proposals);
    res.json(augmented);
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

// POST /api/ai-intelligence/collections/:collectionId/generate-negative-tests
router.post('/collections/:collectionId/generate-negative-tests', requireAuth, async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params;
    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });

    const suite = generateNegativeTests(collection);
    logApiAudit('api:intelligence:negative-tests:generated', collectionId, req);
    res.json(suite);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-intelligence/collections/:collectionId/generate-tests
// Accepts optional { baseUrl } for AI-enhanced generation. Uses configured AI provider if enabled.
router.post('/collections/:collectionId/generate-tests', requireAuth, async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params;
    const { category, baseUrl } = req.body as { category?: string; baseUrl?: string };
    if (!category || !ALL_TEST_CATEGORIES.includes(category as TestCategory)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${ALL_TEST_CATEGORIES.join(', ')}` });
    }
    const collections = readAll<ApiCollection>(API_COLLECTIONS);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });

    // Use AI-enhanced generator (falls back to static if AI not configured)
    const suite = await generateTestsWithAi(collection, category as TestCategory, baseUrl ?? '');
    logApiAudit('api:intelligence:tests:generated', collectionId, req);
    res.json(suite);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-intelligence/test-categories
router.get('/test-categories', requireAuth, (_req: Request, res: Response) => {
  res.json({ categories: ALL_TEST_CATEGORIES });
});

// POST /api/ai-intelligence/steps/:stepId/suggest-assertions
router.post('/steps/:stepId/suggest-assertions', requireAuth, async (req: Request, res: Response) => {
  try {
    const { stepId } = req.params;
    const { runId } = req.body as { runId?: string };
    if (!runId) return res.status(400).json({ error: 'runId is required in request body' });

    const runResult = await loadRunResult(runId);
    if (!runResult) return res.status(404).json({ error: 'Run not found' });

    const stepResult = runResult.stepResults?.find((s: any) => s.stepId === stepId);
    if (!stepResult) return res.status(404).json({ error: 'Step result not found in this run' });

    const suggestions = suggestAssertions(stepResult);
    logApiAudit('api:intelligence:assertions:suggested', stepId, req);
    res.json(suggestions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerAiIntelligenceRoutes(app: Express): void {
  app.use('/api/ai-intelligence', router);
}
