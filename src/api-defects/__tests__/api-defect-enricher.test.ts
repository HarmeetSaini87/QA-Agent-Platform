// src/api-defects/__tests__/api-defect-enricher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { enrichDefectPayload } from '../api-defect-enricher';
import type { ApiDefectEnrichmentContext } from '../contracts/api-defect.contracts';
import type { ApiStepResult, ApiCollectionRunResult, ApiCollection, ApiEnvironment } from '../../data/types';
import type { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';

// Mock the heal advisor so enricher tests stay pure
vi.mock('../api-heal-advisor', () => ({
  proposeUrlFixes: () => [],
}));

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'GET /users',
    status: 'failed',
    request: { method: 'GET', url: 'https://api.example.com/v1/users', headers: {}, body: undefined, queryParams: {} },
    response: { status: 404, headers: {}, body: '{"error":"nf"}', durationMs: 200, bodyTruncated: false },
    assertionResults: [
      { field: 'status', operator: 'equals', passed: false, actual: 404, expected: 200 },
      { field: 'body.id', operator: 'exists', passed: true, actual: true, expected: true },
    ],
    extractedVariables: {},
    durationMs: 200,
    ...overrides,
  } as ApiStepResult;
}

function makeRun(overrides: Partial<ApiCollectionRunResult> = {}): ApiCollectionRunResult {
  return {
    id: 'run-1',
    collectionId: 'col-1',
    startedAt: '2026-05-01T00:00:00Z',
    completedAt: '2026-05-01T00:01:00Z',
    status: 'failed',
    stepResults: [],
    variableContext: {},
    ...overrides,
  } as ApiCollectionRunResult;
}

function makeCollection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col-1',
    name: 'User API',
    environmentId: 'env-1',
    steps: [{ id: 'step-1', dependsOn: ['step-0'] } as any],
    ...overrides,
  } as ApiCollection;
}

function makeEnv(overrides: Partial<ApiEnvironment> = {}): ApiEnvironment {
  return {
    id: 'env-1',
    name: 'Staging',
    baseUrl: 'https://api.example.com',
    variables: [],
    ...overrides,
  } as ApiEnvironment;
}

describe('enrichDefectPayload', () => {
  it('sets stepId, collectionId, runId from context', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.stepId).toBe('step-1');
    expect(result.collectionId).toBe('col-1');
    expect(result.runId).toBe('run-1');
  });

  it('populates flakinessScore, failRate, isFlaky from flakinessReport when matching record exists', () => {
    const flakinessReport: CollectionFlakinessReport = {
      collectionId: 'col-1',
      computedAt: '2026-05-01T00:00:00Z',
      stepRecords: [
        {
          stepId: 'step-1',
          flakinessScore: 0.72,
          failRate: 0.5,
          isFlaky: true,
          alternationIndex: 0.4,
          dominantSignature: { signatureKey: 'http_404', category: 'http_status' } as any,
          retryStats: { retryCount: 2, maxRetryAttempt: 2, avgAttemptDurationMs: 150, recoveredAfterRetry: false },
          hotspots: [],
          totalRuns: 10,
          failCount: 5,
        } as any,
      ],
      clusterGroups: [],
    } as any;

    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
      flakinessReport,
    };
    const result = enrichDefectPayload(ctx);
    expect(result.flakinessScore).toBe(0.72);
    expect(result.failRate).toBe(0.5);
    expect(result.isFlaky).toBe(true);
    expect(result.signatureKey).toBe('http_404');
  });

  it('leaves flakinessScore undefined when flakinessReport is absent', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.flakinessScore).toBeUndefined();
    expect(result.signatureKey).toBeUndefined();
  });

  it('populates retryHistory from graphNodeResult.retryHistory', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
      graphNodeResult: {
        stepId: 'step-1',
        stepName: 'GET /users',
        status: 'failed',
        durationMs: 200,
        retryCount: 2,
        retryHistory: [
          { attempt: 1, startedAt: 't1', completedAt: 't2', durationMs: 110, httpStatus: 404, error: undefined, resultStatus: 'failed', retriedAfter: 500 },
          { attempt: 2, startedAt: 't3', completedAt: 't4', durationMs: 115, httpStatus: 404, error: 'timeout', resultStatus: 'failed', retriedAfter: 500 },
        ],
      } as any,
    };
    const result = enrichDefectPayload(ctx);
    expect(result.retryHistory).toHaveLength(2);
    expect(result.retryHistory[0].attempt).toBe(1);
    expect(result.retryHistory[1].error).toBe('timeout');
    expect(result.retryCount).toBe(2);
  });

  it('retryCount is 0 when graphNodeResult is absent', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.retryCount).toBe(0);
    expect(result.retryHistory).toHaveLength(0);
  });

  it('populates dependencyChain from collection.steps[].dependsOn', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection({ steps: [{ id: 'step-1', dependsOn: ['step-0', 'step-auth'] } as any] }),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.dependencyChain).toEqual(['step-0', 'step-auth']);
  });

  it('dependencyChain is empty when step has no dependsOn', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection({ steps: [{ id: 'step-1' } as any] }),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.dependencyChain).toEqual([]);
  });

  it('failedAssertions only includes assertions where passed === false', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.failedAssertions).toHaveLength(1);
    expect(result.failedAssertions[0].field).toBe('status');
  });

  it('requestBody contains serialized body only, not headers', () => {
    const step = makeStep({
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/users',
        headers: { 'Authorization': 'Bearer secret-token', 'Content-Type': 'application/json' },
        body: { name: 'test' },
        queryParams: {},
      },
    });
    const ctx: ApiDefectEnrichmentContext = { step, run: makeRun(), collection: makeCollection(), environment: makeEnv() };
    const result = enrichDefectPayload(ctx);
    expect(result.requestBody).toContain('test');
    expect(result.requestBody).not.toContain('secret-token');
  });

  it('healingSuggestions comes from proposeUrlFixes result', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep(),
      run: makeRun(),
      collection: makeCollection(),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.healingSuggestions).toEqual([]); // mock returns []
  });

  it('truncates requestBody to 500 chars', () => {
    const longBody = { data: 'x'.repeat(600) };
    const step = makeStep({ request: { method: 'POST', url: 'https://api.example.com/v1/users', headers: {}, body: longBody, queryParams: {} } });
    const ctx: ApiDefectEnrichmentContext = { step, run: makeRun(), collection: makeCollection(), environment: makeEnv() };
    const result = enrichDefectPayload(ctx);
    expect(result.requestBody).toHaveLength(500);
  });

  it('dependencyChain is empty when stepId not found in collection.steps', () => {
    const ctx: ApiDefectEnrichmentContext = {
      step: makeStep({ stepId: 'unknown-step' }),
      run: makeRun(),
      collection: makeCollection({ steps: [{ id: 'step-1', dependsOn: ['step-0'] } as any] }),
      environment: makeEnv(),
    };
    const result = enrichDefectPayload(ctx);
    expect(result.dependencyChain).toEqual([]);
  });
});
