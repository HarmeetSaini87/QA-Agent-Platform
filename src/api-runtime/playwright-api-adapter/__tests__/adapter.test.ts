/**
 * adapter.test.ts
 * Unit tests for PlaywrightApiAdapter, PlaywrightRequestBuilder, PlaywrightResponseParser.
 *
 * All tests run without a real Playwright browser — Playwright context is mocked.
 * Tests validate:
 *   A. RequestBuilder — body-type branching, query params, header assembly
 *   B. ResponseParser — body parsing, truncation, header normalization
 *   C. PlaywrightApiAdapter — integration via mocked context manager
 *   D. ctx.dispose() guarantee — called even when fetch throws
 *   E. getAdapter / setAdapter singleton swap
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PlaywrightRequestBuilder,
} from '../request-builder';
import {
  PlaywrightResponseParser,
  MAX_BODY_BYTES,
} from '../response-parser';
import {
  PlaywrightApiAdapter,
  getAdapter,
  setAdapter,
  PlaywrightApiAdapterStub,
  type IPlaywrightApiAdapter,
} from '../adapter';
import type {
  IRequestContextManager,
  IManagedContext,
} from '../context-manager';
import type { IResponseParser } from '../response-parser';
import type { IRequestBuilder } from '../request-builder';

// ── A. RequestBuilder ─────────────────────────────────────────────────────────

describe('PlaywrightRequestBuilder — A. Body type branching', () => {
  const builder = new PlaywrightRequestBuilder();

  it('GET — no body options, no data/form', () => {
    const result = builder.build({
      url: '/api/items', method: 'GET', headers: {},
    });
    expect(result.fetchOptions.data).toBeUndefined();
    expect(result.fetchOptions.form).toBeUndefined();
    expect(result.fetchOptions.method).toBe('GET');
  });

  it('POST json — sets data + Content-Type', () => {
    const result = builder.build({
      url: '/api/items', method: 'POST', headers: {},
      body: { name: 'test' }, bodyType: 'json',
    });
    expect(result.fetchOptions.data).toEqual({ name: 'test' });
    expect(result.resolvedHeaders['Content-Type']).toBe('application/json');
  });

  it('POST json — existing Content-Type not overwritten', () => {
    const result = builder.build({
      url: '/api/items', method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: { name: 'test' }, bodyType: 'json',
    });
    expect(result.resolvedHeaders['Content-Type']).toBe('application/vnd.api+json');
  });

  it('POST form — sets form, not data', () => {
    const result = builder.build({
      url: '/api/items', method: 'POST', headers: {},
      body: { key: 'value' }, bodyType: 'form',
    });
    expect(result.fetchOptions.form).toEqual({ key: 'value' });
    expect(result.fetchOptions.data).toBeUndefined();
  });

  it('POST raw — sets data', () => {
    const result = builder.build({
      url: '/api/items', method: 'POST', headers: {},
      body: 'raw-string', bodyType: 'raw',
    });
    expect(result.fetchOptions.data).toBe('raw-string');
  });

  it('HEAD — body ignored even if provided', () => {
    const result = builder.build({
      url: '/api/items', method: 'HEAD', headers: {},
      body: { ignored: true }, bodyType: 'json',
    });
    expect(result.fetchOptions.data).toBeUndefined();
  });

  it('OPTIONS — body ignored', () => {
    const result = builder.build({
      url: '/api/items', method: 'OPTIONS', headers: {},
      body: 'ignored', bodyType: 'raw',
    });
    expect(result.fetchOptions.data).toBeUndefined();
  });

  it('query params populated when provided', () => {
    const result = builder.build({
      url: '/api/items', method: 'GET', headers: {},
      queryParams: { page: '1', size: '10' },
    });
    expect(result.fetchOptions.params).toEqual({ page: '1', size: '10' });
  });

  it('query params undefined when empty', () => {
    const result = builder.build({
      url: '/api/items', method: 'GET', headers: {}, queryParams: {},
    });
    expect(result.fetchOptions.params).toBeUndefined();
  });

  it('timeout passed through to fetchOptions', () => {
    const result = builder.build({
      url: '/api/items', method: 'GET', headers: {}, timeoutMs: 5000,
    });
    expect(result.fetchOptions.timeout).toBe(5000);
  });

  it('resolvedUrl matches input url', () => {
    const result = builder.build({ url: 'https://api.test/v1', method: 'GET', headers: {} });
    expect(result.resolvedUrl).toBe('https://api.test/v1');
  });
});

// ── B. ResponseParser ─────────────────────────────────────────────────────────

describe('PlaywrightResponseParser — B. Response parsing', () => {
  const parser = new PlaywrightResponseParser();
  const timings = { startMs: 0, endMs: 100, durationMs: 100 };

  function mockResponse(opts: {
    status?: number;
    headers?: Record<string, string>;
    body?: Buffer | string;
  }) {
    const bodyBuf = opts.body instanceof Buffer ? opts.body : Buffer.from(opts.body ?? '');
    return {
      status: () => opts.status ?? 200,
      headers: () => opts.headers ?? {},
      body: async () => bodyBuf,
    };
  }

  it('parses JSON body', async () => {
    const res = mockResponse({ body: JSON.stringify({ id: 1 }) });
    const parsed = await parser.parse(res, timings);
    expect(parsed.body).toEqual({ id: 1 });
    expect(parsed.bodyTruncated).toBe(false);
  });

  it('falls back to string when JSON parse fails', async () => {
    const res = mockResponse({ body: 'not-json' });
    const parsed = await parser.parse(res, timings);
    expect(parsed.body).toBe('not-json');
  });

  it('truncates body exceeding MAX_BODY_BYTES', async () => {
    const bigBody = Buffer.alloc(MAX_BODY_BYTES + 100, 'x');
    const res = mockResponse({ body: bigBody });
    const parsed = await parser.parse(res, timings);
    expect(parsed.bodyTruncated).toBe(true);
    expect(typeof parsed.body).toBe('string');
    expect((parsed.body as string).length).toBe(MAX_BODY_BYTES);
  });

  it('captures status code', async () => {
    const res = mockResponse({ status: 404 });
    const parsed = await parser.parse(res, timings);
    expect(parsed.status).toBe(404);
  });

  it('normalizes headers to plain object', async () => {
    const res = mockResponse({ headers: { 'Content-Type': 'application/json', 'X-Custom': 'val' } });
    const parsed = await parser.parse(res, timings);
    expect(parsed.headers['Content-Type']).toBe('application/json');
    expect(parsed.headers['X-Custom']).toBe('val');
  });

  it('extracts contentType from content-type header', async () => {
    const res = mockResponse({ headers: { 'content-type': 'application/json; charset=utf-8' } });
    const parsed = await parser.parse(res, timings);
    expect(parsed.contentType).toBe('application/json');
  });

  it('durationMs comes from timings', async () => {
    const res = mockResponse({});
    const parsed = await parser.parse(res, { startMs: 0, endMs: 250, durationMs: 250 });
    expect(parsed.durationMs).toBe(250);
  });

  it('rawBodyBytes reflects original size', async () => {
    const body = Buffer.from('hello');
    const res = mockResponse({ body });
    const parsed = await parser.parse(res, timings);
    expect(parsed.rawBodyBytes).toBe(5);
  });
});

// ── C. PlaywrightApiAdapter — mocked context manager ─────────────────────────

function makeMockContextManager(opts: {
  fetchResult?: unknown;
  fetchError?: Error;
  disposeSpy?: ReturnType<typeof vi.fn>;
}): IRequestContextManager {
  const disposeSpy = opts.disposeSpy ?? vi.fn().mockResolvedValue(undefined);
  const ctx: IManagedContext = {
    contextId: 'mock-ctx-1',
    fetch: opts.fetchError
      ? vi.fn().mockRejectedValue(opts.fetchError)
      : vi.fn().mockResolvedValue(opts.fetchResult ?? {}),
    dispose: disposeSpy,
  };
  return {
    create: vi.fn().mockResolvedValue(ctx),
    disposeAll: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockParser(result: Partial<import('../response-parser').ParsedResponse> = {}): IResponseParser {
  return {
    parse: vi.fn().mockResolvedValue({
      status: 200, headers: {}, body: null, bodyTruncated: false, durationMs: 50, ...result,
    }),
  };
}

const baseRequest = {
  method: 'GET' as const,
  url: 'https://api.test/v1/items',
  headers: [],
  queryParams: [],
};

describe('PlaywrightApiAdapter — C. Adapter integration', () => {
  it('returns snapshot from parser result', async () => {
    const mgr = makeMockContextManager({ fetchResult: {} });
    const parser = makeMockParser({ status: 201, body: { ok: true } });
    const adapter = new PlaywrightApiAdapter(mgr, new PlaywrightRequestBuilder(), parser);

    const result = await adapter.execute({
      request: baseRequest,
      context: {},
      authHeaders: {},
      timeoutMs: 5000,
    });

    expect(result.snapshot.status).toBe(201);
    expect(result.snapshot.body).toEqual({ ok: true });
  });

  it('passes auth headers to context manager', async () => {
    const mgr = makeMockContextManager({ fetchResult: {} });
    const parser = makeMockParser();
    const adapter = new PlaywrightApiAdapter(mgr, new PlaywrightRequestBuilder(), parser);

    await adapter.execute({
      request: baseRequest,
      context: {},
      authHeaders: { Authorization: 'Bearer tok123' },
      timeoutMs: 5000,
    });

    expect(mgr.create).toHaveBeenCalledWith(
      expect.objectContaining({ extraHTTPHeaders: expect.objectContaining({ Authorization: 'Bearer tok123' }) })
    );
  });
});

// ── D. ctx.dispose() guarantee ────────────────────────────────────────────────

describe('PlaywrightApiAdapter — D. dispose() guarantee (Gate 5)', () => {
  it('dispose() called on successful fetch', async () => {
    const disposeSpy = vi.fn().mockResolvedValue(undefined);
    const mgr = makeMockContextManager({ fetchResult: {}, disposeSpy });
    const parser = makeMockParser();
    const adapter = new PlaywrightApiAdapter(mgr, new PlaywrightRequestBuilder(), parser);

    await adapter.execute({ request: baseRequest, context: {}, authHeaders: {}, timeoutMs: 5000 });

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it('dispose() called even when fetch throws', async () => {
    const disposeSpy = vi.fn().mockResolvedValue(undefined);
    const mgr = makeMockContextManager({
      fetchError: new Error('network error'),
      disposeSpy,
    });
    const adapter = new PlaywrightApiAdapter(mgr, new PlaywrightRequestBuilder(), makeMockParser());

    await expect(
      adapter.execute({ request: baseRequest, context: {}, authHeaders: {}, timeoutMs: 5000 })
    ).rejects.toThrow('network error');

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it('dispose() called even when parser throws', async () => {
    const disposeSpy = vi.fn().mockResolvedValue(undefined);
    const mgr = makeMockContextManager({ fetchResult: {}, disposeSpy });
    const badParser: IResponseParser = {
      parse: vi.fn().mockRejectedValue(new Error('parse failure')),
    };
    const adapter = new PlaywrightApiAdapter(mgr, new PlaywrightRequestBuilder(), badParser);

    await expect(
      adapter.execute({ request: baseRequest, context: {}, authHeaders: {}, timeoutMs: 5000 })
    ).rejects.toThrow('parse failure');

    expect(disposeSpy).toHaveBeenCalledOnce();
  });
});

// ── E. Singleton swap ─────────────────────────────────────────────────────────

describe('getAdapter / setAdapter — E. Singleton pattern', () => {
  let original: IPlaywrightApiAdapter;

  beforeEach(() => {
    original = getAdapter();
  });

  it('getAdapter returns default PlaywrightApiAdapter instance', () => {
    expect(getAdapter()).toBeInstanceOf(PlaywrightApiAdapter);
  });

  it('setAdapter replaces singleton', () => {
    const stub = new PlaywrightApiAdapterStub();
    setAdapter(stub);
    expect(getAdapter()).toBe(stub);
    setAdapter(original); // restore
  });

  it('adapter is restorable after swap', () => {
    const stub = new PlaywrightApiAdapterStub();
    setAdapter(stub);
    setAdapter(original);
    expect(getAdapter()).toBe(original);
  });
});
