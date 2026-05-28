// src/api-analytics/routes/analytics.routes.ts
// Phase E Step 7: Enterprise analytics REST endpoints. Observational only.

import type { Express, Request, Response } from 'express';
import { globalExecutionTrendAggregator } from '../execution-trend-aggregator';
import { globalSlaIntelligenceEngine } from '../sla-intelligence-engine';
import { globalRcaAnalyticsEngine } from '../rca-analytics-engine';
import { globalGraphAnalyticsOverlayBuilder } from '../graph-analytics-overlay-builder';
import { globalTenantAnalyticsAggregator } from '../tenant-analytics-aggregator';

export function registerAnalyticsRoutes(app: Express): void {

  // POST /api/analytics/trends/record — ingest a trend sample
  app.post('/api/analytics/trends/record', (req: Request, res: Response) => {
    const sample = req.body;
    if (!sample?.collectionId || !sample?.runId) {
      res.status(400).json({ error: 'collectionId and runId required' });
      return;
    }
    globalExecutionTrendAggregator.record({
      ...sample,
      sampledAt: sample.sampledAt ?? new Date().toISOString(),
    });
    res.status(201).json({ recorded: true });
  });

  // GET /api/analytics/trends/:collectionId — aggregate trend window
  app.get('/api/analytics/trends/:collectionId', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const windowMs = parseInt((req.query['windowMs'] as string) || '0', 10) || undefined;
    const trend = globalExecutionTrendAggregator.aggregate(collectionId, windowMs);
    if (!trend) {
      res.status(404).json({ error: 'No trend data for this collection.' });
      return;
    }
    res.json(trend);
  });

  // POST /api/analytics/sla/evaluate — evaluate SLA scorecard
  app.post('/api/analytics/sla/evaluate', (req: Request, res: Response) => {
    const { collectionId, policyId, metrics } = req.body as {
      collectionId?: string;
      policyId?: string;
      metrics?: { avgLatencyMs: number; retryRate: number; passRate: number; teardownFailureRate: number };
    };

    if (!collectionId || !policyId || !metrics) {
      res.status(400).json({ error: 'collectionId, policyId, metrics required' });
      return;
    }
    res.json(globalSlaIntelligenceEngine.evaluate(collectionId, policyId, metrics));
  });

  // GET /api/analytics/sla/:collectionId/breaches — list SLA breaches
  app.get('/api/analytics/sla/:collectionId/breaches', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    res.json({ collectionId, breaches: globalSlaIntelligenceEngine.listBreaches(collectionId) });
  });

  // POST /api/analytics/rca/failure-trends — compute failure trends from step outcomes
  app.post('/api/analytics/rca/failure-trends', (req: Request, res: Response) => {
    const { collectionId, stepOutcomes } = req.body as {
      collectionId?: string;
      stepOutcomes?: Array<{ stepId: string; stepName: string; failed: boolean; retries: number; timestamp: string }>;
    };
    if (!collectionId || !Array.isArray(stepOutcomes)) {
      res.status(400).json({ error: 'collectionId and stepOutcomes (array) required' });
      return;
    }
    res.json({ collectionId, trends: globalRcaAnalyticsEngine.computeFailureTrends(collectionId, stepOutcomes) });
  });

  // POST /api/analytics/rca/retry-hotspots — identify retry hotspots
  app.post('/api/analytics/rca/retry-hotspots', (req: Request, res: Response) => {
    const { collectionId, stepRetries } = req.body as {
      collectionId?: string;
      stepRetries?: Array<{ stepId: string; retriesInWindow: number; runsInWindow: number }>;
    };
    if (!collectionId || !Array.isArray(stepRetries)) {
      res.status(400).json({ error: 'collectionId and stepRetries (array) required' });
      return;
    }
    res.json({ collectionId, hotspots: globalRcaAnalyticsEngine.identifyRetryHotspots(collectionId, stepRetries) });
  });

  // POST /api/analytics/graph-overlay/:collectionId — build graph analytics overlay
  app.post('/api/analytics/graph-overlay/:collectionId', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const { retryHotspots = [], slaBreaches = [], failureTrends = [] } = req.body ?? {};
    res.json(globalGraphAnalyticsOverlayBuilder.build(collectionId, { retryHotspots, slaBreaches, failureTrends }));
  });

  // GET /api/analytics/tenant/:tenantId — tenant analytics summary
  app.get('/api/analytics/tenant/:tenantId', (req: Request, res: Response) => {
    const { tenantId } = req.params as { tenantId: string };
    const summary = globalTenantAnalyticsAggregator.getTenantSummary(tenantId);
    if (!summary) {
      res.status(404).json({ error: 'No analytics for this tenant.' });
      return;
    }
    res.json(summary);
  });

  // POST /api/analytics/tenant — record tenant analytics summary
  app.post('/api/analytics/tenant', (req: Request, res: Response) => {
    const summary = req.body;
    if (!summary?.tenantId) {
      res.status(400).json({ error: 'tenantId required' });
      return;
    }
    globalTenantAnalyticsAggregator.recordTenantSummary({ ...summary, sampledAt: summary.sampledAt ?? new Date().toISOString() });
    res.status(201).json({ recorded: true, tenantId: summary.tenantId });
  });
}
