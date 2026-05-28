// src/api-copilot/routes/copilot.routes.ts
// Phase E Step 10: AI copilot REST endpoints. Advisory only — zero runtime mutation.

import { Application, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { globalCopilotGuidanceEngine } from '../copilot-guidance-engine';
import { globalPredictiveIntelligenceEngine } from '../predictive-intelligence-engine';
import { globalReplayReasoningEngine } from '../replay-reasoning-engine';
import { globalAiGraphOverlayBuilder } from '../ai-graph-overlay-builder';
import { globalAutonomousPreparationEngine } from '../autonomous-preparation-engine';
import { CopilotQuery } from '../contracts/copilot-guidance.contracts';

export function registerCopilotRoutes(app: Application): void {

  // POST /api/copilot/guide — submit a copilot query, receive advisory guidance
  app.post('/api/copilot/guide', (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<CopilotQuery>;
      if (!body.queryType || !body.collectionId || !body.actorId) {
        res.status(400).json({ error: 'queryType, collectionId, actorId required' });
        return;
      }
      const query: CopilotQuery = {
        queryId: body.queryId ?? randomUUID(),
        queryType: body.queryType,
        collectionId: body.collectionId,
        runId: body.runId,
        actorId: body.actorId,
        tenantId: body.tenantId,
        context: body.context ?? {},
        askedAt: body.askedAt ?? new Date().toISOString(),
      };
      const result = globalCopilotGuidanceEngine.guide(query);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/copilot/history/:collectionId — audit trail of guidance results
  app.get('/api/copilot/history/:collectionId', (req: Request, res: Response) => {
    const history = globalCopilotGuidanceEngine.listHistory(req.params.collectionId);
    res.json(history);
  });

  // POST /api/copilot/predict/flakiness — predictive flakiness forecast
  app.post('/api/copilot/predict/flakiness', (req: Request, res: Response) => {
    try {
      const { collectionId, stepIds } = req.body as { collectionId: string; stepIds?: string[] };
      if (!collectionId) {
        res.status(400).json({ error: 'collectionId required' });
        return;
      }
      const forecasts = globalPredictiveIntelligenceEngine.forecastFlakiness(
        collectionId,
        stepIds ?? []
      );
      res.json({ collectionId, forecasts });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/copilot/predict/retry-storm — retry storm forecast
  app.post('/api/copilot/predict/retry-storm', (req: Request, res: Response) => {
    try {
      const { collectionId } = req.body as { collectionId: string };
      if (!collectionId) {
        res.status(400).json({ error: 'collectionId required' });
        return;
      }
      const forecast = globalPredictiveIntelligenceEngine.forecastRetryStorm(collectionId);
      res.json(forecast);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/copilot/predict/sla-breach — SLA breach forecast
  app.post('/api/copilot/predict/sla-breach', (req: Request, res: Response) => {
    try {
      const { collectionId, slaMetric, currentValue } = req.body as {
        collectionId: string;
        slaMetric: string;
        currentValue: number;
      };
      if (!collectionId || !slaMetric || currentValue === undefined) {
        res.status(400).json({ error: 'collectionId, slaMetric, currentValue required' });
        return;
      }
      const forecast = globalPredictiveIntelligenceEngine.forecastSlaBreach(
        collectionId,
        slaMetric,
        currentValue
      );
      res.json(forecast);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/copilot/replay/:runId/summarize — replay-assisted summary
  app.post('/api/copilot/replay/:runId/summarize', (req: Request, res: Response) => {
    try {
      const { collectionId } = req.body as { collectionId: string };
      if (!collectionId) {
        res.status(400).json({ error: 'collectionId required' });
        return;
      }
      const summary = globalReplayReasoningEngine.summarizeReplay(req.params.runId, collectionId);
      res.json(summary);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/copilot/replay/:runId/rca — RCA evidence correlation
  app.post('/api/copilot/replay/:runId/rca', (req: Request, res: Response) => {
    try {
      const { collectionId, failedStepId } = req.body as {
        collectionId: string;
        failedStepId: string;
      };
      if (!collectionId || !failedStepId) {
        res.status(400).json({ error: 'collectionId, failedStepId required' });
        return;
      }
      const correlation = globalReplayReasoningEngine.correlateRcaEvidence(
        req.params.runId,
        collectionId,
        failedStepId
      );
      res.json(correlation);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/copilot/graph-overlay/:collectionId — AI graph overlay
  app.post('/api/copilot/graph-overlay/:collectionId', (req: Request, res: Response) => {
    try {
      const overlay = globalAiGraphOverlayBuilder.build(req.params.collectionId, req.body ?? {});
      res.json(overlay);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/copilot/autonomous/:collectionId/propose — propose a governed action
  app.post('/api/copilot/autonomous/:collectionId/propose', (req: Request, res: Response) => {
    try {
      const { actionType, actorId, proposedChange, rationale, confidence } = req.body as {
        actionType: string;
        actorId: string;
        proposedChange: Record<string, unknown>;
        rationale: string;
        confidence: number;
      };
      if (!actionType || !actorId || !proposedChange || !rationale || confidence === undefined) {
        res.status(400).json({ error: 'actionType, actorId, proposedChange, rationale, confidence required' });
        return;
      }
      const action = globalAutonomousPreparationEngine.propose(
        req.params.collectionId,
        actionType as never,
        actorId,
        proposedChange,
        rationale,
        confidence
      );
      res.json(action);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/copilot/autonomous/:collectionId/pending — list pending proposals
  app.get('/api/copilot/autonomous/:collectionId/pending', (req: Request, res: Response) => {
    const pending = globalAutonomousPreparationEngine.listPending(req.params.collectionId);
    res.json(pending);
  });
}
