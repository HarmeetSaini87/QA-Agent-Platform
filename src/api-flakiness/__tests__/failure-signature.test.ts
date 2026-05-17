import { describe, it, expect } from 'vitest';
import { buildFailureSignature } from '../failure-signature';
import type { ApiStepResult } from '../../data/types';

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'GET Users',
    status: 'failed',
    request: { url: 'https://api.example.com/users', method: 'GET', headers: {}, body: undefined },
    response: { status: 200, headers: {}, body: '' },
    assertionResults: [],
    extractedVariables: {},
    durationMs: 300,
    ...overrides,
  };
}

describe('buildFailureSignature', () => {
  it('categorizes assertion failure', () => {
    const step = makeStep({
      status: 'failed',
      assertionResults: [
        { assertionIndex: 0, field: 'body.id', operator: 'eq', passed: false, actual: null, expected: 1 },
      ],
    });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('assertion');
    expect(sig.assertionField).toBe('body.id');
    expect(sig.assertionOperator).toBe('eq');
    expect(sig.signatureKey).toBe('assertion:body.id:eq');
  });

  it('categorizes http_status failure', () => {
    const step = makeStep({ status: 'failed', response: { status: 503, headers: {}, body: '' }, assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('http_status');
    expect(sig.httpStatus).toBe(503);
    expect(sig.signatureKey).toBe('http_status:503');
  });

  it('categorizes timeout from error string', () => {
    const step = makeStep({ status: 'error', error: 'Request timed out after 30000ms', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('timeout');
    expect(sig.signatureKey).toBe('timeout:ETIMEDOUT');
  });

  it('categorizes network error ECONNREFUSED', () => {
    const step = makeStep({ status: 'error', error: 'connect ECONNREFUSED 127.0.0.1:3000', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('network');
    expect(sig.transportError).toBe('ECONNREFUSED');
    expect(sig.signatureKey).toBe('network:ECONNREFUSED');
  });

  it('categorizes auth failure on 401', () => {
    const step = makeStep({ status: 'failed', response: { status: 401, headers: {}, body: '' }, assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('auth');
    expect(sig.signatureKey).toBe('auth:401');
  });

  it('categorizes auth failure on 403', () => {
    const step = makeStep({ status: 'failed', response: { status: 403, headers: {}, body: '' }, assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('auth');
    expect(sig.signatureKey).toBe('auth:403');
  });

  it('categorizes dependency_propagation from skipped + error message', () => {
    const step = makeStep({ status: 'skipped', error: 'Skipped: dependency step-2 failed', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('dependency_propagation');
    expect(sig.signatureKey).toContain('dependency_propagation');
  });

  it('falls back to unknown', () => {
    const step = makeStep({ status: 'failed', assertionResults: [] });
    const sig = buildFailureSignature(step);
    expect(sig.category).toBe('unknown');
    expect(sig.signatureKey).toBe('unknown:failed');
  });
});
