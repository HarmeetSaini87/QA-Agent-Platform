/**
 * adapter.ts
 * Phase B — LIVE IMPLEMENTATION.
 *
 * PlaywrightApiAdapter: thin orchestrator over context-manager + request-builder + response-parser.
 * Replaces inline Playwright usage in apiRunner.ts ~lines 279-317.
 *
 * apiRunner.ts wires in this adapter via module-level singleton (getAdapter/setAdapter).
 * All existing routes and executeStep signature remain UNCHANGED.
 *
 * Dependency boundary:
 *   adapter → IRequestContextManager  ✓
 *   adapter → IRequestBuilder         ✓
 *   adapter → IResponseParser         ✓
 *   workflow-engine → IPlaywrightApiAdapter only  ✓
 *   adapter → Playwright directly     ✗  (context-manager.ts handles that)
 */

import type { ApiRequest, ApiResponseSnapshot } from '../../data/types';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';
import type { RetryPolicy } from '../retry-engine/engine';
import type { HarMetadata } from './artifact-capture';
import type { IRequestContextManager } from './context-manager';
import type { IRequestBuilder } from './request-builder';
import type { IResponseParser } from './response-parser';
import {
  PlaywrightRequestContextManager,
} from './context-manager';
import { PlaywrightRequestBuilder } from './request-builder';
import { PlaywrightResponseParser } from './response-parser';

export interface AdapterRequestOptions {
  request: ApiRequest;
  /** Already-merged variable context — no substitution inside adapter */
  context: VariableMap;
  timeoutMs: number;
  /** Pre-resolved auth headers from IAuthInjector — adapter applies directly */
  authHeaders: Record<string, string>;
  retryPolicy?: RetryPolicy;
  /** Phase C: request HAR capture for this step */
  captureHar?: boolean;
  harMeta?: HarMetadata;
}

export interface AdapterResponse {
  /** Matches ApiResponseSnapshot shape exactly — zero breaking change to callers */
  snapshot: ApiResponseSnapshot;
  durationMs: number;
}

export interface IPlaywrightApiAdapter {
  /**
   * Execute a single HTTP request via Playwright APIRequestContext.
   * Auth headers pre-resolved by caller (IAuthInjector).
   * Phase B: replaces inline Playwright usage in apiRunner.ts ~lines 279-317.
   */
  execute(options: AdapterRequestOptions): Promise<AdapterResponse>;

  /**
   * Dispose any open contexts held by this adapter.
   * Call on worker shutdown or after a collection run completes.
   */
  close(): Promise<void>;
}

// ── Phase B live implementation ───────────────────────────────────────────────

export class PlaywrightApiAdapter implements IPlaywrightApiAdapter {
  private readonly _contextManager: IRequestContextManager;
  private readonly _requestBuilder: IRequestBuilder;
  private readonly _responseParser: IResponseParser;

  constructor(
    contextManager: IRequestContextManager = new PlaywrightRequestContextManager(),
    requestBuilder: IRequestBuilder = new PlaywrightRequestBuilder(),
    responseParser: IResponseParser = new PlaywrightResponseParser(),
  ) {
    this._contextManager = contextManager;
    this._requestBuilder = requestBuilder;
    this._responseParser = responseParser;
  }

  async execute(options: AdapterRequestOptions): Promise<AdapterResponse> {
    const { request, authHeaders, timeoutMs } = options;

    // Assemble resolved headers (caller already resolved variables + auth)
    const headers = { ...authHeaders };

    // Build query params object
    const queryParams: Record<string, string> = {};
    const rawParams = request.queryParams ?? [];
    if (Array.isArray(rawParams)) {
      for (const p of rawParams as { key?: string; value?: string; enabled?: boolean }[]) {
        if (p.enabled !== false && p.key) queryParams[p.key] = p.value ?? '';
      }
    } else {
      Object.assign(queryParams, rawParams as Record<string, string>);
    }

    const built = this._requestBuilder.build({
      url: request.url,
      method: request.method as import('./request-builder').HttpMethod,
      headers,
      queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      body: request.body,
      bodyType: request.bodyType as import('./request-builder').BodyType | undefined,
      timeoutMs,
    });

    const startMs = Date.now();
    const ctx = await this._contextManager.create({
      extraHTTPHeaders: built.resolvedHeaders,
      timeoutMs,
    });

    try {
      const rawResponse = await ctx.fetch(built.resolvedUrl, built.fetchOptions);
      const endMs = Date.now();
      const parsed = await this._responseParser.parse(rawResponse, {
        startMs,
        endMs,
        durationMs: endMs - startMs,
      });

      const snapshot: ApiResponseSnapshot = {
        status: parsed.status,
        headers: parsed.headers,
        body: parsed.body,
        bodyTruncated: parsed.bodyTruncated,
        durationMs: parsed.durationMs,
      };

      return { snapshot, durationMs: parsed.durationMs };
    } finally {
      // Gate 5 — NON-NEGOTIABLE: always dispose, even on throw
      await ctx.dispose();
    }
  }

  async close(): Promise<void> {
    await this._contextManager.disposeAll();
  }
}

// ── Singleton accessor — wired into apiRunner.ts ──────────────────────────────

let _adapter: IPlaywrightApiAdapter = new PlaywrightApiAdapter();

/** Returns the module-level adapter singleton. */
export function getAdapter(): IPlaywrightApiAdapter {
  return _adapter;
}

/** Replace adapter — for testing or Phase C worker injection. */
export function setAdapter(adapter: IPlaywrightApiAdapter): void {
  _adapter = adapter;
}

// ── Phase A stub (kept for import compat) ─────────────────────────────────────

export class PlaywrightApiAdapterStub implements IPlaywrightApiAdapter {
  async execute(_options: AdapterRequestOptions): Promise<AdapterResponse> {
    throw new Error('PlaywrightApiAdapter not implemented — Phase B target');
  }
  async close(): Promise<void> { /* no-op */ }
}
