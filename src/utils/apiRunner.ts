import vm from 'node:vm';
import * as fs from 'fs';
import * as path from 'path';
import { request as pwRequest } from 'playwright';
import Ajv from 'ajv';
import type {
  ApiCollection, ApiEnvironment, ApiTestStep,
  ApiCollectionRunResult, ApiStepResult, ApiResponseSnapshot,
  BaselineDiff, JsonDiff,
} from '../data/types';
import { substituteVars, snapshotContext, mergeStepLocals, extractVariables } from './apiVariables';
import type { VariableContext } from './apiVariables';
import { evaluateAssertions } from './apiAssertions';
import { resolveAuthHeaders } from './apiAuth';
import { decryptSensitiveVars } from './apiSecrets';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const RUNS_DIR = path.join(DATA_DIR, 'api-runs');
const BASELINES_DIR = path.join(DATA_DIR, 'api-baselines');
const OA_SPECS_DIR = path.join(DATA_DIR, 'openapi-specs');

const _ajv = new Ajv();

// ── Errors ────────────────────────────────────────────────────────────────────

export class CircularDependencyError extends Error {
  constructor(cycle: string) {
    super(`Circular dependency detected: ${cycle}`);
    this.name = 'CircularDependencyError';
  }
}

// ── Condition evaluation (vm module — spec §6.5) ──────────────────────────────

function evaluateCondition(condition: string, variables: VariableContext): boolean {
  try {
    const sandbox = Object.freeze({ ...variables });
    const ctx = vm.createContext(sandbox);
    return !!vm.runInContext(condition, ctx, { timeout: 100 });
  } catch {
    return false;
  }
}

// ── DAG construction ──────────────────────────────────────────────────────────

const VAR_REF_RE = /\{\{([^}]+)\}\}|\$\{([^}]+)\}/g;

function extractVarRefs(step: ApiTestStep): string[] {
  const refs: string[] = [];
  const scan = (s: string) => { for (const m of s.matchAll(VAR_REF_RE)) refs.push(m[1] ?? m[2]); };
  scan(step.request.url);
  if (step.request.headers) {
    const hdrs = step.request.headers;
    if (Array.isArray(hdrs)) hdrs.forEach((h: { key?: string; value?: string }) => { if (h.value) scan(h.value); if (h.key) scan(h.key); });
    else Object.values(hdrs as Record<string, string>).forEach(scan);
  }
  if (step.request.body && typeof step.request.body === 'string') scan(step.request.body);
  return refs;
}

function buildDAG(steps: ApiTestStep[]): Map<string, Set<string>> {
  const extractionIndex = new Map<string, string>(); // varName → stepId
  for (const s of steps) for (const e of s.extractVariables) extractionIndex.set(e.name, s.id);

  const deps = new Map<string, Set<string>>();
  for (const s of steps) {
    const d = new Set(s.dependsOn ?? []);
    for (const ref of extractVarRefs(s)) {
      const producer = extractionIndex.get(ref);
      if (producer && producer !== s.id) d.add(producer);
    }
    // group ordering
    const sameGroup = steps.filter(x => x.group && x.group === s.group && x.id !== s.id && (x.order ?? 0) < (s.order ?? 0));
    for (const g of sameGroup) d.add(g.id);
    deps.set(s.id, d);
  }
  return deps;
}

function topoSort(steps: ApiTestStep[], deps: Map<string, Set<string>>): ApiTestStep[][] {
  const inDegree = new Map<string, number>();
  for (const s of steps) inDegree.set(s.id, 0);
  for (const [, d] of deps) for (const dep of d) inDegree.set(dep, (inDegree.get(dep) ?? 0)); // no-op intentional

  // Recompute in-degree as number of steps that depend on this step
  const revDeps = new Map<string, Set<string>>();
  for (const s of steps) revDeps.set(s.id, new Set());
  for (const [id, d] of deps) for (const dep of d) revDeps.get(dep)!.add(id);

  // Standard Kahn — inDegree[id] = number of deps for that step
  const deg = new Map<string, number>();
  for (const s of steps) deg.set(s.id, deps.get(s.id)!.size);

  const waves: ApiTestStep[][] = [];
  const remaining = new Set(steps.map(s => s.id));

  while (remaining.size > 0) {
    const wave = steps.filter(s => remaining.has(s.id) && deg.get(s.id) === 0);
    if (wave.length === 0) {
      // Cycle — find it
      const cycleNode = [...remaining][0];
      throw new CircularDependencyError(cycleNode);
    }
    waves.push(wave);
    for (const s of wave) {
      remaining.delete(s.id);
      for (const dependent of revDeps.get(s.id) ?? []) {
        deg.set(dependent, (deg.get(dependent) ?? 1) - 1);
      }
    }
  }
  return waves;
}

// ── Rate limiter (token bucket) ───────────────────────────────────────────────

function makeRateLimiter(rps: number) {
  const intervalMs = 1000 / rps;
  let lastFire = 0;
  return async function throttle() {
    const now = Date.now();
    const wait = intervalMs - (now - lastFire);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastFire = Date.now();
  };
}

// ── Baseline diff ─────────────────────────────────────────────────────────────

function deepJsonDiff(expected: unknown, actual: unknown, pathPrefix = '$'): JsonDiff[] {
  const diffs: JsonDiff[] = [];
  if (typeof expected !== 'object' || expected === null ||
      typeof actual !== 'object' || actual === null) {
    if (expected !== actual) diffs.push({ path: pathPrefix, expected, actual });
    return diffs;
  }
  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(expObj), ...Object.keys(actObj)]);
  for (const k of allKeys) {
    diffs.push(...deepJsonDiff(expObj[k], actObj[k], `${pathPrefix}.${k}`));
  }
  return diffs;
}

function diffBaseline(baseline: ApiResponseSnapshot, current: ApiResponseSnapshot): BaselineDiff {
  const baselineHeaderKeys = new Set(Object.keys(baseline.headers).map(k => k.toLowerCase()));
  const currentHeaderKeys  = new Set(Object.keys(current.headers).map(k => k.toLowerCase()));
  return {
    statusChanged:   baseline.status !== current.status,
    headersAdded:    [...currentHeaderKeys].filter(k => !baselineHeaderKeys.has(k)),
    headersRemoved:  [...baselineHeaderKeys].filter(k => !currentHeaderKeys.has(k)),
    bodyDiff:        deepJsonDiff(baseline.body, current.body),
  };
}

function loadBaseline(stepId: string): ApiResponseSnapshot | null {
  const p = path.join(BASELINES_DIR, `${stepId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as ApiResponseSnapshot; } catch { return null; }
}

function saveBaseline(stepId: string, snapshot: ApiResponseSnapshot): void {
  if (!fs.existsSync(BASELINES_DIR)) fs.mkdirSync(BASELINES_DIR, { recursive: true });
  const clean: ApiResponseSnapshot = { status: snapshot.status, headers: snapshot.headers, body: snapshot.body, durationMs: snapshot.durationMs, bodyTruncated: false };
  fs.writeFileSync(path.join(BASELINES_DIR, `${stepId}.json`), JSON.stringify(clean, null, 2));
}

// ── Contract drift detection ──────────────────────────────────────────────────

function checkContractDrift(response: ApiResponseSnapshot, specId: string): string[] {
  const specPath = path.join(OA_SPECS_DIR, `${specId}.json`);
  if (!fs.existsSync(specPath)) return [];
  try {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Record<string, unknown>;
    const statusKey = String(response.status);
    // Navigate paths[*].responses[status].content[application/json].schema
    const paths = spec['paths'] as Record<string, Record<string, unknown>> | undefined;
    if (!paths) return [];
    for (const pathItem of Object.values(paths)) {
      for (const op of Object.values(pathItem)) {
        const responses = (op as Record<string, unknown>)?.['responses'] as Record<string, unknown> | undefined;
        if (!responses) continue;
        const resp = responses[statusKey] as Record<string, unknown> | undefined;
        if (!resp) continue;
        const content = resp['content'] as Record<string, Record<string, unknown>> | undefined;
        const schema = content?.['application/json']?.['schema'];
        if (!schema) continue;
        try {
          const validate = _ajv.compile(schema);
          const valid = validate(response.body);
          if (!valid && validate.errors) {
            return validate.errors.map(e => `${(e as unknown as Record<string,string>)['instancePath'] || '$'} ${e.message ?? 'invalid'}`);
          }
        } catch { /* malformed schema */ }
        return [];
      }
    }
  } catch { /* malformed spec */ }
  return [];
}

// ── Pre/post script sandbox ───────────────────────────────────────────────────

function runScript(
  script: string,
  variables: VariableContext,
  response?: ApiResponseSnapshot
): Record<string, string> {
  const mutations: Record<string, string> = {};
  try {
    const sandbox = vm.createContext({
      ...Object.freeze({ ...variables }),
      response: response ? Object.freeze(response) : undefined,
      setVar: (key: string, val: string) => { mutations[key] = val; },
    });
    vm.runInContext(script, sandbox, { timeout: 500 });
  } catch (e) {
    // script errors are non-fatal — log only
    console.warn('[apiRunner] script error:', e instanceof Error ? e.message : String(e));
  }
  return mutations;
}

// ── HTTP step executor ────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 50 * 1024;

async function executeStep(
  step: ApiTestStep,
  context: VariableContext,
  authHeaders: Record<string, string>,
  timeoutMs: number,
  baseUrl = ''
): Promise<ApiStepResult> {
  const exec = step.execution ?? {};
  const delay = exec.delayAfterMs ?? 0;

  // Pre-script: may inject/override variables before request
  let ctx = context;
  if (exec.preScript) {
    const mutations = runScript(exec.preScript, context);
    if (Object.keys(mutations).length) ctx = { ...context, ...mutations };
  }

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
    for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) headers[k] = substituteVars(v, ctx);
  }
  Object.assign(headers, authHeaders);

  const queryParams: Record<string, string> = {};
  const rawParams = step.request.queryParams ?? [];
  if (Array.isArray(rawParams)) {
    for (const p of rawParams as { key?: string; value?: string; enabled?: boolean }[]) {
      if (p.enabled !== false && p.key) queryParams[p.key] = substituteVars(p.value ?? '', ctx);
    }
  } else {
    for (const [k, v] of Object.entries(rawParams as Record<string, string>)) queryParams[k] = substituteVars(v, ctx);
  }

  let bodyData: unknown = step.request.body;
  if (typeof bodyData === 'string') bodyData = substituteVars(bodyData, ctx);

  const startMs = Date.now();
  let response: ApiResponseSnapshot;

  try {
    const ctx = await pwRequest.newContext({ extraHTTPHeaders: headers });
    try {
      const fetchOpts: Parameters<typeof ctx.fetch>[1] = {
        method: step.request.method,
        timeout: timeoutMs,
        params: queryParams,
      };
      if (bodyData !== undefined && bodyData !== null &&
          !['GET', 'HEAD', 'OPTIONS'].includes(step.request.method)) {
        if (step.request.bodyType === 'json') {
          fetchOpts.data = bodyData;
          headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
        } else if (step.request.bodyType === 'form') {
          fetchOpts.form = bodyData as Record<string, string>;
        } else {
          fetchOpts.data = bodyData;
        }
      }

      const res = await ctx.fetch(url, fetchOpts);
      const durationMs = Date.now() - startMs;
      const resHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers())) resHeaders[k] = v;

      let body: unknown;
      let bodyTruncated = false;
      const rawBuffer = await res.body();
      if (rawBuffer.length > MAX_BODY_BYTES) {
        bodyTruncated = true;
        body = rawBuffer.slice(0, MAX_BODY_BYTES).toString('utf8');
      } else {
        const text = rawBuffer.toString('utf8');
        try { body = JSON.parse(text); } catch { body = text; }
      }

      response = { status: res.status(), headers: resHeaders, body, bodyTruncated, durationMs };
    } finally {
      await ctx.dispose();
    }
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

  // Baseline diff (Task 5.1)
  if (step.captureBaseline) {
    saveBaseline(step.id, response);
  } else if (step.baselineRunId !== undefined || step.captureBaseline === false) {
    const baseline = loadBaseline(step.id);
    if (baseline) response.baselineDiff = diffBaseline(baseline, response);
  }

  // Contract drift detection (Task 5.2)
  let contractViolations: string[] | undefined;
  if (step.request.openapiSpecId) {
    const violations = checkContractDrift(response, step.request.openapiSpecId);
    if (violations.length) contractViolations = violations;
  }

  // Normalise assertion format: UI stores { source, path } but engine expects { field }
  // source=statusCode → field='status'
  // source=responseTime → field='responseTime'
  // source=responseHeader + path='content-type' → field='header.content-type'
  // source=responseBody + path='$.token' → field='$.token' (JSONPath)
  // Normalise assertion format: UI stores { source, path } but engine expects { field }
  type LooseAssertion = Record<string, unknown>;
  const normalisedAssertions = (step.assertions ?? []).map(a => {
    const la = a as unknown as LooseAssertion;
    if (la['field'] !== undefined) return a;
    const src = la['source'] as string ?? '';
    const pth = la['path'] as string ?? '';
    let field: string;
    if (src === 'statusCode')        field = 'status';
    else if (src === 'responseTime') field = 'responseTime';
    else if (src === 'responseHeader') field = `header.${pth}`;
    else                             field = pth || '$';
    return { ...a, field } as unknown as typeof a;
  });
  const { results: assertionResults, stepStatus: rawStatus } = evaluateAssertions(normalisedAssertions, response);
  const extractedVariables = extractVariables(step.extractVariables ?? [], response);

  // Degrade status if contract violations or baseline diff exist but no hard assertion failures
  let stepStatus = rawStatus;
  if (stepStatus === 'passed') {
    const hasDrift = (contractViolations && contractViolations.length > 0) ||
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

async function executeStepWithRetry(
  step: ApiTestStep,
  context: VariableContext,
  authHeaders: Record<string, string>,
  baseUrl = ''
): Promise<ApiStepResult> {
  const exec = step.execution ?? {};
  const timeout = exec.timeoutMs ?? 30_000;
  const retry = exec.retryPolicy ?? { maxRetries: 0, delayMs: 0 };
  const retryOn = retry.retryOn ?? [500, 502, 503, 504, 429];
  const isIdempotent = exec.idempotent !== false;
  const mutable = ['POST', 'PUT', 'PATCH'].includes(step.request.method);
  const canRetry = isIdempotent || !mutable;

  let last: ApiStepResult | undefined;
  for (let attempt = 0; attempt <= (canRetry ? retry.maxRetries : 0); attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, retry.delayMs * Math.pow(2, attempt - 1)));
    last = await executeStep(step, context, authHeaders, timeout, baseUrl);
    const status = last.response?.status;
    if (last.status !== 'error' && status && !retryOn.includes(status)) break;
    if (!canRetry) break;
  }
  return last!;
}

// ── Chunk helper (maxConcurrency) ─────────────────────────────────────────────

async function runChunked<I, O>(items: I[], concurrency: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const results: O[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.map(fn)));
  }
  return results;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function runCollection(
  collection: ApiCollection,
  environment: ApiEnvironment,
  runId: string
): Promise<ApiCollectionRunResult> {
  const startedAt = new Date().toISOString();

  // Task 4.8: Separate test steps from teardown steps
  const testSteps = collection.steps.filter(s => !s.execution?.teardown);
  const teardownSteps = collection.steps.filter(s => s.execution?.teardown);

  const decryptedEnvVars = decryptSensitiveVars(environment.variables ?? []);
  let sharedContext: VariableContext = {};
  for (const v of decryptedEnvVars) sharedContext[v.key] = v.value;
  for (const v of collection.variables ?? []) sharedContext[v.key] = v.value;

  // Build execution waves based on mode:
  // sequential  → one wave per step, strict order (ignores dependsOn/DAG)
  // parallel    → one single wave containing ALL steps (ignores dependsOn/DAG, no chaining)
  // auto (default) → DAG-based topological sort, respects dependsOn + variable refs
  const mode = collection.executionMode ?? 'auto';
  const deps = buildDAG(testSteps); // always build — needed for skipDependents onFailure logic
  let waves: ApiTestStep[][];
  if (mode === 'sequential') {
    waves = testSteps.map(s => [s]);
  } else if (mode === 'parallel') {
    waves = [testSteps];
  } else {
    waves = topoSort(testSteps, deps);
  }

  const maxConcurrency = collection.maxConcurrency ?? 5;
  const rpsLimit = collection.rateLimit?.requestsPerSecond ?? 10;
  const throttle = makeRateLimiter(rpsLimit);

  const stepResults: ApiStepResult[] = [];
  const abortedIds = new Set<string>();
  let collectionFailed = false;

  const writePartial = (status: ApiCollectionRunResult['status']) => {
    const partial: ApiCollectionRunResult = {
      id: runId, collectionId: collection.id, projectId: collection.projectId,
      startedAt, completedAt: new Date().toISOString(),
      status, stepResults, variableContext: sharedContext,
    };
    if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUNS_DIR, `${runId}.json`), JSON.stringify(partial, null, 2));
  };

  writePartial('running');

  for (const wave of waves) {
    const waveSteps = wave.filter(s => !abortedIds.has(s.id));
    const stepLocals: Record<string, VariableContext> = {};
    const ctx = snapshotContext(sharedContext);

    const results = await runChunked(waveSteps, maxConcurrency, async (step) => {
      if (step.execution?.condition && !evaluateCondition(step.execution.condition, ctx)) {
        return {
          stepId: step.id, stepName: step.name, status: 'skipped' as const,
          request: step.request, assertionResults: [], extractedVariables: {}, durationMs: 0,
        };
      }
      const authHeaders = await resolveAuthHeaders(environment.authConfig ?? { type: 'none' }, ctx).catch(() => ({}));
      await throttle();
      const result = await executeStepWithRetry(step, ctx, authHeaders, environment.baseUrl ?? "");
      // Task 4.6: healing proposal on 404 with openapiSpecId
      if (result.response?.status === 404 && step.request.openapiSpecId) {
        result.healingProposal = `URL ${step.request.url} returned 404 -- check OpenAPI spec ${step.request.openapiSpecId} for correct path`;
      }
      stepLocals[step.id] = result.extractedVariables;
      return result;
    });

    for (const result of results) {
      stepResults.push(result);
      if (result.status === 'failed' || result.status === 'error') {
        collectionFailed = true;
        const onFail = testSteps.find(s => s.id === result.stepId)?.execution?.onFailure ?? collection.onFailure;
        if (onFail === 'stop') {
          for (const s of testSteps) {
            if (!stepResults.find(r => r.stepId === s.id)) abortedIds.add(s.id);
          }
          break;
        } else if (onFail === 'skipDependents') {
          const markSkipped = (id: string) => {
            for (const s of testSteps) {
              if (deps.get(s.id)?.has(id) && !abortedIds.has(s.id)) { abortedIds.add(s.id); markSkipped(s.id); }
            }
          };
          markSkipped(result.stepId);
        }
      }
    }
    sharedContext = mergeStepLocals(sharedContext, stepLocals, 'last-write-wins');
    writePartial('running');
    if (abortedIds.size > 0 && collection.onFailure === 'stop') break;
  }

  // Task 4.8: teardown steps always run after test steps, regardless of pass/fail
  for (const step of teardownSteps) {
    const authHeaders = await resolveAuthHeaders(environment.authConfig ?? { type: 'none' }, sharedContext).catch(() => ({}));
    const result = await executeStepWithRetry(step, sharedContext, authHeaders, environment.baseUrl ?? "");
    stepResults.push(result);
  }

  // Final status from test steps only -- teardown failures don't affect it
  const finalStatus = collectionFailed ? 'failed' : 'passed';
  const result: ApiCollectionRunResult = {
    id: runId, collectionId: collection.id, projectId: collection.projectId,
    startedAt, completedAt: new Date().toISOString(),
    status: finalStatus, stepResults, variableContext: sharedContext,
  };

  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${runId}.json`), JSON.stringify(result, null, 2));

  // Task 4.5: Jira auto-file defects for failed test steps
  if (collection.autoFileDefects) {
    const testStepResults = stepResults.filter(r => !teardownSteps.find(t => t.id === r.stepId));
    try {
      const { loadJiraConfig, loadDefectsRegistry, saveDefectsRegistry } = await import('./defectsStore');
      const { JiraClient } = await import('./jiraClient');
      const { buildApiDefectAdf } = await import('./adfBuilder');
      const cfg = loadJiraConfig();
      if (cfg?.projectKey) {
        let apiToken = '';
        if (cfg.apiTokenEnc) {
          const { jiraDecryptToken } = await import('../ui/helpers/jira-helpers');
          try { apiToken = jiraDecryptToken(cfg.apiTokenEnc); } catch { /* ignore */ }
        }
        const baseUrl = cfg.baseUrl ?? '';
        if (baseUrl) {
          const client = new JiraClient({ baseUrl, email: cfg.email ?? '', apiToken });
          const reg = loadDefectsRegistry();
          for (const step of testStepResults) {
            if (step.status !== 'failed') continue;
            const failMsg = step.error ?? (step.assertionResults.find(a => !a.passed)?.message ?? 'failed');
            const title = (`[API] ${step.request.method} ${step.request.url} -- ${failMsg}`).slice(0, 200);
            const existing = await client.searchOpenDefectByTestId(step.stepId, collection.id, cfg.projectKey).catch(() => null);
            if (!existing) {
              const adf = buildApiDefectAdf(step, collection, environment);
              const issue = await client.createIssue({
                projectKey: cfg.projectKey, issueType: 'Bug', summary: title, descriptionADF: adf, priority: 'High',
              }).catch(() => null);
              if (issue) {
                reg.defects.push({
                  defectKey: issue.key, jiraId: issue.id,
                  testId: step.stepId, testName: step.stepName,
                  suiteId: collection.id, suiteName: collection.name,
                  environmentId: environment.id, environmentName: environment.name,
                  projectId: cfg.projectKey, parentStoryKey: '',
                  status: 'open', createdAt: new Date().toISOString(), createdBy: 'api-runner',
                  filedFromRunId: runId, jiraUrl: issue.self,
                  attachments: {}, comments: [],
                });
                saveDefectsRegistry(reg);
              }
            }
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  return result;
}
