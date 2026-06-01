// src/api-federation/routes/federation.routes.ts
// Phase E Step 12: Federated orchestration REST endpoints. Governed — no uncontrolled federation.

import { Application, Request, Response } from 'express';
import { globalFederationOrchestrationRegistry } from '../federation-orchestration-registry';
import { globalCrossOrgIntelligenceHub } from '../cross-org-intelligence-hub';
import { globalFederatedGovernanceRegistry } from '../federated-governance-registry';
import { globalFederatedReplayIntelligenceEngine } from '../federated-replay-intelligence-engine';
import { globalFederatedGraphOverlayBuilder } from '../federated-graph-overlay-builder';
import { IntelligenceCategory } from '../contracts/cross-org-intelligence.contracts';

export function registerFederationRoutes(app: Application): void {

  // ── Federation Orchestration ────────────────────────────────────────────────

  app.post('/api/federation/nodes', (req: Request, res: Response) => {
    try {
      globalFederationOrchestrationRegistry.registerNode(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/federation/nodes', (req: Request, res: Response) => {
    const orgId = req.query.orgId as string | undefined;
    res.json(globalFederationOrchestrationRegistry.listNodes(orgId));
  });

  app.patch('/api/federation/nodes/:nodeId/status', (req: Request, res: Response) => {
    try {
      const { status } = req.body as { status: string };
      if (!status) { res.status(400).json({ error: 'status required' }); return; }
      globalFederationOrchestrationRegistry.updateNodeStatus(req.params.nodeId, status as never);
      res.json({ updated: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/federation/policies', (req: Request, res: Response) => {
    try {
      globalFederationOrchestrationRegistry.registerPolicy(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/federation/check-sharing', (req: Request, res: Response) => {
    try {
      const { orgId, targetOrgId } = req.body as { orgId: string; targetOrgId: string };
      if (!orgId || !targetOrgId) { res.status(400).json({ error: 'orgId, targetOrgId required' }); return; }
      res.json(globalFederationOrchestrationRegistry.checkSharingPermission(orgId, targetOrgId));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/federation/snapshot/:orgId', (req: Request, res: Response) => {
    res.json(globalFederationOrchestrationRegistry.snapshot(req.params.orgId));
  });

  // ── Cross-Org Intelligence ──────────────────────────────────────────────────

  app.post('/api/federation/intelligence/records', (req: Request, res: Response) => {
    try {
      globalCrossOrgIntelligenceHub.publishRecord(req.body);
      res.status(201).json({ published: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/federation/intelligence/records', (req: Request, res: Response) => {
    const category = req.query.category as IntelligenceCategory | undefined;
    res.json(globalCrossOrgIntelligenceHub.listRecords(category));
  });

  app.post('/api/federation/intelligence/bundles', (req: Request, res: Response) => {
    try {
      const { fromOrgId, toOrgId, category, approvedBy } = req.body as {
        fromOrgId: string; toOrgId: string; category: IntelligenceCategory; approvedBy?: string;
      };
      if (!fromOrgId || !toOrgId || !category) {
        res.status(400).json({ error: 'fromOrgId, toOrgId, category required' }); return;
      }
      const bundle = globalCrossOrgIntelligenceHub.createBundle(fromOrgId, toOrgId, category, approvedBy);
      res.status(201).json(bundle);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/federation/intelligence/bundles/:orgId', (req: Request, res: Response) => {
    res.json(globalCrossOrgIntelligenceHub.listBundles(req.params.orgId));
  });

  app.get('/api/federation/intelligence/aggregate', (req: Request, res: Response) => {
    try {
      const { category } = req.query as { category: IntelligenceCategory };
      if (!category) { res.status(400).json({ error: 'category required' }); return; }
      res.json(globalCrossOrgIntelligenceHub.aggregate(category));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Federated Governance ────────────────────────────────────────────────────

  app.post('/api/federation/governance/policies', (req: Request, res: Response) => {
    try {
      globalFederatedGovernanceRegistry.registerPolicy(req.body);
      res.status(201).json({ registered: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/federation/governance/policies/:orgId', (req: Request, res: Response) => {
    res.json(globalFederatedGovernanceRegistry.listPolicies(req.params.orgId));
  });

  app.post('/api/federation/governance/approval-chains', (req: Request, res: Response) => {
    try {
      const chain = globalFederatedGovernanceRegistry.createApprovalChain(req.body);
      res.status(201).json(chain);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post('/api/federation/governance/approval-chains/:chainId/approve', (req: Request, res: Response) => {
    try {
      const { orgId, approvedBy } = req.body as { orgId: string; approvedBy: string };
      if (!orgId || !approvedBy) { res.status(400).json({ error: 'orgId, approvedBy required' }); return; }
      const chain = globalFederatedGovernanceRegistry.recordApproval(req.params.chainId, orgId, approvedBy);
      res.json(chain);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/federation/governance/audit/:orgId', (req: Request, res: Response) => {
    res.json(globalFederatedGovernanceRegistry.listAuditEntries(req.params.orgId));
  });

  // ── Federated Replay Intelligence ───────────────────────────────────────────

  app.post('/api/federation/replay/patterns', (req: Request, res: Response) => {
    try {
      globalFederatedReplayIntelligenceEngine.publishPattern(req.body);
      res.status(201).json({ published: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get('/api/federation/replay/patterns', (req: Request, res: Response) => {
    const orgId = req.query.orgId as string | undefined;
    res.json(globalFederatedReplayIntelligenceEngine.listPatterns(orgId));
  });

  app.get('/api/federation/replay/insights', (_req: Request, res: Response) => {
    res.json(globalFederatedReplayIntelligenceEngine.generateInsights());
  });

  app.post('/api/federation/replay/anomaly', (req: Request, res: Response) => {
    try {
      const { collectionId, localAnomalyType } = req.body as { collectionId: string; localAnomalyType: string };
      if (!collectionId || !localAnomalyType) {
        res.status(400).json({ error: 'collectionId, localAnomalyType required' }); return;
      }
      res.json(globalFederatedReplayIntelligenceEngine.detectFederatedAnomaly(collectionId, localAnomalyType));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Federated Graph Overlay ─────────────────────────────────────────────────

  app.post('/api/federation/graph-overlay/:collectionId', (req: Request, res: Response) => {
    try {
      const { orgId, ...input } = req.body as { orgId: string; [k: string]: unknown };
      if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }
      const overlay = globalFederatedGraphOverlayBuilder.build(
        req.params.collectionId, orgId, input as never
      );
      res.json(overlay);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}
