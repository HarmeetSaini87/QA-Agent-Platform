// src/api-observability/contracts/replay-event.contracts.ts
// Spec req A: normalized immutable replay event records.
// Spec req B: replay session = the ordered list of events for one run.
// Spec req G: observability storage contract for RCA/audit history.

export type ReplayEventKind =
  | 'request-sent'
  | 'response-received'
  | 'assertion-evaluated'
  | 'retry-triggered'
  | 'dependency-wait'
  | 'lifecycle-hook-executed'
  | 'teardown-executed'
  | 'failure-propagated'
  | 'variable-extracted'
  | 'step-skipped'
  | 'step-completed';

export interface ReplayEvent {
  readonly seq: number;
  readonly kind: ReplayEventKind;
  readonly stepId: string;
  readonly stepName: string;
  readonly timestamp: string;
  readonly durationMs?: number;

  readonly request?: {
    readonly method: string;
    readonly url: string;
    readonly headerKeys: string[];
    readonly bodySizeBytes: number;
  };
  readonly response?: {
    readonly status: number;
    readonly durationMs: number;
    readonly bodyTruncated: boolean;
    readonly headerKeys: string[];
  };

  readonly assertion?: {
    readonly type: string;
    readonly passed: boolean;
    readonly message?: string;
  };

  readonly retry?: {
    readonly attempt: number;
    readonly maxRetries: number;
    readonly delayMs: number;
    readonly triggerStatus?: number;
    readonly triggerError?: string;
  };

  readonly dependency?: {
    readonly waitingForStepId: string;
    readonly waitingForStepName: string;
  };

  readonly isTeardown?: boolean;
  readonly isLifecycleHook?: boolean;

  readonly failure?: {
    readonly reason: string;
    readonly propagatedToStepIds: string[];
  };

  readonly variable?: {
    readonly key: string;
    readonly maskedValue: string;
  };

  readonly skipReason?: string;
}

export interface ReplaySession {
  readonly runId: string;
  readonly collectionId: string;
  readonly collectionName?: string;
  readonly synthesizedAt: string;
  readonly _schemaVersion: 1;
  readonly events: readonly ReplayEvent[];
  readonly eventCount: number;
  readonly stats: {
    readonly requestsSent: number;
    readonly assertionsPassed: number;
    readonly assertionsFailed: number;
    readonly retriesTriggered: number;
    readonly teardownEvents: number;
    readonly failuresPropagated: number;
  };
}
