import type { ApiCollectionRunResult } from '../data/types';
import type { ExecutionSnapshot } from '../shared-core/contracts/dependency-graph.contract';
import type { ReplayEvent, ReplaySession } from './contracts/replay-event.contracts';

const SECRET_KEY_RE = /password|token|secret|apikey|api_key|auth|credential/i;

function maskIfSecret(key: string, value: string): string {
  return SECRET_KEY_RE.test(key) ? '***' : value;
}

function headerKeys(headers: Record<string, string>): string[] {
  return Object.keys(headers).map(k => k.toLowerCase());
}

function bodySizeBytes(body: unknown): number {
  if (body === undefined || body === null) return 0;
  return Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
}

export function synthesizeReplaySession(
  run: ApiCollectionRunResult,
  // _snapshot reserved: future enrichment with retry-triggered + dependency-wait events
  _snapshot?: ExecutionSnapshot,
): ReplaySession {
  const events: ReplayEvent[] = [];
  let seq = 0;

  const stats = {
    requestsSent: 0,
    assertionsPassed: 0,
    assertionsFailed: 0,
    retriesTriggered: 0,
    teardownEvents: 0,
    failuresPropagated: 0,
  };

  for (const step of run.stepResults) {
    const ts = run.startedAt;

    // request-sent
    if (step.request) {
      events.push({
        seq: seq++, kind: 'request-sent', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        request: {
          method: step.request.method,
          url: step.request.url,
          headerKeys: headerKeys(step.request.headers ?? {}),
          bodySizeBytes: bodySizeBytes(step.request.body),
        },
        isTeardown: step.isTeardown,
      });
      stats.requestsSent++;
    }

    // response-received
    if (step.response) {
      events.push({
        seq: seq++, kind: 'response-received', stepId: step.stepId, stepName: step.stepName,
        timestamp: ts, durationMs: step.response.durationMs,
        response: {
          status: step.response.status,
          durationMs: step.response.durationMs,
          bodyTruncated: step.response.bodyTruncated,
          headerKeys: headerKeys(step.response.headers ?? {}),
        },
        isTeardown: step.isTeardown,
      });
    }

    // assertion-evaluated
    for (const ar of step.assertionResults ?? []) {
      events.push({
        seq: seq++, kind: 'assertion-evaluated', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        assertion: { type: ar.field ?? ar.operator ?? 'unknown', passed: ar.passed, message: ar.message },
      });
      if (ar.passed) stats.assertionsPassed++; else stats.assertionsFailed++;
    }

    // variable-extracted
    for (const [key, value] of Object.entries(step.extractedVariables ?? {})) {
      events.push({
        seq: seq++, kind: 'variable-extracted', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        variable: { key, maskedValue: maskIfSecret(key, String(value)) },
      });
    }

    // teardown-executed
    if (step.isTeardown) {
      events.push({
        seq: seq++, kind: 'teardown-executed', stepId: step.stepId, stepName: step.stepName,
        timestamp: ts, durationMs: step.durationMs, isTeardown: true,
      });
      stats.teardownEvents++;
    }

    // step-skipped
    if (step.status === 'skipped') {
      events.push({
        seq: seq++, kind: 'step-skipped', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        skipReason: step.error ?? 'dependency-failed',
      });
    }

    // step-completed (non-skipped terminal event)
    if (step.status !== 'skipped') {
      events.push({
        seq: seq++, kind: 'step-completed', stepId: step.stepId, stepName: step.stepName,
        timestamp: ts, durationMs: step.durationMs,
        isTeardown: step.isTeardown,
      });
    }

    // failure-propagated
    if (step.status === 'failed' || step.status === 'error') {
      events.push({
        seq: seq++, kind: 'failure-propagated', stepId: step.stepId, stepName: step.stepName, timestamp: ts,
        failure: { reason: step.error ?? step.status, propagatedToStepIds: [] },
      });
      stats.failuresPropagated++;
    }
  }

  return {
    runId: run.id,
    collectionId: run.collectionId,
    synthesizedAt: new Date().toISOString(),
    _schemaVersion: 1,
    events,
    eventCount: events.length,
    stats,
  };
}
