// src/api-autonomous/routes/autonomous.routes.ts
// Phase E Step 11: Autonomous operations REST endpoints. Advisory + approval-gated only.

import { Application, Request, Response } from 'express';
import { globalAutonomyGovernanceRegistry } from '../autonomous-governance-registry';
import { globalControlledRemediationExecutor } from '../controlled-remediation-executor';
import { globalAdaptiveRetryIntelligence } from '../adaptive-retry-intelligence';
import { globalReplayAutonomousIntelligenceEngine } from '../replay-autonomous-intelligence-engine';
import { globalAutonomousGraphOverlayBuilder } from '../autonomous-graph-overlay-builder';
import { AutonomyActionCategory } from '../contracts/autonomous-governance.contracts';
import { RemediationExecutionStatus } from '../contracts/controlled-remediation.contracts';

export function registerAutonomousRoutes(app: Application): void {

  // ── Governance ──────────────────────────────────────────────────────────────

  app.get('/api/autonomous/governance/policy', (_req: Request, res: Response) => {
    res.json(globalAutonomyGovernanceRegistry.getEffectivePolicy());
  });

  app.post('/api/autonomous/governance/policy', (req: Request, res: Response) => {
    try {
      globalAutonomyGovernanceRegistry.registerPolicy(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/governance/check-permission', (req: Request, res: Response) => {
    try {
      const { actionCategory, confidence, actorRole, tenantId } = req.body as {
        actionCategory: AutonomyActionCategory;
        confidence: number;
        actorRole: string;
        tenantId?: string;
      };
      if (!actionCategory || confidence === undefined || !actorRole) {
        res.status(400).json({ error: 'actionCategory, confidence, actorRole required' });
        return;
      }
      const result = globalAutonomyGovernanceRegistry.checkPermission(
        actionCategory, confidence, actorRole, tenantId
      );
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/governance/tenant-control', (req: Request, res: Response) => {
    try {
      globalAutonomyGovernanceRegistry.registerTenantControl(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  // ── Controlled Remediation ──────────────────────────────────────────────────

  app.post('/api/autonomous/remediation/:collectionId/plans', (req: Request, res: Response) => {
    try {
      const { actionCategory, proposedChanges, actorId, confidence, replayRunId } = req.body as {
        actionCategory: AutonomyActionCategory;
        proposedChanges: RemediationExecutionStatus[];
        actorId: string;
        confidence: number;
        replayRunId?: string;
      };
      if (!actionCategory || !proposedChanges || !actorId || confidence === undefined) {
        res.status(400).json({ error: 'actionCategory, proposedChanges, actorId, confidence required' });
        return;
      }
      const plan = globalControlledRemediationExecutor.createPlan(
        req.params.collectionId,
        actionCategory,
        proposedChanges as never,
        actorId,
        confidence,
        replayRunId
      );
      res.status(201).json(plan);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/autonomous/remediation/:collectionId/plans', (req: Request, res: Response) => {
    const status = req.query.status as RemediationExecutionStatus | undefined;
    res.json(globalControlledRemediationExecutor.listPlans(req.params.collectionId, status));
  });

  app.post('/api/autonomous/remediation/plans/:planId/approve', (req: Request, res: Response) => {
    try {
      const { approverRole } = req.body as { approverRole: string };
      if (!approverRole) {
        res.status(400).json({ error: 'approverRole required' });
        return;
      }
      const plan = globalControlledRemediationExecutor.approvePlan(req.params.planId, approverRole);
      res.json(plan);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/remediation/plans/:planId/execute', (req: Request, res: Response) => {
    try {
      const result = globalControlledRemediationExecutor.executeApproved(req.params.planId);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/remediation/plans/:planId/rollback', (req: Request, res: Response) => {
    try {
      const result = globalControlledRemediationExecutor.rollback(req.params.planId);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/remediation/:collectionId/effectiveness', (req: Request, res: Response) => {
    try {
      globalControlledRemediationExecutor.recordEffectiveness(req.body);
      res.status(201).json({ recorded: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/autonomous/remediation/:collectionId/effectiveness', (req: Request, res: Response) => {
    res.json(globalControlledRemediationExecutor.listEffectiveness(req.params.collectionId));
  });

  // ── Adaptive Retry ──────────────────────────────────────────────────────────

  app.post('/api/autonomous/retry/:collectionId/recommendations', (req: Request, res: Response) => {
    try {
      const { stepRetryStats } = req.body as {
        stepRetryStats: { stepId: string; retryCount: number; avgDurationMs: number }[];
      };
      if (!Array.isArray(stepRetryStats)) {
        res.status(400).json({ error: 'stepRetryStats array required' });
        return;
      }
      const recommendations = globalAdaptiveRetryIntelligence.recommendRetryAdaptations(
        req.params.collectionId, stepRetryStats
      );
      res.json(recommendations);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/retry/:collectionId/storm-containment', (req: Request, res: Response) => {
    try {
      const { retryRateByStep } = req.body as { retryRateByStep: Record<string, number> };
      if (!retryRateByStep || typeof retryRateByStep !== 'object') {
        res.status(400).json({ error: 'retryRateByStep object required' });
        return;
      }
      const advice = globalAdaptiveRetryIntelligence.adviseStormContainment(
        req.params.collectionId, retryRateByStep
      );
      res.json(advice);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/retry/:collectionId/sla-governance', (req: Request, res: Response) => {
    try {
      const { slaMetric, slaThreshold, currentRetryBudgetMs } = req.body as {
        slaMetric: string; slaThreshold: number; currentRetryBudgetMs: number;
      };
      if (!slaMetric || slaThreshold === undefined || currentRetryBudgetMs === undefined) {
        res.status(400).json({ error: 'slaMetric, slaThreshold, currentRetryBudgetMs required' });
        return;
      }
      const governance = globalAdaptiveRetryIntelligence.governSlaRetries(
        req.params.collectionId, slaMetric, slaThreshold, currentRetryBudgetMs
      );
      res.json(governance);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Replay Autonomous Intelligence ─────────────────────────────────────────

  app.post('/api/autonomous/replay/:runId/correlate', (req: Request, res: Response) => {
    try {
      const { collectionId, linkedPlanId } = req.body as { collectionId: string; linkedPlanId?: string };
      if (!collectionId) {
        res.status(400).json({ error: 'collectionId required' });
        return;
      }
      const correlation = globalReplayAutonomousIntelligenceEngine.correlateReplayWithRemediation(
        req.params.runId, collectionId, linkedPlanId
      );
      res.json(correlation);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/replay/:collectionId/stabilization', (req: Request, res: Response) => {
    try {
      const { recentRunIds } = req.body as { recentRunIds?: string[] };
      const insight = globalReplayAutonomousIntelligenceEngine.computeStabilizationInsight(
        req.params.collectionId, recentRunIds ?? []
      );
      res.json(insight);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/autonomous/replay/:collectionId/failure-prevention', (req: Request, res: Response) => {
    try {
      const { stepIds } = req.body as { stepIds?: string[] };
      const insights = globalReplayAutonomousIntelligenceEngine.generateFailurePreventionInsights(
        req.params.collectionId, stepIds ?? []
      );
      res.json(insights);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Autonomous Graph Overlay ────────────────────────────────────────────────

  app.post('/api/autonomous/graph-overlay/:collectionId', (req: Request, res: Response) => {
    try {
      const overlay = globalAutonomousGraphOverlayBuilder.build(
        req.params.collectionId, req.body ?? {}
      );
      res.json(overlay);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}
