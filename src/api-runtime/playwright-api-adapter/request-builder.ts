/**
 * request-builder.ts
 * Phase B — LIVE IMPLEMENTATION.
 *
 * Extracts body-type branching + fetch option assembly from apiRunner.ts ~lines 263-295.
 * Receives already-resolved values — no variable substitution happens here.
 * Variable substitution stays in apiRunner.ts (variable-engine extraction is Phase B-2).
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type BodyType = 'json' | 'form' | 'multipart' | 'raw' | 'none';

export interface RequestSpec {
  url: string;
  method: HttpMethod;
  /** Already-resolved headers (auth headers pre-merged by caller) */
  headers: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
  bodyType?: BodyType;
  timeoutMs?: number;
  followRedirects?: boolean;
}

export interface BuiltRequest {
  /** Final URL — query params appended by Playwright via params option */
  resolvedUrl: string;
  /**
   * Fetch options shaped for Playwright ctx.fetch().
   * Typed generically — no Playwright import needed by callers.
   */
  fetchOptions: {
    method: string;
    timeout?: number;
    params?: Record<string, string>;
    data?: unknown;
    form?: Record<string, string>;
    multipart?: Record<string, unknown>;
    headers?: Record<string, string>;
  };
  /** Headers may be mutated (e.g. Content-Type added for JSON) — returned so caller sees final set */
  resolvedHeaders: Record<string, string>;
}

export interface IRequestBuilder {
  /**
   * Assemble fetch options from resolved request spec.
   * Replaces inline branching at apiRunner.ts ~lines 281-295.
   * Receives already-resolved values — no substituteVars calls here.
   */
  build(spec: RequestSpec): BuiltRequest;
}

// ── Phase B live implementation ───────────────────────────────────────────────

export class PlaywrightRequestBuilder implements IRequestBuilder {
  build(spec: RequestSpec): BuiltRequest {
    const headers = { ...spec.headers };

    const fetchOptions: BuiltRequest['fetchOptions'] = {
      method: spec.method,
      timeout: spec.timeoutMs,
      params: spec.queryParams && Object.keys(spec.queryParams).length > 0
        ? spec.queryParams
        : undefined,
    };

    const hasBody = spec.body !== undefined && spec.body !== null;
    const methodAllowsBody = !['GET', 'HEAD', 'OPTIONS'].includes(spec.method);

    if (hasBody && methodAllowsBody) {
      if (spec.bodyType === 'json') {
        fetchOptions.data = spec.body;
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      } else if (spec.bodyType === 'form') {
        fetchOptions.form = spec.body as Record<string, string>;
      } else if (spec.bodyType === 'multipart') {
        fetchOptions.multipart = spec.body as Record<string, unknown>;
      } else {
        // raw or unspecified
        fetchOptions.data = spec.body;
      }
    }

    return {
      resolvedUrl: spec.url,
      fetchOptions,
      resolvedHeaders: headers,
    };
  }
}

// ── Phase A stub ──────────────────────────────────────────────────────────────

export class RequestBuilderStub implements IRequestBuilder {
  build(_spec: RequestSpec): BuiltRequest {
    throw new Error('RequestBuilder not implemented — Phase B target');
  }
}
