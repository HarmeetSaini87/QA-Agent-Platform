// src/api-autonomous/controlled-remediation-executor.ts
// Phase E Step 11: Controlled remediation execution. Advisory simulation — never auto-mutates collections.

import { randomUUID } from 'crypto';
import {
  RemediationExecutionPlan,
  RemediationExecutionResult,
  RemediationEffectivenessRecord,
  RemediationExecutionStatus,
  IControlledRemediationExecutor,
} from './contracts/controlled-remediation.contracts';
import { AutonomyActionCategory } from './contracts/autonomous-governance.contracts';

const GOVERNANCE_NOTE =
  'Execution is advisory simulation only. Actual collection mutation requires a separate user-triggered action.';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export class ControlledRemediationExecutor implements IControlledRemediationExecutor {
  private readonly _plans = new Map<string, RemediationExecutionPlan>();
  private readonly _effectiveness = new Map<string, RemediationEffectivenessRecord[]>();

  createPlan(
    collectionId: string,
    actionCategory: AutonomyActionCategory,
    proposedChanges: RemediationExecutionPlan['proposedChanges'],
    actorId: string,
    confidence: number,
    replayRunId?: string
  ): RemediationExecutionPlan {
    const now = new Date();
    const plan: RemediationExecutionPlan = {
      planId: randomUUID(),
      collectionId,
      actionCategory,
      proposedChanges,
      replayRunId,
      confidence,
      status: 'pending-approval',
      actorId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    this._plans.set(plan.planId, plan);
    return plan;
  }

  approvePlan(planId: string, approverRole: string): RemediationExecutionPlan {
    const plan = this._plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    if (plan.status !== 'pending-approval') throw new Error(`Plan ${planId} is not pending approval`);
    const updated: RemediationExecutionPlan = { ...plan, status: 'approved', approvedBy: approverRole };
    this._plans.set(planId, updated);
    return updated;
  }

  executeApproved(planId: string): RemediationExecutionResult {
    const plan = this._plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    if (plan.status !== 'approved') throw new Error(`Plan ${planId} is not approved`);

    const executing: RemediationExecutionPlan = { ...plan, status: 'executing' };
    this._plans.set(planId, executing);

    const appliedChanges = plan.proposedChanges.map(
      (c) => `${c.field}: ${String(c.currentValue)} → ${String(c.proposedValue)}`
    );

    const completed: RemediationExecutionPlan = { ...executing, status: 'completed' };
    this._plans.set(planId, completed);

    return {
      planId,
      collectionId: plan.collectionId,
      status: 'completed',
      appliedChanges,
      rollbackAvailable: true,
      auditTrail: [
        `Plan ${planId} created by ${plan.actorId}`,
        `Approved by ${plan.approvedBy ?? 'unknown'}`,
        `Executed advisory simulation at ${new Date().toISOString()}`,
      ],
      executedAt: new Date().toISOString(),
      advisoryNote: GOVERNANCE_NOTE,
    };
  }

  rollback(planId: string): RemediationExecutionResult {
    const plan = this._plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    const rolled: RemediationExecutionPlan = { ...plan, status: 'rolled-back' };
    this._plans.set(planId, rolled);
    return {
      planId,
      collectionId: plan.collectionId,
      status: 'rolled-back',
      appliedChanges: [],
      rollbackAvailable: false,
      auditTrail: [`Plan ${planId} rolled back at ${new Date().toISOString()}`],
      executedAt: new Date().toISOString(),
      advisoryNote: GOVERNANCE_NOTE,
    };
  }

  getPlan(planId: string): RemediationExecutionPlan | null {
    return this._plans.get(planId) ?? null;
  }

  listPlans(collectionId: string, status?: RemediationExecutionStatus): RemediationExecutionPlan[] {
    const all = [...this._plans.values()].filter((p) => p.collectionId === collectionId);
    return status ? all.filter((p) => p.status === status) : all;
  }

  recordEffectiveness(record: RemediationEffectivenessRecord): void {
    const prev = this._effectiveness.get(record.collectionId) ?? [];
    this._effectiveness.set(record.collectionId, [...prev, record]);
  }

  listEffectiveness(collectionId: string): RemediationEffectivenessRecord[] {
    return this._effectiveness.get(collectionId) ?? [];
  }

  _reset(): void {
    this._plans.clear();
    this._effectiveness.clear();
  }
}

export const globalControlledRemediationExecutor = new ControlledRemediationExecutor();
