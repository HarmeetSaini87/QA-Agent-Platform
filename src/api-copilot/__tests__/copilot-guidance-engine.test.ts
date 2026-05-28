import { describe, it, expect, beforeEach } from 'vitest';
import { CopilotGuidanceEngine } from '../copilot-guidance-engine';
import { CopilotQuery } from '../contracts/copilot-guidance.contracts';

function makeQuery(overrides: Partial<CopilotQuery> = {}): CopilotQuery {
  return {
    queryId: 'q1',
    queryType: 'workflow-guidance',
    collectionId: 'col1',
    actorId: 'actor1',
    context: {},
    askedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CopilotGuidanceEngine', () => {
  let engine: CopilotGuidanceEngine;

  beforeEach(() => {
    engine = new CopilotGuidanceEngine();
  });

  it('returns a result with items', () => {
    const result = engine.guide(makeQuery());
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.queryId).toBe('q1');
  });

  it('result has governance note', () => {
    const result = engine.guide(makeQuery());
    expect(result.governanceNote).toBeTruthy();
  });

  it('items have confidence 0–100', () => {
    const result = engine.guide(makeQuery());
    for (const item of result.items) {
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(100);
    }
  });

  it('items have advisory note', () => {
    const result = engine.guide(makeQuery());
    for (const item of result.items) {
      expect(item.advisoryNote).toBeTruthy();
    }
  });

  it('listHistory returns empty before any guidance', () => {
    expect(engine.listHistory('col1')).toHaveLength(0);
  });

  it('listHistory accumulates results', () => {
    engine.guide(makeQuery({ queryId: 'q1' }));
    engine.guide(makeQuery({ queryId: 'q2' }));
    expect(engine.listHistory('col1')).toHaveLength(2);
  });

  it('listHistory is per-collection', () => {
    engine.guide(makeQuery({ collectionId: 'col1' }));
    engine.guide(makeQuery({ collectionId: 'col2' }));
    expect(engine.listHistory('col1')).toHaveLength(1);
    expect(engine.listHistory('col2')).toHaveLength(1);
  });

  it('flakiness-investigation produces warning severity', () => {
    const result = engine.guide(makeQuery({ queryType: 'flakiness-investigation' }));
    expect(result.items[0].severity).toBe('warning');
  });

  it('environment-anomaly produces critical severity', () => {
    const result = engine.guide(makeQuery({ queryType: 'environment-anomaly' }));
    expect(result.items[0].severity).toBe('critical');
  });

  it('runId is included in evidenceRefs when provided', () => {
    const result = engine.guide(makeQuery({ runId: 'run42' }));
    expect(result.items[0].evidenceRefs).toContain('run42');
  });
});
