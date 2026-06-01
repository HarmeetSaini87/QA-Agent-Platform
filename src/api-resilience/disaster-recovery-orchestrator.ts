import { randomUUID } from 'crypto';
import type {
  DisasterRecoveryPlan,
  RecoveryPlanStatus,
  RecoveryScope,
  WorkerFailoverContinuity,
  QueueRecoveryStrategy,
  IDisasterRecoveryOrchestrator,
} from './contracts/disaster-recovery-orchestration.contracts';

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const GOVERNANCE_NOTE = 'Advisory only — disaster recovery plans require explicit human approval; no runtime mutation occurs.';

const RECOVERY_STEPS: Record<RecoveryScope, Array<{ stepName: string; action: string; advisory: string }>> = {
  'orchestration-recovery': [
    { stepName: 'Assess state', action: 'scan-orchestration-state', advisory: 'Read-only state scan' },
    { stepName: 'Route to standby', action: 'advisory-route-to-standby', advisory: 'Approval required before routing' },
  ],
  'replay-reconstruction': [
    { stepName: 'Locate checkpoint', action: 'find-replay-checkpoint', advisory: 'Read-only checkpoint lookup' },
    { stepName: 'Reconstruct replay', action: 'advisory-replay-reconstruct', advisory: 'Determinism preserved' },
  ],
  'worker-failover': [
    { stepName: 'Identify idle worker', action: 'find-continuity-worker', advisory: 'Advisory worker selection' },
    { stepName: 'Transfer lease', action: 'advisory-lease-transfer', advisory: 'Approval required' },
  ],
  'queue-recovery': [
    { stepName: 'Checkpoint queue state', action: 'checkpoint-queue', advisory: 'Read-only queue scan' },
    { stepName: 'Requeue priority items', action: 'advisory-requeue', advisory: 'Approval required' },
  ],
  'environment-recovery': [
    { stepName: 'Assess environment', action: 'assess-env-health', advisory: 'Read-only health check' },
    { stepName: 'Apply recovery config', action: 'advisory-env-recovery', advisory: 'Approval required' },
  ],
  'replay-continuity': [
    { stepName: 'Validate replay safety', action: 'validate-replay-safety', advisory: 'Determinism check' },
    { stepName: 'Resume replay', action: 'advisory-resume-replay', advisory: 'Approval required' },
  ],
};

export class DisasterRecoveryOrchestrator implements IDisasterRecoveryOrchestrator {
  private _plans = new Map<string, DisasterRecoveryPlan>();

  _reset(): void {
    this._plans.clear();
  }

  createRecoveryPlan(
    plan: Omit<DisasterRecoveryPlan, 'planId' | 'createdAt' | 'expiresAt' | 'governanceNote'>,
  ): DisasterRecoveryPlan {
    const now = new Date();
    const full: DisasterRecoveryPlan = {
      ...plan,
      recoverySteps: plan.recoverySteps.length > 0
        ? plan.recoverySteps
        : RECOVERY_STEPS[plan.scope],
      planId: randomUUID(),
      status: 'pending-approval',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._plans.set(full.planId, full);
    return full;
  }

  approvePlan(planId: string, approvedBy: string): DisasterRecoveryPlan {
    const p = this._plans.get(planId);
    if (!p || p.status !== 'pending-approval') {
      throw new Error(`Plan ${planId} is not in pending-approval status`);
    }
    const updated: DisasterRecoveryPlan = {
      ...p,
      status: 'executing-advisory' as RecoveryPlanStatus,
      approvedBy,
    };
    this._plans.set(planId, updated);
    return updated;
  }

  rejectPlan(planId: string, _reason: string): DisasterRecoveryPlan {
    const p = this._plans.get(planId);
    if (!p || p.status !== 'pending-approval') {
      throw new Error(`Plan ${planId} is not in pending-approval status`);
    }
    const updated: DisasterRecoveryPlan = { ...p, status: 'rolled-back' as RecoveryPlanStatus };
    this._plans.set(planId, updated);
    return updated;
  }

  listPlans(orgId: string, status?: RecoveryPlanStatus): DisasterRecoveryPlan[] {
    return [...this._plans.values()].filter(
      p => p.orgId === orgId && (status == null || p.status === status),
    );
  }

  planWorkerFailover(
    collectionId: string,
    failedWorkerId: string,
    continuityWorkerId: string,
  ): WorkerFailoverContinuity {
    return {
      continuityId: randomUUID(),
      collectionId,
      failedWorkerId,
      continuityWorkerId,
      replayStatePreserved: true,
      queuePositionPreserved: true,
      isAdvisoryOnly: true,
      governanceNote: GOVERNANCE_NOTE,
    };
  }

  adviseQueueRecovery(orgId: string, queueType: string): QueueRecoveryStrategy {
    return {
      strategyId: randomUUID(),
      orgId,
      queueType,
      recoveryAction: 'replay-from-checkpoint',
      estimatedRecoveryMs: 5000,
      isExplainable: true,
      governanceNote: GOVERNANCE_NOTE,
    };
  }
}

export const globalDisasterRecoveryOrchestrator = new DisasterRecoveryOrchestrator();
