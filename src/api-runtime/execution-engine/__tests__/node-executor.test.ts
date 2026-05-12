import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeNode } from '../node-executor';
import { setAdapter, getAdapter } from '../../playwright-api-adapter/adapter';
import type { IPlaywrightApiAdapter, AdapterResult } from '../../playwright-api-adapter/adapter';
import type { ApiTestStep } from '../../../data/types';

function makeStep(overrides: Partial<ApiTestStep> = {}): ApiTestStep {
  return {
    id: 's1', name: 'Step 1',
    request: { method: 'GET', url: 'https://api.test/resource', bodyType: 'none' },
    assertions: [], extractVariables: [], dependsOn: [],
    execution: {},
    ...overrides,
  } as unknown as ApiTestStep;
}

function makeAdapter(status = 200, body: unknown = {}): IPlaywrightApiAdapter {
  const snapshot = {
    status, headers: { 'content-type': 'application/json' },
    body, bodyTruncated: false, durationMs: 42,
  };
  return {
    execute: vi.fn().mockResolvedValue({ snapshot } as AdapterResult),
  };
}

let restoreAdapter: IPlaywrightApiAdapter;

beforeEach(() => {
  restoreAdapter = getAdapter();
});

afterEach(() => {
  setAdapter(restoreAdapter);
});

// ── Group 1: basic execution ──────────────────────────────────────────────────

describe('executeNode — basic execution', () => {
  it('returns passed result for 200 response with no assertions', async () => {
    setAdapter(makeAdapter(200));
    const result = await executeNode(makeStep(), {}, {}, 30_000);
    expect(result.status).toBe('passed');
    expect(result.stepId).toBe('s1');
    expect(result.response?.status).toBe(200);
    expect(result.durationMs).toBe(42);
  });

  it('returns error result when adapter throws', async () => {
    setAdapter({
      execute: vi.fn().mockRejectedValue(new Error('network failure')),
    });
    const result = await executeNode(makeStep(), {}, {}, 30_000);
    expect(result.status).toBe('error');
    expect(result.error).toContain('network failure');
  });
});

// ── Group 2: pre/post script ──────────────────────────────────────────────────

describe('executeNode — pre/post script', () => {
  it('pre-script mutations available in URL substitution', async () => {
    const adapter = makeAdapter(200);
    setAdapter(adapter);
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.test/{{userId}}', bodyType: 'none' },
      execution: { preScript: 'setVar("userId", "u99")' },
    } as Partial<ApiTestStep>);
    await executeNode(step, {}, {}, 30_000);
    const callArg = (adapter.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.request.url).toContain('u99');
  });
});

// ── Group 3: assertion evaluation ────────────────────────────────────────────

describe('executeNode — assertions', () => {
  it('returns failed when status assertion fails', async () => {
    setAdapter(makeAdapter(404));
    const step = makeStep({
      assertions: [{ field: 'status', operator: 'eq', value: '200' }],
    } as Partial<ApiTestStep>);
    const result = await executeNode(step, {}, {}, 30_000);
    expect(result.status).toBe('failed');
    expect(result.assertionResults[0].passed).toBe(false);
  });

  it('returns passed when no assertions defined', async () => {
    setAdapter(makeAdapter(200));
    const step = makeStep(); // no assertions
    const result = await executeNode(step, {}, {}, 30_000);
    expect(result.status).toBe('passed');
    expect(result.assertionResults).toHaveLength(0);
  });
});

// ── Group 4: variable extraction ─────────────────────────────────────────────

describe('executeNode — variable extraction', () => {
  it('extracts variable from response body', async () => {
    setAdapter(makeAdapter(200, { token: 'abc123' }));
    const step = makeStep({
      extractVariables: [{ name: 'token', source: 'body', path: '$.token' }],
    } as Partial<ApiTestStep>);
    const result = await executeNode(step, {}, {}, 30_000);
    expect(result.extractedVariables['token']).toBe('abc123');
  });
});

// ── Group 5: URL substitution ─────────────────────────────────────────────────

describe('executeNode — URL substitution', () => {
  it('substitutes context variable in URL', async () => {
    const adapter = makeAdapter(200);
    setAdapter(adapter);
    const step = makeStep({
      request: { method: 'GET', url: 'https://api.test/users/{{id}}', bodyType: 'none' },
    } as Partial<ApiTestStep>);
    await executeNode(step, { id: '42' }, {}, 30_000);
    const callArg = (adapter.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.request.url).toContain('42');
  });

  it('prepends baseUrl for relative URL', async () => {
    const adapter = makeAdapter(200);
    setAdapter(adapter);
    const step = makeStep({
      request: { method: 'GET', url: '/users/1', bodyType: 'none' },
    } as Partial<ApiTestStep>);
    await executeNode(step, {}, {}, 30_000, 'https://api.example.com');
    const callArg = (adapter.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.request.url).toBe('https://api.example.com/users/1');
  });
});

// ── Group 6: nodeType guard ───────────────────────────────────────────────────

describe('executeNode — nodeType guard', () => {
  it('throws on unsupported nodeType', async () => {
    const step = makeStep();
    (step as { nodeType?: string }).nodeType = 'CONDITION';
    await expect(executeNode(step, {}, {}, 30_000)).rejects.toThrow(/unsupported nodeType/);
  });

  it('accepts HTTP nodeType', async () => {
    setAdapter(makeAdapter(200));
    const step = makeStep();
    (step as { nodeType?: string }).nodeType = 'HTTP';
    const result = await executeNode(step, {}, {}, 30_000);
    expect(result.status).toBe('passed');
  });
});
