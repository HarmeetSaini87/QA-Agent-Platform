import { randomUUID } from 'crypto';
import type {
  ComplianceDimension, ComplianceEvaluationResult, OrchestrationComplianceScorecard,
  ExecutionGovernanceScore, EnterpriseTrustIntelligence, IComplianceIntelligenceEngine
} from './contracts/compliance-intelligence.contracts';

const GOVERNANCE_NOTE = 'Compliance intelligence engine — advisory only, no runtime mutations.';

const DIMENSION_OBSERVATIONS: Record<ComplianceDimension, string> = {
  'replay-traceability': 'Replay event traceability assessed across execution trail',
  'policy-adherence': 'Policy adherence signals evaluated against governance rules',
  'audit-continuity': 'Audit continuity checked for completeness and chain integrity',
  'execution-governance': 'Execution governance signals scanned for compliance violations',
  'remediation-compliance': 'Remediation compliance lifecycle verified against policy',
  'trust-integrity': 'Trust integrity indicators assessed for credential and secret hygiene',
};

const DIMENSION_GAPS: Record<ComplianceDimension, string> = {
  'replay-traceability': 'Incomplete replay event chains reduce traceability coverage',
  'policy-adherence': 'Policy signal gaps indicate adherence risks',
  'audit-continuity': 'Missing audit records reduce continuity confidence',
  'execution-governance': 'Execution governance gaps may indicate policy drift',
  'remediation-compliance': 'Remediation lifecycle gaps indicate compliance exposure',
  'trust-integrity': 'Trust signal inconsistencies require investigation',
};

function trendForScore(score: number): ComplianceEvaluationResult['trend'] {
  if (score >= 75) return 'improving';
  if (score >= 50) return 'stable';
  return 'degrading';
}

function complianceLevel(score: number): OrchestrationComplianceScorecard['complianceLevel'] {
  if (score >= 85) return 'fully-compliant';
  if (score >= 70) return 'substantially-compliant';
  if (score >= 50) return 'partially-compliant';
  return 'non-compliant';
}

function trustLevel(score: number): EnterpriseTrustIntelligence['trustLevel'] {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'low';
  return 'critical';
}

const ALL_DIMENSIONS: ComplianceDimension[] = [
  'replay-traceability', 'policy-adherence', 'audit-continuity',
  'execution-governance', 'remediation-compliance', 'trust-integrity',
];

export class ComplianceIntelligenceEngine implements IComplianceIntelligenceEngine {
  _reset(): void { /* stateless */ }

  evaluateDimension(collectionId: string, dimension: ComplianceDimension, signals: string[]): ComplianceEvaluationResult {
    const score = signals.length > 0 ? Math.min(100, 55 + signals.length * 7) : 50;
    return {
      evaluationId: randomUUID(),
      collectionId,
      dimension,
      score,
      trend: trendForScore(score),
      evidenceSignals: [...signals],
      complianceGap: DIMENSION_GAPS[dimension],
      isExplainable: true,
      evaluatedAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  buildScorecard(collectionId: string): OrchestrationComplianceScorecard {
    const dimensionScores = ALL_DIMENSIONS.map((dim, i) => {
      const score = 60 + (i % 3) * 10;
      return {
        evaluationId: randomUUID(),
        collectionId,
        dimension: dim,
        score,
        trend: trendForScore(score),
        evidenceSignals: [`${dim}-signal`],
        complianceGap: DIMENSION_GAPS[dim],
        isExplainable: true as const,
        evaluatedAt: new Date().toISOString(),
        governanceNote: GOVERNANCE_NOTE,
      };
    });

    const overall = Math.round(dimensionScores.reduce((s, d) => s + d.score, 0) / dimensionScores.length);
    const criticalGaps = dimensionScores.filter(d => d.score < 60).map(d => DIMENSION_GAPS[d.dimension]);

    return {
      scorecardId: randomUUID(),
      collectionId,
      dimensionScores,
      overallComplianceScore: overall,
      complianceLevel: complianceLevel(overall),
      criticalGaps,
      governanceNote: GOVERNANCE_NOTE,
      scoredAt: new Date().toISOString(),
    };
  }

  scoreExecutionGovernance(collectionId: string, runId: string, signals: string[]): ExecutionGovernanceScore {
    const score = signals.length > 0 ? Math.min(100, 60 + signals.length * 5) : 55;
    const violations = signals.filter(s => s.includes('violation') || s.includes('breach'));
    return {
      scoreId: randomUUID(),
      collectionId,
      runId,
      governanceScore: score,
      trustIndicators: signals.filter(s => !violations.includes(s)),
      policyViolations: violations,
      isExplainable: true,
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  assessEnterpriseTrust(orgId: string, collectionIds: string[]): EnterpriseTrustIntelligence {
    const score = collectionIds.length > 0 ? Math.min(100, 60 + collectionIds.length * 4) : 55;
    return {
      trustId: randomUUID(),
      orgId,
      trustScore: score,
      trustFactors: collectionIds.map(id => `collection-trust-${id.slice(0, 4)}`),
      riskSignals: score < 70 ? ['elevated-policy-breach-risk'] : [],
      trustLevel: trustLevel(score),
      isExplainable: true,
      assessedAt: new Date().toISOString(),
    };
  }
}

export const globalComplianceIntelligenceEngine = new ComplianceIntelligenceEngine();
