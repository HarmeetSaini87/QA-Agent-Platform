// src/api-defects/__tests__/api-heal-advisor.test.ts
import { describe, it, expect } from 'vitest';
import { proposeUrlFixes } from '../api-heal-advisor';
import type { ApiStepResult } from '../../data/types';

function makeStep(overrides: Partial<ApiStepResult> = {}): ApiStepResult {
  return {
    stepId: 'step-1',
    stepName: 'Test Step',
    status: 'failed',
    request: { method: 'GET', url: 'https://api.example.com/users', headers: {}, body: undefined, queryParams: {} },
    response: { status: 200, headers: {}, body: 'ok', durationMs: 100, bodyTruncated: false },
    assertionResults: [],
    extractedVariables: {},
    durationMs: 100,
    ...overrides,
  } as ApiStepResult;
}

describe('proposeUrlFixes', () => {
  it('returns empty array when step passed (200 status, no error)', () => {
    const step = makeStep({ status: 'passed' });
    expect(proposeUrlFixes(step)).toEqual([]);
  });

  it('suggests version_drift for 404 with /v1/ in URL', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/v1/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const drift = suggestions.find(s => s.type === 'version_drift');
    expect(drift).toBeDefined();
    expect(drift!.suggestedUrl).toContain('/v2/');
    expect(drift!.confidence).toBe(0.6);
  });

  it('suggests version_drift with v2→v3 when URL has /v2/', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/v2/orders', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const drift = suggestions.find(s => s.type === 'version_drift');
    expect(drift).toBeDefined();
    expect(drift!.suggestedUrl).toContain('/v3/');
  });

  it('suggests missing_prefix for 404 URL without /api/', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const prefix = suggestions.find(s => s.type === 'missing_prefix');
    expect(prefix).toBeDefined();
    expect(prefix!.suggestedUrl).toContain('/api/users');
  });

  it('does NOT suggest missing_prefix when URL already has /api/', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/api/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    expect(suggestions.find(s => s.type === 'missing_prefix')).toBeUndefined();
  });

  it('suggests base_url_drift for network error ECONNREFUSED', () => {
    const step = makeStep({
      response: undefined,
      error: 'ECONNREFUSED 127.0.0.1:3001',
    });
    const suggestions = proposeUrlFixes(step);
    const drift = suggestions.find(s => s.type === 'base_url_drift');
    expect(drift).toBeDefined();
    expect(drift!.confidence).toBe(0.7);
    expect(drift!.reason).toContain('ECONNREFUSED');
  });

  it('suggests base_url_drift for ENOTFOUND', () => {
    const step = makeStep({
      response: undefined,
      error: 'ENOTFOUND api.example.com',
    });
    const suggestions = proposeUrlFixes(step);
    expect(suggestions.find(s => s.type === 'base_url_drift')).toBeDefined();
  });

  it('suggests auth_refresh for 401 with confidence 0.8', () => {
    const step = makeStep({
      response: { status: 401, headers: {}, body: 'unauth', durationMs: 80, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const auth = suggestions.find(s => s.type === 'auth_refresh');
    expect(auth).toBeDefined();
    expect(auth!.confidence).toBe(0.8);
    expect(auth!.reason).toContain('401');
  });

  it('suggests auth_refresh for 403', () => {
    const step = makeStep({
      response: { status: 403, headers: {}, body: 'forbidden', durationMs: 80, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    const auth = suggestions.find(s => s.type === 'auth_refresh');
    expect(auth).toBeDefined();
    expect(auth!.reason).toContain('403');
  });

  it('returns 2 suggestions for 404 with /v1/ AND no /api/ prefix', () => {
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.example.com/v1/users', headers: {}, body: undefined, queryParams: {} },
      response: { status: 404, headers: {}, body: 'nf', durationMs: 100, bodyTruncated: false },
    });
    const suggestions = proposeUrlFixes(step);
    expect(suggestions.length).toBe(2);
    expect(suggestions.map(s => s.type)).toContain('version_drift');
    expect(suggestions.map(s => s.type)).toContain('missing_prefix');
  });
});
