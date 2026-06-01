/**
 * retry-engine/engine.ts
 * Live implementation — Phase B Step 6 extraction from apiRunner.ts.
 *
 * executeStepWithRetry() logic moved here from src/utils/apiRunner.ts.
 * apiRunner.ts retains commented-out original per CLAUDE.md comment-out rule.
 *
 * Retry semantics preserved exactly:
 *   - exponential backoff: delayMs * 2^(attempt-1)
 *   - retryOn status codes: [500, 502, 503, 504, 429] default
 *   - idempotency guard: POST/PUT/PATCH skip retries unless step.execution.idempotent=true
 *   - transport errors (status='error') always retry within budget
 */

import type { ApiTestStep, ApiStepResult } from '../../data/types';
import type { RetryHistoryEntry } from '../workflow-engine/failure-propagation';

export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
  /** HTTP status codes that trigger a retry. Default: [500, 502, 503, 504, 429] */
  retryOn?: number[];
  /** Only retry if step.execution.idempotent === true (default: true for GET/HEAD) */
  respectIdempotency?: boolean;
}

export interface IRetryEngine {
  /**
   * Execute fn with retry policy.
   * fn receives the attempt number (0-based).
   */
  withRetry<T>(fn: (attempt: number) => Promise<T>, policy: RetryPolicy): Promise<T>;
}

// ── Retry decision helpers ────────────────────────────────────────────────────

const DEFAULT_RETRY_ON = [500, 502, 503, 504, 429];
const MUTABLE_METHODS = ['POST', 'PUT', 'PATCH'];

export function isRetryEligible(step: ApiTestStep): boolean {
  const isIdempotent = (step.execution?.idempotent) !== false;
  const isMutable = MUTABLE_METHODS.includes(step.request.method);
  return isIdempotent || !isMutable;
}

export function shouldRetryOnResult(result: ApiStepResult, retryOn: number[]): boolean {
  if (result.status === 'error') return true;
  const status = result.response?.status;
  return !!status && retryOn.includes(status);
}

// ── RetryEngine ───────────────────────────────────────────────────────────────

export class RetryEngine implements IRetryEngine {
  async withRetry<T>(fn: (attempt: number) => Promise<T>, policy: RetryPolicy): Promise<T> {
    let last: T | undefined;
    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = policy.delayMs * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
      last = await fn(attempt);
      return last; // caller controls break condition via shouldRetryOnResult
    }
    return last!;
  }
}

// ── Step-level retry coordinator ──────────────────────────────────────────────

/**
 * executeWithRetry — wraps a single step execution with retry semantics.
 * Extracted from apiRunner.ts executeStepWithRetry().
 *
 * Transport boundary: executeStep is injected — retry engine never calls
 * Playwright directly. DAG-safe: retries are contained within a single node;
 * no dependency edges or variable propagation are affected.
 *
 * Phase C Step 4: optional onAttempt callback — called after each attempt with
 * a RetryHistoryEntry. Zero behavior change when callback is absent.
 */
export async function executeWithRetry(
  step: ApiTestStep,
  executeStep: (step: ApiTestStep, attempt: number) => Promise<ApiStepResult>,
  onAttempt?: (entry: RetryHistoryEntry) => void,
): Promise<ApiStepResult> {
  const exec = step.execution ?? {};
  const retry = exec.retryPolicy ?? { maxRetries: 0, delayMs: 0 };
  const retryOn = retry.retryOn ?? DEFAULT_RETRY_ON;
  const canRetry = isRetryEligible(step);
  const maxAttempts = canRetry ? retry.maxRetries : 0;

  let last: ApiStepResult | undefined;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = retry.delayMs * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
    const attemptStart = new Date().toISOString();
    const attemptStartMs = Date.now();
    last = await executeStep(step, attempt);
    const willRetry = canRetry && shouldRetryOnResult(last, retryOn) && attempt < maxAttempts;

    // Phase C Step 4: emit attempt record (fire-and-forget, never throws)
    if (onAttempt) {
      try {
        onAttempt({
          attempt,
          startedAt: attemptStart,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartMs,
          httpStatus: last.response?.status,
          error: last.error,
          resultStatus: last.status,
          retriedAfter: willRetry,
        });
      } catch { /* never break execution */ }
    }

    if (!shouldRetryOnResult(last, retryOn)) break;
    if (!canRetry) break;
  }
  return last!;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _retryEngine: RetryEngine | null = null;

export function getRetryEngine(): RetryEngine {
  if (!_retryEngine) _retryEngine = new RetryEngine();
  return _retryEngine;
}
