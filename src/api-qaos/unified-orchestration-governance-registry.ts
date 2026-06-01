import { randomUUID } from 'crypto';
import type {
  UnifiedOrchestrationRule, UnifiedOrchestrationScope, UnifiedOrchestrationDecision,
  UnifiedOrchestrationStatus, EnterpriseOrchestrationSummary, IUnifiedOrchestrationGovernanceRegistry
} from './contracts/unified-orchestration-governance.contracts';

const GOVERNANCE_NOTE = 'Unified orchestration governance registry — advisory only, no runtime mutations.';

const DEFAULT_RULES: UnifiedOrchestrationRule[] = [
  { ruleId: 'default-orchestration-federation', scope: 'orchestration-federation', ruleDescription: 'Baseline orchestration federation governance', governanceThreshold: 70, requireExplainability: true, requireApprovalForWaiver: true, isActive: true },
  { ruleId: 'default-replay-continuity', scope: 'replay-continuity', ruleDescription: 'Baseline replay continuity governance', governanceThreshold: 70, requireExplainability: true, requireApprovalForWaiver: true, isActive: true },
  { ruleId: 'default-platform-consolidation', scope: 'platform-consolidation', ruleDescription: 'Baseline platform consolidation governance', governanceThreshold: 70, requireExplainability: true, requireApprovalForWaiver: true, isActive: true },
];

function platformTrustLevel(avg: number): EnterpriseOrchestrationSummary['overallPlatformTrustLevel'] {
  if (avg >= 80) return 'unified';
  if (avg >= 60) return 'substantially-unified';
  if (avg >= 40) return 'partially-unified';
  return 'fragmented';
}

export class UnifiedOrchestrationGovernanceRegistry implements IUnifiedOrchestrationGovernanceRegistry {
  private _rules = new Map<string, UnifiedOrchestrationRule>();
  private _decisions: UnifiedOrchestrationDecision[] = [];

  constructor() { DEFAULT_RULES.forEach(r => this._rules.set(r.ruleId, r)); }

  _reset(): void { this._rules.clear(); this._decisions = []; DEFAULT_RULES.forEach(r => this._rules.set(r.ruleId, r)); }

  registerRule(rule: UnifiedOrchestrationRule): void { this._rules.set(rule.ruleId, rule); }

  getRule(ruleId: string): UnifiedOrchestrationRule | null { return this._rules.get(ruleId) ?? null; }

  listRules(orgId?: string): UnifiedOrchestrationRule[] {
    const all = Array.from(this._rules.values());
    return orgId ? all.filter(r => r.orgId === orgId) : all;
  }

  recordDecision(decision: Omit<UnifiedOrchestrationDecision, 'decisionId' | 'evaluatedAt' | 'governanceNote'>): UnifiedOrchestrationDecision {
    const full: UnifiedOrchestrationDecision = {
      ...decision,
      decisionId: randomUUID(),
      evaluatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._decisions.push(full);
    return full;
  }

  listDecisions(collectionId: string, status?: UnifiedOrchestrationStatus): UnifiedOrchestrationDecision[] {
    let results = this._decisions.filter(d => d.collectionId === collectionId);
    if (status) results = results.filter(d => d.status === status);
    return results;
  }

  summarize(orgId: string): EnterpriseOrchestrationSummary {
    const all = this._decisions;
    const avg = all.length ? all.reduce((s, d) => s + d.governanceScore, 0) / all.length : 0;

    const scopeCount = new Map<string, number>();
    all.forEach(d => scopeCount.set(d.scope, (scopeCount.get(d.scope) ?? 0) + 1));
    let dominantScope: UnifiedOrchestrationScope | null = null;
    let maxCount = 0;
    scopeCount.forEach((count, scope) => { if (count > maxCount) { maxCount = count; dominantScope = scope as UnifiedOrchestrationScope; } });

    return {
      orgId,
      totalDecisions: all.length,
      governedCount: all.filter(d => d.status === 'governed').length,
      nonGovernedCount: all.filter(d => d.status === 'non-governed' || d.status === 'remediation-required').length,
      avgGovernanceScore: Math.round(avg * 10) / 10,
      dominantScope,
      overallPlatformTrustLevel: platformTrustLevel(avg),
      summarizedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalUnifiedOrchestrationGovernanceRegistry = new UnifiedOrchestrationGovernanceRegistry();
