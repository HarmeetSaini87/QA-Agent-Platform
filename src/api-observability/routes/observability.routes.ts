import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { getObservabilitySummary } from '../observability-query';
import { loadReplaySession, replaySessionExists, saveReplaySession } from '../replay-event-store';
import { synthesizeReplaySession } from '../replay-event-synthesizer';
import { loadRunResult, loadSnapshot } from '../../storage-provider/execution-store';
import { loadTimeline } from '../../api-runtime/artifact-engine/timeline-builder';

export function registerObservabilityRoutes(app: Express): void {

  /**
   * GET /api/api-runs/:runId/observability
   * Returns full ObservabilitySummary: run metadata + replay stats + timeline + snapshot summary.
   */
  app.get('/api/api-runs/:runId/observability', requireAuth, async (req: Request, res: Response) => {
    const summary = await getObservabilitySummary(req.params.runId);
    if (!summary) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
    return void res.json(summary);
  });

  /**
   * GET /api/api-runs/:runId/replay-events
   * Returns the ReplaySession for a run.
   * Synthesizes and caches on first request — subsequent requests are read-only disk loads.
   */
  app.get('/api/api-runs/:runId/replay-events', requireAuth, async (req: Request, res: Response) => {
    const runId = req.params.runId;

    if (replaySessionExists(runId)) {
      const cached = loadReplaySession(runId);
      if (cached) return void res.json(cached);
    }

    const run = loadRunResult(runId);
    if (!run) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });

    const snapshot = loadSnapshot(runId);
    const session = synthesizeReplaySession(run, snapshot);
    await saveReplaySession(session);
    return void res.json(session);
  });

  /**
   * GET /api/api-runs/:runId/timeline
   * Returns the ExecutionTimeline for a run.
   * Timeline is built by the execution engine and saved to data/api-timelines/.
   */
  app.get('/api/api-runs/:runId/timeline', requireAuth, async (req: Request, res: Response) => {
    const timeline = await loadTimeline(req.params.runId);
    if (!timeline) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Timeline not found for this run' } });
    return void res.json(timeline);
  });
}
