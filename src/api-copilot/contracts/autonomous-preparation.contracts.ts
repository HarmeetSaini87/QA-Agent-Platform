// src/api-copilot/contracts/autonomous-preparation.contracts.ts
// Phase E Step 10: Controlled autonomous preparation stubs. APPROVAL-GATED only — never auto-executes.

export type AutonomousActionType =
  | 'retry-param-suggestion'
  | 'dependency-reorder-suggestion'
  | 'environment-correction-suggestion'
  | 'flakiness-quarantine-suggestion';

export type AutonomousActionStatus =
  | 'pending-human-review'
  | 'approved'
  | 'rejected'
  | 'expired';

export interface ApprovalBasedAutonomousAction {
  readonly actionId: string;
  readonly actionType: AutonomousActionType;
  readonly collectionId: string;
  readonly actorId: string;
  readonly proposedChange: Record<string, unknown>;
  readonly rationale: string;
  readonly confidence: number;   // 0–100
  readonly status: AutonomousActionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly governanceNote: string;
}

/** Stub interface — autonomous actions never execute without explicit human approval. */
export interface IAutonomousPreparationEngine {
  /** Produces a pending-human-review action proposal. Never executes the action. */
  propose(
    collectionId: string,
    actionType: AutonomousActionType,
    actorId: string,
    proposedChange: Record<string, unknown>,
    rationale: string,
    confidence: number
  ): ApprovalBasedAutonomousAction;
  listPending(collectionId: string): ApprovalBasedAutonomousAction[];
}

/** No-op stub for future autonomous execution pipeline (requires explicit approvals + audit trail). */
export class NoOpAutonomousExecutionPipeline {
  readonly isNoOp = true as const;
  readonly governanceNote = 'Autonomous execution requires explicit human approval. This stub never executes.';
}
