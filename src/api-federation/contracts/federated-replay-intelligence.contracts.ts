// src/api-federation/contracts/federated-replay-intelligence.contracts.ts
// Phase E Step 12: Federated replay intelligence. Anonymized patterns only — replay determinism preserved.

export interface AnonymizedReplayPattern {
  readonly patternId: string;
  readonly sourceOrgId: string;        // anonymized in federation contexts
  readonly failureSignature: string;   // normalized, non-tenant-sensitive
  readonly retrySequenceHash: string;  // deterministic hash of retry pattern, no raw payloads
  readonly occurrenceCount: number;
  readonly avgRemediationEffectiveness: number;   // 0–1
  readonly contributingRunCount: number;
  readonly anonymizedAt: string;
}

export interface FederatedReplayInsight {
  readonly insightId: string;
  readonly category: 'failure-pattern' | 'retry-stabilization' | 'anomaly-cluster' | 'remediation-effectiveness';
  readonly signal: string;
  readonly crossOrgOccurrences: number;
  readonly recommendedAction: string;
  readonly confidence: number;         // 0–100
  readonly advisoryNote: string;
  readonly generatedAt: string;
}

export interface FederatedAnomalyIntelligence {
  readonly collectionId: string;
  readonly anomalyType: string;
  readonly crossOrgFrequency: number;  // how often this anomaly appears federation-wide
  readonly localFrequency: number;
  readonly isKnownPattern: boolean;
  readonly mitigationHint: string;
  readonly generatedAt: string;
}

export interface IFederatedReplayIntelligence {
  publishPattern(pattern: AnonymizedReplayPattern): void;
  listPatterns(sourceOrgId?: string): AnonymizedReplayPattern[];
  generateInsights(): FederatedReplayInsight[];
  detectFederatedAnomaly(collectionId: string, localAnomalyType: string): FederatedAnomalyIntelligence;
}
