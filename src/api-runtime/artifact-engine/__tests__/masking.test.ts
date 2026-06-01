import { describe, it, expect } from 'vitest';
import { maskRunResult } from '../masking';
import type { ApiCollectionRunResult } from '../../../../data/types';

function makeResult(overrides: Partial<ApiCollectionRunResult> = {}): ApiCollectionRunResult {
  return {
    id: 'run1', collectionId: 'col1', startedAt: '', completedAt: '',
    status: 'passed', stepResults: [], variableContext: {},
    ...overrides,
  };
}

describe('maskRunResult', () => {
  it('passes through result with no sensitive data unchanged', () => {
    const r = makeResult();
    const masked = maskRunResult(r);
    expect(masked.id).toBe('run1');
    expect(masked.stepResults).toHaveLength(0);
  });

  it('masks Authorization header in step response', () => {
    const r = makeResult({
      stepResults: [{
        stepId: 's1', stepName: 'S', status: 'passed',
        request: { method: 'GET', url: 'https://x', headers: {}, bodyType: 'none' } as never,
        response: { status: 200, headers: { 'authorization': 'Bearer secret123', 'content-type': 'application/json' }, body: {}, bodyTruncated: false, durationMs: 10 },
        assertionResults: [], extractedVariables: {}, durationMs: 10,
      }],
    });
    const masked = maskRunResult(r);
    expect(masked.stepResults[0].response!.headers['authorization']).toBe('***');
    expect(masked.stepResults[0].response!.headers['content-type']).toBe('application/json');
  });

  it('masks x-api-key header', () => {
    const r = makeResult({
      stepResults: [{
        stepId: 's1', stepName: 'S', status: 'passed',
        request: { method: 'GET', url: 'https://x', headers: {}, bodyType: 'none' } as never,
        response: { status: 200, headers: { 'x-api-key': 'mykey' }, body: {}, bodyTruncated: false, durationMs: 5 },
        assertionResults: [], extractedVariables: {}, durationMs: 5,
      }],
    });
    const masked = maskRunResult(r);
    expect(masked.stepResults[0].response!.headers['x-api-key']).toBe('***');
  });

  it('masks sensitive extracted variables by name pattern', () => {
    const r = makeResult({
      stepResults: [{
        stepId: 's1', stepName: 'S', status: 'passed',
        request: { method: 'GET', url: 'https://x', headers: {}, bodyType: 'none' } as never,
        response: { status: 200, headers: {}, body: {}, bodyTruncated: false, durationMs: 5 },
        assertionResults: [], extractedVariables: { authToken: 'abc123', userId: 'u99' }, durationMs: 5,
      }],
    });
    const masked = maskRunResult(r);
    expect(masked.stepResults[0].extractedVariables['authToken']).toBe('***');
    expect(masked.stepResults[0].extractedVariables['userId']).toBe('u99');
  });

  it('does not mutate original result', () => {
    const r = makeResult({
      stepResults: [{
        stepId: 's1', stepName: 'S', status: 'passed',
        request: { method: 'GET', url: 'https://x', headers: {}, bodyType: 'none' } as never,
        response: { status: 200, headers: { 'authorization': 'Bearer tok' }, body: {}, bodyTruncated: false, durationMs: 5 },
        assertionResults: [], extractedVariables: {}, durationMs: 5,
      }],
    });
    maskRunResult(r);
    expect(r.stepResults[0].response!.headers['authorization']).toBe('Bearer tok');
  });
});
