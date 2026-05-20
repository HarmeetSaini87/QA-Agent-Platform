import { describe, it, expect, vi } from 'vitest';

import type { ApiCollection, ApiEnvironment } from '../../../data/types';

function makeCollection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'col-1', name: 'Test Col', environmentId: 'env-1',
    steps: [
      { id: 'step-main', name: 'Main', request: { method: 'GET', url: 'http://x/main', headers: {}, body: undefined, queryParams: {} }, assertions: [], extractVariables: [], execution: { teardown: false }, dependsOn: [] },
      { id: 'step-td', name: 'Teardown', request: { method: 'DELETE', url: 'http://x/td', headers: {}, body: undefined, queryParams: {} }, assertions: [], extractVariables: [], execution: { teardown: true }, dependsOn: [] },
    ],
    variables: [], onFailure: 'continue', executionMode: 'sequential',
    ...overrides,
  } as ApiCollection;
}

function makeEnv(): ApiEnvironment {
  return { id: 'env-1', name: 'Test', baseUrl: 'http://x', variables: [] } as ApiEnvironment;
}

describe('teardown observability', () => {
  it('teardown step result has isTeardown: true', async () => {
    const { WorkflowEngine } = await import('../engine');
    const executeStep = vi.fn()
      .mockImplementationOnce(async () => ({
        stepId: 'step-main', stepName: 'Main', status: 'passed',
        request: { method: 'GET', url: 'http://x/main', headers: {}, body: undefined, queryParams: {} },
        response: { status: 200, headers: {}, body: '', durationMs: 10, bodyTruncated: false },
        assertionResults: [], extractedVariables: {}, durationMs: 10,
      }))
      .mockImplementationOnce(async () => ({
        stepId: 'step-td', stepName: 'Teardown', status: 'passed',
        request: { method: 'DELETE', url: 'http://x/td', headers: {}, body: undefined, queryParams: {} },
        response: { status: 200, headers: {}, body: '', durationMs: 10, bodyTruncated: false },
        assertionResults: [], extractedVariables: {}, durationMs: 10,
      }));
    const resolveAuth = vi.fn().mockResolvedValue({});
    const engine = new WorkflowEngine({ executeStep, resolveAuth, onPartialWrite: () => {} });
    const result = await engine.execute(makeCollection(), makeEnv(), 'run-1', {});
    const tdResult = result.stepResults.find(r => r.stepId === 'step-td');
    expect(tdResult).toBeDefined();
    expect(tdResult!.isTeardown).toBe(true);
    const mainResult = result.stepResults.find(r => r.stepId === 'step-main');
    expect(mainResult!.isTeardown).toBeFalsy();
  });

  it('teardown step runs even when main step fails', async () => {
    const { WorkflowEngine } = await import('../engine');
    const executeStep = vi.fn()
      .mockImplementationOnce(async () => ({
        stepId: 'step-main', stepName: 'Main', status: 'failed',
        request: { method: 'GET', url: 'http://x/main', headers: {}, body: undefined, queryParams: {} },
        assertionResults: [], extractedVariables: {}, durationMs: 5, error: 'boom',
      }))
      .mockImplementationOnce(async () => ({
        stepId: 'step-td', stepName: 'Teardown', status: 'passed',
        request: { method: 'DELETE', url: 'http://x/td', headers: {}, body: undefined, queryParams: {} },
        assertionResults: [], extractedVariables: {}, durationMs: 5,
      }));
    const resolveAuth = vi.fn().mockResolvedValue({});
    const collection = makeCollection();
    (collection as any).onFailure = 'stop';
    const engine = new WorkflowEngine({ executeStep, resolveAuth, onPartialWrite: () => {} });
    const result = await engine.execute(collection, makeEnv(), 'run-1', {});
    const tdResult = result.stepResults.find(r => r.stepId === 'step-td');
    expect(tdResult).toBeDefined();
    expect(tdResult!.isTeardown).toBe(true);
  });
});
