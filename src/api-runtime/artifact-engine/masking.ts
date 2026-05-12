import type { ApiCollectionRunResult, ApiStepResult } from '../../data/types';

const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|x-auth-token|cookie|set-cookie|proxy-authorization)$/i;
const SENSITIVE_VAR_RE = /(?:password|token|secret|key|credential|api[_-]?key|auth)/i;
const MASK = '***';

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_RE.test(k) ? MASK : v;
  }
  return out;
}

function maskStepResult(step: ApiStepResult): ApiStepResult {
  if (!step.response) return step;
  return {
    ...step,
    response: {
      ...step.response,
      headers: maskHeaders(step.response.headers ?? {}),
    },
    extractedVariables: Object.fromEntries(
      Object.entries(step.extractedVariables ?? {}).map(([k, v]) =>
        [k, SENSITIVE_VAR_RE.test(k) ? MASK : v]
      )
    ),
  };
}

export function maskRunResult(result: ApiCollectionRunResult): ApiCollectionRunResult {
  return {
    ...result,
    stepResults: result.stepResults.map(maskStepResult),
  };
}
