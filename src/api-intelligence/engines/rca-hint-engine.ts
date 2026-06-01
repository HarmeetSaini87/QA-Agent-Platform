import { nanoid } from 'nanoid';
import { ReplaySession } from '../../api-observability/contracts/replay-event.contracts';
import { RcaHint, RcaHintBundle } from '../contracts/rca-hints.contracts';

const ADVISORY = 'AI RCA hints are advisory only — heuristic suggestions based on replay event analysis. They do not alter execution.';

export function generateRcaHints(session: ReplaySession): RcaHintBundle {
  const hints: RcaHint[] = [];
  const events = session.events;

  // Hint: First assertion failure
  const firstAssertionFail = events.find(e => e.kind === 'assertion-evaluated' && e.assertion?.passed === false);
  if (firstAssertionFail) {
    const priorRequest = events
      .filter(e => e.seq < firstAssertionFail.seq && e.kind === 'request-sent' && e.stepId === firstAssertionFail.stepId)
      .at(-1);
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      stepId: firstAssertionFail.stepId,
      stepName: firstAssertionFail.stepName,
      title: `Assertion failure on step "${firstAssertionFail.stepName}"`,
      probableCause: [
        `Assertion "${firstAssertionFail.assertion?.type}" failed.`,
        firstAssertionFail.assertion?.message ?? '',
        priorRequest?.response?.status ? `Response status: ${priorRequest.response.status}.` : '',
      ].filter(Boolean).join(' '),
      confidence: 80,
      basis: 'replay-evidence',
      evidences: [
        { type: 'replay', ref: `seq:${firstAssertionFail.seq}`, detail: 'Assertion evaluated — failed' },
        ...(priorRequest ? [{ type: 'replay' as const, ref: `seq:${priorRequest.seq}`, detail: `Request sent: ${priorRequest.request?.method} ${priorRequest.request?.url}` }] : []),
      ],
      generatedAt: new Date().toISOString(),
    });
  }

  // Hint: Failure propagation cascade
  const propagationEvents = events.filter(e => e.kind === 'failure-propagated');
  if (propagationEvents.length > 0) {
    // Uses only the first propagation root; additional independent cascade chains are not separately reported.
    // For advisory hints, a single chain hint is sufficient to direct investigation.
    const root = propagationEvents[0];
    const affectedCount = root.failure?.propagatedToStepIds?.length ?? 0;
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      stepId: root.stepId,
      stepName: root.stepName,
      title: `Failure cascade from step "${root.stepName}" — ${affectedCount} dependent(s) affected`,
      probableCause: `Step "${root.stepName}" failed (${root.failure?.reason ?? 'unknown reason'}) and caused ${affectedCount} dependent step(s) to skip: ${(root.failure?.propagatedToStepIds ?? []).join(', ')}.`,
      confidence: 90,
      basis: 'replay-evidence',
      evidences: [
        { type: 'replay', ref: `seq:${root.seq}`, detail: 'Failure propagated' },
        ...(root.failure?.propagatedToStepIds ?? []).map(sid => ({ type: 'replay' as const, ref: sid, detail: 'Affected dependent step' })),
      ],
      generatedAt: new Date().toISOString(),
    });
  }

  // Hint: Retry hotspot — step with the most retry events
  const retryEvents = events.filter(e => e.kind === 'retry-triggered');
  if (retryEvents.length > 0) {
    const retryByStep: Record<string, number> = {};
    for (const e of retryEvents) retryByStep[e.stepId] = (retryByStep[e.stepId] ?? 0) + 1;
    const [topStepId, retryCount] = Object.entries(retryByStep).sort(([, a], [, b]) => b - a)[0];
    const topEvent = retryEvents.find(e => e.stepId === topStepId)!;
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      stepId: topStepId,
      stepName: topEvent.stepName,
      title: `Step "${topEvent.stepName}" required ${retryCount} retry attempt(s)`,
      probableCause: [
        `This step triggered ${retryCount} retries.`,
        topEvent.retry?.triggerError ? `Trigger error: ${topEvent.retry.triggerError}.` : '',
        topEvent.retry?.triggerStatus ? `Trigger status: ${topEvent.retry.triggerStatus}.` : '',
        'Repeated retries suggest network instability, slow endpoints, or assertion fragility.',
      ].filter(Boolean).join(' '),
      confidence: 70,
      basis: 'replay-evidence',
      evidences: retryEvents
        .filter(e => e.stepId === topStepId)
        .map(e => ({ type: 'replay' as const, ref: `seq:${e.seq}`, detail: `Retry attempt ${e.retry?.attempt ?? '?'} of ${e.retry?.maxRetries ?? '?'}` })),
      generatedAt: new Date().toISOString(),
    });
  }

  // Hint: Skip cascade — many steps skipped
  const skippedEvents = events.filter(e => e.kind === 'step-skipped');
  if (skippedEvents.length > 2) {
    hints.push({
      id: nanoid(8),
      runId: session.runId,
      title: `${skippedEvents.length} steps were skipped — likely dependency cascade`,
      probableCause: `${skippedEvents.length} steps were skipped, which typically means one or more upstream steps failed and their dependents were cascaded into skip state.`,
      confidence: 75,
      basis: 'replay-evidence',
      evidences: skippedEvents.slice(0, 4).map(e => ({
        type: 'replay' as const,
        ref: `seq:${e.seq}`,
        detail: `"${e.stepName}" skipped: ${e.skipReason ?? 'dependency failed'}`,
      })),
      generatedAt: new Date().toISOString(),
    });
  }

  return { runId: session.runId, generatedAt: new Date().toISOString(), hints, advisoryNote: ADVISORY };
}
