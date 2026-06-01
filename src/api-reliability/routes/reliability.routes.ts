import { Router, type Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { globalReliabilityFabricRegistry } from '../reliability-fabric-registry';
import { globalReplayExplainabilityEngine } from '../replay-explainability-engine';
import { globalGovernedReliabilityOptimizationEngine } from '../governed-reliability-optimization-engine';
import { globalFederatedReliabilityMemory } from '../federated-reliability-memory';
import { globalReliabilityGraphOverlayBuilder } from '../reliability-graph-overlay-builder';
import type { ExplainabilityDimension } from '../contracts/replay-explainability.contracts';
import type { StabilizationDomain, ReliabilityOptimizationStatus } from '../contracts/governed-reliability-optimization.contracts';

export function registerReliabilityRoutes(app: Express): void {
  const router = Router();

  // --- Reliability Fabric ---
  router.post('/fabric/nodes', requireAuth, (req, res) => {
    try {
      const node = globalReliabilityFabricRegistry.registerNode(req.body);
      res.json(node);
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/fabric/nodes/:orgId', requireAuth, (req, res) => {
    const { collectionId } = req.query;
    res.json(globalReliabilityFabricRegistry.listNodes(req.params.orgId, collectionId as string | undefined));
  });

  router.get('/fabric/nodes/:orgId/snapshot', requireAuth, (req, res) => {
    res.json(globalReliabilityFabricRegistry.snapshot(req.params.orgId));
  });

  router.post('/fabric/governance', requireAuth, (req, res) => {
    const record = globalReliabilityFabricRegistry.recordGovernance(req.body);
    res.json(record);
  });

  // --- Replay Explainability ---
  router.post('/explainability/:collectionId/trail', requireAuth, (req, res) => {
    const { runId, dimensions } = req.body as { runId: string; dimensions: ExplainabilityDimension[] };
    const trail = globalReplayExplainabilityEngine.buildTrail(
      req.params.collectionId, runId, dimensions ?? [],
    );
    res.json(trail);
  });

  router.post('/explainability/:collectionId/retry-evolution', requireAuth, (req, res) => {
    const { signals } = req.body as { signals?: string[] };
    res.json(globalReplayExplainabilityEngine.explainRetryEvolution(req.params.collectionId, signals ?? []));
  });

  router.post('/explainability/:collectionId/dependency-stabilization', requireAuth, (req, res) => {
    const { dependencyId, signals } = req.body as { dependencyId: string; signals?: string[] };
    res.json(globalReplayExplainabilityEngine.explainDependencyStabilization(
      req.params.collectionId, dependencyId, signals ?? [],
    ));
  });

  router.post('/explainability/:collectionId/sla-optimization', requireAuth, (req, res) => {
    const { currentScore } = req.body as { currentScore: number };
    res.json(globalReplayExplainabilityEngine.explainSlaOptimization(req.params.collectionId, currentScore ?? 70));
  });

  // --- Governed Reliability Optimization ---
  router.post('/optimization/:collectionId/proposals', requireAuth, (req, res) => {
    const { domain, currentState, proposedState, expectedImprovement, confidenceScore, reasoning, requestedBy } =
      req.body as {
        domain: StabilizationDomain; currentState: string; proposedState: string;
        expectedImprovement: string; confidenceScore: number; reasoning: string; requestedBy: string;
      };
    const proposal = globalGovernedReliabilityOptimizationEngine.propose(
      req.params.collectionId, domain, currentState, proposedState,
      expectedImprovement, confidenceScore, reasoning, requestedBy,
    );
    res.json(proposal);
  });

  router.get('/optimization/:collectionId/proposals', requireAuth, (req, res) => {
    const { status } = req.query;
    res.json(globalGovernedReliabilityOptimizationEngine.listProposals(
      req.params.collectionId, status as ReliabilityOptimizationStatus | undefined,
    ));
  });

  router.post('/optimization/proposals/:proposalId/approve', requireAuth, (req, res) => {
    try {
      const { approvedBy } = req.body as { approvedBy: string };
      res.json(globalGovernedReliabilityOptimizationEngine.approve(req.params.proposalId, approvedBy));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post('/optimization/proposals/:proposalId/reject', requireAuth, (req, res) => {
    try {
      const { reason } = req.body as { reason: string };
      res.json(globalGovernedReliabilityOptimizationEngine.reject(req.params.proposalId, reason));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/optimization/:collectionId/resilience-score', requireAuth, (req, res) => {
    res.json(globalGovernedReliabilityOptimizationEngine.scoreResilience(req.params.collectionId));
  });

  router.get('/optimization/policy', requireAuth, (req, res) => {
    const { collectionId } = req.query;
    res.json(globalGovernedReliabilityOptimizationEngine.getPolicy(collectionId as string | undefined));
  });

  router.post('/optimization/policy', requireAuth, (req, res) => {
    globalGovernedReliabilityOptimizationEngine.registerPolicy(req.body);
    res.json({ ok: true });
  });

  // --- Federated Reliability Memory ---
  router.post('/memory/records', requireAuth, (req, res) => {
    globalFederatedReliabilityMemory.addMemoryRecord(req.body);
    res.json({ ok: true });
  });

  router.get('/memory/:orgId/index', requireAuth, (req, res) => {
    const { collectionId } = req.query;
    res.json(globalFederatedReliabilityMemory.buildIndex(req.params.orgId, collectionId as string | undefined));
  });

  router.post('/memory/evict', requireAuth, (req, res) => {
    const count = globalFederatedReliabilityMemory.evictExpired();
    res.json({ evicted: count });
  });

  router.post('/memory/anti-patterns', requireAuth, (req, res) => {
    globalFederatedReliabilityMemory.addAntiPattern(req.body);
    res.json({ ok: true });
  });

  router.get('/memory/anti-patterns', requireAuth, (_req, res) => {
    res.json(globalFederatedReliabilityMemory.listAntiPatterns());
  });

  router.post('/memory/retention-policy', requireAuth, (req, res) => {
    globalFederatedReliabilityMemory.registerRetentionPolicy(req.body);
    res.json({ ok: true });
  });

  // --- Reliability Graph Overlay ---
  router.post('/graph-overlay/:collectionId', requireAuth, (req, res) => {
    const overlay = globalReliabilityGraphOverlayBuilder.build(req.params.collectionId, req.body);
    res.json(overlay);
  });

  app.use('/api/reliability', router);
}
