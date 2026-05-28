import { describe, it, expect, beforeEach } from 'vitest';
import { AutonomousPreparationEngine } from '../autonomous-preparation-engine';

describe('AutonomousPreparationEngine', () => {
  let engine: AutonomousPreparationEngine;

  beforeEach(() => {
    engine = new AutonomousPreparationEngine();
    engine._reset();
  });

  it('propose returns pending-human-review status', () => {
    const action = engine.propose('col1', 'retry-param-suggestion', 'actor1', { maxRetries: 3 }, 'High retry rate', 80);
    expect(action.status).toBe('pending-human-review');
  });

  it('propose sets expiresAt in the future', () => {
    const action = engine.propose('col1', 'retry-param-suggestion', 'actor1', {}, 'test', 70);
    expect(new Date(action.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('propose has governance note', () => {
    const action = engine.propose('col1', 'retry-param-suggestion', 'actor1', {}, 'reason', 60);
    expect(action.governanceNote).toBeTruthy();
  });

  it('propose sets all provided fields', () => {
    const action = engine.propose('col1', 'dependency-reorder-suggestion', 'actor2', { order: [1, 2] }, 'order fix', 90);
    expect(action.actionType).toBe('dependency-reorder-suggestion');
    expect(action.actorId).toBe('actor2');
    expect(action.confidence).toBe(90);
  });

  it('listPending returns empty for unknown collection', () => {
    expect(engine.listPending('unknown')).toHaveLength(0);
  });

  it('listPending returns proposed actions', () => {
    engine.propose('col1', 'retry-param-suggestion', 'actor1', {}, 'r', 50);
    engine.propose('col1', 'environment-correction-suggestion', 'actor1', {}, 'r', 60);
    expect(engine.listPending('col1')).toHaveLength(2);
  });

  it('listPending is scoped per collection', () => {
    engine.propose('col1', 'retry-param-suggestion', 'actor1', {}, 'r', 50);
    engine.propose('col2', 'retry-param-suggestion', 'actor1', {}, 'r', 50);
    expect(engine.listPending('col1')).toHaveLength(1);
  });

  it('each propose returns a unique actionId', () => {
    const a1 = engine.propose('col1', 'retry-param-suggestion', 'a', {}, 'r', 50);
    const a2 = engine.propose('col1', 'retry-param-suggestion', 'a', {}, 'r', 50);
    expect(a1.actionId).not.toBe(a2.actionId);
  });
});
