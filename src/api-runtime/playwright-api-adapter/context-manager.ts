/**
 * context-manager.ts
 * Phase B — LIVE IMPLEMENTATION.
 *
 * Wraps Playwright APIRequestContext lifecycle.
 * Extracts pwRequest.newContext() + ctx.dispose() from apiRunner.ts ~lines 279, 315-316.
 *
 * IMPORTANT: This is the ONLY file in api-runtime that imports from 'playwright' directly.
 * All other modules depend on IRequestContextManager — never on Playwright types.
 *
 * NON-NEGOTIABLE USAGE PATTERN (Gate 5):
 * Every call to create() MUST be wrapped in try/finally:
 *
 *   const ctx = await manager.create(options);
 *   try {
 *     const res = await ctx.fetch(url, opts);
 *   } finally {
 *     await ctx.dispose();   // ALWAYS runs — even on throw, timeout, or cancellation
 *   }
 *
 * Playwright APIRequestContext leaks cause: memory growth, open TCP connections,
 * TLS session accumulation, and eventual process OOM under load.
 */

import { request as pwRequest } from 'playwright';

export interface RequestContextOptions {
  extraHTTPHeaders?: Record<string, string>;
  timeoutMs?: number;
  baseUrl?: string;
  ignoreHTTPSErrors?: boolean;
  /** Phase C: enable HAR recording on this context */
  recordHar?: boolean;
}

export interface IManagedContext {
  /** Opaque ID — for tracking/debugging only; callers never access Playwright internals */
  readonly contextId: string;
  /**
   * Execute an HTTP fetch via the underlying Playwright APIRequestContext.
   * Returns raw Playwright APIResponse — callers pass to IResponseParser.
   */
  fetch(url: string, options: Record<string, unknown>): Promise<unknown>;
  /** MUST be called in finally — disposes the underlying Playwright context */
  dispose(): Promise<void>;
}

export interface IRequestContextManager {
  /**
   * Create a scoped Playwright APIRequestContext.
   * Caller MUST call IManagedContext.dispose() in a finally block after use.
   * Phase B: wraps pwRequest.newContext().
   *
   * NON-NEGOTIABLE USAGE PATTERN (Gate 5):
   * Every call to create() MUST be wrapped in try/finally:
   *
   *   const ctx = await manager.create(options);
   *   try {
   *     const res = await ctx.fetch(url, opts);   // or adapter.execute()
   *   } finally {
   *     await ctx.dispose();   // ALWAYS runs — even on throw, timeout, or cancellation
   *   }
   *
   * Playwright APIRequestContext leaks cause: memory growth, open TCP connections,
   * TLS session accumulation, and eventual process OOM under load.
   * There are NO exceptions to this rule. No "I'll dispose it later" patterns.
   */
  create(options: RequestContextOptions): Promise<IManagedContext>;

  /** Dispose all open contexts — called on worker shutdown or server teardown. */
  disposeAll(): Promise<void>;
}

// ── Phase B live implementation ───────────────────────────────────────────────

let _contextCounter = 0;

class ManagedPlaywrightContext implements IManagedContext {
  readonly contextId: string;
  private readonly _inner: Awaited<ReturnType<typeof pwRequest.newContext>>;

  constructor(inner: Awaited<ReturnType<typeof pwRequest.newContext>>) {
    this._inner = inner;
    this.contextId = `ctx-${++_contextCounter}-${Date.now()}`;
  }

  async fetch(url: string, options: Record<string, unknown>): Promise<unknown> {
    return this._inner.fetch(url, options as Parameters<typeof this._inner.fetch>[1]);
  }

  async dispose(): Promise<void> {
    await this._inner.dispose();
  }
}

export class PlaywrightRequestContextManager implements IRequestContextManager {
  private readonly _open = new Map<string, ManagedPlaywrightContext>();

  async create(options: RequestContextOptions): Promise<IManagedContext> {
    const inner = await pwRequest.newContext({
      extraHTTPHeaders: options.extraHTTPHeaders,
      ignoreHTTPSErrors: options.ignoreHTTPSErrors,
      baseURL: options.baseUrl,
    });
    const ctx = new ManagedPlaywrightContext(inner);
    this._open.set(ctx.contextId, ctx);
    // Auto-remove from tracking on dispose
    const originalDispose = ctx.dispose.bind(ctx);
    const self = this;
    ctx.dispose = async function () {
      self._open.delete(ctx.contextId);
      await originalDispose();
    };
    return ctx;
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this._open.values()].map(c => c.dispose()));
    this._open.clear();
  }
}

// ── Phase A stub ──────────────────────────────────────────────────────────────

export class RequestContextManagerStub implements IRequestContextManager {
  async create(_options: RequestContextOptions): Promise<IManagedContext> {
    throw new Error('RequestContextManager not implemented — Phase B target');
  }
  async disposeAll(): Promise<void> { /* no-op */ }
}
