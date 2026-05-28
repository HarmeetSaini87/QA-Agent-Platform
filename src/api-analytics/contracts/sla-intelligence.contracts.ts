// src/api-analytics/contracts/sla-intelligence.contracts.ts
// Phase E Step 7: SLA intelligence — latency/retry/stability tracking. Advisory only.

export interface SlaPolicy {
  readonly policyId: string;
  readonly collectionId?: string;
  readonly tenantId?: string;
  readonly maxLatencyMs: number;
  readonly maxRetryRate: number;       // 0–1 (fraction of steps retried)
  readonly minPassRate: number;        // 0–1
  readonly maxTeardownFailureRate: number;
}

export type SlaBreachType = 'latency' | 'retry-rate' | 'pass-rate' | 'teardown-failure';

export interface SlaBreachRecord {
  readonly breachId: string;
  readonly collectionId: string;
  readonly policyId: string;
  readonly breachType: SlaBreachType;
  readonly observed: number;
  readonly threshold: number;
  readonly detectedAt: string;
  readonly advisoryNote: string;
}

export interface SlaScorecard {
  readonly collectionId: string;
  readonly policyId: string;
  readonly score: number;    // 0–100
  readonly breaches: readonly SlaBreachRecord[];
  readonly healthy: boolean;
  readonly evaluatedAt: string;
}

export interface ISlaIntelligenceEngine {
  registerPolicy(policy: SlaPolicy): void;
  getPolicy(policyId: string): SlaPolicy | null;
  evaluate(collectionId: string, policyId: string, metrics: {
    avgLatencyMs: number;
    retryRate: number;
    passRate: number;
    teardownFailureRate: number;
  }): SlaScorecard;
  listBreaches(collectionId: string): SlaBreachRecord[];
}
