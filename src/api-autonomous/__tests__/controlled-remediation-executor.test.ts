import { describe, it, expect, beforeEach } from 'vitest';
import { ControlledRemediationExecutor } from '../controlled-remediation-executor';

describe('ControlledRemediationExecutor', () => {
  let executor: ControlledRemediationExecutor;

  beforeEach(() => {
    executor = new ControlledRemediationExecutor();
    executor._reset();
  });

  const changes = [{ field: 'maxRetries', currentValue: 3, proposedValue: 2, rationale: 'reduce storm' }] as const;

  it('createPlan returns pending-approval status', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    expect(plan.status).toBe('pending-approval');
  });

  it('createPlan sets expiresAt in future', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    expect(new Date(plan.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('createPlan has governance note', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    expect(plan.governanceNote).toBeTruthy();
  });

  it('approvePlan changes status to approved', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    const approved = executor.approvePlan(plan.planId, 'admin');
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('admin');
  });

  it('approvePlan throws on non-pending plan', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    executor.approvePlan(plan.planId, 'admin');
    expect(() => executor.approvePlan(plan.planId, 'admin')).toThrow();
  });

  it('executeApproved returns completed result', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    executor.approvePlan(plan.planId, 'admin');
    const result = executor.executeApproved(plan.planId);
    expect(result.status).toBe('completed');
    expect(result.rollbackAvailable).toBe(true);
  });

  it('executeApproved throws on non-approved plan', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    expect(() => executor.executeApproved(plan.planId)).toThrow();
  });

  it('rollback sets status to rolled-back', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    executor.approvePlan(plan.planId, 'admin');
    executor.executeApproved(plan.planId);
    const result = executor.rollback(plan.planId);
    expect(result.status).toBe('rolled-back');
    expect(result.rollbackAvailable).toBe(false);
  });

  it('listPlans filters by collectionId', () => {
    executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    executor.createPlan('col2', 'retry-tuning', changes, 'actor1', 80);
    expect(executor.listPlans('col1')).toHaveLength(1);
  });

  it('listPlans filters by status', () => {
    const plan = executor.createPlan('col1', 'retry-tuning', changes, 'actor1', 80);
    executor.approvePlan(plan.planId, 'admin');
    expect(executor.listPlans('col1', 'approved')).toHaveLength(1);
    expect(executor.listPlans('col1', 'pending-approval')).toHaveLength(0);
  });

  it('recordEffectiveness and listEffectiveness', () => {
    executor.recordEffectiveness({
      planId: 'p1',
      collectionId: 'col1',
      actionCategory: 'retry-tuning',
      wasEffective: true,
      preRemediationMetric: 0.8,
      postRemediationMetric: 0.3,
      measuredAt: new Date().toISOString(),
    });
    expect(executor.listEffectiveness('col1')).toHaveLength(1);
  });
});
