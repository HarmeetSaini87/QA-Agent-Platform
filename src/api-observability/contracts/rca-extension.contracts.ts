// src/api-observability/contracts/rca-extension.contracts.ts
// Spec req J: AI RCA extension point contracts.
// ADVISORY ONLY — extension points for future AI RCA engine.
// No AI calls, no autonomous remediation, no runtime side effects.

export type RcaHintKind =
  | 'flakiness-pattern'
  | 'retry-exhaustion'
  | 'dependency-chain-break'
  | 'latency-anomaly'
  | 'auth-expiry'
  | 'environment-drift';

export interface RcaHint {
  readonly kind: RcaHintKind;
  readonly stepId: string;
  readonly stepName: string;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly description: string;
  readonly evidence: readonly string[];
  readonly investigationPaths: readonly string[];
}

export interface RcaExtensionPoint {
  analyseSession(session: import('./replay-event.contracts').ReplaySession): Promise<RcaHint[]>;
  readonly providerName: string;
}

export class NoOpRcaProvider implements RcaExtensionPoint {
  readonly providerName = 'no-op';
  async analyseSession(): Promise<RcaHint[]> { return []; }
}
