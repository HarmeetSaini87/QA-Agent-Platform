/**
 * response-parser.ts
 * Phase B — LIVE IMPLEMENTATION.
 *
 * Extracts response body + header normalization from apiRunner.ts ~lines 300-314.
 * rawResponse typed as `unknown` — keeps Playwright out of the interface.
 * Implementation casts to Playwright APIResponse internally.
 *
 * MAX_BODY_BYTES moved here from apiRunner.ts — single source of truth.
 */

export const MAX_BODY_BYTES = 50 * 1024; // 50 KB — matches apiRunner.ts original

export interface ParsedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  bodyTruncated: boolean;
  durationMs: number;
  contentType?: string;
  rawBodyBytes?: number;
}

export interface ResponseTimings {
  startMs: number;
  endMs: number;
  durationMs: number;
  ttfbMs?: number;
}

export interface IResponseParser {
  /**
   * Parse raw Playwright APIResponse into ParsedResponse.
   * rawResponse: unknown — caller passes Playwright APIResponse; parser casts internally.
   * Phase B: replaces inline parsing at apiRunner.ts ~lines 300-314.
   */
  parse(rawResponse: unknown, timings: ResponseTimings): Promise<ParsedResponse>;
}

// ── Phase B live implementation ───────────────────────────────────────────────

export class PlaywrightResponseParser implements IResponseParser {
  async parse(rawResponse: unknown, timings: ResponseTimings): Promise<ParsedResponse> {
    // Cast to Playwright APIResponse shape — only this file imports Playwright types
    const res = rawResponse as {
      status(): number;
      headers(): Record<string, string>;
      body(): Promise<Buffer>;
    };

    const status = res.status();
    const rawHeaders = res.headers();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) headers[k] = v;

    const contentType = headers['content-type']?.split(';')[0]?.trim();

    const rawBuffer = await res.body();
    const rawBodyBytes = rawBuffer.length;
    let body: unknown;
    let bodyTruncated = false;

    if (rawBuffer.length > MAX_BODY_BYTES) {
      bodyTruncated = true;
      body = rawBuffer.slice(0, MAX_BODY_BYTES).toString('utf8');
    } else {
      const text = rawBuffer.toString('utf8');
      try { body = JSON.parse(text); } catch { body = text; }
    }

    return {
      status,
      headers,
      body,
      bodyTruncated,
      durationMs: timings.durationMs,
      contentType,
      rawBodyBytes,
    };
  }
}

// ── Phase A stub (kept for backward compat if anything imports it) ─────────────

export class ResponseParserStub implements IResponseParser {
  async parse(_rawResponse: unknown, _timings: ResponseTimings): Promise<ParsedResponse> {
    throw new Error('ResponseParser not implemented — Phase B target');
  }
}
