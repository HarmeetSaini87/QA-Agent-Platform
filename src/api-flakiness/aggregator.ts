// src/api-flakiness/aggregator.ts
import type { ApiCollectionRunResult } from '../data/types';
import type { StepFlakinessRecord, FailureSignature, RetryStats } from './contracts/flakiness.contracts';
import { buildFailureSignature } from './failure-signature';

const FLAKINESS_THRESHOLD = 0.2;

export function aggregateRunsForStep(
  stepId: string,
  collectionId: string,
  runs: ApiCollectionRunResult[]
): StepFlakinessRecord | null {
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const stepEntries = sorted.flatMap(run =>
    run.stepResults.filter(sr => sr.stepId === stepId).map(sr => ({ sr, run }))
  );
  if (stepEntries.length === 0) return null;

  const stepName = stepEntries[0].sr.stepName;
  const totalRuns = stepEntries.length;
  let failedRuns = 0, passedRuns = 0, skippedRuns = 0;
  let lastFailedAt: string | undefined, lastPassedAt: string | undefined;
  const signatures: FailureSignature[] = [];

  for (const { sr, run } of stepEntries) {
    if (sr.status === 'passed') {
      passedRuns++;
      if (!lastPassedAt || run.startedAt > lastPassedAt) lastPassedAt = run.startedAt;
    } else if (sr.status === 'skipped') {
      skippedRuns++;
    } else {
      failedRuns++;
      if (!lastFailedAt || run.startedAt > lastFailedAt) lastFailedAt = run.startedAt;
      signatures.push(buildFailureSignature(sr));
    }
  }

  const failRate = totalRuns > 0 ? failedRuns / totalRuns : 0;

  const outcomes = stepEntries.map(({ sr }) => sr.status === 'passed' ? 'pass' : 'fail');
  let alternations = 0;
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i] !== outcomes[i - 1]) alternations++;
  }
  const alternationIndex = outcomes.length > 1 ? alternations / (outcomes.length - 1) : 0;

  const flakinessScore = parseFloat((0.7 * failRate + 0.3 * alternationIndex).toFixed(4));
  const isFlaky = flakinessScore >= FLAKINESS_THRESHOLD;

  const sigCounts: Record<string, { sig: FailureSignature; count: number }> = {};
  for (const sig of signatures) {
    if (!sigCounts[sig.signatureKey]) sigCounts[sig.signatureKey] = { sig, count: 0 };
    sigCounts[sig.signatureKey].count++;
  }
  const dominantSignature = Object.values(sigCounts).sort((a, b) => b.count - a.count)[0]?.sig;
  const uniqueSignatures = Object.values(sigCounts).map(e => e.sig);

  const retryStats: RetryStats = {
    retryCount: failedRuns,
    maxRetryAttempt: 0,
    avgAttemptDurationMs: stepEntries.reduce((sum, { sr }) => sum + sr.durationMs, 0) / totalRuns,
    recoveredAfterRetry: false,
  };

  return {
    stepId, stepName, collectionId, totalRuns, failedRuns, passedRuns, skippedRuns,
    failRate, alternationIndex, flakinessScore, isFlaky,
    flakinessThreshold: FLAKINESS_THRESHOLD, retryStats,
    dominantSignature, signatures: uniqueSignatures,
    lastFailedAt, lastPassedAt, computedAt: new Date().toISOString(),
  };
}
