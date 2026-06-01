// src/api-defects/api-defect-enricher.ts
import type { ApiDefectEnrichmentContext, ApiDefectPayload } from './contracts/api-defect.contracts';
import { proposeUrlFixes } from './api-heal-advisor';

export function enrichDefectPayload(ctx: ApiDefectEnrichmentContext): ApiDefectPayload {
  const { step, run, collection, environment, flakinessReport, graphNodeResult } = ctx;

  const stepFlakiness = flakinessReport?.stepRecords.find(r => r.stepId === step.stepId);

  const retryHistory = graphNodeResult?.retryHistory?.map(h => ({
    attempt: h.attempt,
    httpStatus: h.httpStatus,
    error: h.error,
    durationMs: h.durationMs,
  })) ?? [];
  const retryCount = graphNodeResult?.retryCount ?? retryHistory.length;

  const thisStep = collection.steps.find(s => s.id === step.stepId);
  const dependencyChain: readonly string[] = thisStep?.dependsOn ?? [];

  const requestBody = step.request.body
    ? JSON.stringify(step.request.body).slice(0, 500)
    : undefined;

  const responseBody = step.response?.body
    ? (typeof step.response.body === 'string'
        ? step.response.body.slice(0, 500)
        : JSON.stringify(step.response.body).slice(0, 500))
    : undefined;

  const failedAssertions = step.assertionResults
    .filter(a => !a.passed)
    .map(a => ({ field: a.field, operator: a.operator, expected: a.expected, actual: a.actual }));

  const healingSuggestions = proposeUrlFixes(step);

  const signatureKey = stepFlakiness?.dominantSignature?.signatureKey;

  return {
    stepId: step.stepId,
    stepName: step.stepName,
    collectionId: collection.id,
    collectionName: collection.name,
    collectionVersion: undefined,
    runId: run.id,
    method: step.request.method,
    url: step.request.url,
    httpStatus: step.response?.status,
    durationMs: step.durationMs,
    failedAssertions,
    errorMessage: step.error,
    requestBody,
    responseBody,
    flakinessScore: stepFlakiness?.flakinessScore,
    failRate: stepFlakiness?.failRate,
    isFlaky: stepFlakiness?.isFlaky,
    retryCount,
    retryHistory,
    dependencyChain,
    signatureKey,
    environmentName: environment.name,
    environmentBaseUrl: environment.baseUrl,
    healingSuggestions,
  };
}
