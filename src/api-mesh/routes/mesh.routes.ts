// src/api-mesh/routes/mesh.routes.ts
// Phase E Step 13: Adaptive QA mesh REST endpoints. Advisory intelligence — no runtime mutation.

import { Application, Request, Response } from 'express';
import { globalMeshIntelligenceRegistry, MeshIntelligenceRegistry } from '../mesh-intelligence-registry';
import { globalReplayKnowledgeFabric } from '../replay-knowledge-fabric';
import { globalAdaptiveReliabilityIntelligence } from '../adaptive-reliability-intelligence';
import { globalFederatedOperationalMemory } from '../federated-operational-memory';
import { globalAdaptiveMeshGraphOverlayBuilder } from '../adaptive-graph-overlay-builder';
import { MeshIntelligenceScope, OrchestrationSignalType } from '../contracts/mesh-intelligence.contracts';
import { KnowledgeMemoryType } from '../contracts/replay-knowledge-fabric.contracts';
import { ReliabilityDimension } from '../contracts/adaptive-reliability.contracts';
import { AntiPatternSeverity } from '../contracts/federated-operational-memory.contracts';

export function registerMeshRoutes(app: Application): void {

  // ── Mesh Intelligence ───────────────────────────────────────────────────────

  app.post('/api/mesh/nodes', (req: Request, res: Response) => {
    try {
      globalMeshIntelligenceRegistry.registerNode(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/mesh/nodes', (req: Request, res: Response) => {
    const orgId = req.query.orgId as string | undefined;
    const scope = req.query.scope as MeshIntelligenceScope | undefined;
    res.json(globalMeshIntelligenceRegistry.listNodes(orgId, scope));
  });

  app.post('/api/mesh/propagations', (req: Request, res: Response) => {
    try {
      const { signalType, sourceNodeId, targetScope, payload, confidence } = req.body as {
        signalType: OrchestrationSignalType;
        sourceNodeId: string;
        targetScope: MeshIntelligenceScope;
        payload?: Record<string, unknown>;
        confidence: number;
      };
      if (!signalType || !sourceNodeId || !targetScope || confidence === undefined) {
        res.status(400).json({ error: 'signalType, sourceNodeId, targetScope, confidence required' });
        return;
      }
      const propagation = MeshIntelligenceRegistry.makePropagation(
        signalType, sourceNodeId, targetScope, payload ?? {}, confidence
      );
      globalMeshIntelligenceRegistry.publishPropagation(propagation);
      res.status(201).json(propagation);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/mesh/propagations', (req: Request, res: Response) => {
    const signalType = req.query.signalType as OrchestrationSignalType | undefined;
    res.json(globalMeshIntelligenceRegistry.listPropagations(signalType));
  });

  app.get('/api/mesh/summary/:orgId', (req: Request, res: Response) => {
    res.json(globalMeshIntelligenceRegistry.summarize(req.params.orgId));
  });

  // ── Replay Knowledge Fabric ─────────────────────────────────────────────────

  app.post('/api/mesh/knowledge/entries', (req: Request, res: Response) => {
    try {
      globalReplayKnowledgeFabric.addEntry(req.body);
      res.status(201).json({ added: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/mesh/knowledge/:collectionId/entries', (req: Request, res: Response) => {
    const memoryType = req.query.memoryType as KnowledgeMemoryType | undefined;
    res.json(globalReplayKnowledgeFabric.listEntries(req.params.collectionId, memoryType));
  });

  app.get('/api/mesh/knowledge/:collectionId/index', (req: Request, res: Response) => {
    res.json(globalReplayKnowledgeFabric.buildIndex(req.params.collectionId));
  });

  app.post('/api/mesh/knowledge/:collectionId/optimization-memory', (req: Request, res: Response) => {
    try {
      globalReplayKnowledgeFabric.recordOptimizationMemory(req.body);
      res.status(201).json({ recorded: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/mesh/knowledge/:collectionId/optimization-memory', (req: Request, res: Response) => {
    res.json(globalReplayKnowledgeFabric.listOptimizationMemory(req.params.collectionId));
  });

  // ── Adaptive Reliability ────────────────────────────────────────────────────

  app.post('/api/mesh/reliability/:collectionId/score', (req: Request, res: Response) => {
    try {
      const { inputs } = req.body as { inputs?: Partial<Record<ReliabilityDimension, number>> };
      const score = globalAdaptiveReliabilityIntelligence.scoreReliability(
        req.params.collectionId, inputs ?? {}
      );
      res.json(score);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/mesh/reliability/:collectionId/forecast', (req: Request, res: Response) => {
    try {
      const { inputs, forecastWindowHours } = req.body as {
        inputs?: Partial<Record<ReliabilityDimension, number>>;
        forecastWindowHours?: number;
      };
      const score = globalAdaptiveReliabilityIntelligence.scoreReliability(
        req.params.collectionId, inputs ?? {}
      );
      const forecast = globalAdaptiveReliabilityIntelligence.forecastReliability(
        req.params.collectionId, score, forecastWindowHours ?? 24
      );
      res.json(forecast);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/mesh/reliability/:collectionId/sla-alignment', (req: Request, res: Response) => {
    try {
      const { slaMetric, currentScore, slaTarget } = req.body as {
        slaMetric: string; currentScore: number; slaTarget: number;
      };
      if (!slaMetric || currentScore === undefined || slaTarget === undefined) {
        res.status(400).json({ error: 'slaMetric, currentScore, slaTarget required' });
        return;
      }
      res.json(globalAdaptiveReliabilityIntelligence.assessSlaAlignment(
        req.params.collectionId, slaMetric, currentScore, slaTarget
      ));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Federated Operational Memory ────────────────────────────────────────────

  app.post('/api/mesh/memory/records', (req: Request, res: Response) => {
    try {
      globalFederatedOperationalMemory.addRecord(req.body);
      res.status(201).json({ added: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/mesh/memory/records', (req: Request, res: Response) => {
    const orgId = req.query.orgId as string | undefined;
    res.json(globalFederatedOperationalMemory.listRecords(orgId));
  });

  app.post('/api/mesh/memory/evict', (_req: Request, res: Response) => {
    const evicted = globalFederatedOperationalMemory.evictExpired();
    res.json({ evicted });
  });

  app.post('/api/mesh/memory/anti-patterns', (req: Request, res: Response) => {
    try {
      globalFederatedOperationalMemory.addAntiPattern(req.body);
      res.status(201).json({ added: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/mesh/memory/anti-patterns', (req: Request, res: Response) => {
    const severity = req.query.severity as AntiPatternSeverity | undefined;
    res.json(globalFederatedOperationalMemory.listAntiPatterns(severity));
  });

  app.post('/api/mesh/memory/retention-policy', (req: Request, res: Response) => {
    try {
      globalFederatedOperationalMemory.registerRetentionPolicy(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  // ── Adaptive Graph Overlay ──────────────────────────────────────────────────

  app.post('/api/mesh/graph-overlay/:collectionId', (req: Request, res: Response) => {
    try {
      const overlay = globalAdaptiveMeshGraphOverlayBuilder.build(
        req.params.collectionId, req.body ?? {}
      );
      res.json(overlay);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}
