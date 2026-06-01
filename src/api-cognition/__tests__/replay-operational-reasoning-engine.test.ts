import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayOperationalReasoningEngine } from '../replay-operational-reasoning-engine';
import { ReasoningDimension } from '../contracts/replay-operational-reasoning.contracts';

describe('ReplayOperationalReasoningEngine', () => {
  let engine: ReplayOperationalReasoningEngine;

  beforeEach(() => {
    engine = new ReplayOperationalReasoningEngine();
    engine._reset();
  });

  it('buildReasoningTrail returns a trail with correct IDs', () => {
    const trail = engine.buildReasoningTrail('run1', 'col1', ['retry-cognition']);
    expect(trail.runId).toBe('run1');
    expect(trail.collectionId).toBe('col1');
  });

  it('trail has one step per dimension', () => {
    const dims: ReasoningDimension[] = ['retry-cognition', 'dependency-cognition'];
    const trail = engine.buildReasoningTrail('run1', 'col1', dims);
    expect(trail.steps).toHaveLength(2);
  });

  it('trail steps have observation and inference', () => {
    const trail = engine.buildReasoningTrail('run1', 'col1', ['orchestration-bottleneck']);
    expect(trail.steps[0].observation).toBeTruthy();
    expect(trail.steps[0].inference).toBeTruthy();
  });

  it('trail isExplainable is true', () => {
    const trail = engine.buildReasoningTrail('run1', 'col1', []);
    expect(trail.isExplainable).toBe(true);
  });

  it('trail overallConfidence is 0–100', () => {
    const trail = engine.buildReasoningTrail('run1', 'col1', ['remediation-effectiveness']);
    expect(trail.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(trail.overallConfidence).toBeLessThanOrEqual(100);
  });

  it('trail has advisory note', () => {
    const trail = engine.buildReasoningTrail('run1', 'col1', []);
    expect(trail.advisoryNote).toBeTruthy();
  });

  it('each call returns a unique trailId', () => {
    const t1 = engine.buildReasoningTrail('run1', 'col1', []);
    const t2 = engine.buildReasoningTrail('run1', 'col1', []);
    expect(t1.trailId).not.toBe(t2.trailId);
  });

  it('recordOptimizationReasoning and listOptimizationReasoning', () => {
    engine.recordOptimizationReasoning({
      recordId: 'rec1',
      collectionId: 'col1',
      dimension: 'retry-cognition',
      currentState: 'maxRetries=5',
      optimizedState: 'maxRetries=2',
      rationale: 'Reduce storm risk',
      expectedImprovement: 0.3,
      confidence: 75,
      generatedAt: new Date().toISOString(),
    });
    expect(engine.listOptimizationReasoning('col1')).toHaveLength(1);
  });

  it('listOptimizationReasoning is per-collection', () => {
    engine.recordOptimizationReasoning({
      recordId: 'r1', collectionId: 'col1', dimension: 'retry-cognition',
      currentState: 'a', optimizedState: 'b', rationale: 'r',
      expectedImprovement: 0.2, confidence: 70, generatedAt: new Date().toISOString(),
    });
    expect(engine.listOptimizationReasoning('col2')).toHaveLength(0);
  });
});
