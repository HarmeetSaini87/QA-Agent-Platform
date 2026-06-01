export type PolicyAutomationScope =
  | 'orchestration-policy'
  | 'replay-governance'
  | 'remediation-compliance'
  | 'audit-governance'
  | 'trust-orchestration'
  | 'retention-policy';

export type GovernanceAutomationStatus =
  | 'pending-evaluation'
  | 'compliant'
  | 'non-compliant'
  | 'remediation-required'
  | 'waived';

export interface PolicyAutomationRule {
  ruleId: string;
  orgId?: string;
  scope: PolicyAutomationScope;
  ruleDescription: string;
  complianceThreshold: number;
  requireExplainability: boolean;
  requireApprovalForWaiver: boolean;
  isActive: boolean;
}

export interface GovernanceAutomationDecision {
  decisionId: string;
  collectionId: string;
  ruleId: string;
  scope: PolicyAutomationScope;
  status: GovernanceAutomationStatus;
  complianceScore: number;
  evidenceSignals: string[];
  remediationHint?: string;
  isExplainable: true;
  evaluatedAt: string;
  governanceNote: string;
}

export interface EnterpriseGovernanceSummary {
  orgId: string;
  totalEvaluations: number;
  compliantCount: number;
  nonCompliantCount: number;
  avgComplianceScore: number;
  dominantScope: PolicyAutomationScope | null;
  overallTrustLevel: 'trusted' | 'conditionally-trusted' | 'at-risk' | 'non-compliant';
  summarizedAt: string;
  governanceNote: string;
}

export interface IGovernanceAutomationRegistry {
  registerRule(rule: PolicyAutomationRule): void;
  getRule(ruleId: string): PolicyAutomationRule | null;
  listRules(orgId?: string): PolicyAutomationRule[];
  recordDecision(decision: Omit<GovernanceAutomationDecision, 'decisionId' | 'evaluatedAt' | 'governanceNote'>): GovernanceAutomationDecision;
  listDecisions(collectionId: string, status?: GovernanceAutomationStatus): GovernanceAutomationDecision[];
  summarize(orgId: string): EnterpriseGovernanceSummary;
}
