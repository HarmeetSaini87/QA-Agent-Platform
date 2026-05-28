// src/api-autonomous/contracts/controlled-remediation.contracts.ts
// Phase E Step 11: Controlled remediation execution contracts. Approval-gated — never auto-mutates runtime.

import { AutonomyActionCategory } from './autonomous-governance.contracts';

export type RemediationExecutionStatus =
  | 'pending-approval'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled-back'
  | 'expired';

export interface RemediationExecutionPlan {
  readonly planId: string;
  readonly collectionId: string;
  readonly actionCategory: AutonomyActionCategory;
  readonly proposedChanges: readonly {
    readonly field: string;
    readonly currentValue: unknown;
    readonly proposedValue: unknown;
    readonly rationale: string;
  }[];
  readonly replayRunId?: string;
  readonly confidence: number;          // 0–100
  readonly status: RemediationExecutionStatus;
  readonly actorId: string;
  readonly approvedBy?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly governanceNote: string;
}

export interface RemediationExecutionResult {
  readonly planId: string;
  readonly collectionId: string;
  readonly status: RemediationExecutionStatus;
  readonly appliedChanges: readonly string[];
  readonly rollbackAvailable: boolean;
  readonly auditTrail: readonly string[];
  readonly executedAt: string;
  readonly advisoryNote: string;
}

export interface RemediationEffectivenessRecord {
  readonly planId: string;
  readonly collectionId: string;
  readonly actionCategory: AutonomyActionCategory;
  readonly wasEffective: boolean;
  readonly preRemediationMetric: number;
  readonly postRemediationMetric: number;
  readonly measuredAt: string;
}

export interface IControlledRemediationExecutor {
  createPlan(
    collectionId: string,
    actionCategory: AutonomyActionCategory,
    proposedChanges: RemediationExecutionPlan['proposedChanges'],
    actorId: string,
    confidence: number,
    replayRunId?: string
  ): RemediationExecutionPlan;
  approvePlan(planId: string, approverRole: string): RemediationExecutionPlan;
  /** Simulated execution — advisory result only; actual collection mutation requires separate user action. */
  executeApproved(planId: string): RemediationExecutionResult;
  rollback(planId: string): RemediationExecutionResult;
  getPlan(planId: string): RemediationExecutionPlan | null;
  listPlans(collectionId: string, status?: RemediationExecutionStatus): RemediationExecutionPlan[];
  recordEffectiveness(record: RemediationEffectivenessRecord): void;
  listEffectiveness(collectionId: string): RemediationEffectivenessRecord[];
}
