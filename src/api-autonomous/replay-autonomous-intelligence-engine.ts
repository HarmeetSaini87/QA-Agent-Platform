// src/api-autonomous/replay-autonomous-intelligence-engine.ts
// Phase E Step 11: Replay-driven autonomous intelligence. Read-only — replay determinism preserved.

import { randomUUID } from 'crypto';
import {
  ReplayRemediationCorrelation,
  OrchestrationStabilizationInsight,
  AdaptiveFailurePreventionInsight,
  IReplayAutonomousIntelligence,
} from './contracts/replay-autonomous-intelligence.contracts';
import { RemediationEffectivenessRecord } from './contracts/controlled-remediation.contracts';

export class ReplayAutonomousIntelligenceEngine implements IReplayAutonomousIntelligence {
  private readonly _effectivenessCache = new Map<string, RemediationEffectivenessRecord[]>();

  /** Wire in external effectiveness records for historical scoring. */
  ingestEffectiveness(collectionId: string, records: RemediationEffectivenessRecord[]): void {
    this._effectivenessCache.set(collectionId, records);
  }

  correlateReplayWithRemediation(
    runId: string,
    collectionId: string,
    linkedPlanId?: string
  ): ReplayRemediationCorrelation {
    const records = this._effectivenessCache.get(collectionId) ?? [];
    const avgEffectiveness = records.length > 0
      ? records.reduce((s, r) => s + (r.wasEffective ? 1 : 0), 0) / records.length
      : 0.5;

    return {
      correlationId: randomUUID(),
      runId,
      collectionId,
      linkedPlanId,
      rcaConfidence: Math.round(50 + avgEffectiveness * 40),
      stabilizationSignals: ['replay-event-pattern', 'retry-sequence'],
      predictedEffectiveness: avgEffectiveness,
      advisoryNote: 'Correlation is advisory. Replay data is never modified.',
      generatedAt: new Date().toISOString(),
    };
  }

  computeStabilizationInsight(
    collectionId: string,
    recentRunIds: readonly string[]
  ): OrchestrationStabilizationInsight {
    const records = this._effectivenessCache.get(collectionId) ?? [];
    const avgEffectiveness = records.length > 0
      ? records.reduce((s, r) => s + (r.wasEffective ? 1 : 0), 0) / records.length
      : 0;

    const instabilityScore = Math.round((1 - avgEffectiveness) * 60 + recentRunIds.length * 2);

    return {
      collectionId,
      instabilityScore: Math.min(100, instabilityScore),
      primaryDrivers: recentRunIds.length > 3
        ? ['high-run-frequency', 'retry-accumulation']
        : ['baseline-variance'],
      stabilizationHints: [
        'Review retry policies for high-frequency steps.',
        'Inspect dependency chain for cascading failures.',
      ],
      historicalRemedyEffectiveness: avgEffectiveness,
      generatedAt: new Date().toISOString(),
    };
  }

  generateFailurePreventionInsights(
    collectionId: string,
    stepIds: readonly string[]
  ): AdaptiveFailurePreventionInsight[] {
    return stepIds.map((stepId, i) => ({
      collectionId,
      stepId,
      failureProbability: Math.min(1, 0.1 + (i % 5) * 0.12),
      preventionHints: [
        `Inspect step ${stepId} for environment dependency issues.`,
        'Consider adding a pre-condition assertion before this step.',
      ],
      evidenceRunIds: [],
      confidence: 60 + (i % 4) * 8,
      generatedAt: new Date().toISOString(),
    }));
  }

  _reset(): void {
    this._effectivenessCache.clear();
  }
}

export const globalReplayAutonomousIntelligenceEngine = new ReplayAutonomousIntelligenceEngine();
