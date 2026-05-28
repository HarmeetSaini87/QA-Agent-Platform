import { randomUUID } from 'crypto';
import type {
  PolicyAutomationRule, PolicyAutomationScope, GovernanceAutomationDecision,
  GovernanceAutomationStatus, EnterpriseGovernanceSummary, IGovernanceAutomationRegistry
} from './contracts/governance-automation.contracts';

const GOVERNANCE_NOTE = 'Governance automation registry — advisory only, no runtime mutations.';

const DEFAULT_RULE_SET: PolicyAutomationRule[] = [
  { ruleId: 'default-orchestration-policy', scope: 'orchestration-policy', ruleDescription: 'Baseline orchestration governance rule', complianceThreshold: 70, requireExplainability: true, requireApprovalForWaiver: true, isActive: true },
  { ruleId: 'default-replay-governance', scope: 'replay-governance', ruleDescription: 'Baseline replay governance rule', complianceThreshold: 70, requireExplainability: true, requireApprovalForWaiver: true, isActive: true },
  { ruleId: 'default-audit-governance', scope: 'audit-governance', ruleDescription: 'Baseline audit governance rule', complianceThreshold: 70, requireExplainability: true, requireApprovalForWaiver: true, isActive: true },
];

function overallTrustLevel(avg: number): EnterpriseGovernanceSummary['overallTrustLevel'] {
  if (avg >= 80) return 'trusted';
  if (avg >= 60) return 'conditionally-trusted';
  if (avg >= 40) return 'at-risk';
  return 'non-compliant';
}

export class GovernanceAutomationRegistry implements IGovernanceAutomationRegistry {
  private _rules = new Map<string, PolicyAutomationRule>();
  private _decisions: GovernanceAutomationDecision[] = [];

  constructor() { DEFAULT_RULE_SET.forEach(r => this._rules.set(r.ruleId, r)); }

  _reset(): void { this._rules.clear(); this._decisions = []; DEFAULT_RULE_SET.forEach(r => this._rules.set(r.ruleId, r)); }

  registerRule(rule: PolicyAutomationRule): void { this._rules.set(rule.ruleId, rule); }

  getRule(ruleId: string): PolicyAutomationRule | null { return this._rules.get(ruleId) ?? null; }

  listRules(orgId?: string): PolicyAutomationRule[] {
    const all = Array.from(this._rules.values());
    return orgId ? all.filter(r => r.orgId === orgId) : all;
  }

  recordDecision(decision: Omit<GovernanceAutomationDecision, 'decisionId' | 'evaluatedAt' | 'governanceNote'>): GovernanceAutomationDecision {
    const full: GovernanceAutomationDecision = {
      ...decision,
      decisionId: randomUUID(),
      evaluatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._decisions.push(full);
    return full;
  }

  listDecisions(collectionId: string, status?: GovernanceAutomationStatus): GovernanceAutomationDecision[] {
    let results = this._decisions.filter(d => d.collectionId === collectionId);
    if (status) results = results.filter(d => d.status === status);
    return results;
  }

  summarize(orgId: string): EnterpriseGovernanceSummary {
    const orgDecisions = this._decisions.filter(d => {
      const rule = this._rules.get(d.ruleId);
      return rule?.orgId === orgId || !rule?.orgId;
    });

    const avg = orgDecisions.length
      ? orgDecisions.reduce((s, d) => s + d.complianceScore, 0) / orgDecisions.length
      : 0;

    const scopeCount = new Map<string, number>();
    orgDecisions.forEach(d => scopeCount.set(d.scope, (scopeCount.get(d.scope) ?? 0) + 1));
    let dominantScope: PolicyAutomationScope | null = null;
    let maxCount = 0;
    scopeCount.forEach((count, scope) => { if (count > maxCount) { maxCount = count; dominantScope = scope as PolicyAutomationScope; } });

    return {
      orgId,
      totalEvaluations: orgDecisions.length,
      compliantCount: orgDecisions.filter(d => d.status === 'compliant').length,
      nonCompliantCount: orgDecisions.filter(d => d.status === 'non-compliant' || d.status === 'remediation-required').length,
      avgComplianceScore: Math.round(avg * 10) / 10,
      dominantScope,
      overallTrustLevel: overallTrustLevel(avg),
      summarizedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalGovernanceAutomationRegistry = new GovernanceAutomationRegistry();
