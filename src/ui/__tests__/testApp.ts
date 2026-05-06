import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { registerApiTestingRoutes } from '../routes/api-testing.routes';
import { readAll, upsert, API_ENVS, API_COLLECTIONS } from '../../data/store';

const TEST_DATA_DIR = path.join(path.dirname(path.dirname(__filename)), '__test_api_data__');

function sessionMiddleware(role: 'admin' | 'tester' | 'viewer') {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).session = {
      userId: role === 'viewer' ? 'viewer-user-id' : 'test-user-id',
      username: role === 'viewer' ? 'viewer1' : 'testadmin',
      role,
      loginAt: new Date().toISOString(),
    };
    next();
  };
}

export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware('admin'));
  process.env.DATA_DIR = TEST_DATA_DIR;
  registerApiTestingRoutes(app);
  return app;
}

export function createViewerApp() {
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware('viewer'));
  process.env.DATA_DIR = TEST_DATA_DIR;
  registerApiTestingRoutes(app);
  return app;
}

export function setupTestEnv() {
  process.env.DATA_DIR = TEST_DATA_DIR;
  if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  const files = ['api-envs.json', 'api-collections.json', 'audit.json', 'apikeys.json'];
  for (const f of files) {
    fs.writeFileSync(path.join(TEST_DATA_DIR, f), '[]');
  }
  const dirs = ['openapi-specs', 'api-runs'];
  for (const d of dirs) {
    const p = path.join(TEST_DATA_DIR, d);
    if (fs.existsSync(p)) {
      for (const entry of fs.readdirSync(p)) {
        try { fs.rmSync(path.join(p, entry), { recursive: true, force: true }); } catch {}
      }
    }
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

export function cleanupTestEnv() {
  try {
    const files = ['api-envs.json', 'api-collections.json', 'audit.json', 'apikeys.json'];
    for (const f of files) {
      const p = path.join(TEST_DATA_DIR, f);
      try { fs.writeFileSync(p, '[]'); } catch {}
    }
    const dirs = ['openapi-specs', 'api-runs'];
    for (const d of dirs) {
      const p = path.join(TEST_DATA_DIR, d);
      if (fs.existsSync(p)) {
        for (const entry of fs.readdirSync(p)) {
          try { fs.rmSync(path.join(p, entry), { recursive: true, force: true }); } catch {}
        }
      }
    }
  } catch {}
}

export function seedEnvironments(envs: Partial<import('../../data/types').ApiEnvironment>[] = []) {
  process.env.DATA_DIR = TEST_DATA_DIR;
  for (const e of envs) {
    upsert(API_ENVS, {
      id: e.id || `test-env-${Date.now()}`,
      projectId: e.projectId || 'test-project',
      name: e.name || 'Test Env',
      baseUrl: e.baseUrl || 'https://api.test.com',
      variables: e.variables || [],
      ...e,
    } as import('../../data/types').ApiEnvironment);
  }
}

export function seedCollections(cols: Partial<import('../../data/types').ApiCollection>[] = []) {
  process.env.DATA_DIR = TEST_DATA_DIR;
  for (const c of cols) {
    upsert(API_COLLECTIONS, {
      id: c.id || `test-col-${Date.now()}`,
      projectId: c.projectId || 'test-project',
      name: c.name || 'Test Collection',
      environmentId: c.environmentId || 'test-env-1',
      steps: c.steps || [],
      variables: c.variables || [],
      onFailure: c.onFailure || 'stop',
      executionMode: c.executionMode || 'sequential',
      ...c,
    } as import('../../data/types').ApiCollection);
  }
}