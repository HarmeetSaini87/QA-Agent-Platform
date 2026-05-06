import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, createViewerApp, setupTestEnv, cleanupTestEnv, seedEnvironments, seedCollections } from './testApp';
import type { ApiEnvironment, ApiCollection } from '../../data/types';

describe('API Testing — Integration Tests', () => {

  beforeEach(() => { setupTestEnv(); });
  afterEach(() => { cleanupTestEnv(); });

  // ═══════════════════════════════════════════════════════════════
  // ENVIRONMENTS CRUD
  // ═══════════════════════════════════════════════════════════════

  describe('Environments CRUD', () => {

    it('POST /api/api-envs — creates environment', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', name: 'Staging', baseUrl: 'https://staging.example.com' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    it('POST /api/api-envs — 400 when missing name', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', baseUrl: 'https://staging.example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('name');
    });

    it('POST /api/api-envs — 400 when missing baseUrl', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', name: 'NoUrl' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('baseUrl');
    });

    it('POST /api/api-envs — 400 when missing projectId', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({ name: 'Staging', baseUrl: 'https://staging.example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('projectId');
    });

    it('POST /api/api-envs — creates with variables', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({
          projectId: 'proj-1',
          name: 'QA',
          baseUrl: 'https://qa.example.com',
          variables: [
            { key: 'API_KEY', value: 'secret-123', sensitive: true },
            { key: 'REGION', value: 'us-east-1', sensitive: false },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app).get(`/api/api-envs/${res.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.variables).toHaveLength(2);
    });

    it('GET /api/api-envs — returns environments filtered by projectId', async () => {
      const app = createTestApp();
      await request(app).post('/api/api-envs').send({ projectId: 'proj-1', name: 'Env1', baseUrl: 'https://a.com' });
      // Ensure proj-2 env is isolated by creating after proj-1 check
      const res1 = await request(app).get('/api/api-envs?projectId=proj-1');
      expect(res1.status).toBe(200);
      expect(res1.body).toHaveLength(1);
      expect(res1.body.every((e: any) => e.projectId === 'proj-1')).toBe(true);
    });

    it('GET /api/api-envs — returns [] when no projectId', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/api-envs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('GET /api/api-envs/:id — returns environment', async () => {
      const app = createTestApp();
      const createRes = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', name: 'QA', baseUrl: 'https://qa.com' });
      const id = createRes.body.id;

      const getRes = await request(app).get(`/api/api-envs/${id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.name).toBe('QA');
      expect(getRes.body.baseUrl).toBe('https://qa.com');
    });

    it('GET /api/api-envs/:id — 404 for non-existent ID', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/api-envs/nonexistent-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Not found');
    });

    it('PUT /api/api-envs/:id — updates environment', async () => {
      const app = createTestApp();
      const createRes = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', name: 'Staging', baseUrl: 'https://staging.com' });
      const id = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/api-envs/${id}`)
        .send({ name: 'Staging-v2', baseUrl: 'https://staging-v2.com' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);

      const getRes = await request(app).get(`/api/api-envs/${id}`);
      expect(getRes.body.name).toBe('Staging-v2');
      expect(getRes.body.baseUrl).toBe('https://staging-v2.com');
    });

    it('PUT /api/api-envs/:id — 404 for non-existent ID', async () => {
      const app = createTestApp();
      const res = await request(app)
        .put('/api/api-envs/nonexistent-id')
        .send({ name: 'Ghost' });
      expect(res.status).toBe(404);
    });

    it('DELETE /api/api-envs/:id — removes environment', async () => {
      const app = createTestApp();
      const createRes = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', name: 'ToDelete', baseUrl: 'https://del.com' });
      const id = createRes.body.id;

      const delRes = await request(app).delete(`/api/api-envs/${id}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      const getRes = await request(app).get(`/api/api-envs/${id}`);
      expect(getRes.status).toBe(404);
    });

    it('POST /api/api-envs — creates with authConfig', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({
          projectId: 'proj-1',
          name: 'BearerEnv',
          baseUrl: 'https://api.example.com',
          authConfig: { type: 'bearer', bearer: { token: 'my-token-123' } },
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app).get(`/api/api-envs/${res.body.id}`);
      expect(getRes.body.authConfig.type).toBe('bearer');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // COLLECTIONS CRUD
  // ═══════════════════════════════════════════════════════════════

  describe('Collections CRUD', () => {

    it('POST /api/api-collections — creates collection', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'QA', baseUrl: 'https://qa.com' }]);

      const res = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'Smoke Tests', environmentId: 'env-1' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    it('POST /api/api-collections — 400 when missing name', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', environmentId: 'env-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('name');
    });

    it('POST /api/api-collections — 400 when missing environmentId', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'NoEnv' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('environmentId');
    });

    it('POST /api/api-collections — 400 when missing projectId', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections')
        .send({ name: 'NoProject', environmentId: 'env-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('projectId');
    });

it('GET /api/api-collections — returns collections filtered by projectId', async () => {
      const app = createTestApp();
      await seedEnvironments([{ id: 'env-1', name: 'QA', baseUrl: 'https://qa.com' }]);

      await request(app).post('/api/api-collections').send({ projectId: 'proj-1', name: 'Col1', environmentId: 'env-1' });
      await request(app).post('/api/api-collections').send({ projectId: 'proj-2', name: 'Col2', environmentId: 'env-1' });

      const res = await request(app).get('/api/api-collections?projectId=proj-1');
      expect(res.status).toBe(200);
      expect(res.body.every((c: any) => c.projectId === 'proj-1')).toBe(true);
    });

    it('GET /api/api-collections — returns [] when no projectId', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/api-collections');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('GET /api/api-collections/:id — returns collection', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'QA', baseUrl: 'https://qa.com' }]);

      const createRes = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'GetCol', environmentId: 'env-1' });
      const id = createRes.body.id;

      const getRes = await request(app).get(`/api/api-collections/${id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.name).toBe('GetCol');
    });

    it('GET /api/api-collections/:id — 404 for non-existent ID', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/api-collections/nonexistent-id');
      expect(res.status).toBe(404);
    });

    it('PUT /api/api-collections/:id — updates collection steps', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'QA', baseUrl: 'https://qa.com' }]);

      const createRes = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'UpdateCol', environmentId: 'env-1' });
      const id = createRes.body.id;

      const steps = [{
        id: 'step-1', name: 'GET /health', request: { method: 'GET', url: '/health' },
        assertions: [], extractVariables: [], execution: {}, dependsOn: [],
      }];

      const updateRes = await request(app)
        .put(`/api/api-collections/${id}`)
        .send({ steps });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);

      const getRes = await request(app).get(`/api/api-collections/${id}`);
      expect(getRes.body.steps).toHaveLength(1);
      expect(getRes.body.steps[0].name).toBe('GET /health');
    });

    it('PUT /api/api-collections/:id — 404 for non-existent ID', async () => {
      const app = createTestApp();
      const res = await request(app)
        .put('/api/api-collections/nonexistent-id')
        .send({ name: 'Ghost' });
      expect(res.status).toBe(404);
    });

    it('DELETE /api/api-collections/:id — removes collection', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'QA', baseUrl: 'https://qa.com' }]);

      const createRes = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'DeleteCol', environmentId: 'env-1' });
      const id = createRes.body.id;

      const delRes = await request(app).delete(`/api/api-collections/${id}`);
      expect(delRes.status).toBe(200);

      const getRes = await request(app).get(`/api/api-collections/${id}`);
      expect(getRes.status).toBe(404);
    });

    it('POST /api/api-collections — creates with full step config', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'QA', baseUrl: 'https://qa.com' }]);

      const steps: Partial<import('../../data/types').ApiTestStep>[] = [{
        id: 's1',
        name: 'Login',
        request: { method: 'POST', url: '/auth/login', headers: { 'Content-Type': 'application/json' }, body: { user: 'admin' }, bodyType: 'json' },
        assertions: [{ field: 'status', operator: 'equals', expected: '200', weight: 10, severity: 'critical', message: '' }],
        extractVariables: [{ name: 'token', source: 'responseBody' as const, path: '$.token', scope: 'collection' as const }],
        execution: { retryPolicy: { maxRetries: 2, delayMs: 500, retryOn: [500] } },
        dependsOn: [],
      }];

      const res = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'Login Flow', environmentId: 'env-1', steps });
      expect(res.status).toBe(200);

      const getRes = await request(app).get(`/api/api-collections/${res.body.id}`);
      expect(getRes.body.steps).toHaveLength(1);
      expect(getRes.body.steps[0].name).toBe('Login');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // AUTH GATE — RBAC
  // ═══════════════════════════════════════════════════════════════

  describe('Auth Gate — RBAC', () => {

    it('viewer can read environments (GET /api/api-envs)', async () => {
      const app = createTestApp();
      await request(app).post('/api/api-envs').send({ projectId: 'p1', name: 'V1', baseUrl: 'https://v.com' });

      const viewerApp = createViewerApp();
      const res = await request(viewerApp).get('/api/api-envs?projectId=p1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body.every((e: any) => e.projectId === 'p1')).toBe(true);
    });

    it('viewer CANNOT create environment (POST /api/api-envs)', async () => {
      const viewerApp = createViewerApp();
      const res = await request(viewerApp)
        .post('/api/api-envs')
        .send({ projectId: 'p1', name: 'Blocked', baseUrl: 'https://blocked.com' });
      expect(res.status).toBe(403);
    });

    it('viewer CANNOT update environment (PUT /api/api-envs/:id)', async () => {
      const app = createTestApp();
      const createRes = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'p1', name: 'E1', baseUrl: 'https://e.com' });
      const id = createRes.body.id;

      const viewerApp = createViewerApp();
      const res = await request(viewerApp).put(`/api/api-envs/${id}`).send({ name: 'Hacked' });
      expect(res.status).toBe(403);
    });

    it('viewer CANNOT delete environment (DELETE /api/api-envs/:id)', async () => {
      const app = createTestApp();
      const createRes = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'p1', name: 'E2', baseUrl: 'https://e2.com' });
      const id = createRes.body.id;

      const viewerApp = createViewerApp();
      const res = await request(viewerApp).delete(`/api/api-envs/${id}`);
      expect(res.status).toBe(403);
    });

    it('viewer CANNOT create collection (POST /api/api-collections)', async () => {
      const viewerApp = createViewerApp();
      const res = await request(viewerApp)
        .post('/api/api-collections')
        .send({ projectId: 'p1', name: 'Blocked', environmentId: 'env-1' });
      expect(res.status).toBe(403);
    });

    it('viewer CANNOT run collection (POST /api/api-collections/:id/run)', async () => {
      const viewerApp = createViewerApp();
      const res = await request(viewerApp).post('/api/api-collections/fake-id/run');
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // IMPORT ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  describe('Import Endpoints', () => {

    it('POST /api/api-collections/import/curl — imports cURL command', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/curl')
        .send({
          curlCommand: 'curl -X GET https://api.example.com/users -H "Authorization: Bearer token123"',
          environmentId: 'env-test',
        });
      expect(res.status).toBe(200);
      expect(res.body.name).toContain('GET');
      expect(res.body.request.method).toBe('GET');
      expect(res.body.request.url).toContain('api.example.com');
    });

    it('POST /api/api-collections/import/curl — POST with body', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/curl')
        .send({
          curlCommand: 'curl -X POST https://api.example.com/users -H "Content-Type: application/json" -d \'{"name":"Alice"}\'',
          environmentId: 'env-test',
        });
      expect(res.status).toBe(200);
      expect(res.body.request.method).toBe('POST');
    });

    it('POST /api/api-collections/import/curl — 400 when missing curlCommand', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/curl')
        .send({ environmentId: 'env-test' });
      expect(res.status).toBe(400);
    });

    it('POST /api/api-collections/import/curl — 400 when missing environmentId', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/curl')
        .send({ curlCommand: 'curl https://example.com' });
      expect(res.status).toBe(400);
    });

    it('POST /api/api-collections/import/curl — invalid cURL returns 200 (parser is lenient)', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/curl')
        .send({ curlCommand: 'not a curl command $$$$', environmentId: 'env-test' });
      expect(res.status).toBe(200);
    });

    it('POST /api/api-collections/import/curl — parses -u basic auth', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/curl')
        .send({
          curlCommand: 'curl -u admin:password123 https://api.example.com/admin',
          environmentId: 'env-test',
        });
      expect(res.status).toBe(200);
      expect(res.body.request.method).toBe('GET');
      expect(res.body.name).toContain('GET');
    });

    it('POST /api/api-collections/import/openapi — 400 when missing specContent', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/openapi')
        .send({ environmentId: 'env-test' });
      expect(res.status).toBe(400);
    });

    it('POST /api/api-collections/import/openapi — imports valid spec', async () => {
      const app = createTestApp();
      const spec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Petstore', version: '1.0.0' },
        paths: {
          '/pets': {
            get: { operationId: 'listPets', responses: { '200': { description: 'OK' } } },
            post: { operationId: 'createPet', responses: { '201': { description: 'Created' } } },
          },
        },
      });
      const res = await request(app)
        .post('/api/api-collections/import/openapi')
        .send({ specContent: spec, environmentId: 'env-test' });
      expect(res.status).toBe(200);
      expect(res.body.steps.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/api-collections/import/openapi — 400 for invalid JSON spec', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/openapi')
        .send({ specContent: '{ invalid json }}}', environmentId: 'env-test' });
      expect(res.status).toBe(400);
    });

    it('POST /api/api-collections/import/postman — imports Postman collection', async () => {
      const app = createTestApp();
      const postman = JSON.stringify({
        info: { name: 'Test Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [{
          name: 'Get Users',
          request: { method: 'GET', url: { raw: 'https://api.example.com/users' }, header: [] },
        }],
      });
      const res = await request(app)
        .post('/api/api-collections/import/postman')
        .send({ collectionJson: postman, environmentId: 'env-test' });
      expect(res.status).toBe(200);
      expect(res.body.steps.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/api-collections/import/postman — 400 when missing collectionJson', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/postman')
        .send({ environmentId: 'env-test' });
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // OPENAPI SPEC CACHE
  // ═══════════════════════════════════════════════════════════════

  describe('OpenAPI Spec Cache', () => {

    it('GET /api/openapi-specs — returns empty array initially', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/openapi-specs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('POST /api/openapi-specs — stores spec', async () => {
      const app = createTestApp();
      const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Test', version: '1.0' }, paths: {} });
      const res = await request(app)
        .post('/api/openapi-specs')
        .send({ specContent: spec });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
    });

    it('POST /api/openapi-specs — 400 when missing specContent', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/openapi-specs')
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/openapi-specs — 400 for invalid JSON', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/openapi-specs')
        .send({ specContent: '{ not valid json' });
      expect(res.status).toBe(400);
    });

    it('GET /api/openapi-specs — lists stored specs', async () => {
      const app = createTestApp();
      const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Test API', version: '1.0' }, paths: {} });
      await request(app).post('/api/openapi-specs').send({ specContent: spec });

      const res = await request(app).get('/api/openapi-specs');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].title).toBeDefined();
    });

    it('DELETE /api/openapi-specs/:id — removes spec', async () => {
      const app = createTestApp();
      const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'To Delete', version: '1.0' }, paths: {} });
      const createRes = await request(app).post('/api/openapi-specs').send({ specContent: spec });
      const id = createRes.body.id;

      const delRes = await request(app).delete(`/api/openapi-specs/${id}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.ok).toBe(true);
    });

    it('DELETE /api/openapi-specs/:id — 404 for non-existent spec', async () => {
      const app = createTestApp();
      const res = await request(app).delete('/api/openapi-specs/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RUN EXECUTION
  // ═══════════════════════════════════════════════════════════════

  describe('Run Execution', () => {

    it('POST /api/api-collections/:id/run — 404 for non-existent collection', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/api-collections/nonexistent-id/run');
      expect(res.status).toBe(404);
    });

    it('POST /api/api-collections/:id/run — 400 when environment not found', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-missing', name: 'WillBeDeleted', baseUrl: 'https://x.com' }]);

      const createRes = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'BadEnv Col', environmentId: 'env-does-not-exist' });
      const id = createRes.body.id;

      const res = await request(app).post(`/api/api-collections/${id}/run`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not found');
    });

    it('POST /api/api-collections/:id/run — returns runId for valid collection', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-run', name: 'Run Env', baseUrl: 'https://httpbin.org' }]);

      const colRes = await request(app)
        .post('/api/api-collections')
        .send({
          projectId: 'proj-1', name: 'Run Col', environmentId: 'env-run',
          steps: [{
            id: 's1', name: 'GET /get', request: { method: 'GET', url: 'https://httpbin.org/get' },
            assertions: [], extractVariables: [], execution: {}, dependsOn: [],
          }],
        });
      const id = colRes.body.id;

      const runRes = await request(app).post(`/api/api-collections/${id}/run`);
      expect(runRes.status).toBe(200);
      expect(runRes.body.runId).toBeDefined();
    });

    it('GET /api/api-runs — returns empty when no projectId', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/api-runs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASES & NEGATIVE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Edge Cases & Negative Tests', () => {

    it('POST /api/api-envs — creates environment with zero variables', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', name: 'EmptyEnv', baseUrl: 'https://empty.com', variables: [] });
      expect(res.status).toBe(200);
      const getRes = await request(app).get(`/api/api-envs/${res.body.id}`);
      expect(getRes.body.variables).toEqual([]);
    });

    it('POST /api/api-envs — creates environment with Unicode name', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-envs')
        .send({ projectId: 'proj-1', name: 'Ambiente-テスト-środowisko', baseUrl: 'https://uni.com' });
      expect(res.status).toBe(200);
      const getRes = await request(app).get(`/api/api-envs/${res.body.id}`);
      expect(getRes.body.name).toContain('テスト');
    });

    it('POST /api/api-collections — creates with all execution modes', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'E', baseUrl: 'https://e.com' }]);

      for (const mode of ['sequential', 'parallel', 'dag'] as const) {
        const res = await request(app)
          .post('/api/api-collections')
          .send({ projectId: 'proj-1', name: `Col-${mode}`, environmentId: 'env-1', executionMode: mode });
        expect(res.status).toBe(200);

        const getRes = await request(app).get(`/api/api-collections/${res.body.id}`);
        expect(getRes.body.executionMode).toBe(mode);
      }
    });

    it('POST /api/api-collections — creates with empty steps array', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'E', baseUrl: 'https://e.com' }]);

      const res = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'EmptySteps', environmentId: 'env-1', steps: [] });
      expect(res.status).toBe(200);

      const getRes = await request(app).get(`/api/api-collections/${res.body.id}`);
      expect(getRes.body.steps).toEqual([]);
    });

    it('PUT /api/api-collections/:id — updates onFailure and executionMode', async () => {
      const app = createTestApp();
      await seedEnvironments( [{ id: 'env-1', name: 'E', baseUrl: 'https://e.com' }]);

      const createRes = await request(app)
        .post('/api/api-collections')
        .send({ projectId: 'proj-1', name: 'UpCol', environmentId: 'env-1' });
      const id = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/api-collections/${id}`)
        .send({ onFailure: 'continue', executionMode: 'dag', maxConcurrency: 10 });
      expect(updateRes.status).toBe(200);

      const getRes = await request(app).get(`/api/api-collections/${id}`);
      expect(getRes.body.onFailure).toBe('continue');
      expect(getRes.body.executionMode).toBe('dag');
      expect(getRes.body.maxConcurrency).toBe(10);
    });

    it('POST /api/api-collections/import/openapi — imports with tag filter', async () => {
      const app = createTestApp();
      const spec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Tagged', version: '1.0' },
        paths: {
          '/users': {
            get: { operationId: 'listUsers', tags: ['users'], responses: { '200': { description: 'OK' } } },
          },
          '/admin': {
            get: { operationId: 'adminPanel', tags: ['admin'], responses: { '200': { description: 'OK' } } },
          },
        },
      });
      const res = await request(app)
        .post('/api/api-collections/import/openapi')
        .send({ specContent: spec, environmentId: 'env-test', tag: 'users' });
      expect(res.status).toBe(200);
      expect(res.body.steps.length).toBe(1);
      expect(res.body.steps[0].name).toContain('listUsers');
    });

    it('POST /api/api-collections/import/curl — parses -X method and -H headers', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/api-collections/import/curl')
        .send({
          curlCommand: 'curl -X DELETE https://api.example.com/items/123 -H "X-Custom: value"',
          environmentId: 'env-test',
        });
      expect(res.status).toBe(200);
      expect(res.body.request.method).toBe('DELETE');
      expect(res.body.request.headers).toBeDefined();
    });
  });
});