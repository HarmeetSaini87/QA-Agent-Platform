import { nanoid } from 'nanoid';
import { ApiTestStep, ApiCollectionRunResult } from '../../data/types';
import { AiRecommendation } from '../contracts/recommendation.contracts';
import { AiGraphAnnotation } from '../contracts/graph-overlay-ai.contracts';
import { makeProvenance } from './engine-helpers';

export interface RetryAnalysisResult {
  recommendations: AiRecommendation[];
  annotations: AiGraphAnnotation[];
}

export function analyzeRetryIntelligence(
  steps: ApiTestStep[],
  _runs: ApiCollectionRunResult[], // reserved — future: per-step retry frequency from run history
  collectionId: string,
): RetryAnalysisResult {
  const recommendations: AiRecommendation[] = [];
  const annotations: AiGraphAnnotation[] = [];

  for (const step of steps) {
    const maxRetries = step.execution?.retryPolicy?.maxRetries ?? 0;
    if (maxRetries === 0) continue;

    // Anti-pattern: teardown step with retries
    if (step.execution?.teardown === true) {
      recommendations.push({
        id: nanoid(8),
        category: 'retry',
        severity: 'warning',
        title: `Teardown step "${step.name}" has retries configured`,
        detail: `Teardown steps are cleanup operations and should not retry. Retrying a teardown can cause duplicate deletes or leave partially-cleaned state.`,
        confidence: 85,
        actionHint: 'Set retryPolicy.maxRetries = 0 for all teardown steps.',
        provenance: makeProvenance('retry-intelligence', [step.id], 'deterministic'),
        collectionId,
        stepId: step.id,
      });
      annotations.push({
        nodeId: step.id,
        stepId: step.id,
        badges: [{ type: 'retry-hotspot', label: 'Teardown+retry', confidence: 85, detail: 'Teardown step should not retry' }],
      });
    }

    // Over-retry: maxRetries > 2 with no assertions
    if (maxRetries > 2 && step.assertions.length === 0 && !step.execution?.teardown) {
      recommendations.push({
        id: nanoid(8),
        category: 'retry',
        severity: 'info',
        title: `Step "${step.name}" retries ${maxRetries}× but has no assertions`,
        detail: `Without assertions, retrying ${maxRetries} times provides no additional validation guarantee and significantly increases run duration on failure.`,
        confidence: 60,
        actionHint: `Reduce maxRetries to 1 or add status/body assertions to validate the retry outcome.`,
        provenance: makeProvenance('retry-intelligence', [step.id], 'deterministic'),
        collectionId,
        stepId: step.id,
      });
      annotations.push({
        nodeId: step.id,
        stepId: step.id,
        badges: [{ type: 'optimization-hint', label: `${maxRetries}x retry, no assertions`, confidence: 60, detail: 'Consider reducing retries or adding assertions' }],
      });
    }
  }

  return { recommendations, annotations };
}
