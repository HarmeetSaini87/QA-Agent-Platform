import { describe, it, expect, beforeEach } from 'vitest';
import { DisasterRecoveryOrchestrator } from '../disaster-recovery-orchestrator';

describe('DisasterRecoveryOrchestrator', () => {
  let orchestrator: DisasterRecoveryOrchestrator;

  beforeEach(() => {
    orchestrator = new DisasterRecoveryOrchestrator();
    orchestrator._reset();
  });

  const createPlan = () => orchestrator.createRecoveryPlan({
    orgId: 'org1', collectionId: 'col1',
    scope: 'orchestration-recovery',
    triggerCondition: 'region us-east-1 degraded',
    recoverySteps: [],
    status: 'pending-approval',
    confidenceScore: 80,
    requestedBy: 'actor1',
    isExplainable: true,
  });

  it('createRecoveryPlan returns pending-approval status', () => {
    expect(createPlan().status).toBe('pending-approval');
  });

  it('createRecoveryPlan sets isExplainable true', () => {
    expect(createPlan().isExplainable).toBe(true);
  });

  it('createRecoveryPlan has governanceNote', () => {
    expect(createPlan().governanceNote).toBeTruthy();
  });

  it('createRecoveryPlan expiresAt is in the future', () => {
    expect(new Date(createPlan().expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('createRecoveryPlan uses default recovery steps when none provided', () => {
    expect(createPlan().recoverySteps.length).toBeGreaterThan(0);
  });

  it('approvePlan changes status to executing-advisory', () => {
    const p = createPlan();
    const approved = orchestrator.approvePlan(p.planId, 'admin');
    expect(approved.status).toBe('executing-advisory');
    expect(approved.approvedBy).toBe('admin');
  });

  it('rejectPlan changes status to rolled-back', () => {
    const p = createPlan();
    const rejected = orchestrator.rejectPlan(p.planId, 'not needed');
    expect(rejected.status).toBe('rolled-back');
  });

  it('approvePlan throws on non-pending plan', () => {
    const p = createPlan();
    orchestrator.approvePlan(p.planId, 'admin');
    expect(() => orchestrator.approvePlan(p.planId, 'admin')).toThrow();
  });

  it('rejectPlan throws on non-pending plan', () => {
    const p = createPlan();
    orchestrator.rejectPlan(p.planId, 'reason');
    expect(() => orchestrator.rejectPlan(p.planId, 'reason')).toThrow();
  });

  it('listPlans filters by orgId', () => {
    orchestrator.createRecoveryPlan({ orgId: 'org1', collectionId: 'c1', scope: 'worker-failover', triggerCondition: 't', recoverySteps: [], status: 'pending-approval', confidenceScore: 75, requestedBy: 'u', isExplainable: true });
    orchestrator.createRecoveryPlan({ orgId: 'org2', collectionId: 'c1', scope: 'worker-failover', triggerCondition: 't', recoverySteps: [], status: 'pending-approval', confidenceScore: 75, requestedBy: 'u', isExplainable: true });
    expect(orchestrator.listPlans('org1')).toHaveLength(1);
  });

  it('listPlans filters by status', () => {
    const p = createPlan();
    orchestrator.approvePlan(p.planId, 'admin');
    expect(orchestrator.listPlans('org1', 'executing-advisory')).toHaveLength(1);
    expect(orchestrator.listPlans('org1', 'pending-approval')).toHaveLength(0);
  });

  it('planWorkerFailover returns isAdvisoryOnly true', () => {
    const result = orchestrator.planWorkerFailover('col1', 'w-old', 'w-new');
    expect(result.isAdvisoryOnly).toBe(true);
    expect(result.replayStatePreserved).toBe(true);
    expect(result.queuePositionPreserved).toBe(true);
  });

  it('adviseQueueRecovery returns isExplainable true', () => {
    const result = orchestrator.adviseQueueRecovery('org1', 'in-memory');
    expect(result.isExplainable).toBe(true);
    expect(result.recoveryAction).toBe('replay-from-checkpoint');
  });
});
