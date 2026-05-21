import { describe, it, expect } from 'vitest';
import { generateRcaHints } from '../engines/rca-hint-engine';
import type { ReplaySession, ReplayEvent } from '../../api-observability/contracts/replay-event.contracts';

function makeSession(events: Partial<ReplayEvent>[]): ReplaySession {
  const full = events.map((e, i) => ({
    seq: i + 1,
    kind: e.kind ?? 'step-completed',
    stepId: e.stepId ?? `step-${i}`,
    stepName: e.stepName ?? `Step ${i}`,
    timestamp: '2026-01-01T00:00:00Z',
    ...e,
  })) as ReplayEvent[];
  return {
    runId: 'run-test-1',
    collectionId: 'col-1',
    synthesizedAt: '2026-01-01T00:00:00Z',
    _schemaVersion: 1,
    events: full,
    eventCount: full.length,
    stats: { requestsSent: 1, assertionsPassed: 0, assertionsFailed: 1, retriesTriggered: 0, teardownEvents: 0, failuresPropagated: 0 },
  };
}

describe('generateRcaHints', () => {
  it('returns empty hints for a clean session', () => {
    const session = makeSession([{ kind: 'step-completed', stepId: 's1', stepName: 'Get' }]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints).toHaveLength(0);
    expect(bundle.advisoryNote).toBeTruthy();
  });

  it('generates assertion failure hint', () => {
    const session = makeSession([
      { kind: 'request-sent', stepId: 's1', stepName: 'Get User', response: { status: 404, durationMs: 100, bodyTruncated: false, headerKeys: [] } },
      { kind: 'assertion-evaluated', stepId: 's1', stepName: 'Get User', assertion: { type: 'statusCode', passed: false, message: 'expected 200 got 404' } },
    ]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints.some(h => h.title.includes('Assertion failure'))).toBe(true);
    expect(bundle.hints[0].basis).toBe('replay-evidence');
  });

  it('generates propagation cascade hint', () => {
    const session = makeSession([
      { kind: 'failure-propagated', stepId: 's1', stepName: 'Create Order', failure: { reason: 'step failed', propagatedToStepIds: ['s2', 's3'] } },
    ]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints.some(h => h.title.includes('cascade'))).toBe(true);
  });

  it('generates skip cascade hint when 3+ steps skipped', () => {
    const session = makeSession([
      { kind: 'step-skipped', stepId: 's2', stepName: 'Step 2', skipReason: 'dependency failed' },
      { kind: 'step-skipped', stepId: 's3', stepName: 'Step 3', skipReason: 'dependency failed' },
      { kind: 'step-skipped', stepId: 's4', stepName: 'Step 4', skipReason: 'dependency failed' },
    ]);
    const bundle = generateRcaHints(session);
    expect(bundle.hints.some(h => h.title.includes('skipped'))).toBe(true);
  });
});
