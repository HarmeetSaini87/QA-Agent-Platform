/**
 * node-executor.ts — NodeExecutor
 * Phase B Step 7: executeStep pipeline extracted from apiRunner.ts.
 *
 * NodeExecutor owns the single-node execution pipeline:
 *   pre-script → URL/header/body substitution → transport → post-script
 *   → baseline diff → contract drift → assertions → variable extraction → result
 *
 * Does NOT own:
 *   - retry loop        → retry-engine (executeWithRetry wraps this)
 *   - wave orchestration → workflow-engine (WorkflowEngine calls executeWithRetry)
 *   - auth resolution   → apiAuth (resolved before NodeExecutor is called)
 *   - rate limiting     → workflow-engine (throttle applied before each node)
 *
 * Transport boundary: PlaywrightApiAdapter is injected, never imported directly.
 * nodeType guard: Phase B handles HTTP only — non-HTTP nodes throw.
 */

import type { ApiTestStep, ApiStepResult, ApiResponseSnapshot } from '../../data/types';
import type { VariableContext } from '../../utils/apiVariables';
import { substituteVars, extractVariables } from '../../utils/apiVariables';
import { evaluateAssertions } from '../../utils/apiAssertions';
import { normaliseAssertions } from '../assertion-engine/engine';
import { getAdapter } from '../playwright-api-adapter/adapter';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';
import { runScript } from './script-sandbox';
import { deepJsonDiff, diffBaseline, loadBaseline, saveBaseline } from './baseline';
import { checkContractDrift } from './contract';

// ── NodeExecutor ──────────────────────────────────────────────────────────────

export async function executeNode(
  step: ApiTestStep,
  context: VariableContext,
  authHeaders: Record<string, string>,
  timeoutMs: number,
  baseUrl = ''
): Promise<ApiStepResult> {
  // nodeType guard — Phase B: HTTP nodes only
  const nodeType = (step as { nodeType?: string }).nodeType;
  if (nodeType && nodeType !== 'HTTP') {
    throw new Error(`NodeExecutor: unsupported nodeType '${nodeType}' — Phase B supports HTTP only`);
  }

  const exec = step.execution ?? {};
  const delay = exec.delayAfterMs ?? 0;

  // Pre-script: may inject/override variables before request
  let ctx = context;
  if (exec.preScript) {
    const mutations = runScript(exec.preScript, context);
    if (Object.keys(mutations).length) ctx = { ...context, ...mutations };
  }

  // URL + header + query param + body substitution
  const rawUrl = substituteVars(step.request.url, ctx);
  const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : `${baseUrl.replace(/\/$/, '')}${rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl}`;

  const headers: Record<string, string> = {};
  const rawHeaders = step.request.headers ?? [];
  if (Array.isArray(rawHeaders)) {
    for (const h of rawHeaders as { key?: string; value?: string; enabled?: boolean }[]) {
      if (h.enabled !== false && h.key) headers[h.key] = substituteVars(h.value ?? '', ctx);
    }
  } else {
    for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
      headers[k] = substituteVars(v, ctx);
    }
  }
  Object.assign(headers, authHeaders);

  const queryParams: Record<string, string> = {};
  const rawParams = step.request.queryParams ?? [];
  if (Array.isArray(rawParams)) {
    for (const p of rawParams as { key?: string; value?: string; enabled?: boolean }[]) {
      if (p.enabled !== false && p.key) queryParams[p.key] = substituteVars(p.value ?? '', ctx);
    }
  } else {
    for (const [k, v] of Object.entries(rawParams as Record<string, string>)) {
      queryParams[k] = substituteVars(v, ctx);
    }
  }

  let bodyData: unknown = step.request.body;
  if (typeof bodyData === 'string') bodyData = substituteVars(bodyData, ctx);

  const startMs = Date.now();
  let response: ApiResponseSnapshot;

  // Transport: PlaywrightApiAdapter owns context lifecycle + dispose() guarantee
  try {
    const adapterResult = await getAdapter().execute({
      request: { ...step.request, url, body: bodyData },
      context: ctx as unknown as VariableMap,
      authHeaders,
      timeoutMs,
    });
    response = adapterResult.snapshot;
  } catch (err: unknown) {
    const durationMs = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    return {
      stepId: step.id, stepName: step.name,
      status: 'error',
      request: step.request,
      assertionResults: [],
      extractedVariables: {},
      durationMs,
      error: msg,
    };
  }

  // Post-script: may read response and set variables
  if (exec.postScript) {
    const mutations = runScript(exec.postScript, ctx, response);
    Object.assign(ctx, mutations);
  }

  // Baseline diff
  if (step.captureBaseline) {
    saveBaseline(step.id, response);
  } else if (step.baselineRunId !== undefined || step.captureBaseline === false) {
    const baseline = loadBaseline(step.id);
    if (baseline) response.baselineDiff = diffBaseline(baseline, response);
  }

  // Contract drift detection
  let contractViolations: string[] | undefined;
  if (step.request.openapiSpecId) {
    const violations = checkContractDrift(response, step.request.openapiSpecId);
    if (violations.length) contractViolations = violations;
  }

  // Assertion evaluation
  const normalisedAssertions = normaliseAssertions(step.assertions ?? []);
  const { results: assertionResults, stepStatus: rawStatus } = evaluateAssertions(normalisedAssertions, response);
  const extractedVariables = extractVariables(step.extractVariables ?? [], response);

  // Degrade status if contract violations or baseline drift (no hard assertion failures)
  let stepStatus = rawStatus;
  if (stepStatus === 'passed') {
    const hasDrift =
      (contractViolations && contractViolations.length > 0) ||
      (response.baselineDiff && (
        response.baselineDiff.statusChanged ||
        response.baselineDiff.headersAdded.length > 0 ||
        response.baselineDiff.headersRemoved.length > 0 ||
        response.baselineDiff.bodyDiff.length > 0
      ));
    if (hasDrift) stepStatus = 'degraded';
  }

  if (delay > 0) await new Promise(r => setTimeout(r, delay));

  return {
    stepId: step.id, stepName: step.name,
    status: stepStatus,
    request: step.request,
    response,
    assertionResults,
    extractedVariables,
    durationMs: response.durationMs,
    ...(contractViolations ? { contractViolations } : {}),
  };
}

// Re-export helpers for callers that need them (e.g. apiRunner.ts compatibility)
export { deepJsonDiff, diffBaseline, loadBaseline, saveBaseline } from './baseline';
export { checkContractDrift } from './contract';
export { runScript } from './script-sandbox';
