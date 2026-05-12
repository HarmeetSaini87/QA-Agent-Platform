import { describe, it, expect, vi } from 'vitest';
import {
  isRetryEligible,
  shouldRetryOnResult,
  executeWithRetry,
  getRetryEngine,
  RetryEngine,
} from '../engine';
import type { ApiTestStep, ApiStepResult } from '../../../data/types';

function makeStep(method: string, overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id: 's1', name: 'Step 1',
    request: { method, url: 'https://api.test/resource', bodyType: 'none' },
    assertions: [], extractVariables: [], dependsOn: [],
    execution: {},
    ...overrides,
  } as unknown as ApiTestStep;
}

function makeResult(status: number, stepStatus: ApiStepResult['status'] = 'passed'): ApiStepResult {
  return {
    stepId: 's1', stepName: 'Step 1', status: stepStatus,
    request: { method: 'GET', url: 'https://api.test/resource', bodyType: 'none' },
    assertionResults: [], extractedVariables: {}, durationMs: 10,
    response: { status, headers: {}, body: '', bodyTruncated: false, durationMs: 10 },
  };
}

// ── Group 1: isRetryEligible ──────────────────────────────────────────────────

describe('isRetryEligible', () => {
  // Original semantics: isIdempotent = (exec.idempotent !== false)
  // canRetry = isIdempotent || !mutable
  // Default (idempotent undefined): isIdempotent=true → canRetry=true for ALL methods

  it('GET is retry-eligible by default', () => {
    expect(isRetryEligible(makeStep('GET'))).toBe(true);
  });

  it('POST is retry-eligible by default (idempotent defaults to true)', () => {
    expect(isRetryEligible(makeStep('POST'))).toBe(true);
  });

  it('GET with idempotent=false but non-mutable — still eligible (!mutable=true)', () => {
    // canRetry = false || !false = true — GET is not mutable
    const step = makeStep('GET', { execution: { idempotent: false } } as Partial<ApiTestStep>);
    expect(isRetryEligible(step)).toBe(true);
  });

  it('POST with idempotent=false is NOT retry-eligible', () => {
    // canRetry = false || !true = false
    const step = makeStep('POST', { execution: { idempotent: false } } as Partial<ApiTestStep>);
    expect(isRetryEligible(step)).toBe(false);
  });

  it('PUT with idempotent=false is NOT retry-eligible', () => {
    const step = makeStep('PUT', { execution: { idempotent: false } } as Partial<ApiTestStep>);
    expect(isRetryEligible(step)).toBe(false);
  });

  it('DELETE is retry-eligible by default (not in mutable list)', () => {
    expect(isRetryEligible(makeStep('DELETE'))).toBe(true);
  });
});

// ── Group 2: shouldRetryOnResult ──────────────────────────────────────────────

describe('shouldRetryOnResult', () => {
  it('returns true for transport error', () => {
    const result = { ...makeResult(0, 'error'), response: undefined };
    expect(shouldRetryOnResult(result as ApiStepResult, [500])).toBe(true);
  });

  it('returns true for retryOn status code', () => {
    expect(shouldRetryOnResult(makeResult(503), [503])).toBe(true);
  });

  it('returns false for non-retryOn status code', () => {
    expect(shouldRetryOnResult(makeResult(200), [503])).toBe(false);
  });

  it('returns false for 200 with default retry codes', () => {
    expect(shouldRetryOnResult(makeResult(200), [500, 502, 503, 504, 429])).toBe(false);
  });

  it('returns true for 429 with default retry codes', () => {
    expect(shouldRetryOnResult(makeResult(429), [500, 502, 503, 504, 429])).toBe(true);
  });
});

// ── Group 3: executeWithRetry ─────────────────────────────────────────────────

describe('executeWithRetry', () => {
  it('returns result immediately if no retry needed (200)', async () => {
    const step = makeStep('GET', { execution: { retryPolicy: { maxRetries: 3, delayMs: 0 } } } as Partial<ApiTestStep>);
    const fn = vi.fn().mockResolvedValue(makeResult(200));
    const result = await executeWithRetry(step, fn);
    expect(result.response?.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and returns final result', async () => {
    const step = makeStep('GET', { execution: { retryPolicy: { maxRetries: 2, delayMs: 0, retryOn: [503] } } } as Partial<ApiTestStep>);
    const fn = vi.fn()
      .mockResolvedValueOnce(makeResult(503, 'failed'))
      .mockResolvedValueOnce(makeResult(503, 'failed'))
      .mockResolvedValueOnce(makeResult(200));
    const result = await executeWithRetry(step, fn);
    expect(result.response?.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops at maxRetries even if still failing', async () => {
    const step = makeStep('GET', { execution: { retryPolicy: { maxRetries: 2, delayMs: 0, retryOn: [503] } } } as Partial<ApiTestStep>);
    const fn = vi.fn().mockResolvedValue(makeResult(503, 'failed'));
    const result = await executeWithRetry(step, fn);
    expect(result.response?.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(3); // attempt 0, 1, 2
  });

  it('does NOT retry POST with idempotent=false', async () => {
    // canRetry = false || !true = false
    const step = makeStep('POST', {
      execution: { idempotent: false, retryPolicy: { maxRetries: 3, delayMs: 0, retryOn: [503] } },
    } as Partial<ApiTestStep>);
    const fn = vi.fn().mockResolvedValue(makeResult(503, 'failed'));
    await executeWithRetry(step, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries POST when idempotent=true', async () => {
    const step = makeStep('POST', {
      execution: { idempotent: true, retryPolicy: { maxRetries: 1, delayMs: 0, retryOn: [503] } },
    } as Partial<ApiTestStep>);
    const fn = vi.fn()
      .mockResolvedValueOnce(makeResult(503, 'failed'))
      .mockResolvedValueOnce(makeResult(200));
    const result = await executeWithRetry(step, fn);
    expect(result.response?.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries transport error (status=error)', async () => {
    const step = makeStep('GET', { execution: { retryPolicy: { maxRetries: 1, delayMs: 0 } } } as Partial<ApiTestStep>);
    const errResult: ApiStepResult = { ...makeResult(0, 'error'), response: undefined } as unknown as ApiStepResult;
    const fn = vi.fn()
      .mockResolvedValueOnce(errResult)
      .mockResolvedValueOnce(makeResult(200));
    const result = await executeWithRetry(step, fn);
    expect(result.response?.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses default maxRetries=0 when no retryPolicy', async () => {
    const step = makeStep('GET');
    const fn = vi.fn().mockResolvedValue(makeResult(503, 'failed'));
    await executeWithRetry(step, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── Group 4: RetryEngine.withRetry ───────────────────────────────────────────

describe('RetryEngine.withRetry', () => {
  it('calls fn once and returns result', async () => {
    const engine = new RetryEngine();
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await engine.withRetry(fn, { maxRetries: 3, delayMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('getRetryEngine returns singleton', () => {
    expect(getRetryEngine()).toBe(getRetryEngine());
  });
});
