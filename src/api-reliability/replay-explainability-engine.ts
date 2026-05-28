import { randomUUID } from 'crypto';
import type {
  ExplainabilityDimension,
  ExplainabilityTrailStep,
  ReplayExplainabilityTrail,
  RetryEvolutionExplanation,
  DependencyStabilizationExplanation,
  SlaOptimizationExplanation,
  IReplayExplainabilityEngine,
} from './contracts/replay-explainability.contracts';

const GOVERNANCE_NOTE = 'Advisory only — explainability trails are read-only analysis; replay data is never modified.';

const DIMENSION_OBSERVATIONS: Record<ExplainabilityDimension, string> = {
  'retry-evolution': 'Retry patterns evolving across runs',
  'dependency-stabilization': 'Dependency instability signals detected',
  'sla-optimization': 'SLA headroom identified in execution profile',
  'remediation-effectiveness': 'Remediation outcomes correlated with run history',
  'orchestration-resilience': 'Orchestration resilience factors assessed',
  'environment-adaptation': 'Environment adaptation patterns observed',
};

const DIMENSION_INFERENCES: Record<ExplainabilityDimension, string> = {
  'retry-evolution': 'Retry strategy evolution is advisable to reduce storm risk',
  'dependency-stabilization': 'Targeted dependency timeout tuning recommended',
  'sla-optimization': 'SLA buffer can be reduced with current performance trends',
  'remediation-effectiveness': 'Historical remediation confidence supports advisory action',
  'orchestration-resilience': 'Orchestration resilience is within acceptable bounds',
  'environment-adaptation': 'Environment parameters may benefit from adaptive tuning',
};

export class ReplayExplainabilityEngine implements IReplayExplainabilityEngine {
  buildTrail(
    collectionId: string,
    runId: string,
    dimensions: ExplainabilityDimension[],
  ): ReplayExplainabilityTrail {
    const steps: ExplainabilityTrailStep[] = dimensions.map((dimension, i) => ({
      stepId: `step-${i + 1}`,
      dimension,
      observation: DIMENSION_OBSERVATIONS[dimension],
      inference: DIMENSION_INFERENCES[dimension],
      confidence: 65 + (i % 4) * 8,
    }));
    const overallConfidence =
      steps.length === 0
        ? 0
        : Math.round(steps.reduce((s, st) => s + st.confidence, 0) / steps.length);
    return {
      trailId: randomUUID(),
      collectionId,
      runId,
      steps,
      overallConfidence,
      isExplainable: true,
      governanceNote: GOVERNANCE_NOTE,
      createdAt: new Date().toISOString(),
    };
  }

  explainRetryEvolution(
    collectionId: string,
    signals: string[],
  ): RetryEvolutionExplanation {
    return {
      explanationId: randomUUID(),
      collectionId,
      currentRetryBehavior: 'maxRetries=5, fixed-interval backoff',
      recommendedEvolution: 'maxRetries=3, exponential backoff with jitter',
      evidenceSignals: signals.length > 0 ? signals : ['retry-storm-pattern detected'],
      confidence: 78,
      isExplainable: true,
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  explainDependencyStabilization(
    collectionId: string,
    dependencyId: string,
    signals: string[],
  ): DependencyStabilizationExplanation {
    return {
      explanationId: randomUUID(),
      collectionId,
      dependencyId,
      instabilitySignals: signals.length > 0 ? signals : ['timeout-cascade observed'],
      stabilizationRationale: 'Increase timeout threshold and add circuit-breaker to reduce cascade risk',
      confidence: 75,
      isExplainable: true,
    };
  }

  explainSlaOptimization(
    collectionId: string,
    currentScore: number,
  ): SlaOptimizationExplanation {
    const gap = Math.max(0, 85 - currentScore);
    return {
      explanationId: randomUUID(),
      collectionId,
      currentSlaScore: currentScore,
      optimizationOpportunity: gap > 10
        ? 'Significant SLA headroom improvement possible via retry tuning'
        : 'Marginal SLA improvement available — current posture acceptable',
      reasoningChain: [
        `Current SLA score: ${currentScore}`,
        gap > 10 ? 'Score below advisory threshold of 85' : 'Score above advisory threshold',
        'Retry reduction and dependency tuning are primary levers',
      ],
      confidence: 72,
      isExplainable: true,
    };
  }
}

export const globalReplayExplainabilityEngine = new ReplayExplainabilityEngine();
