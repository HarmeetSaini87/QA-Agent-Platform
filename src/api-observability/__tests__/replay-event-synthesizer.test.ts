import { describe, it, expect } from 'vitest';
import { synthesizeReplaySession } from '../replay-event-synthesizer';
import type { ApiCollectionRunResult, ApiStepResult } from '../../data/types';

function makeStepResult(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'GET /users',
    status: 'passed',
    request: { method: 'GET', url: 'http://x/users', headers: { Authorization: 'Bearer secret' }, body: undefined, queryParams: {} },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{}', durationMs: 45, bodyTruncated: false },
    assertionResults: [{ type: 'status', passed: true, message: 'status is 200' }],
    extractedVariables: { userId: '42' },
    durationMs: 45,
    ...overrides,
  };
}

function makeRunResult(steps: ApiStepResult[]): ApiCollectionRunResult {
  return {
    id: 'run-1',
    collectionId: 'col-1',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:01Z',
    status: 'passed',
    stepResults: steps,
    variableContext: {},
  };
}

describe('synthesizeReplaySession', () => {
  it('returns a ReplaySession with correct metadata', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    expect(session.runId).toBe('run-1');
    expect(session.collectionId).toBe('col-1');
    expect(session._schemaVersion).toBe(1);
    expect(typeof session.synthesizedAt).toBe('string');
  });

  it('emits request-sent and response-received events for each step', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    const kinds = session.events.map(e => e.kind);
    expect(kinds).toContain('request-sent');
    expect(kinds).toContain('response-received');
  });

  it('masks secret header values — exposes only header keys', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    const reqEvent = session.events.find(e => e.kind === 'request-sent');
    expect(reqEvent!.request!.headerKeys).toContain('authorization');
    const raw = JSON.stringify(session.events);
    expect(raw).not.toContain('Bearer secret');
  });

  it('emits assertion-evaluated events for each assertion result', () => {
    const step = makeStepResult({
      assertionResults: [
        { type: 'status', passed: true, message: 'ok' },
        { type: 'body', passed: false, message: 'body mismatch' },
      ],
    });
    const session = synthesizeReplaySession(makeRunResult([step]));
    const assertions = session.events.filter(e => e.kind === 'assertion-evaluated');
    expect(assertions).toHaveLength(2);
    expect(assertions.find(a => !a.assertion!.passed)!.assertion!.message).toBe('body mismatch');
  });

  it('emits variable-extracted events for each extracted variable', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    const varEvents = session.events.filter(e => e.kind === 'variable-extracted');
    expect(varEvents).toHaveLength(1);
    expect(varEvents[0].variable!.key).toBe('userId');
  });

  it('masks variable values that look like secrets', () => {
    const step = makeStepResult({ extractedVariables: { authToken: 'super-secret-value' } });
    const session = synthesizeReplaySession(makeRunResult([step]));
    const varEvent = session.events.find(e => e.kind === 'variable-extracted');
    expect(varEvent!.variable!.maskedValue).toBe('***');
  });

  it('does not mask non-secret variable values', () => {
    const step = makeStepResult({ extractedVariables: { userId: '42' } });
    const session = synthesizeReplaySession(makeRunResult([step]));
    const varEvent = session.events.find(e => e.kind === 'variable-extracted');
    expect(varEvent!.variable!.maskedValue).toBe('42');
  });

  it('emits step-completed for passed steps', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult({ status: 'passed' })]));
    expect(session.events.some(e => e.kind === 'step-completed')).toBe(true);
  });

  it('emits step-skipped for skipped steps', () => {
    const skipped = makeStepResult({ status: 'skipped', response: undefined });
    const session = synthesizeReplaySession(makeRunResult([skipped]));
    expect(session.events.some(e => e.kind === 'step-skipped')).toBe(true);
  });

  it('emits teardown-executed for teardown steps', () => {
    const td = makeStepResult({ isTeardown: true });
    const session = synthesizeReplaySession(makeRunResult([td]));
    const tdEvent = session.events.find(e => e.kind === 'teardown-executed');
    expect(tdEvent).toBeDefined();
    expect(tdEvent!.isTeardown).toBe(true);
  });

  it('seq numbers are strictly monotonically increasing', () => {
    const run = makeRunResult([makeStepResult({ stepId: 's1' }), makeStepResult({ stepId: 's2', stepName: 'step2' })]);
    const session = synthesizeReplaySession(run);
    const seqs = session.events.map(e => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it('stats.requestsSent equals number of steps with a request', () => {
    const run = makeRunResult([makeStepResult(), makeStepResult({ stepId: 's2', stepName: 's2' })]);
    const session = synthesizeReplaySession(run);
    expect(session.stats.requestsSent).toBe(2);
  });

  it('stats.assertionsFailed counts failed assertions across all steps', () => {
    const step = makeStepResult({
      assertionResults: [{ type: 'status', passed: false, message: 'fail' }],
    });
    const session = synthesizeReplaySession(makeRunResult([step]));
    expect(session.stats.assertionsFailed).toBe(1);
  });

  it('eventCount matches events array length', () => {
    const session = synthesizeReplaySession(makeRunResult([makeStepResult()]));
    expect(session.eventCount).toBe(session.events.length);
  });
});
