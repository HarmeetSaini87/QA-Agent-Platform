/**
 * payload.contract.ts
 * SKELETON — Phase C implementation target.
 *
 * ExecutionPayload models for UI and API runtime workers.
 * workflowJson is always JSON.stringify(WorkflowEnvelope) — safe for IPC serialization.
 * Phase A: type definitions only.
 */

export type RuntimeTypeValue = 'ui' | 'api';

export type ExecutionPayloadBase = {
  runId: string;
  runtimeType: RuntimeTypeValue;
  /** JSON.stringify(WorkflowEnvelope) — pre-serialized to avoid IPC Map/Set issues */
  workflowJson: string;
  triggeredBy: 'manual' | 'schedule' | 'api';
  /** Selective rerun: only execute these nodeIds */
  targetNodeIds?: string[];
  environmentId?: string;
};

export type ApiExecutionPayload = ExecutionPayloadBase & {
  runtimeType: 'api';
  baseUrl?: string;
  authOverride?: Record<string, string>;
};

export type UiExecutionPayload = ExecutionPayloadBase & {
  runtimeType: 'ui';
  headed?: boolean;
  browserName?: 'chromium' | 'firefox' | 'webkit';
};

export type ExecutionPayload = ApiExecutionPayload | UiExecutionPayload;
