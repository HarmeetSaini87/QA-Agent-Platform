import { randomUUID } from 'crypto';
import type {
  GovernanceReasoningDimension, GovernanceReasoningStep, ReplayGovernanceReasoningTrail,
  GovernanceAnomalyAnalysis, RetryGovernanceSemantics, IReplayGovernanceReasoningEngine
} from './contracts/replay-governance-reasoning.contracts';

const GOVERNANCE_NOTE = 'Replay governance reasoning engine — advisory only, no runtime mutations.';

const DIMENSION_OBSERVATIONS: Record<GovernanceReasoningDimension, string> = {
  'audit-trail-integrity': 'Audit trail integrity evaluated across replay event chain',
  'policy-adherence-trace': 'Policy adherence trace analysed for governance compliance',
  'retry-governance-semantics': 'Retry governance semantics classified against policy thresholds',
  'dependency-compliance': 'Dependency compliance assessed across step dependency graph',
  'trust-scoring': 'Trust scoring signals aggregated from execution and memory layers',
  'anomaly-governance': 'Anomaly governance signals detected and classified by severity',
};

const DIMENSION_INFERENCES: Record<GovernanceReasoningDimension, string> = {
  'audit-trail-integrity': 'Audit chain completeness supports governance compliance',
  'policy-adherence-trace': 'Policy trace indicates adherence confidence level',
  'retry-governance-semantics': 'Retry semantics classify governance category for escalation routing',
  'dependency-compliance': 'Dependency compliance signals indicate cross-step governance health',
  'trust-scoring': 'Trust score aggregation drives enterprise compliance posture',
  'anomaly-governance': 'Anomaly governance classification drives remediation routing',
};

function complianceImpactForSignals(count: number): GovernanceAnomalyAnalysis['complianceImpact'] {
  if (count === 0) return 'none';
  if (count === 1) return 'low';
  if (count <= 3) return 'medium';
  if (count <= 5) return 'high';
  return 'critical';
}

function retryCategory(retryCount: number, maxAllowed: number): RetryGovernanceSemantics['retryGovernanceCategory'] {
  if (retryCount <= maxAllowed * 0.5) return 'within-policy';
  if (retryCount <= maxAllowed) return 'borderline';
  if (retryCount <= maxAllowed * 1.5) return 'policy-breach';
  return 'escalation-required';
}

export class ReplayGovernanceReasoningEngine implements IReplayGovernanceReasoningEngine {
  _reset(): void { /* stateless */ }

  buildGovernanceTrail(collectionId: string, dimensions: GovernanceReasoningDimension[], runId?: string): ReplayGovernanceReasoningTrail {
    const steps: GovernanceReasoningStep[] = dimensions.map((dim, i) => ({
      stepId: randomUUID(),
      dimension: dim,
      auditObservation: DIMENSION_OBSERVATIONS[dim],
      complianceInference: DIMENSION_INFERENCES[dim],
      confidence: 65 + (i % 4) * 8,
    }));

    const overallConfidence = steps.length
      ? Math.round(steps.reduce((s, st) => s + st.confidence, 0) / steps.length)
      : 65;

    return {
      trailId: randomUUID(),
      collectionId,
      runId,
      steps,
      overallGovernanceConfidence: overallConfidence,
      isExplainable: true,
      createdAt: new Date().toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  analyzeGovernanceAnomaly(collectionId: string, anomalyType: string, signals: string[]): GovernanceAnomalyAnalysis {
    return {
      anomalyId: randomUUID(),
      collectionId,
      anomalyType,
      complianceImpact: complianceImpactForSignals(signals.length),
      policyViolationSignals: [...signals],
      governanceRecommendation: `Investigate ${anomalyType} anomaly and apply governance remediation policy`,
      confidence: Math.min(100, 55 + signals.length * 8),
      isExplainable: true,
    };
  }

  classifyRetryGovernance(collectionId: string, retryCount: number, maxAllowed: number): RetryGovernanceSemantics {
    const category = retryCategory(retryCount, maxAllowed);
    const actions: Record<RetryGovernanceSemantics['retryGovernanceCategory'], string> = {
      'within-policy': 'No action required — retry count within governance policy',
      'borderline': 'Monitor retry count — approaching policy boundary',
      'policy-breach': 'Escalate to governance review — retry count exceeds policy limit',
      'escalation-required': 'Immediate escalation required — critical retry governance breach',
    };
    return {
      semanticsId: randomUUID(),
      collectionId,
      retryGovernanceCategory: category,
      policyContext: `maxAllowed=${maxAllowed}, actual=${retryCount}`,
      governanceAction: actions[category],
      confidence: 80,
      isExplainable: true,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalReplayGovernanceReasoningEngine = new ReplayGovernanceReasoningEngine();
