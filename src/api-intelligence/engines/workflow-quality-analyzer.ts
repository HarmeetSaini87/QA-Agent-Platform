import { nanoid } from 'nanoid';
import { ApiCollection, ApiCollectionRunResult } from '../../data/types';
import { AiRecommendation } from '../contracts/recommendation.contracts';
import { makeProvenance } from './engine-helpers';

export interface WorkflowQualityScore {
  collectionId: string;
  overallScore: number;        // 0–100 weighted composite
  assertionCoverage: number;   // 0–1 fraction of steps with assertions
  teardownCoverage: number;    // 0–1 fraction of steps that are teardown
  recentPassRate: number;      // 0–1 across last N runs
  computedAt: string;
}

export interface WorkflowQualityResult {
  score: WorkflowQualityScore;
  recommendations: AiRecommendation[];
}

export function analyzeWorkflowQuality(
  collection: ApiCollection,
  recentRuns: ApiCollectionRunResult[],
): WorkflowQualityResult {
  const recommendations: AiRecommendation[] = [];
  const steps = collection.steps;

  const teardownSteps = steps.filter(s => s.execution?.teardown === true).length;
  const stepsWithAssertions = steps.filter(s => s.assertions.length > 0).length;

  const assertionCoverage = steps.length > 0 ? stepsWithAssertions / steps.length : 1;
  const teardownCoverage = steps.length > 0 ? teardownSteps / steps.length : 0;
  const recentPassRate = recentRuns.length === 0
    ? 1
    : recentRuns.filter(r => r.status === 'passed').length / recentRuns.length;

  // Weighted score: assertions 35%, pass rate 40%, teardown presence 25%
  const overallScore = Math.round(
    assertionCoverage * 35 + recentPassRate * 40 + (teardownCoverage > 0 ? 1 : 0) * 25
  );

  if (assertionCoverage < 0.5) {
    recommendations.push({
      id: nanoid(8),
      category: 'assertion',
      severity: 'warning',
      title: `Only ${Math.round(assertionCoverage * 100)}% of steps have assertions`,
      detail: `${stepsWithAssertions}/${steps.length} steps validate responses. Steps without assertions are pass-through — failures in response contracts go undetected.`,
      confidence: 85,
      actionHint: 'Add status code or key response field assertions to steps that currently have none.',
      provenance: makeProvenance('workflow-quality-analyzer', [collection.id]),
      collectionId: collection.id,
    });
  }

  if (teardownCoverage === 0 && steps.length > 3) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'info',
      title: 'No teardown steps — collection accumulates server-side state',
      detail: 'Without teardown, each run may leave behind created resources. Over multiple runs this causes assertion drift (e.g. duplicate name conflicts, quota exhaustion).',
      confidence: 70,
      actionHint: 'Add DELETE/cleanup steps and mark them execution.teardown = true so the engine guarantees they run even on failure.',
      provenance: makeProvenance('workflow-quality-analyzer', [collection.id]),
      collectionId: collection.id,
    });
  }

  if (recentPassRate < 0.5 && recentRuns.length >= 5) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'critical',
      title: `Pass rate is ${Math.round(recentPassRate * 100)}% across last ${recentRuns.length} runs`,
      detail: 'More than half of recent runs failed. This indicates a systemic issue: API contract change, broken setup step, or environment drift.',
      confidence: 95,
      actionHint: 'Open the replay session for the most recent failure and review RCA hints before making any other changes.',
      provenance: makeProvenance('workflow-quality-analyzer', [collection.id, ...recentRuns.slice(0, 3).map(r => r.id)]),
      collectionId: collection.id,
    });
  }

  const score: WorkflowQualityScore = {
    collectionId: collection.id,
    overallScore,
    assertionCoverage,
    teardownCoverage,
    recentPassRate,
    computedAt: new Date().toISOString(),
  };

  return { score, recommendations };
}
