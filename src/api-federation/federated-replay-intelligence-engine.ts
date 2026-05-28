// src/api-federation/federated-replay-intelligence-engine.ts
// Phase E Step 12: Federated replay intelligence. Anonymized patterns — replay determinism preserved.

import { randomUUID } from 'crypto';
import {
  AnonymizedReplayPattern,
  FederatedReplayInsight,
  FederatedAnomalyIntelligence,
  IFederatedReplayIntelligence,
} from './contracts/federated-replay-intelligence.contracts';

const ADVISORY_NOTE = 'Federated replay intelligence is anonymized and advisory. Replay data is never modified.';

export class FederatedReplayIntelligenceEngine implements IFederatedReplayIntelligence {
  private readonly _patterns: AnonymizedReplayPattern[] = [];

  publishPattern(pattern: AnonymizedReplayPattern): void {
    this._patterns.push(pattern);
  }

  listPatterns(sourceOrgId?: string): AnonymizedReplayPattern[] {
    return sourceOrgId
      ? this._patterns.filter((p) => p.sourceOrgId === sourceOrgId)
      : [...this._patterns];
  }

  generateInsights(): FederatedReplayInsight[] {
    if (this._patterns.length === 0) return [];

    // group by failureSignature
    const bySignature = new Map<string, AnonymizedReplayPattern[]>();
    for (const p of this._patterns) {
      const prev = bySignature.get(p.failureSignature) ?? [];
      bySignature.set(p.failureSignature, [...prev, p]);
    }

    return [...bySignature.entries()].map(([sig, patterns]) => {
      const avgEff =
        patterns.reduce((s, p) => s + p.avgRemediationEffectiveness, 0) / patterns.length;
      const totalRuns = patterns.reduce((s, p) => s + p.contributingRunCount, 0);

      return {
        insightId: randomUUID(),
        category: 'failure-pattern' as const,
        signal: sig,
        crossOrgOccurrences: patterns.length,
        recommendedAction:
          avgEff > 0.6
            ? 'Apply known remediation — high effectiveness across orgs.'
            : 'Investigate further — low cross-org remediation effectiveness.',
        confidence: Math.min(100, 50 + totalRuns * 2),
        advisoryNote: ADVISORY_NOTE,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  detectFederatedAnomaly(
    collectionId: string,
    localAnomalyType: string
  ): FederatedAnomalyIntelligence {
    const matches = this._patterns.filter((p) => p.failureSignature === localAnomalyType);
    const crossOrgFrequency = matches.reduce((s, p) => s + p.occurrenceCount, 0);

    return {
      collectionId,
      anomalyType: localAnomalyType,
      crossOrgFrequency,
      localFrequency: 1,
      isKnownPattern: crossOrgFrequency > 0,
      mitigationHint:
        crossOrgFrequency > 0
          ? 'Known federation-wide pattern — review cross-org remediation records.'
          : 'No cross-org pattern match — investigate locally.',
      generatedAt: new Date().toISOString(),
    };
  }

  _reset(): void {
    this._patterns.length = 0;
  }
}

export const globalFederatedReplayIntelligenceEngine = new FederatedReplayIntelligenceEngine();
