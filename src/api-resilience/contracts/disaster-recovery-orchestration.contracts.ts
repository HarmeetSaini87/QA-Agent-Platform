export type RecoveryPlanStatus =
  | 'pending-approval'
  | 'approved'
  | 'executing-advisory'
  | 'completed'
  | 'rolled-back';

export type RecoveryScope =
  | 'orchestration-recovery'
  | 'replay-reconstruction'
  | 'worker-failover'
  | 'queue-recovery'
  | 'environment-recovery'
  | 'replay-continuity';

export interface DisasterRecoveryPlan {
  planId: string;
  orgId: string;
  collectionId: string;
  scope: RecoveryScope;
  triggerCondition: string;
  recoverySteps: Array<{ stepName: string; action: string; advisory: string }>;
  status: RecoveryPlanStatus;
  confidenceScore: number;
  requestedBy: string;
  approvedBy?: string;
  isExplainable: true;
  createdAt: string;
  expiresAt: string;
  governanceNote: string;
}

export interface WorkerFailoverContinuity {
  continuityId: string;
  collectionId: string;
  failedWorkerId: string;
  continuityWorkerId: string;
  replayStatePreserved: boolean;
  queuePositionPreserved: boolean;
  isAdvisoryOnly: true;
  governanceNote: string;
}

export interface QueueRecoveryStrategy {
  strategyId: string;
  orgId: string;
  queueType: string;
  recoveryAction: 'replay-from-checkpoint' | 'drain-and-restart' | 'priority-requeue' | 'advisory-only';
  estimatedRecoveryMs: number;
  isExplainable: true;
  governanceNote: string;
}

export interface IDisasterRecoveryOrchestrator {
  createRecoveryPlan(plan: Omit<DisasterRecoveryPlan, 'planId' | 'createdAt' | 'expiresAt' | 'governanceNote'>): DisasterRecoveryPlan;
  approvePlan(planId: string, approvedBy: string): DisasterRecoveryPlan;
  rejectPlan(planId: string, reason: string): DisasterRecoveryPlan;
  listPlans(orgId: string, status?: RecoveryPlanStatus): DisasterRecoveryPlan[];
  planWorkerFailover(collectionId: string, failedWorkerId: string, continuityWorkerId: string): WorkerFailoverContinuity;
  adviseQueueRecovery(orgId: string, queueType: string): QueueRecoveryStrategy;
}
