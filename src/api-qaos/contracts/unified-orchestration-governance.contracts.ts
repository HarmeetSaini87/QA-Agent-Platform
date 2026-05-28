export type UnifiedOrchestrationScope =
  | 'orchestration-federation'
  | 'replay-continuity'
  | 'operational-trust'
  | 'reliability-coordination'
  | 'cognition-harmonization'
  | 'platform-consolidation';

export type UnifiedOrchestrationStatus =
  | 'pending-evaluation'
  | 'governed'
  | 'non-governed'
  | 'remediation-required'
  | 'waived';

export interface UnifiedOrchestrationRule {
  ruleId: string;
  orgId?: string;
  scope: UnifiedOrchestrationScope;
  ruleDescription: string;
  governanceThreshold: number;
  requireExplainability: boolean;
  requireApprovalForWaiver: boolean;
  isActive: boolean;
}

export interface UnifiedOrchestrationDecision {
  decisionId: string;
  collectionId: string;
  ruleId: string;
  scope: UnifiedOrchestrationScope;
  status: UnifiedOrchestrationStatus;
  governanceScore: number;
  evidenceSignals: string[];
  remediationHint?: string;
  isExplainable: true;
  evaluatedAt: string;
  governanceNote: string;
}

export interface EnterpriseOrchestrationSummary {
  orgId: string;
  totalDecisions: number;
  governedCount: number;
  nonGovernedCount: number;
  avgGovernanceScore: number;
  dominantScope: UnifiedOrchestrationScope | null;
  overallPlatformTrustLevel: 'unified' | 'substantially-unified' | 'partially-unified' | 'fragmented';
  summarizedAt: string;
  governanceNote: string;
}

export interface IUnifiedOrchestrationGovernanceRegistry {
  registerRule(rule: UnifiedOrchestrationRule): void;
  getRule(ruleId: string): UnifiedOrchestrationRule | null;
  listRules(orgId?: string): UnifiedOrchestrationRule[];
  recordDecision(decision: Omit<UnifiedOrchestrationDecision, 'decisionId' | 'evaluatedAt' | 'governanceNote'>): UnifiedOrchestrationDecision;
  listDecisions(collectionId: string, status?: UnifiedOrchestrationStatus): UnifiedOrchestrationDecision[];
  summarize(orgId: string): EnterpriseOrchestrationSummary;
}
