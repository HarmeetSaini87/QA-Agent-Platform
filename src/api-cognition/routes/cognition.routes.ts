// src/api-cognition/routes/cognition.routes.ts
// Phase E Step 14: Operational cognition REST endpoints. Explainable + governed — no runtime mutation.

import { Application, Request, Response } from 'express';
import { globalCognitionLayerRegistry } from '../cognition-layer-registry';
import { globalReplayOperationalReasoningEngine } from '../replay-operational-reasoning-engine';
import { globalGovernedSelfOptimizationEngine } from '../governed-self-optimization-engine';
import { globalFederatedCognitionMemory } from '../federated-cognition-memory';
import { globalCognitiveGraphOverlayBuilder } from '../cognitive-graph-overlay-builder';
import { CognitionMemoryType } from '../contracts/cognition-layer.contracts';
import { ReasoningDimension } from '../contracts/replay-operational-reasoning.contracts';
import { OptimizationApprovalStatus, OptimizationDomain } from '../contracts/governed-self-optimization.contracts';

export function registerCognitionRoutes(app: Application): void {

  // ── Cognition Layer ─────────────────────────────────────────────────────────

  app.post('/api/cognition/records', (req: Request, res: Response) => {
    try {
      globalCognitionLayerRegistry.addRecord(req.body);
      res.status(201).json({ added: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/cognition/:collectionId/records', (req: Request, res: Response) => {
    const memoryType = req.query.memoryType as CognitionMemoryType | undefined;
    res.json(globalCognitionLayerRegistry.listRecords(req.params.collectionId, memoryType));
  });

  app.get('/api/cognition/:collectionId/summary', (req: Request, res: Response) => {
    res.json(globalCognitionLayerRegistry.summarize(req.params.collectionId));
  });

  // ── Replay Operational Reasoning ────────────────────────────────────────────

  app.post('/api/cognition/reasoning/:runId/trail', (req: Request, res: Response) => {
    try {
      const { collectionId, dimensions } = req.body as {
        collectionId: string;
        dimensions?: ReasoningDimension[];
      };
      if (!collectionId) {
        res.status(400).json({ error: 'collectionId required' }); return;
      }
      const trail = globalReplayOperationalReasoningEngine.buildReasoningTrail(
        req.params.runId, collectionId, dimensions ?? []
      );
      res.json(trail);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/cognition/:collectionId/optimization-reasoning', (req: Request, res: Response) => {
    try {
      globalReplayOperationalReasoningEngine.recordOptimizationReasoning(req.body);
      res.status(201).json({ recorded: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/cognition/:collectionId/optimization-reasoning', (req: Request, res: Response) => {
    res.json(globalReplayOperationalReasoningEngine.listOptimizationReasoning(req.params.collectionId));
  });

  // ── Governed Self-Optimization ──────────────────────────────────────────────

  app.post('/api/cognition/:collectionId/proposals', (req: Request, res: Response) => {
    try {
      const { domain, currentState, proposedOptimization, expectedImprovement,
              confidence, reasoning, actorId, evidenceRefs } = req.body as {
        domain: OptimizationDomain; currentState: string; proposedOptimization: string;
        expectedImprovement: string; confidence: number; reasoning: string;
        actorId: string; evidenceRefs?: string[];
      };
      if (!domain || !currentState || !proposedOptimization || !expectedImprovement
          || confidence === undefined || !reasoning || !actorId) {
        res.status(400).json({ error: 'domain, currentState, proposedOptimization, expectedImprovement, confidence, reasoning, actorId required' });
        return;
      }
      const proposal = globalGovernedSelfOptimizationEngine.propose(
        req.params.collectionId, domain, currentState, proposedOptimization,
        expectedImprovement, confidence, reasoning, actorId, evidenceRefs
      );
      res.status(201).json(proposal);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/cognition/:collectionId/proposals', (req: Request, res: Response) => {
    const status = req.query.status as OptimizationApprovalStatus | undefined;
    res.json(globalGovernedSelfOptimizationEngine.listProposals(req.params.collectionId, status));
  });

  app.post('/api/cognition/proposals/:proposalId/approve', (req: Request, res: Response) => {
    try {
      const { approverRole } = req.body as { approverRole: string };
      if (!approverRole) { res.status(400).json({ error: 'approverRole required' }); return; }
      res.json(globalGovernedSelfOptimizationEngine.approve(req.params.proposalId, approverRole));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/cognition/proposals/:proposalId/reject', (req: Request, res: Response) => {
    try {
      const { reason } = req.body as { reason?: string };
      res.json(globalGovernedSelfOptimizationEngine.reject(req.params.proposalId, reason ?? ''));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/cognition/governance/policies', (req: Request, res: Response) => {
    try {
      globalGovernedSelfOptimizationEngine.registerPolicy(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/cognition/governance/policy', (req: Request, res: Response) => {
    const collectionId = req.query.collectionId as string | undefined;
    res.json(globalGovernedSelfOptimizationEngine.getPolicy(collectionId));
  });

  // ── Federated Cognition Memory ──────────────────────────────────────────────

  app.post('/api/cognition/memory/records', (req: Request, res: Response) => {
    try {
      globalFederatedCognitionMemory.addCognitionRecord(req.body);
      res.status(201).json({ added: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/cognition/memory/index/:orgId', (req: Request, res: Response) => {
    const collectionId = req.query.collectionId as string | undefined;
    res.json(globalFederatedCognitionMemory.buildIndex(req.params.orgId, collectionId));
  });

  app.post('/api/cognition/memory/anti-patterns', (req: Request, res: Response) => {
    try {
      globalFederatedCognitionMemory.addAntiPatternCognition(req.body);
      res.status(201).json({ added: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/cognition/memory/anti-patterns', (_req: Request, res: Response) => {
    res.json(globalFederatedCognitionMemory.listAntiPatternCognitions());
  });

  app.post('/api/cognition/memory/retention-policy', (req: Request, res: Response) => {
    try {
      globalFederatedCognitionMemory.registerRetentionPolicy(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  // ── Cognitive Graph Overlay ─────────────────────────────────────────────────

  app.post('/api/cognition/graph-overlay/:collectionId', (req: Request, res: Response) => {
    try {
      const overlay = globalCognitiveGraphOverlayBuilder.build(
        req.params.collectionId, req.body ?? {}
      );
      res.json(overlay);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}
