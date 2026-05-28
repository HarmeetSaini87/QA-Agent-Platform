import { Router, type Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { globalExecutionKnowledgeGraphRegistry } from '../execution-knowledge-graph-registry';
import { globalSemanticReplayIntelligenceEngine } from '../semantic-replay-intelligence-engine';
import { globalContextualOperationalReasoningEngine } from '../contextual-operational-reasoning-engine';
import { globalFederatedSemanticMemoryFabric } from '../federated-semantic-memory-fabric';
import { globalSemanticGraphOverlayBuilder } from '../semantic-graph-overlay-builder';
import type { KnowledgeNodeType, KnowledgeRelationType } from '../contracts/execution-knowledge-graph.contracts';
import type { SemanticReplayCategory } from '../contracts/semantic-replay-intelligence.contracts';
import type { ReasoningContextDimension } from '../contracts/contextual-operational-reasoning.contracts';

export function registerSemknowRoutes(app: Express): void {
  const router = Router();

  // --- Execution Knowledge Graph ---
  router.post('/knowledge-graph/nodes', requireAuth, (req, res) => {
    const node = globalExecutionKnowledgeGraphRegistry.addNode(req.body);
    res.json(node);
  });

  router.get('/knowledge-graph/:collectionId/nodes', requireAuth, (req, res) => {
    const { nodeType } = req.query;
    res.json(globalExecutionKnowledgeGraphRegistry.listNodes(
      req.params.collectionId, nodeType as KnowledgeNodeType | undefined,
    ));
  });

  router.post('/knowledge-graph/edges', requireAuth, (req, res) => {
    const edge = globalExecutionKnowledgeGraphRegistry.addEdge(req.body);
    res.json(edge);
  });

  router.get('/knowledge-graph/:collectionId/edges', requireAuth, (req, res) => {
    const { relationType } = req.query;
    res.json(globalExecutionKnowledgeGraphRegistry.listEdges(
      req.params.collectionId, relationType as KnowledgeRelationType | undefined,
    ));
  });

  router.get('/knowledge-graph/:collectionId/snapshot', requireAuth, (req, res) => {
    res.json(globalExecutionKnowledgeGraphRegistry.snapshot(req.params.collectionId));
  });

  // --- Semantic Replay Intelligence ---
  router.post('/semantic-replay/:collectionId/correlate', requireAuth, (req, res) => {
    const { runId, categories } = req.body as { runId: string; categories: SemanticReplayCategory[] };
    res.json(globalSemanticReplayIntelligenceEngine.correlateSemantics(
      req.params.collectionId, runId, categories ?? [],
    ));
  });

  router.post('/semantic-replay/:collectionId/infer-intent', requireAuth, (req, res) => {
    const { signals } = req.body as { signals?: string[] };
    res.json(globalSemanticReplayIntelligenceEngine.inferOrchestrationIntent(
      req.params.collectionId, signals ?? [],
    ));
  });

  router.post('/semantic-replay/:collectionId/categorize-retries', requireAuth, (req, res) => {
    const { retrySignals } = req.body as { retrySignals?: string[] };
    res.json(globalSemanticReplayIntelligenceEngine.categorizeRetrySemantics(
      req.params.collectionId, retrySignals ?? [],
    ));
  });

  router.post('/semantic-replay/:collectionId/sla-semantics', requireAuth, (req, res) => {
    const { currentScore } = req.body as { currentScore: number };
    res.json(globalSemanticReplayIntelligenceEngine.analyzeSlaSemantics(
      req.params.collectionId, currentScore ?? 70,
    ));
  });

  // --- Contextual Operational Reasoning ---
  router.post('/reasoning/:collectionId/trail', requireAuth, (req, res) => {
    const { dimensions } = req.body as { dimensions: ReasoningContextDimension[] };
    res.json(globalContextualOperationalReasoningEngine.buildReasoningTrail(
      req.params.collectionId, dimensions ?? [],
    ));
  });

  router.post('/reasoning/:collectionId/anomaly-semantics', requireAuth, (req, res) => {
    const { anomalyType, signals } = req.body as { anomalyType: string; signals?: string[] };
    res.json(globalContextualOperationalReasoningEngine.analyzeAnomalySemantics(
      req.params.collectionId, anomalyType, signals ?? [],
    ));
  });

  router.post('/reasoning/:collectionId/optimization-semantics', requireAuth, (req, res) => {
    const { context } = req.body as { context: string };
    res.json(globalContextualOperationalReasoningEngine.deriveOptimizationSemantics(
      req.params.collectionId, context ?? '',
    ));
  });

  // --- Federated Semantic Memory ---
  router.post('/semantic-memory/records', requireAuth, (req, res) => {
    globalFederatedSemanticMemoryFabric.addRecord(req.body);
    res.json({ ok: true });
  });

  router.get('/semantic-memory/:orgId/index', requireAuth, (req, res) => {
    const { collectionId } = req.query;
    res.json(globalFederatedSemanticMemoryFabric.buildIndex(
      req.params.orgId, collectionId as string | undefined,
    ));
  });

  router.post('/semantic-memory/evict', requireAuth, (_req, res) => {
    const count = globalFederatedSemanticMemoryFabric.evictExpired();
    res.json({ evicted: count });
  });

  router.post('/semantic-memory/anti-patterns', requireAuth, (req, res) => {
    globalFederatedSemanticMemoryFabric.addAntiPatternSemantics(req.body);
    res.json({ ok: true });
  });

  router.get('/semantic-memory/anti-patterns', requireAuth, (_req, res) => {
    res.json(globalFederatedSemanticMemoryFabric.listAntiPatternSemantics());
  });

  router.post('/semantic-memory/retention-policy', requireAuth, (req, res) => {
    globalFederatedSemanticMemoryFabric.registerRetentionPolicy(req.body);
    res.json({ ok: true });
  });

  // --- Semantic Graph Overlay ---
  router.post('/graph-overlay/:collectionId', requireAuth, (req, res) => {
    const overlay = globalSemanticGraphOverlayBuilder.build(req.params.collectionId, req.body);
    res.json(overlay);
  });

  app.use('/api/semknow', router);
}
