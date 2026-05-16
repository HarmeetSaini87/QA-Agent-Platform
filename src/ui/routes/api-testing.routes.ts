import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readAll, upsert, remove, findById, API_ENVS, API_COLLECTIONS } from '../../data/store';
import type { ApiEnvironment, ApiCollection, ApiCollectionRunResult } from '../../data/types';
import { requireAuth, requireEditor } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { encryptSensitiveVars, decryptSensitiveVars } from '../../utils/apiSecrets';
import { runCollection } from '../../utils/apiRunner';
import { resolveAuthHeaders } from '../../utils/apiAuth';
import { importFromOpenApi } from '../../utils/openapiImport';
// OLD: direct legacy import — replaced by import-engine adapter in Phase D Step 3
// import { importFromPostman } from '../../utils/postmanImport';
import { adaptPostmanImport } from '../../api-runtime/import-engine/import-engine-adapter';
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
    if (body.name)      env.name      = body.name;
    if (body.baseUrl)   env.baseUrl   = body.baseUrl;
    if (body.variables) env.variables = encryptSensitiveVars(body.variables);
    if (body.authConfig !== undefined) env.authConfig = body.authConfig;
    upsert(API_ENVS, env);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'UPDATE_API_ENV', resourceType: 'api-env', resourceId: env.id, details: env.name, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.delete('/api/api-envs/:id', requireAuth, requireEditor, (req: Request, res: Response) => {
    remove(API_ENVS, req.params.id);
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'DELETE_API_ENV', resourceType: 'api-env', resourceId: req.params.id, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  // ── Collections ─────────────────────────────────────────────────────────────

  app.get('/api/api-collections', requireAuth, (req: Request, res: Response) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) { res.json([]); return; }
    const all = readAll<ApiCollection>(API_COLLECTIONS);
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

  // ── Run Execution ───────────────────────────────────────────────────────────

  app.post('/api/api-collections/:id/run', requireAuth, requireEditor, (req: Request, res: Response) => {
    const col = findById<ApiCollection>(API_COLLECTIONS, req.params.id);
    if (!col) { res.status(404).json({ error: 'Not found' }); return; }
    const env = findById<ApiEnvironment>(API_ENVS, col.environmentId);
    if (!env) { res.status(400).json({ error: `Environment ${col.environmentId} not found` }); return; }

    const runId = uuidv4();
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'RUN_API_COLLECTION', resourceType: 'api-collection', resourceId: col.id, details: col.name, ip: req.ip ?? null });
    // Fire async — do not await
    runCollection(col, env, runId).catch(() => { /* errors persisted in run file */ });
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
    const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json'));
    const runs: ApiCollectionRunResult[] = [];
    for (const f of files) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')) as ApiCollectionRunResult;
        if (r.projectId !== projectId) continue;
        if (!collectionId || r.collectionId === collectionId) runs.push(r);
      } catch { /* skip corrupt file */ }
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    res.json(runs.slice(0, 50));
  });

  // ── Pre-Scan Health Check ───────────────────────────────────────────────────

  app.post('/api/api-collections/:id/pre-scan', requireAuth, async (req: Request, res: Response) => {
    const col = findById<ApiCollection>(API_COLLECTIONS, req.params.id);
    if (!col) { res.status(404).json({ error: 'Not found' }); return; }
    const env = findById<ApiEnvironment>(API_ENVS, col.environmentId);
    if (!env) { res.status(400).json({ error: `Environment ${col.environmentId} not found` }); return; }

    const ctx = snapshotContext(
      Object.fromEntries([...env.variables.map(v => [v.key, v.value]), ...col.variables.map(v => [v.key, v.value])])
    );
    const authHeaders = await resolveAuthHeaders(env.authConfig ?? { type: 'none' }, ctx).catch(() => ({}));

    const results = await Promise.all(col.steps.map(async (step) => {
      const timeout = step.execution?.timeoutMs ?? 30_000;
      const url = substituteVars(step.request.url, ctx);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(step.request.headers ?? {})) headers[k] = substituteVars(v, ctx);
      Object.assign(headers, authHeaders);

      const start = Date.now();
      try {
        const pwCtx = await pwRequest.newContext({ extraHTTPHeaders: headers });
        const pwRes = await pwCtx.fetch(url, { method: step.request.method, timeout }).catch(e => { throw e; });
        const durationMs = Date.now() - start;
        await pwCtx.dispose();

        const status = pwRes.status();
        let score = status < 300 ? 100 : status < 400 ? 50 : status < 500 ? 20 : 0;
        const over500ms = Math.max(0, durationMs - 500);
        score -= Math.floor(over500ms / 200) * 5;

        // Schema penalty
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
  });

  // ── Import Endpoints ────────────────────────────────────────────────────────

  app.post('/api/api-collections/import/openapi', requireAuth, requireEditor, (req: Request, res: Response) => {
    const { specContent, environmentId, tag, includeExamples, projectId } = req.body as {
      specContent?: string; environmentId?: string; tag?: string; includeExamples?: boolean; projectId?: string;
    };
    if (!specContent || !environmentId) { res.status(400).json({ error: 'specContent and environmentId are required' }); return; }
    try {
      const collection = importFromOpenApi(specContent, environmentId, { tag, includeExamples });
      if (projectId) (collection as ApiCollection).projectId = projectId;
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_OPENAPI', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length}${tag ? ` tag:${tag}` : ''}`, ip: req.ip ?? null });
      res.json(collection);
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
      const collection = importFromOpenApi(specContent, environmentId, { tag, includeExamples });
      (collection as ApiCollection).projectId = projectId;
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_OPENAPI_URL', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} url:${url}${tag ? ` tag:${tag}` : ''}`, ip: req.ip ?? null });
      res.json(collection);
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
      const { collection, warnings, compatibility } = adapted;
      logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'IMPORT_POSTMAN', resourceType: 'api-collection', resourceId: collection.id, details: `steps:${collection.steps.length} name:${collection.name} warnings:${warnings.length}`, ip: req.ip ?? null });
      res.json({ ...collection, warnings, compatibility });
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
}
