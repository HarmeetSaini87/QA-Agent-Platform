import { Router, type Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { globalMultiRegionResilienceRegistry } from '../multi-region-resilience-registry';
import { globalDisasterRecoveryOrchestrator } from '../disaster-recovery-orchestrator';
import { globalFailoverIntelligenceEngine } from '../failover-intelligence-engine';
import { globalFederatedContinuityMemoryFabric } from '../federated-continuity-memory-fabric';
import { globalResilienceGraphOverlayBuilder } from '../resilience-graph-overlay-builder';
import type { RegionStatus } from '../contracts/multi-region-resilience.contracts';
import type { RecoveryPlanStatus } from '../contracts/disaster-recovery-orchestration.contracts';
import type { SurvivabilityDimension } from '../contracts/failover-intelligence.contracts';

export function registerResilienceRoutes(app: Express): void {
  const router = Router();

  // --- Multi-Region Resilience ---
  router.post('/regions/nodes', requireAuth, (req, res) => {
    const node = globalMultiRegionResilienceRegistry.registerNode(req.body);
    res.json(node);
  });

  router.get('/regions/nodes/:orgId', requireAuth, (req, res) => {
    const { status } = req.query;
    res.json(globalMultiRegionResilienceRegistry.listNodes(
      req.params.orgId, status as RegionStatus | undefined,
    ));
  });

  router.patch('/regions/nodes/:nodeId/status', requireAuth, (req, res) => {
    try {
      const { status } = req.body as { status: RegionStatus };
      res.json(globalMultiRegionResilienceRegistry.updateNodeStatus(req.params.nodeId, status));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/regions/nodes/:orgId/snapshot', requireAuth, (req, res) => {
    res.json(globalMultiRegionResilienceRegistry.snapshot(req.params.orgId));
  });

  router.post('/regions/failovers', requireAuth, (req, res) => {
    const record = globalMultiRegionResilienceRegistry.recordFailover(req.body);
    res.json(record);
  });

  router.get('/regions/failovers/:orgId', requireAuth, (req, res) => {
    res.json(globalMultiRegionResilienceRegistry.listFailovers(req.params.orgId));
  });

  router.get('/regions/policy', requireAuth, (req, res) => {
    const { orgId } = req.query;
    res.json(globalMultiRegionResilienceRegistry.getPolicy(orgId as string | undefined));
  });

  router.post('/regions/policy', requireAuth, (req, res) => {
    globalMultiRegionResilienceRegistry.registerPolicy(req.body);
    res.json({ ok: true });
  });

  // --- Disaster Recovery Orchestration ---
  router.post('/recovery/plans', requireAuth, (req, res) => {
    const plan = globalDisasterRecoveryOrchestrator.createRecoveryPlan(req.body);
    res.json(plan);
  });

  router.get('/recovery/plans/:orgId', requireAuth, (req, res) => {
    const { status } = req.query;
    res.json(globalDisasterRecoveryOrchestrator.listPlans(
      req.params.orgId, status as RecoveryPlanStatus | undefined,
    ));
  });

  router.post('/recovery/plans/:planId/approve', requireAuth, (req, res) => {
    try {
      const { approvedBy } = req.body as { approvedBy: string };
      res.json(globalDisasterRecoveryOrchestrator.approvePlan(req.params.planId, approvedBy));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post('/recovery/plans/:planId/reject', requireAuth, (req, res) => {
    try {
      const { reason } = req.body as { reason: string };
      res.json(globalDisasterRecoveryOrchestrator.rejectPlan(req.params.planId, reason));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post('/recovery/worker-failover', requireAuth, (req, res) => {
    const { collectionId, failedWorkerId, continuityWorkerId } = req.body as {
      collectionId: string; failedWorkerId: string; continuityWorkerId: string;
    };
    res.json(globalDisasterRecoveryOrchestrator.planWorkerFailover(collectionId, failedWorkerId, continuityWorkerId));
  });

  router.post('/recovery/queue-recovery', requireAuth, (req, res) => {
    const { orgId, queueType } = req.body as { orgId: string; queueType: string };
    res.json(globalDisasterRecoveryOrchestrator.adviseQueueRecovery(orgId, queueType));
  });

  // --- Failover Intelligence ---
  router.post('/intelligence/:collectionId/trail', requireAuth, (req, res) => {
    const { dimensions } = req.body as { dimensions: SurvivabilityDimension[] };
    res.json(globalFailoverIntelligenceEngine.buildIntelligenceTrail(
      req.params.collectionId, dimensions ?? [],
    ));
  });

  router.get('/intelligence/:collectionId/survivability', requireAuth, (req, res) => {
    res.json(globalFailoverIntelligenceEngine.scoreSurvivability(req.params.collectionId));
  });

  router.post('/intelligence/:collectionId/anomaly', requireAuth, (req, res) => {
    const { anomalyType, signals } = req.body as { anomalyType: string; signals?: string[] };
    res.json(globalFailoverIntelligenceEngine.analyzeResilienceAnomaly(
      req.params.collectionId, anomalyType, signals ?? [],
    ));
  });

  // --- Federated Continuity Memory ---
  router.post('/continuity-memory/records', requireAuth, (req, res) => {
    globalFederatedContinuityMemoryFabric.addRecord(req.body);
    res.json({ ok: true });
  });

  router.get('/continuity-memory/:orgId/index', requireAuth, (req, res) => {
    const { collectionId } = req.query;
    res.json(globalFederatedContinuityMemoryFabric.buildIndex(
      req.params.orgId, collectionId as string | undefined,
    ));
  });

  router.post('/continuity-memory/evict', requireAuth, (_req, res) => {
    const count = globalFederatedContinuityMemoryFabric.evictExpired();
    res.json({ evicted: count });
  });

  router.post('/continuity-memory/outage-patterns', requireAuth, (req, res) => {
    globalFederatedContinuityMemoryFabric.addOutagePattern(req.body);
    res.json({ ok: true });
  });

  router.get('/continuity-memory/outage-patterns', requireAuth, (_req, res) => {
    res.json(globalFederatedContinuityMemoryFabric.listOutagePatterns());
  });

  router.post('/continuity-memory/retention-policy', requireAuth, (req, res) => {
    globalFederatedContinuityMemoryFabric.registerRetentionPolicy(req.body);
    res.json({ ok: true });
  });

  // --- Resilience Graph Overlay ---
  router.post('/graph-overlay/:collectionId', requireAuth, (req, res) => {
    const overlay = globalResilienceGraphOverlayBuilder.build(req.params.collectionId, req.body);
    res.json(overlay);
  });

  app.use('/api/resilience', router);
}
