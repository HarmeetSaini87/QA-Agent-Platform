// src/api-flakiness/failure-signature.ts
import type { ApiStepResult } from '../data/types';
import type { FailureCategory, FailureSignature } from './contracts/flakiness.contracts';

const NETWORK_ERRORS = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'];
const TIMEOUT_PATTERNS = /timed?\s*out|timeout|ETIMEDOUT/i;
const DEP_PROPAGATION_PATTERNS = /skipped.*dependency|dependency.*failed|blocked by/i;

function detectTransportError(error: string): string | undefined {
  for (const code of NETWORK_ERRORS) {
    if (error.includes(code)) return code;
  }
  return undefined;
}

export function buildFailureSignature(step: ApiStepResult): FailureSignature {
  const error = step.error ?? '';
  const httpStatus = step.response?.status;

  // 1. dependency propagation (skipped by upstream failure)
  if (step.status === 'skipped' && DEP_PROPAGATION_PATTERNS.test(error)) {
    return {
      signatureKey: 'dependency_propagation:skipped',
      category: 'dependency_propagation',
    };
  }

  // 2. assertion failures (check before http_status — assertion is more specific)
  const failedAssertions = step.assertionResults.filter(a => !a.passed);
  if (failedAssertions.length > 0) {
    const a = failedAssertions[0];
    return {
      signatureKey: `assertion:${a.field}:${a.operator}`,
      category: 'assertion',
      assertionField: a.field,
      assertionOperator: a.operator,
    };
  }

  // 3. auth failures
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      signatureKey: `auth:${httpStatus}`,
      category: 'auth',
      httpStatus,
    };
  }

  // 4. timeout
  if (TIMEOUT_PATTERNS.test(error)) {
    const isEtimedout = error.includes('ETIMEDOUT');
    return {
      signatureKey: isEtimedout ? 'timeout:ETIMEDOUT' : 'timeout',
      category: 'timeout',
      ...(isEtimedout ? { transportError: 'ETIMEDOUT' } : {}),
    };
  }

  // 5. network/transport errors
  const transportError = detectTransportError(error);
  if (transportError) {
    return {
      signatureKey: `network:${transportError}`,
      category: 'network',
      transportError,
    };
  }

  // 6. non-2xx HTTP status
  if (httpStatus !== undefined && (httpStatus < 200 || httpStatus >= 300)) {
    return {
      signatureKey: `http_status:${httpStatus}`,
      category: 'http_status',
      httpStatus,
    };
  }

  // 7. unknown
  return {
    signatureKey: `unknown:${step.status}`,
    category: 'unknown',
  };
}
