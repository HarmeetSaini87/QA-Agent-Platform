import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../timeline-builder';
import type { ApiStepResult } from '../../../../data/types';

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 's1', stepName: 'Step 1', status: 'passed',
    request: { method: 'GET', url: 'https://api.test/resource', headers: {}, bodyType: 'none' } as never,
    response: { status: 200, headers: {}, body: {}, bodyTruncated: false, durationMs: 42 },
    assertionResults: [], extractedVariables: {}, durationMs: 42,
    ...overrides,
  };
}

const START = '2026-01-01T00:00:00.000Z';

describe('buildTimeline', () => {
  it('returns timeline with correct metadata', () => {
    const t = buildTimeline('run1', 'col1', [], START);
    expect(t.runId).toBe('run1');
    expect(t.collectionId).toBe('col1');
    expect(t.startedAt).toBe(START);
  });

  it('emits node-started and node-completed for passed step', () => {
    const t = buildTimeline('run1', 'col1', [makeStep()], START);
    const types = t.events.map(e => e.eventType);
    expect(types).toContain('node-started');
    expect(types).toContain('node-completed');
  });

  it('emits node-failed for failed step', () => {
    const t = buildTimeline('run1', 'col1', [makeStep({ status: 'failed' })], START);
    expect(t.events.some(e => e.eventType === 'node-failed')).toBe(true);
  });

  it('emits node-skipped for skipped step', () => {
    const t = buildTimeline('run1', 'col1', [makeStep({ status: 'skipped' })], START);
    expect(t.events.some(e => e.eventType === 'node-skipped')).toBe(true);
  });

  it('emits assertion-failed event for each failed assertion', () => {
    const step = makeStep({
      assertionResults: [
        { passed: false, message: 'status mismatch', field: 'status', operator: 'eq', expected: '200', actual: '404' },
      ],
    });
    const t = buildTimeline('run1', 'col1', [step], START);
    expect(t.events.some(e => e.eventType === 'assertion-failed')).toBe(true);
  });

  it('emits variable-extracted event for each extracted variable', () => {
    const step = makeStep({ extractedVariables: { token: 'abc', userId: '42' } });
    const t = buildTimeline('run1', 'col1', [step], START);
    const varEvents = t.events.filter(e => e.eventType === 'variable-extracted');
    expect(varEvents).toHaveLength(2);
  });

  it('totalDurationMs sums step durations', () => {
    const t = buildTimeline('run1', 'col1', [makeStep({ durationMs: 100 }), makeStep({ stepId: 's2', durationMs: 200 })], START);
    expect(t.totalDurationMs).toBe(300);
  });

  it('empty steps produce no events', () => {
    const t = buildTimeline('run1', 'col1', [], START);
    expect(t.events).toHaveLength(0);
    expect(t.totalDurationMs).toBe(0);
  });
});
