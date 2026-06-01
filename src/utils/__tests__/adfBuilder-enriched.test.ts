// src/utils/__tests__/adfBuilder-enriched.test.ts
import { describe, it, expect } from 'vitest';
import { buildEnrichedApiDefectAdf } from '../adfBuilder';
import type { ApiDefectPayload } from '../../api-defects/contracts/api-defect.contracts';

function makePayload(overrides: Partial<ApiDefectPayload> = {}): ApiDefectPayload {
  return {
    stepId: 'step-1',
    stepName: 'GET Users',
    collectionId: 'col-1',
    collectionName: 'User API',
    runId: 'run-42',
    method: 'GET',
    url: 'https://api.example.com/v1/users',
    httpStatus: 404,
    durationMs: 320,
    failedAssertions: [{ field: 'status', operator: 'equals', expected: 200, actual: 404 }],
    errorMessage: undefined,
    requestBody: undefined,
    responseBody: '{"error":"not found"}',
    flakinessScore: 0.72,
    failRate: 0.5,
    isFlaky: true,
    retryCount: 2,
    retryHistory: [
      { attempt: 1, httpStatus: 404, durationMs: 120 },
      { attempt: 2, httpStatus: 404, durationMs: 115, error: 'timeout' },
    ],
    dependencyChain: ['step-0'],
    signatureKey: 'http_404_GET_/v1/users',
    environmentName: 'Staging',
    environmentBaseUrl: 'https://api.example.com',
    healingSuggestions: [
      {
        type: 'version_drift',
        currentUrl: 'https://api.example.com/v1/users',
        suggestedUrl: 'https://api.example.com/v2/users',
        confidence: 0.6,
        reason: 'Endpoint returned 404. API may have upgraded from v1 to v2.',
      },
    ],
    ...overrides,
  };
}

describe('buildEnrichedApiDefectAdf', () => {
  it('returns a doc node with version 1', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(Array.isArray(adf.content)).toBe(true);
  });

  it('includes collection name and environment', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('User API');
    expect(text).toContain('Staging');
  });

  it('includes step name, method, and URL', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('GET Users');
    expect(text).toContain('GET');
    expect(text).toContain('/v1/users');
  });

  it('includes flakiness info when flakinessScore is defined', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('FLAKY');
    expect(text).toContain('72%');
  });

  it('omits flakiness section when flakinessScore is undefined', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload({ flakinessScore: undefined, isFlaky: undefined, failRate: undefined }));
    const text = JSON.stringify(adf);
    expect(text).not.toContain('FLAKY');
    expect(text).not.toContain('Flakiness');
  });

  it('includes failed assertion detail', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('status');
    expect(text).toContain('equals');
  });

  it('includes retry history attempts', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('Attempt 1');
    expect(text).toContain('Attempt 2');
  });

  it('includes dependency chain', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('step-0');
  });

  it('includes healing suggestion type and reason', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('version_drift');
    expect(text).toContain('v2');
  });

  it('includes response body when present', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload());
    const text = JSON.stringify(adf);
    expect(text).toContain('not found');
  });

  it('omits retry history section when retryHistory is empty', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload({ retryHistory: [], retryCount: 0 }));
    const text = JSON.stringify(adf);
    expect(text).not.toContain('Retry History');
  });

  it('omits dependency section when dependencyChain is empty', () => {
    const adf = buildEnrichedApiDefectAdf(makePayload({ dependencyChain: [] }));
    const text = JSON.stringify(adf);
    expect(text).not.toContain('Dependency Chain');
  });
});
