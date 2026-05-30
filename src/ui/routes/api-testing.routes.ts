import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readAll, upsert, remove, findById, API_ENVS, API_COLLECTIONS } from '../../data/store';
import type { ApiEnvironment, ApiCollection, ApiCollectionRunResult } from '../../data/types';
import { requireAuth, requireEditor } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { encryptSensitiveVars, decryptSensitiveVars } from '../../utils/apiSecrets';
import { runCollection, runCollectionWithDataFile } from '../../utils/apiRunner';
import { getDataFile, getDataFileRows } from '../../data/data-file-store';
import { execHealthStart, execHealthComplete } from '../../utils/exec-health-store';
import { getCoordinatorBridge, USE_COORDINATOR } from '../../api-runtime/execution-coordinator/coordinator-bridge';
import { resolveAuthHeaders } from '../../utils/apiAuth';
// OLD: direct legacy import — replaced by import-engine adapter in Phase D Step 3
// import { importFromOpenApi } from '../../utils/openapiImport';
// OLD: direct legacy import — replaced by import-engine adapter in Phase D Step 3
// import { importFromPostman } from '../../utils/postmanImport';
import { adaptPostmanImport, adaptOpenApiImport } from '../../api-runtime/import-engine/import-engine-adapter';
import { importFromCurl } from '../../utils/curlImport';
import { substituteVars, snapshotContext } from '../../utils/apiVariables';
import { evaluateAssertions } from '../../utils/apiAssertions';
import { request as pwRequest } from 'playwright';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const RUNS_DIR = path.join(DATA_DIR, 'api-runs');

export function registerApiTestingRoutes(app: express.Application): void {

  // ── Environments ────────────────────────────────────────────────────────────

  app.get('/api/api-envs', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) { res.json([]); return; }
    const all = readAll<ApiEnvironment>(API_ENVS);
    res.json(all.filter(e => e.projectId === projectId).map(e => ({ ...e, variables: decryptSensitiveVars(e.variables) })));
  });

  app.post('/api/api-envs', requireAuth, requireEditor, (req: Request, res: Response) => {
    const body = req.body as Partial<ApiEnvironment>;
    if (!body.name || !body.baseUrl) { res.status(400).json({ error: 'name and baseUrl are required' }); return; }
    if (!body.projectId) { res.status(400).json({ error: 'projectId is required' }); return; }
    const env: ApiEnvironment = {
      id: uuidv4(),
      projectId: body.projectId,
      name: body.name,
      baseUrl: body.baseUrl,
      variables: encryptSensitiveVars(body.variables ?? []),
      authConfig: body.authConfig,
      description: body.description,
      envType: body.envType,
      tags: body.tags,
    };
    upsert(API_ENVS, env);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'CREATE_API_ENV', resourceType: 'api-env', resourceId: env.id, details: env.name, ip: req.ip ?? null });
    res.json({ success: true, id: env.id });
  });

  app.get('/api/api-envs/:id', requireAuth, (req: Request, res: Response) => {
    const env = findById<ApiEnvironment>(API_ENVS, req.params.id);
    if (!env) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ...env, variables: decryptSensitiveVars(env.variables) });
  });

  app.put('/api/api-envs/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    const env = findById<ApiEnvironment>(API_ENVS, req.params.id);
    if (!env) { res.status(404).json({ error: 'Not found' }); return; }
    const body = req.body as Partial<ApiEnvironment>;
    if (body.name)                  env.name        = body.name;
    if (body.baseUrl)               env.baseUrl     = body.baseUrl;
    if (body.variables)             env.variables   = encryptSensitiveVars(body.variables);
    if (body.authConfig !== undefined) env.authConfig = body.authConfig;
    if (body.description !== undefined) env.description = body.description;
    if (body.envType    !== undefined)  env.envType     = body.envType;
    if (body.tags       !== undefined)  env.tags        = body.tags;
    upsert(API_ENVS, env);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'UPDATE_API_ENV', resourceType: 'api-env', resourceId: env.id, details: env.name, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.delete('/api/api-envs/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    remove(API_ENVS, req.params.id);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'DELETE_API_ENV', resourceType: 'api-env', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  // ── Environment: Connection Health Check ────────────────────────────────────
  app.post('/api/api-envs/:id/ping', requireAuth, async (req: Request, res: Response) => {
    const env = findById<ApiEnvironment>(API_ENVS, req.params.id);
    if (!env) { res.status(404).json({ error: 'Not found' }); return; }
    const start = Date.now();
    try {
      const varCtx: Record<string, string> = Object.fromEntries(decryptSensitiveVars(env.variables).map(v => [v.key, v.value]));
      const authHeaders = await resolveAuthHeaders(env.authConfig ?? { type: 'none' }, varCtx);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(env.baseUrl, {
        method: 'HEAD',
        headers: authHeaders as Record<string, string>,
        signal: controller.signal,
      }).catch(async () => {
        // fallback to GET if HEAD not allowed
        return fetch(env.baseUrl, { method: 'GET', headers: authHeaders as Record<string, string>, signal: controller.signal });
      });
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;
      const pingResult = { reachable: true, statusCode: response.status, latencyMs, testedAt: new Date().toISOString() };
      env.lastPingResult = pingResult as ApiEnvironment['lastPingResult'];
      upsert(API_ENVS, env);
      res.json(pingResult);
    } catch (e: unknown) {
      const latencyMs = Date.now() - start;
      const pingResult = { reachable: false, statusCode: null, latencyMs, testedAt: new Date().toISOString(), error: (e as Error).message };
      env.lastPingResult = pingResult as ApiEnvironment['lastPingResult'];
      upsert(API_ENVS, env);
      res.json(pingResult);
    }
  });

  // ── Environment: Parse Postman Environment JSON (no file save — preview only) ─
  app.post('/api/api-envs/parse-postman-env', requireAuth, (req: Request, res: Response) => {
    try {
      const raw = req.body as Record<string, unknown>;
      // Accept either the raw Postman env object or wrapped in { json: '...' }
      const parsed = typeof raw.json === 'string' ? JSON.parse(raw.json) : raw;

      const values: Array<{ key: string; value: string; type: string; enabled: boolean }> = Array.isArray(parsed.values) ? parsed.values : [];
      const envName: string = typeof parsed.name === 'string' ? parsed.name : '';

      // Classify each variable
      const TOKEN_RE   = /token|jwt|bearer|auth|session/i;
      const SECRET_RE  = /secret|password|passwd|apikey|api_key|accesstoken|access_token|private|credential/i;
      const URL_RE     = /url|host|endpoint|base|server|domain/i;
      const FLAG_RE    = /flag|feature|toggle|enable|disable/i;

      const variables = values
        .filter(v => v.enabled !== false)
        .map(v => {
          let category: string;
          let sensitive = false;

          if (URL_RE.test(v.key))    { category = 'url';        sensitive = false; }
          else if (TOKEN_RE.test(v.key))  { category = 'credential'; sensitive = true;  }
          else if (SECRET_RE.test(v.key)) { category = 'credential'; sensitive = true;  }
          else if (FLAG_RE.test(v.key))   { category = 'flag';       sensitive = false; }
          else                            { category = 'custom';     sensitive = false; }

          return { key: v.key, value: v.value ?? '', sensitive, category };
        });

      // Try to auto-detect baseUrl from a url-type variable
      const urlVar = variables.find(v => v.category === 'url');
      const baseUrl = urlVar?.value ?? '';

      // Detect environment type from URL
      let envType = 'custom';
      if (/stg|staging/i.test(baseUrl))  envType = 'staging';
      else if (/prod|live/i.test(baseUrl)) envType = 'production';
      else if (/dev|local/i.test(baseUrl)) envType = 'development';

      res.json({ envName, baseUrl, envType, variables });
    } catch (e: unknown) {
      res.status(400).json({ error: 'Invalid Postman environment file: ' + (e as Error).message });
    }
  });

  // ── Environment: Clone ──────────────────────────────────────────────────────
  app.post('/api/api-envs/:id/clone', requireAuth, requireEditor, (req: Request, res: Response) => {
    const env = findById<ApiEnvironment>(API_ENVS, req.params.id);
    if (!env) { res.status(404).json({ error: 'Not found' }); return; }
    const clone: ApiEnvironment = {
      ...env,
      id: uuidv4(),
      name: `Copy of ${env.name}`,
      lastPingResult: undefined,
    };
    upsert(API_ENVS, clone);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'CREATE_API_ENV', resourceType: 'api-env', resourceId: clone.id, details: `Cloned from ${env.id}: ${clone.name}`, ip: req.ip ?? null });
    res.json({ success: true, id: clone.id });
  });

  // ── Environment: Usage (which collections reference this env) ───────────────
  app.get('/api/api-envs/:id/usage', requireAuth, (req: Request, res: Response) => {
    const collections = readAll<ApiCollection>(API_COLLECTIONS)
      .filter(c => c.environmentId === req.params.id)
      .map(c => ({ id: c.id, name: c.name }));
    res.json({ count: collections.length, collections });
  });

  // ── Environment: Promote (copy variables to target env) ────────────────────
  app.put('/api/api-envs/:id/promote', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { targetEnvId } = req.body as { targetEnvId?: string };
    if (!targetEnvId) { res.status(400).json({ error: 'targetEnvId is required' }); return; }
    const source = findById<ApiEnvironment>(API_ENVS, req.params.id);
    const target = findById<ApiEnvironment>(API_ENVS, targetEnvId);
    if (!source || !target) { res.status(404).json({ error: 'Source or target environment not found' }); return; }
    // build diff for response
    const diff = source.variables.map(sv => {
      const tv = target.variables.find(v => v.key === sv.key);
      return { key: sv.key, from: tv?.value ?? null, to: sv.sensitive ? '••••••••' : sv.value, isNew: !tv };
    });
    target.variables = encryptSensitiveVars(source.variables.map(v => ({ ...v })));
    upsert(API_ENVS, target);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'UPDATE_API_ENV', resourceType: 'api-env', resourceId: target.id, details: `Promoted variables from ${source.name}`, ip: req.ip ?? null });
    res.json({ success: true, diff });
  });

  // ── Collections ─────────────────────────────────────────────────────────────

  app.get('/api/api-collections', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    const all = readAll<ApiCollection>(API_COLLECTIONS);
    if (!projectId) { res.json(all); return; }
    res.json(all.filter(c => c.projectId === projectId));
  });

  app.post('/api/api-collections', requireAuth, requireEditor, (req: Request, res: Response) => {
    const body = req.body as Partial<ApiCollection>;
    if (!body.name || !body.environmentId) { res.status(400).json({ error: 'name and environmentId are required' }); return; }
    if (!body.projectId) { res.status(400).json({ error: 'projectId is required' }); return; }
    const col: ApiCollection = {
      id: uuidv4(),
      projectId: body.projectId,
      name: body.name,
      environmentId: body.environmentId,
      steps: body.steps ?? [],
      variables: body.variables ?? [],
      onFailure: body.onFailure ?? 'stop',
      executionMode: body.executionMode ?? 'sequential',
      maxConcurrency: body.maxConcurrency,
      logLevel: body.logLevel,
      rateLimit: body.rateLimit,
      tags: body.tags,
    };
    upsert(API_COLLECTIONS, col);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'CREATE_API_COLLECTION', resourceType: 'api-collection', resourceId: col.id, details: col.name, ip: req.ip ?? null });
    res.json({ success: true, id: col.id });
  });

  app.get('/api/api-collections/:id', requireAuth, (req: Request, res: Response) => {
    const col = findById<ApiCollection>(API_COLLECTIONS, req.params.id);
    if (!col) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(col);
  });

  app.put('/api/api-collections/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    const col = findById<ApiCollection>(API_COLLECTIONS, req.params.id);
    if (!col) { res.status(404).json({ error: 'Not found' }); return; }
    const body = req.body as Partial<ApiCollection>;
    if (body.name)            col.name            = body.name;
    if (body.environmentId)   col.environmentId   = body.environmentId;
    if (body.steps)           col.steps           = body.steps;
    if (body.variables)       col.variables       = body.variables;
    if (body.onFailure)       col.onFailure       = body.onFailure;
    if (body.executionMode)   col.executionMode   = body.executionMode;
    if (body.maxConcurrency !== undefined) col.maxConcurrency = body.maxConcurrency;
    if (body.logLevel !== undefined)       col.logLevel       = body.logLevel;
    if (body.rateLimit !== undefined)      col.rateLimit      = body.rateLimit;
    if (body.tags !== undefined)           col.tags           = body.tags;
    upsert(API_COLLECTIONS, col);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'UPDATE_API_COLLECTION', resourceType: 'api-collection', resourceId: col.id, details: col.name, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.delete('/api/api-collections/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    remove(API_COLLECTIONS, req.params.id);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'DELETE_API_COLLECTION', resourceType: 'api-collection', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  // ── Collections: Add generated steps from Suggest Tests ────────────────────
  app.post('/api/api-collections/:id/add-steps', requireAuth, requireEditor, (req: Request, res: Response) => {
    const col = findById<ApiCollection>(API_COLLECTIONS, req.params.id);
    if (!col) { res.status(404).json({ error: 'Not found' }); return; }
    const { steps } = req.body as { steps?: ApiCollection['steps'] };
    if (!Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'steps array is required and must not be empty' });
      return;
    }
    // Assign fresh IDs and append — never overwrite existing steps
    const newSteps = steps.map(s => ({ ...s, id: uuidv4() }));
    col.steps = [...(col.steps ?? []), ...newSteps];
    upsert(API_COLLECTIONS, col);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'UPDATE_API_COLLECTION', resourceType: 'api-collection', resourceId: col.id, details: `Added ${newSteps.length} suggested step(s)`, ip: req.ip ?? null });
    res.json({ success: true, addedCount: newSteps.length, totalSteps: col.steps.length });
  });

  // ── Collections: Try a single request (no run record created) ─────────────
  app.post('/api/api-collections/try-request', requireAuth, async (req: Request, res: Response) => {
    const { method, url, headers, bodyType, environmentId } = req.body as {
      method?: string; url?: string; headers?: Record<string, string>;
      bodyType?: string; environmentId?: string;
    };
    let body: unknown = (req.body as any).body;
    if (!method || !url) { res.status(400).json({ error: 'method and url are required' }); return; }

    const start = Date.now();
    try {
      // Resolve environment variables in URL and headers
      let resolvedUrl = url;
      let resolvedHeaders: Record<string, string> = { ...(headers ?? {}) };

      if (environmentId) {
        const env = findById<ApiEnvironment>(API_ENVS, environmentId);
        if (env) {
          const vars = decryptSensitiveVars(env.variables);
          // Simple {{varName}} substitution
          const subst = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars.find(v => v.key === k)?.value ?? `{{${k}}}`);
          resolvedUrl = subst(url);
          resolvedHeaders = Object.fromEntries(Object.entries(resolvedHeaders).map(([k, v]) => [k, subst(v)]));
          // Also substitute vars in request body
          if (typeof body === 'string') (body as any) = subst(body as string);
          // Apply environment auth headers
          const authHdrs = await resolveAuthHeaders(env.authConfig ?? { type: 'none' },
            Object.fromEntries(vars.map(v => [v.key, v.value])));
          resolvedHeaders = { ...authHdrs, ...resolvedHeaders };
        }
      }

      // Build request options
      // body arrives as a string (textarea content) — use it directly; never re-stringify
      let fetchBody: string | undefined;
      if (body && method !== 'GET' && method !== 'HEAD') {
        fetchBody = typeof body === 'string' ? body : JSON.stringify(body);
        if (bodyType === 'json' || !bodyType) {
          resolvedHeaders['Content-Type'] = resolvedHeaders['Content-Type'] ?? 'application/json';
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(resolvedUrl, {
        method:  method.toUpperCase(),
        headers: resolvedHeaders,
        body:    fetchBody,
        signal:  controller.signal,
      });
      clearTimeout(timeout);

      const durationMs    = Date.now() - start;
      const responseText  = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });

      let parsedBody: unknown = responseText;
      try { parsedBody = JSON.parse(responseText); } catch { /* keep as string */ }

      res.json({
        status:      response.status,
        statusText:  response.statusText,
        headers:     responseHeaders,
        body:        parsedBody,
        bodyRaw:     responseText.slice(0, 50000),
        durationMs,
        resolvedUrl,
        resolvedRequestHeaders: resolvedHeaders,
      });
    } catch (e: unknown) {
      const durationMs = Date.now() - start;
      const msg = (e as Error).message ?? 'Request failed';
      res.json({ status: 0, statusText: 'Error', headers: {}, body: null, bodyRaw: '', durationMs, error: msg });
    }
  });

  // ── Run Execution ───────────────────────────────────────────────────────────

  app.post('/api/api-collections/:id/run', requireAuth, requireEditor, (req: Request, res: Response) => {
    const col = findById<ApiCollection>(API_COLLECTIONS, req.params.id);
    if (!col) { res.status(404).json({ error: 'Not found' }); return; }
    const env = findById<ApiEnvironment>(API_ENVS, col.environmentId);
    if (!env) { res.status(400).json({ error: `Environment ${col.environmentId} not found` }); return; }

    const runId = uuidv4();
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RUN_API_COLLECTION', resourceType: 'api-collection', resourceId: col.id, details: col.name, ip: req.ip ?? null });

    execHealthStart({ runId, type: 'api-collection', name: col.name, startedAt: new Date().toISOString() });

    const dataFileId   = req.body.dataFileId as string | undefined;
    const stopOnFail   = req.body.stopOnFailure !== false; // default: continue

    if (dataFileId) {
      const dataFileMeta = getDataFile(dataFileId);
      if (!dataFileMeta) { res.status(400).json({ error: `Data file ${dataFileId} not found` }); return; }
      const dataRows = getDataFileRows(dataFileId);
      if (!dataRows.length) { res.status(400).json({ error: 'Data file has no rows' }); return; }

      runCollectionWithDataFile(col, env, runId, dataRows, dataFileId, dataFileMeta.name, stopOnFail)
        .then(r => execHealthComplete(runId, r.status === 'passed' ? 'passed' : 'failed', r.stepResults.filter(s => s.status === 'passed').length, r.stepResults.filter(s => s.status === 'failed').length, r.stepResults.length))
        .catch(() => execHealthComplete(runId, 'error', 0, 0, 0));
    } else if (USE_COORDINATOR) {
      // Phase C Track 1: route through ExecutionCoordinator when feature flag is set
      getCoordinatorBridge().dispatchRun(col, env, runId, (_cId, _eId, rId) =>
        runCollection(col, env, rId)
      );
    } else {
      // OLD: direct runCollection — preserved as default path
      runCollection(col, env, runId)
        .then(r => execHealthComplete(runId, r.status === 'passed' ? 'passed' : 'failed', r.stepResults.filter(s => s.status === 'passed').length, r.stepResults.filter(s => s.status === 'failed').length, r.stepResults.length))
        .catch(() => execHealthComplete(runId, 'error', 0, 0, 0));
    }
    res.json({ runId });
  });

  app.get('/api/api-runs/:runId', requireAuth, (req: Request, res: Response) => {
    const file = path.join(RUNS_DIR, `${req.params.runId}.json`);
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'Run not found' }); return; }
    try {
      const result = JSON.parse(fs.readFileSync(file, 'utf-8')) as ApiCollectionRunResult;
      res.json(result);
    } catch { res.status(500).json({ error: 'Failed to read run result' }); }
  });

  app.get('/api/api-runs', requireAuth, (req: Request, res: Response) => {
    const { collectionId, projectId } = req.query as { collectionId?: string; projectId?: string };
    if (!projectId) { res.json([]); return; }
    if (!fs.existsSync(RUNS_DIR)) { res.json([]); return; }
    // OLD: .filter(f => f.endsWith('.json')) — matched .snapshot.json files which lack startedAt, crashing sort()
    const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json') && !f.includes('.snapshot') && !f.endsWith('.tmp'));
    const runs: ApiCollectionRunResult[] = [];
    for (const f of files) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')) as ApiCollectionRunResult;
        if (!r.startedAt || r.projectId !== projectId) continue;
        if (!collectionId || r.collectionId === collectionId) runs.push(r);
      } catch { /* skip corrupt file */ }
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    // OLD: res.json(runs.slice(0, 50));
    const allCols = readAll<ApiCollection>(API_COLLECTIONS);
    const allEnvs = readAll<ApiEnvironment>(API_ENVS);
    const colMap = new Map(allCols.map(c => [c.id, c]));
    const envMap = new Map(allEnvs.map(e => [e.id, e]));
    const enriched = runs.slice(0, 200).map(r => {
      const col = colMap.get(r.collectionId);
      const env = col ? envMap.get(col.environmentId) : null;
      return { ...r, collectionName: col?.name ?? r.collectionId, environmentName: env?.name ?? '—' };
    });
    res.json(enriched);
  });

  // ── Pre-Scan Health Check ───────────────────────────────────────────────────

  app.post('/api/api-collections/:id/pre-scan', requireAuth, async (req: Request, res: Response) => {
    try {
      const col = findById<ApiCollection>(API_COLLECTIONS, req.params.id);
      if (!col) { res.status(404).json({ error: 'Not found' }); return; }
      const env = findById<ApiEnvironment>(API_ENVS, col.environmentId);
      if (!env) { res.status(400).json({ error: `Environment ${col.environmentId} not found` }); return; }

      const ctx = snapshotContext(
        Object.fromEntries([...(env.variables ?? []).map(v => [v.key, v.value]), ...(col.variables ?? []).map(v => [v.key, v.value])])
      );
      const authHeaders = await resolveAuthHeaders(env.authConfig ?? { type: 'none' }, ctx).catch(() => ({}));

      const results = await Promise.all(col.steps.map(async (step) => {
        const start = Date.now();
        try {
          const timeout = step.execution?.timeoutMs ?? 30_000;
          const url = substituteVars(step.request.url, ctx);
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(step.request.headers ?? {})) headers[k] = substituteVars(v, ctx);
          Object.assign(headers, authHeaders);

          const pwCtx = await pwRequest.newContext({ extraHTTPHeaders: headers });
          const pwRes = await pwCtx.fetch(url, { method: step.request.method, timeout });
          const durationMs = Date.now() - start;
          await pwCtx.dispose();

          const status = pwRes.status();
          let score = status < 300 ? 100 : status < 400 ? 50 : status < 500 ? 20 : 0;
          const over500ms = Math.max(0, durationMs - 500);
          score -= Math.floor(over500ms / 200) * 5;

          const assertionResults = evaluateAssertions(step.assertions ?? [], {
            status, headers: pwRes.headers(), body: null, bodyTruncated: false, durationMs,
          });
          const schemaFails = assertionResults.results.filter(r => r.operator === 'jsonSchemaValid' && !r.passed).length;
          score -= schemaFails * 10;

          return { stepId: step.id, stepName: step.name, healthScore: Math.max(0, score), status: 'ok', durationMs };
        } catch (err) {
          return { stepId: step.id, stepName: step.name, healthScore: 0, status: 'error', durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
        }
      }));

      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Pre-scan failed' });
    }
  });

  // ── Import Endpoints ────────────────────────────────────────────────────────

  // OLD: called importFromOpenApi directly, returned bare ApiCollection
  // app.post('/api/api-collections/import/openapi', requireAuth, requireEditor, (req: Request, res: Response) => {
  //   const { specContent, environmentId, tag, includeExamples, projectId } = req.body as { ... };
  //   if (!specContent || !environmentId) { res.status(400).json({ error: 'specContent and environmentId are required' }); return; }
  //   try {
  //     const collection = importFromOpenApi(specContent, environmentId, { tag, includeExamples });
  //     if (projectId) (collection as ApiCollection).projectId = projectId;
  //     logAudit({ ..., details: `steps:${collection.steps.length}...` });
  //     res.json(collection);
  //   } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  // });

  app.post('/api/api-collections/import/openapi', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { specContent, environmentId, tag, includeExamples, projectId } = req.body as {
      specContent?: string; environmentId?: string; tag?: string; includeExamples?: boolean; projectId?: string;
    };
    if (!specContent || !environmentId) { res.status(400).json({ error: 'specContent and environmentId are required' }); return; }
    try {
      const adapted = adaptOpenApiImport(specContent, environmentId, { tag, includeExamples, projectId });
      const { collection, warnings, compatibility, importHealthScore } = adapted;
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_OPENAPI', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length}${tag ? ` tag:${tag}` : ''} warnings:${warnings.length}`, ip: req.ip ?? null });
      // OLD: res.json({ ...collection, warnings, compatibility });
      res.json({ ...collection, warnings, compatibility, importHealthScore: adapted.importHealthScore });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/api-collections/import/openapi-url', requireAuth, requireEditor, async (req: Request, res: Response) => {
    const { url, environmentId, tag, includeExamples, projectId } = req.body as {
      url?: string; environmentId?: string; tag?: string; includeExamples?: boolean; projectId?: string;
    };
    if (!url || !environmentId) { res.status(400).json({ error: 'url and environmentId are required' }); return; }
    if (!projectId) { res.status(400).json({ error: 'projectId is required' }); return; }
    try {
      const fetchRes = await fetch(url);
      if (!fetchRes.ok) { res.status(400).json({ error: `Failed to fetch spec: ${fetchRes.status} ${fetchRes.statusText}` }); return; }
      const specContent = await fetchRes.text();
      // OLD: called importFromOpenApi directly, no warnings in response
      // const collection = importFromOpenApi(specContent, environmentId, { tag, includeExamples });
      // (collection as ApiCollection).projectId = projectId;
      // logAudit({ ..., details: `steps:${collection.steps.length} url:${url}...` });
      // res.json(collection);
      const adapted = adaptOpenApiImport(specContent, environmentId, { tag, includeExamples, projectId });
      const { collection, warnings, compatibility, importHealthScore } = adapted;
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_OPENAPI_URL', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} url:${url}${tag ? ` tag:${tag}` : ''} warnings:${warnings.length}`, ip: req.ip ?? null });
      // OLD: res.json({ ...collection, warnings, compatibility });
      res.json({ ...collection, warnings, compatibility, importHealthScore: adapted.importHealthScore });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // OLD: called legacy importFromPostman directly, returned bare ApiCollection with no warnings
  // app.post('/api/api-collections/import/postman', requireAuth, requireEditor, (req: Request, res: Response) => {
  //   const { collectionJson, environmentId } = req.body as { collectionJson?: string; environmentId?: string };
  //   if (!collectionJson || !environmentId) { res.status(400).json({ error: 'collectionJson and environmentId are required' }); return; }
  //   try {
  //     const collection = importFromPostman(collectionJson, environmentId);
  //     logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_POSTMAN', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} name:${collection.name}`, ip: req.ip ?? null });
  //     res.json(collection);
  //   } catch (e) {
  //     res.status(400).json({ error: (e as Error).message });
  //   }
  // });

  app.post('/api/api-collections/import/postman', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { collectionJson, environmentId, projectId, executionMode } = req.body as {
      collectionJson?: string; environmentId?: string; projectId?: string; executionMode?: 'sequential' | 'parallel' | 'dag';
    };
    if (!collectionJson || !environmentId) { res.status(400).json({ error: 'collectionJson and environmentId are required' }); return; }
    try {
      const adapted = adaptPostmanImport(collectionJson, environmentId, { projectId, executionMode });
      const { collection, warnings, compatibility, importHealthScore } = adapted;
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_POSTMAN', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} name:${collection.name} warnings:${warnings.length}`, ip: req.ip ?? null });
      // OLD: res.json({ ...collection, warnings, compatibility });
      res.json({ ...collection, warnings, compatibility, importHealthScore });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/api-collections/import/curl', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { curlCommand, environmentId } = req.body as { curlCommand?: string; environmentId?: string };
    if (!curlCommand || !environmentId) { res.status(400).json({ error: 'curlCommand and environmentId are required' }); return; }
    try {
      const step = importFromCurl(curlCommand, environmentId);
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_CURL', resourceType: 'api-step', resourceId: step.id, details: `${step.request.method} ${step.request.url}`, ip: req.ip ?? null });
      res.json(step);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ── OpenAPI spec cache (contract drift detection — Task 5.2) ─────────────────

  const OA_SPECS_DIR = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('data'), 'openapi-specs');

  app.get('/api/openapi-specs', requireAuth, (_req: Request, res: Response) => {
    if (!fs.existsSync(OA_SPECS_DIR)) { res.json([]); return; }
    const specs = fs.readdirSync(OA_SPECS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(OA_SPECS_DIR, f), 'utf8')) as Record<string, unknown>;
          return { id: f.replace('.json', ''), title: (raw['info'] as Record<string, unknown>)?.['title'] ?? f, version: (raw['info'] as Record<string, unknown>)?.['version'] ?? '' };
        } catch { return { id: f.replace('.json', ''), title: f, version: '' }; }
      });
    res.json(specs);
  });

  app.post('/api/openapi-specs', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { specContent, specId } = req.body as { specContent?: string; specId?: string };
    if (!specContent) { res.status(400).json({ error: 'specContent required' }); return; }
    try {
      const parsed = JSON.parse(specContent) as Record<string, unknown>;
      const id = specId ?? uuidv4();
      if (!fs.existsSync(OA_SPECS_DIR)) fs.mkdirSync(OA_SPECS_DIR, { recursive: true });
      fs.writeFileSync(path.join(OA_SPECS_DIR, `${id}.json`), JSON.stringify(parsed, null, 2));
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'UPLOAD_OPENAPI_SPEC', resourceType: 'openapi-spec', resourceId: id, details: '', ip: req.ip ?? null });
      res.json({ id });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/openapi-specs/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    const specPath = path.join(OA_SPECS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(specPath)) { res.status(404).json({ error: 'Not found' }); return; }
    fs.unlinkSync(specPath);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'DELETE_OPENAPI_SPEC', resourceType: 'openapi-spec', resourceId: req.params.id, details: '', ip: req.ip ?? null });
    res.json({ ok: true });
  });

  // ── Collection Analytics (real historical data from run files) ──────────────
  app.get('/api/api-collections/:id/analytics', requireAuth, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

      if (!fs.existsSync(RUNS_DIR)) { res.json({ collectionId: id, runs: [], stepStats: [], summary: null }); return; }

      const files = fs.readdirSync(RUNS_DIR)
        .filter(f => f.endsWith('.json') && !f.includes('.snapshot') && !f.endsWith('.tmp'));

      const runs: ApiCollectionRunResult[] = [];
      for (const f of files) {
        try {
          const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')) as ApiCollectionRunResult;
          if (r.collectionId === id && r.startedAt) runs.push(r);
        } catch { /* skip */ }
      }
      runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const recent = runs.slice(0, limit);

      // Per-run trend points
      const runPoints = recent.map(r => {
        const steps = r.stepResults ?? [];
        const total = steps.length;
        const passed = steps.filter(s => s.status === 'passed').length;
        const failed = steps.filter(s => s.status === 'failed' || s.status === 'error').length;
        const durationMs = steps.reduce((acc, s) => acc + ((s as any).durationMs ?? 0), 0);
        return {
          runId: r.id,
          startedAt: r.startedAt,
          status: r.status,
          totalSteps: total,
          passed,
          failed,
          passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
          durationMs,
        };
      }).reverse(); // oldest first for charts

      // Step-level failure frequency across all recent runs
      const stepFailMap: Record<string, { stepName: string; failures: number; runs: number }> = {};
      for (const r of recent) {
        for (const s of (r.stepResults ?? [])) {
          if (!stepFailMap[s.stepId]) stepFailMap[s.stepId] = { stepName: s.stepName, failures: 0, runs: 0 };
          stepFailMap[s.stepId].runs++;
          if (s.status === 'failed' || s.status === 'error') stepFailMap[s.stepId].failures++;
        }
      }
      const stepStats = Object.entries(stepFailMap)
        .map(([stepId, v]) => ({ stepId, stepName: v.stepName, failures: v.failures, runs: v.runs, failRate: v.runs > 0 ? Math.round((v.failures / v.runs) * 100) : 0 }))
        .filter(s => s.runs > 0)
        .sort((a, b) => b.failRate - a.failRate)
        .slice(0, 10);

      // Summary metrics
      const totalRuns = recent.length;
      const avgPassRate = totalRuns > 0 ? Math.round(recent.reduce((acc, r) => {
        const steps = r.stepResults ?? [];
        const passed = steps.filter(s => s.status === 'passed').length;
        return acc + (steps.length > 0 ? passed / steps.length : 0);
      }, 0) / totalRuns * 100) : 0;
      const durations = recent.map(r => (r.stepResults ?? []).reduce((acc: number, s: any) => acc + (s.durationMs ?? 0), 0)).filter((d: number) => d > 0);
      const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
      const p95Idx = Math.floor(durations.slice().sort((a,b)=>a-b).length * 0.95);
      const p95DurationMs = durations.length > 0 ? durations.slice().sort((a,b)=>a-b)[p95Idx] ?? 0 : 0;
      const passedRuns = recent.filter(r => r.status === 'passed').length;
      const failedRuns = recent.filter(r => r.status === 'failed' || r.status === 'error').length;

      res.json({
        collectionId: id,
        runs: runPoints,
        stepStats,
        summary: { totalRuns, passedRuns, failedRuns, avgPassRate, avgDurationMs, p95DurationMs },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
