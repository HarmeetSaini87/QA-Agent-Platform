import { Router, type Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { globalOperationalIntelligenceGovernanceRegistry } from '../operational-intelligence-governance-registry';
import { globalReplayOperationalMemoryFabric } from '../replay-operational-memory-fabric';
import { globalGovernedAdaptiveFederationEngine } from '../governed-adaptive-federation-engine';
import { globalFederatedReliabilityIntelligenceHub } from '../federated-reliability-intelligence-hub';
import { globalOperationalFederationGraphOverlayBuilder } from '../operational-graph-federation-overlay-builder';
import type { OperationalIntelligenceScope } from '../contracts/operational-intelligence-governance.contracts';
import type { FederationOptimizationDomain, FederationProposalStatus } from '../contracts/governed-adaptive-federation.contracts';
import type { ReliabilityIntelligenceCategory } from '../contracts/federated-reliability-intelligence.contracts';

export function registerOpfabricRoutes(app: Express): void {
  const router = Router();

  // --- Operational Intelligence Governance ---
  router.post('/governance/propagations', requireAuth, (req, res) => {
    const prop = globalOperationalIntelligenceGovernanceRegistry.publishPropagation(req.body);
    res.json(prop);
  });

  router.get('/governance/propagations/:orgId', requireAuth, (req, res) => {
    const { scope } = req.query;
    res.json(globalOperationalIntelligenceGovernanceRegistry.listPropagations(
      req.params.orgId, scope as OperationalIntelligenceScope | undefined,
    ));
  });

  router.post('/governance/decisions', requireAuth, (req, res) => {
    const decision = globalOperationalIntelligenceGovernanceRegistry.recordDecision(req.body);
    res.json(decision);
  });

  router.post('/governance/decisions/:decisionId/approve', requireAuth, (req, res) => {
    try {
      const { approvedBy } = req.body as { approvedBy: string };
      res.json(globalOperationalIntelligenceGovernanceRegistry.approveDecision(req.params.decisionId, approvedBy));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post('/governance/decisions/:decisionId/reject', requireAuth, (req, res) => {
    try {
      res.json(globalOperationalIntelligenceGovernanceRegistry.rejectDecision(req.params.decisionId));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/governance/summary/:orgId', requireAuth, (req, res) => {
    res.json(globalOperationalIntelligenceGovernanceRegistry.summarize(req.params.orgId));
  });

  router.get('/governance/policy', requireAuth, (req, res) => {
    const { orgId } = req.query;
    res.json(globalOperationalIntelligenceGovernanceRegistry.getPolicy(orgId as string | undefined));
  });

  router.post('/governance/policy', requireAuth, (req, res) => {
    globalOperationalIntelligenceGovernanceRegistry.registerPolicy(req.body);
    res.json({ ok: true });
  });

  // --- Replay Operational Memory Fabric ---
  router.post('/memory/entries', requireAuth, (req, res) => {
    globalReplayOperationalMemoryFabric.addEntry(req.body);
    res.json({ ok: true });
  });

  router.get('/memory/:orgId/index', requireAuth, (req, res) => {
    const { collectionId } = req.query;
    res.json(globalReplayOperationalMemoryFabric.buildIndex(req.params.orgId, collectionId as string | undefined));
  });

  router.post('/memory/remediation', requireAuth, (req, res) => {
    globalReplayOperationalMemoryFabric.addRemediationMemory(req.body);
    res.json({ ok: true });
  });

  router.get('/memory/remediation/:collectionId', requireAuth, (req, res) => {
    res.json(globalReplayOperationalMemoryFabric.listRemediationMemory(req.params.collectionId));
  });

  router.post('/memory/retry-stabilization', requireAuth, (req, res) => {
    globalReplayOperationalMemoryFabric.addRetryStabilizationRecord(req.body);
    res.json({ ok: true });
  });

  router.post('/memory/evict', requireAuth, (_req, res) => {
    const count = globalReplayOperationalMemoryFabric.evictExpired();
    res.json({ evicted: count });
  });

  // --- Governed Adaptive Federation ---
  router.post('/federation/:collectionId/proposals', requireAuth, (req, res) => {
    const { domain, currentState, proposedState, expectedImprovement, confidenceScore, reasoning, requestedBy } =
      req.body as {
        domain: FederationOptimizationDomain; currentState: string; proposedState: string;
        expectedImprovement: string; confidenceScore: number; reasoning: string; requestedBy: string;
      };
    const proposal = globalGovernedAdaptiveFederationEngine.propose(
      req.params.collectionId, domain, currentState, proposedState,
      expectedImprovement, confidenceScore, reasoning, requestedBy,
    );
    res.json(proposal);
  });

  router.get('/federation/:collectionId/proposals', requireAuth, (req, res) => {
    const { status } = req.query;
    res.json(globalGovernedAdaptiveFederationEngine.listProposals(
      req.params.collectionId, status as FederationProposalStatus | undefined,
    ));
  });

  router.post('/federation/proposals/:proposalId/approve', requireAuth, (req, res) => {
    try {
      const { approvedBy } = req.body as { approvedBy: string };
      res.json(globalGovernedAdaptiveFederationEngine.approve(req.params.proposalId, approvedBy));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post('/federation/proposals/:proposalId/reject', requireAuth, (req, res) => {
    try {
      const { reason } = req.body as { reason: string };
      res.json(globalGovernedAdaptiveFederationEngine.reject(req.params.proposalId, reason));
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/federation/:collectionId/stabilization-score', requireAuth, (req, res) => {
    res.json(globalGovernedAdaptiveFederationEngine.scoreStabilization(req.params.collectionId));
  });

  router.get('/federation/policy', requireAuth, (req, res) => {
    const { collectionId } = req.query;
    res.json(globalGovernedAdaptiveFederationEngine.getPolicy(collectionId as string | undefined));
  });

  router.post('/federation/policy', requireAuth, (req, res) => {
    globalGovernedAdaptiveFederationEngine.registerPolicy(req.body);
    res.json({ ok: true });
  });

  // --- Federated Reliability Intelligence ---
  router.post('/reliability-intelligence/records', requireAuth, (req, res) => {
    globalFederatedReliabilityIntelligenceHub.publishRecord(req.body);
    res.json({ ok: true });
  });

  router.get('/reliability-intelligence/:orgId/bundle', requireAuth, (req, res) => {
    const { category } = req.query;
    res.json(globalFederatedReliabilityIntelligenceHub.bundleByCategory(
      req.params.orgId, category as ReliabilityIntelligenceCategory,
    ));
  });

  router.get('/reliability-intelligence/:orgId/index', requireAuth, (req, res) => {
    res.json(globalFederatedReliabilityIntelligenceHub.buildIndex(req.params.orgId));
  });

  router.post('/reliability-intelligence/anti-patterns', requireAuth, (req, res) => {
    globalFederatedReliabilityIntelligenceHub.addAntiPattern(req.body);
    res.json({ ok: true });
  });

  router.get('/reliability-intelligence/anti-patterns', requireAuth, (_req, res) => {
    res.json(globalFederatedReliabilityIntelligenceHub.listAntiPatterns());
  });

  // --- Operational Federation Graph Overlay ---
  router.post('/graph-overlay/:collectionId', requireAuth, (req, res) => {
    const overlay = globalOperationalFederationGraphOverlayBuilder.build(req.params.collectionId, req.body);
    res.json(overlay);
  });

  app.use('/api/opfabric', router);
}
