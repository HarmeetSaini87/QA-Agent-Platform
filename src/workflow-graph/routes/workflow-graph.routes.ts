// src/workflow-graph/routes/workflow-graph.routes.ts
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { getProjection } from '../service/projection-service';
import { loadRunResult } from '../../api-runtime/artifact-engine/run-store';
import { loadExecutionSnapshot } from '../../api-runtime/artifact-engine/execution-store';
import type { RunGraphNodeResult, RunGraphProjection } from '../../data/types';

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

  /**
   * GET /api/api-runs/:runId/graph
   * Returns a RunGraphProjection: GraphProjection + per-node execution results.
   * Merges ApiCollectionRunResult (step statuses) with ExecutionSnapshot (retry history,
   * timing, node records). ExecutionSnapshot is optional — degrades gracefully.
   */
  app.get('/api/api-runs/:runId/graph', requireAuth, async (req: Request, res: Response) => {
    const { runId } = req.params;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    // Load run result
    const runResult = await loadRunResult(runId);
    if (!runResult) {
      return res.status(404).json({ error: 'RUN_NOT_FOUND', message: `Run ${runId} not found` });
    }

    // Load graph projection for the collection
    const projResult = getProjection(runResult.collectionId);
    if (!projResult.ok) {
      return res.status(projResult.status).json({ error: projResult.code, message: projResult.message });
    }

    // Optionally load ExecutionSnapshot for retry/timing data (best-effort)
    const snapshot = await loadExecutionSnapshot(runId).catch(() => undefined);

    // Build nodeResults map keyed by stepId
    const nodeResults: Record<string, RunGraphNodeResult> = {};

    // Start from ApiStepResult (always available)
    for (const sr of runResult.stepResults) {
      nodeResults[sr.stepId] = {
        stepId: sr.stepId,
        stepName: sr.stepName,
        status: sr.status,
        durationMs: sr.durationMs ?? null,
        retryCount: 0,
        retryHistory: [],
        error: sr.error,
        contractViolations: sr.contractViolations,
        assertionFailures: sr.assertionResults
          .filter(a => !a.passed)
          .map(a => a.message ?? `${a.field} ${a.operator} ${a.expected}`),
        isTeardown: sr.isTeardown ?? false,
      };
    }

    // Enrich with ExecutionSnapshot NodeExecutionRecord (retry history, timing)
    if (snapshot?.nodeRecords) {
      for (const [nodeId, rec] of Object.entries(snapshot.nodeRecords)) {
        const existing = nodeResults[nodeId];
        const retryHistory = (rec.retryHistory ?? []).map(rh => ({
          attempt: rh.attempt,
          startedAt: rh.startedAt,
          completedAt: rh.completedAt,
          durationMs: rh.durationMs,
          httpStatus: rh.httpStatus,
          error: rh.error,
          resultStatus: rh.resultStatus,
          retriedAfter: rh.retriedAfter,
        }));

        if (existing) {
          existing.retryCount = retryHistory.length > 0 ? retryHistory.length - 1 : 0;
          existing.retryHistory = retryHistory;
          existing.startedAt = rec.startedAt;
          existing.completedAt = rec.completedAt;
          if (!existing.durationMs && rec.durationMs) existing.durationMs = rec.durationMs;
        } else {
          // Node in snapshot but not in stepResults (e.g. blocked/skipped before execution)
          const snapshotStatus = rec.status as RunGraphNodeResult['status'];
          nodeResults[nodeId] = {
            stepId: nodeId,
            stepName: rec.nodeName,
            status: snapshotStatus,
            durationMs: rec.durationMs ?? null,
            retryCount: retryHistory.length > 0 ? retryHistory.length - 1 : 0,
            retryHistory,
            startedAt: rec.startedAt,
            completedAt: rec.completedAt,
            error: rec.error,
            isTeardown: false,
          };
        }
      }
    }

    const response: RunGraphProjection = {
      runId,
      collectionId: runResult.collectionId,
      runStatus: runResult.status,
      startedAt: runResult.startedAt,
      completedAt: runResult.completedAt,
      graph: projResult.projection,
      nodeResults,
    };

    return res.json(response);
  });
}
