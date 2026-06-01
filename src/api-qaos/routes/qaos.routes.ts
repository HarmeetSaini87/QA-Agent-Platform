import type { Express } from 'express';
import { randomUUID } from 'crypto';
import { globalUnifiedOrchestrationGovernanceRegistry } from '../unified-orchestration-governance-registry';
import { globalEnterpriseOperationalConsolidationEngine } from '../enterprise-operational-consolidation-engine';
import { globalReplayUnifiedOperationalReasoningEngine } from '../replay-unified-operational-reasoning-engine';
import { globalFederatedEnterpriseMemoryFabric } from '../federated-enterprise-memory-fabric';
import { globalUnifiedGraphGovernanceOverlayBuilder } from '../unified-graph-governance-overlay-builder';
import type { UnifiedOrchestrationRule } from '../contracts/unified-orchestration-governance.contracts';
import type { EnterpriseMemoryRecord, OrchestrationAntiPatternRecord, EnterpriseRetentionPolicy } from '../contracts/federated-enterprise-memory.contracts';
import type { ConsolidationGovernancePolicy } from '../contracts/enterprise-operational-consolidation.contracts';

export function registerQaosRoutes(app: Express): void {

  // --- Unified Orchestration Governance ---
  app.post('/api/qaos/rules', (req, res) => {
    const rule: UnifiedOrchestrationRule = { ruleId: randomUUID(), ...req.body };
    globalUnifiedOrchestrationGovernanceRegistry.registerRule(rule);
    res.json({ success: true, rule });
  });

  app.get('/api/qaos/rules', (req, res) => {
    const rules = globalUnifiedOrchestrationGovernanceRegistry.listRules(req.query.orgId as string | undefined);
    res.json({ rules });
  });

  app.get('/api/qaos/rules/:ruleId', (req, res) => {
    const rule = globalUnifiedOrchestrationGovernanceRegistry.getRule(req.params.ruleId);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule });
  });

  app.post('/api/qaos/decisions', (req, res) => {
    const decision = globalUnifiedOrchestrationGovernanceRegistry.recordDecision(req.body);
    res.json({ success: true, decision });
  });

  app.get('/api/qaos/decisions/:collectionId', (req, res) => {
    const decisions = globalUnifiedOrchestrationGovernanceRegistry.listDecisions(req.params.collectionId);
    res.json({ decisions });
  });

  app.get('/api/qaos/summary/:orgId', (req, res) => {
    const summary = globalUnifiedOrchestrationGovernanceRegistry.summarize(req.params.orgId);
    res.json({ summary });
  });

  // --- Enterprise Consolidation ---
  app.post('/api/qaos/consolidation/propose', (req, res) => {
    const { collectionId, domain, action, reasoning, confidence } = req.body;
    const proposal = globalEnterpriseOperationalConsolidationEngine.propose(collectionId, domain, action, reasoning, confidence ?? 70);
    res.json({ proposal });
  });

  app.get('/api/qaos/consolidation/:collectionId/proposals', (req, res) => {
    const proposals = globalEnterpriseOperationalConsolidationEngine.listProposals(req.params.collectionId);
    res.json({ proposals });
  });

  app.post('/api/qaos/consolidation/proposals/:proposalId/approve', (req, res) => {
    try {
      const updated = globalEnterpriseOperationalConsolidationEngine.approve(req.params.proposalId, req.body.approverRole ?? 'admin');
      res.json({ proposal: updated });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  app.post('/api/qaos/consolidation/proposals/:proposalId/reject', (req, res) => {
    try {
      const updated = globalEnterpriseOperationalConsolidationEngine.reject(req.params.proposalId);
      res.json({ proposal: updated });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  app.get('/api/qaos/consolidation/:collectionId/scorecard', (req, res) => {
    const scorecard = globalEnterpriseOperationalConsolidationEngine.scoreConsolidation(req.params.collectionId);
    res.json({ scorecard });
  });

  app.get('/api/qaos/consolidation/:collectionId/policy', (req, res) => {
    const policy = globalEnterpriseOperationalConsolidationEngine.getPolicy(req.params.collectionId);
    res.json({ policy });
  });

  app.post('/api/qaos/consolidation/:collectionId/policy', (req, res) => {
    const policy: ConsolidationGovernancePolicy = { policyId: randomUUID(), ...req.body };
    globalEnterpriseOperationalConsolidationEngine.setPolicy(req.params.collectionId, policy);
    res.json({ success: true, policy });
  });

  // --- Replay Unified Operational Reasoning ---
  app.post('/api/qaos/reasoning/trail', (req, res) => {
    const { collectionId, dimensions, runId } = req.body;
    const trail = globalReplayUnifiedOperationalReasoningEngine.buildReasoningTrail(collectionId, dimensions ?? [], runId);
    res.json({ trail });
  });

  app.post('/api/qaos/reasoning/anomaly', (req, res) => {
    const { collectionId, anomalyType, signals } = req.body;
    const analysis = globalReplayUnifiedOperationalReasoningEngine.analyzeOrchestrationAnomaly(collectionId, anomalyType, signals ?? []);
    res.json({ analysis });
  });

  app.post('/api/qaos/reasoning/retry-harmonization', (req, res) => {
    const { collectionId, retryCount, maxAllowed } = req.body;
    const harmonization = globalReplayUnifiedOperationalReasoningEngine.harmonizeRetryGovernance(collectionId, retryCount ?? 0, maxAllowed ?? 3);
    res.json({ harmonization });
  });

  // --- Federated Enterprise Memory ---
  app.post('/api/qaos/memory/records', (req, res) => {
    const record: EnterpriseMemoryRecord = {
      recordId: randomUUID(),
      createdAt: new Date().toISOString(),
      retentionExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      isAnonymized: true,
      isExplainable: true,
      ...req.body,
    };
    globalFederatedEnterpriseMemoryFabric.addRecord(record);
    res.json({ success: true, record });
  });

  app.get('/api/qaos/memory/index/:orgId', (req, res) => {
    const index = globalFederatedEnterpriseMemoryFabric.buildIndex(req.params.orgId, req.query.collectionId as string | undefined);
    res.json({ index });
  });

  app.post('/api/qaos/memory/evict', (_req, res) => {
    const evicted = globalFederatedEnterpriseMemoryFabric.evictExpired();
    res.json({ evicted });
  });

  app.post('/api/qaos/memory/anti-patterns', (req, res) => {
    const pattern: OrchestrationAntiPatternRecord = {
      patternId: randomUUID(),
      firstObservedAt: new Date().toISOString(),
      isAnonymized: true,
      ...req.body,
    };
    globalFederatedEnterpriseMemoryFabric.addOrchestrationAntiPattern(pattern);
    res.json({ success: true, pattern });
  });

  app.get('/api/qaos/memory/anti-patterns', (_req, res) => {
    const patterns = globalFederatedEnterpriseMemoryFabric.listOrchestrationAntiPatterns();
    res.json({ patterns });
  });

  app.post('/api/qaos/memory/retention-policy', (req, res) => {
    const policy: EnterpriseRetentionPolicy = { policyId: randomUUID(), ...req.body };
    globalFederatedEnterpriseMemoryFabric.registerRetentionPolicy(policy);
    res.json({ success: true, policy });
  });

  app.get('/api/qaos/memory/retention-policy/:orgId', (req, res) => {
    const policy = globalFederatedEnterpriseMemoryFabric.getRetentionPolicy(req.params.orgId);
    if (!policy) return res.status(404).json({ error: 'No retention policy found' });
    res.json({ policy });
  });

  // --- Unified Graph Governance Overlay ---
  app.post('/api/qaos/graph-overlay/:collectionId', (req, res) => {
    const overlay = globalUnifiedGraphGovernanceOverlayBuilder.build(req.params.collectionId, req.body ?? {});
    res.json({ overlay });
  });
}
