import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/apiRunner', () => ({
  runCollection: vi.fn(),
}));
vi.mock('../suite-run-store', () => ({
  saveSuiteRunResult: vi.fn().mockResolvedValue(undefined),
}));

import { runSuite } from '../suite-orchestrator';
import { runCollection } from '../../utils/apiRunner';
import type { ApiSuite } from '../contracts/api-suite.contracts';
import type { ApiCollection, ApiEnvironment } from '../../data/types';

const mockRunCollection = vi.mocked(runCollection);

function makeOkResult(collectionId: string, runId: string, vars: Record<string,string> = {}) {
  return {
    id: runId, collectionId,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:01Z',
    status: 'passed' as const,
    stepResults: [],
    variableContext: vars,
  };
}

function makeFailResult(collectionId: string, runId: string) {
  return { ...makeOkResult(collectionId, runId), status: 'failed' as const };
}

function makeSuite(overrides: Partial<ApiSuite> = {}): ApiSuite {
  return {
    id: 'suite-1', name: 'My Suite',
    collectionIds: ['col-main-1', 'col-main-2'],
    environmentId: 'env-1',
    onFailure: 'continue',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCollections(): ApiCollection[] {
  return [
    { id: 'col-before-all', name: 'Before All', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as unknown as ApiCollection,
    { id: 'col-after-all', name: 'After All', environmentId: 'env-1', steps: [], variables: [], onFailure: 'continue', executionMode: 'sequential' } as unknown as ApiCollection,
    { id: 'col-before-each', name: 'Before Each', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as unknown as ApiCollection,
    { id: 'col-after-each', name: 'After Each', environmentId: 'env-1', steps: [], variables: [], onFailure: 'continue', executionMode: 'sequential' } as unknown as ApiCollection,
    { id: 'col-main-1', name: 'Main 1', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as unknown as ApiCollection,
    { id: 'col-main-2', name: 'Main 2', environmentId: 'env-1', steps: [], variables: [], onFailure: 'stop', executionMode: 'sequential' } as unknown as ApiCollection,
  ];
}

const env: ApiEnvironment = { id: 'env-1', name: 'Test', baseUrl: 'http://x', variables: [] } as unknown as ApiEnvironment;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runSuite', () => {
  it('runs collections in order: main 1 then main 2', async () => {
    mockRunCollection
      .mockResolvedValueOnce(makeOkResult('col-main-1', 'r1') as any)
      .mockResolvedValueOnce(makeOkResult('col-main-2', 'r2') as any);

    const result = await runSuite(makeSuite(), makeCollections(), env);

    expect(result.status).toBe('passed');
    expect(result.phaseResults).toHaveLength(2);
    expect(result.phaseResults[0].collectionId).toBe('col-main-1');
    expect(result.phaseResults[1].collectionId).toBe('col-main-2');
    expect(result.phaseResults[0].phase).toBe('main');
  });

  it('runs lifecycle order: beforeAll, beforeEach, main, afterEach, afterAll', async () => {
    mockRunCollection.mockResolvedValue(makeOkResult('any', 'r') as any);

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      beforeAllCollectionId: 'col-before-all',
      afterAllCollectionId: 'col-after-all',
      beforeEachCollectionId: 'col-before-each',
      afterEachCollectionId: 'col-after-each',
    });

    const result = await runSuite(suite, makeCollections(), env);
    const phases = result.phaseResults.map(r => r.phase);
    expect(phases).toEqual(['before_all', 'before_each', 'main', 'after_each', 'after_all']);
  });

  it('afterAll runs even when a main collection fails', async () => {
    const called: string[] = [];
    mockRunCollection.mockImplementation(async (col: ApiCollection) => {
      called.push(col.id);
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1') as any;
      return makeOkResult(col.id, 'r2') as any;
    });

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      afterAllCollectionId: 'col-after-all',
    });

    await runSuite(suite, makeCollections(), env);
    expect(called).toContain('col-after-all');
  });

  it('afterEach runs even when main collection fails', async () => {
    mockRunCollection.mockImplementation(async (col: ApiCollection) => {
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1') as any;
      return makeOkResult(col.id, 'r2') as any;
    });

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      afterEachCollectionId: 'col-after-each',
    });

    const result = await runSuite(suite, makeCollections(), env);
    const afterEachPhase = result.phaseResults.find(p => p.phase === 'after_each');
    expect(afterEachPhase).toBeDefined();
  });

  it('with onFailure=stop, stops after first failure but still runs afterAll', async () => {
    const called: string[] = [];
    mockRunCollection.mockImplementation(async (col: ApiCollection) => {
      called.push(col.id);
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1') as any;
      return makeOkResult(col.id, 'r2') as any;
    });

    const suite = makeSuite({
      onFailure: 'stop',
      collectionIds: ['col-main-1', 'col-main-2'],
      afterAllCollectionId: 'col-after-all',
    });

    const result = await runSuite(suite, makeCollections(), env);
    expect(called).not.toContain('col-main-2');
    expect(called).toContain('col-after-all');
    expect(result.status).toBe('failed');
  });

  it('with onFailure=continue, all collections run despite failure', async () => {
    const called: string[] = [];
    mockRunCollection.mockImplementation(async (col: ApiCollection) => {
      called.push(col.id);
      if (col.id === 'col-main-1') return makeFailResult(col.id, 'r1') as any;
      return makeOkResult(col.id, 'r2') as any;
    });

    await runSuite(makeSuite({ onFailure: 'continue' }), makeCollections(), env);
    expect(called).toContain('col-main-1');
    expect(called).toContain('col-main-2');
  });

  it('variables from beforeAll are passed to main collections as inheritedContext', async () => {
    const capturedContexts: (Record<string, string> | undefined)[] = [];
    mockRunCollection.mockImplementation(async (col: ApiCollection, _env: ApiEnvironment, _runId: string, ctx?: Record<string,string>) => {
      capturedContexts.push(ctx);
      return makeOkResult(col.id, 'r', { TOKEN: 'abc123' }) as any;
    });

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      beforeAllCollectionId: 'col-before-all',
    });

    await runSuite(suite, makeCollections(), env);
    // index 0 = beforeAll, index 1 = main — main should have TOKEN
    expect(capturedContexts[1]).toMatchObject({ TOKEN: 'abc123' });
  });

  it('isLifecycleHook is true for non-main phases', async () => {
    mockRunCollection.mockResolvedValue(makeOkResult('any', 'r') as any);

    const suite = makeSuite({
      collectionIds: ['col-main-1'],
      beforeAllCollectionId: 'col-before-all',
      afterAllCollectionId: 'col-after-all',
    });

    const result = await runSuite(suite, makeCollections(), env);
    const beforeAll = result.phaseResults.find(p => p.phase === 'before_all');
    const main = result.phaseResults.find(p => p.phase === 'main');
    const afterAll = result.phaseResults.find(p => p.phase === 'after_all');
    expect(beforeAll!.isLifecycleHook).toBe(true);
    expect(main!.isLifecycleHook).toBe(false);
    expect(afterAll!.isLifecycleHook).toBe(true);
  });

  it('suite status is failed when any collection fails', async () => {
    mockRunCollection
      .mockResolvedValueOnce(makeFailResult('col-main-1', 'r1') as any)
      .mockResolvedValueOnce(makeOkResult('col-main-2', 'r2') as any);

    const result = await runSuite(makeSuite(), makeCollections(), env);
    expect(result.status).toBe('failed');
  });
});
