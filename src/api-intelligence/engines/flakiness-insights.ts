import { nanoid } from 'nanoid';
import { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';
import { AiRecommendation } from '../contracts/recommendation.contracts';
import { AiGraphAnnotation } from '../contracts/graph-overlay-ai.contracts';
import { makeProvenance } from './engine-helpers';

const HIGH_FAIL_RATE = 0.4;       // 40%+ fail rate = high flakiness
const ALTERNATION_STORM = 0.7;    // 70%+ alternation = non-deterministic

export interface FlakinessInsightResult {
  recommendations: AiRecommendation[];
  annotations: AiGraphAnnotation[];
}

export function analyzeFlakinessInsights(report: CollectionFlakinessReport): FlakinessInsightResult {
  const recommendations: AiRecommendation[] = [];
  const annotations: AiGraphAnnotation[] = [];

  for (const record of report.stepRecords) {
    if (!record.isFlaky) continue;

    if (record.failRate >= HIGH_FAIL_RATE) {
      const sev = record.failRate >= 0.7 ? 'critical' : 'warning';
      recommendations.push({
        id: nanoid(8),
        category: 'flakiness',
        severity: sev,
        title: `Step "${record.stepName}" is highly flaky — ${Math.round(record.failRate * 100)}% fail rate`,
        detail: `Failed in ${record.failedRuns}/${record.totalRuns} runs. Dominant failure category: ${record.dominantSignature?.category ?? 'unknown'}. Last failed: ${record.lastFailedAt ?? 'unknown'}.`,
        confidence: 90,
        actionHint: 'Review response contract, environment stability, and retry configuration for this step.',
        provenance: makeProvenance('flakiness-insights', [record.stepId], 'deterministic'),
        collectionId: report.collectionId,
        stepId: record.stepId,
      });
      annotations.push({
        nodeId: record.stepId,
        stepId: record.stepId,
        badges: [{ type: 'unstable-dependency', label: `${Math.round(record.failRate * 100)}% fail`, confidence: 90, detail: `High flakiness: ${record.failedRuns}/${record.totalRuns}` }],
      });
    }

    if (record.alternationIndex >= ALTERNATION_STORM) {
      recommendations.push({
        id: nanoid(8),
        category: 'flakiness',
        severity: 'warning',
        title: `Step "${record.stepName}" alternates pass/fail (alternation ${record.alternationIndex.toFixed(2)})`,
        detail: 'This step passes and fails on alternating runs, indicating timing or environment-state sensitivity rather than a stable bug.',
        confidence: 75,
        actionHint: 'Add execution.delayAfterMs to stabilize timing, or verify that environment state resets cleanly between runs.',
        provenance: makeProvenance('flakiness-insights', [record.stepId], 'deterministic'),
        collectionId: report.collectionId,
        stepId: record.stepId,
      });
    }

    if (record.dominantSignature?.category === 'dependency_propagation') {
      const upstreamId = record.dominantSignature.propagatedFromStepId ?? 'unknown';
      recommendations.push({
        id: nanoid(8),
        category: 'dependency',
        severity: 'warning',
        title: `Step "${record.stepName}" fails due to upstream cascade from "${upstreamId}"`,
        detail: `Most failures originate from an upstream step failure propagating to this step. Fixing the upstream step should resolve this flakiness.`,
        confidence: 85,
        actionHint: `Investigate step "${upstreamId}" first. Consider onFailure: "continue" if this step can proceed independently.`,
        provenance: makeProvenance('flakiness-insights', [record.stepId, upstreamId], 'deterministic'),
        collectionId: report.collectionId,
        stepId: record.stepId,
      });
    }
  }

  // Collection-level stability warning
  if (report.stabilityScore < 0.6 && report.runsAnalyzed >= 5) {
    recommendations.push({
      id: nanoid(8),
      category: 'workflow-quality',
      severity: 'critical',
      title: `Collection stability is ${Math.round(report.stabilityScore * 100)}% — below threshold`,
      detail: `${report.hotspots.length} hotspot steps across ${report.runsAnalyzed} runs analyzed. Overall quality is significantly degraded.`,
      confidence: 92,
      actionHint: 'Address hotspot steps in priority order before adding new steps to this collection.',
      provenance: makeProvenance('flakiness-insights', [report.collectionId], 'deterministic'),
      collectionId: report.collectionId,
    });
  }

  return { recommendations, annotations };
}
