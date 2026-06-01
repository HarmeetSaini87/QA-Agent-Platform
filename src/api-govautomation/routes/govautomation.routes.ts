import type { Express } from 'express';
import { randomUUID } from 'crypto';
import { globalGovernanceAutomationRegistry } from '../governance-automation-registry';
import { globalComplianceIntelligenceEngine } from '../compliance-intelligence-engine';
import { globalReplayGovernanceReasoningEngine } from '../replay-governance-reasoning-engine';
import { globalFederatedGovernanceMemoryFabric } from '../federated-governance-memory-fabric';
import { globalGovernanceGraphOverlayBuilder } from '../governance-graph-overlay-builder';
import type { PolicyAutomationRule, PolicyAutomationScope } from '../contracts/governance-automation.contracts';
import type { ComplianceAntiPatternRecord, GovernanceRetentionPolicy, GovernanceMemoryRecord } from '../contracts/federated-governance-memory.contracts';

export function registerGovautomationRoutes(app: Express): void {

  // --- Governance Automation Registry ---
  app.post('/api/govautomation/rules', (req, res) => {
    const rule: PolicyAutomationRule = { ruleId: randomUUID(), ...req.body };
    globalGovernanceAutomationRegistry.registerRule(rule);
    res.json({ success: true, rule });
  });

  app.get('/api/govautomation/rules', (req, res) => {
    const rules = globalGovernanceAutomationRegistry.listRules(req.query.orgId as string | undefined);
    res.json({ rules });
  });

  app.get('/api/govautomation/rules/:ruleId', (req, res) => {
    const rule = globalGovernanceAutomationRegistry.getRule(req.params.ruleId);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule });
  });

  app.post('/api/govautomation/decisions', (req, res) => {
    const decision = globalGovernanceAutomationRegistry.recordDecision(req.body);
    res.json({ success: true, decision });
  });

  app.get('/api/govautomation/decisions/:collectionId', (req, res) => {
    const decisions = globalGovernanceAutomationRegistry.listDecisions(req.params.collectionId);
    res.json({ decisions });
  });

  app.get('/api/govautomation/summary/:orgId', (req, res) => {
    const summary = globalGovernanceAutomationRegistry.summarize(req.params.orgId);
    res.json({ summary });
  });

  // --- Compliance Intelligence ---
  app.post('/api/govautomation/compliance/evaluate', (req, res) => {
    const { collectionId, dimension, signals } = req.body;
    const result = globalComplianceIntelligenceEngine.evaluateDimension(collectionId, dimension, signals ?? []);
    res.json({ result });
  });

  app.get('/api/govautomation/compliance/scorecard/:collectionId', (req, res) => {
    const scorecard = globalComplianceIntelligenceEngine.buildScorecard(req.params.collectionId);
    res.json({ scorecard });
  });

  app.post('/api/govautomation/compliance/execution-governance', (req, res) => {
    const { collectionId, runId, signals } = req.body;
    const score = globalComplianceIntelligenceEngine.scoreExecutionGovernance(collectionId, runId, signals ?? []);
    res.json({ score });
  });

  app.post('/api/govautomation/compliance/enterprise-trust', (req, res) => {
    const { orgId, collectionIds } = req.body;
    const trust = globalComplianceIntelligenceEngine.assessEnterpriseTrust(orgId, collectionIds ?? []);
    res.json({ trust });
  });

  // --- Replay Governance Reasoning ---
  app.post('/api/govautomation/reasoning/trail', (req, res) => {
    const { collectionId, dimensions, runId } = req.body;
    const trail = globalReplayGovernanceReasoningEngine.buildGovernanceTrail(collectionId, dimensions ?? [], runId);
    res.json({ trail });
  });

  app.post('/api/govautomation/reasoning/anomaly', (req, res) => {
    const { collectionId, anomalyType, signals } = req.body;
    const analysis = globalReplayGovernanceReasoningEngine.analyzeGovernanceAnomaly(collectionId, anomalyType, signals ?? []);
    res.json({ analysis });
  });

  app.post('/api/govautomation/reasoning/retry-governance', (req, res) => {
    const { collectionId, retryCount, maxAllowed } = req.body;
    const semantics = globalReplayGovernanceReasoningEngine.classifyRetryGovernance(collectionId, retryCount ?? 0, maxAllowed ?? 3);
    res.json({ semantics });
  });

  // --- Federated Governance Memory ---
  app.post('/api/govautomation/memory/records', (req, res) => {
    const record: GovernanceMemoryRecord = {
      recordId: randomUUID(),
      createdAt: new Date().toISOString(),
      retentionExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      isAnonymized: true,
      isExplainable: true,
      ...req.body,
    };
    globalFederatedGovernanceMemoryFabric.addRecord(record);
    res.json({ success: true, record });
  });

  app.get('/api/govautomation/memory/index/:orgId', (req, res) => {
    const index = globalFederatedGovernanceMemoryFabric.buildIndex(req.params.orgId, req.query.collectionId as string | undefined);
    res.json({ index });
  });

  app.post('/api/govautomation/memory/evict', (_req, res) => {
    const evicted = globalFederatedGovernanceMemoryFabric.evictExpired();
    res.json({ evicted });
  });

  app.post('/api/govautomation/memory/anti-patterns', (req, res) => {
    const pattern: ComplianceAntiPatternRecord = {
      patternId: randomUUID(),
      firstObservedAt: new Date().toISOString(),
      isAnonymized: true,
      ...req.body,
    };
    globalFederatedGovernanceMemoryFabric.addComplianceAntiPattern(pattern);
    res.json({ success: true, pattern });
  });

  app.get('/api/govautomation/memory/anti-patterns', (_req, res) => {
    const patterns = globalFederatedGovernanceMemoryFabric.listComplianceAntiPatterns();
    res.json({ patterns });
  });

  app.post('/api/govautomation/memory/retention-policy', (req, res) => {
    const policy: GovernanceRetentionPolicy = { policyId: randomUUID(), ...req.body };
    globalFederatedGovernanceMemoryFabric.registerRetentionPolicy(policy);
    res.json({ success: true, policy });
  });

  app.get('/api/govautomation/memory/retention-policy/:orgId', (req, res) => {
    const policy = globalFederatedGovernanceMemoryFabric.getRetentionPolicy(req.params.orgId);
    if (!policy) return res.status(404).json({ error: 'No retention policy found' });
    res.json({ policy });
  });

  // --- Governance Graph Overlay ---
  app.post('/api/govautomation/graph-overlay/:collectionId', (req, res) => {
    const overlay = globalGovernanceGraphOverlayBuilder.build(req.params.collectionId, req.body ?? {});
    res.json({ overlay });
  });
}
