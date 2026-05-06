import { JSONPath } from 'jsonpath-plus';
import Ajv from 'ajv';
import type { ApiAssertion, ApiAssertionResult, ApiResponseSnapshot } from '../data/types';

const ajv = new Ajv();

function resolveField(field: string, response: ApiResponseSnapshot): unknown {
  if (field === 'status')       return response.status;
  if (field === 'responseTime') return response.durationMs;
  if (field.startsWith('header.')) {
    const name = field.slice(7).toLowerCase();
    const key = Object.keys(response.headers).find(k => k.toLowerCase() === name);
    return key ? response.headers[key] : undefined;
  }
  // JSONPath into body
  try {
    const results = JSONPath({ path: field.startsWith('$') ? field : `$.${field}`, json: response.body as object });
    return results.length > 0 ? results[0] : undefined;
  } catch {
    return undefined;
  }
}

function evaluate(op: string, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'equals':             return String(actual) === String(expected);
    case 'notEquals':          return String(actual) !== String(expected);
    case 'contains':           return typeof actual === 'string' && actual.includes(String(expected));
    case 'notContains':        return typeof actual === 'string' && !actual.includes(String(expected));
    case 'startsWith':         return typeof actual === 'string' && actual.startsWith(String(expected));
    case 'endsWith':           return typeof actual === 'string' && actual.endsWith(String(expected));
    case 'greaterThan':        return Number(actual) > Number(expected);
    case 'lessThan':           return Number(actual) < Number(expected);
    case 'greaterThanOrEqual': return Number(actual) >= Number(expected);
    case 'lessThanOrEqual':    return Number(actual) <= Number(expected);
    case 'matches':            return typeof actual === 'string' && new RegExp(String(expected)).test(actual);
    case 'exists':             return actual !== undefined && actual !== null;
    case 'notExists':          return actual === undefined || actual === null;
    case 'isEmpty':            return actual === '' || actual === null || actual === undefined ||
                                      (Array.isArray(actual) && actual.length === 0) ||
                                      (typeof actual === 'object' && actual !== null && Object.keys(actual).length === 0);
    case 'isNotEmpty':         return actual !== '' && actual !== null && actual !== undefined &&
                                      !(Array.isArray(actual) && actual.length === 0) &&
                                      !(typeof actual === 'object' && actual !== null && Object.keys(actual).length === 0);
    case 'isType':             return typeof actual === String(expected);
    case 'jsonSchemaValid': {
      try {
        const validate = ajv.compile(expected as object);
        return validate(actual) as boolean;
      } catch { return false; }
    }
    default: return false;
  }
}

export function evaluateAssertions(
  assertions: ApiAssertion[],
  response: ApiResponseSnapshot
): { results: ApiAssertionResult[]; stepStatus: 'passed' | 'failed' | 'degraded' } {
  const maxWeight = assertions.length > 0 ? Math.max(...assertions.map(a => a.weight ?? 1)) : 1;
  const results: ApiAssertionResult[] = [];
  let anyHardFailed = false;
  let anySoftFailed = false;

  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i];
    const actual = resolveField(a.field, response);
    const passed = evaluate(a.operator, actual, a.expected);
    const confidenceScore = (a.weight ?? 1) / maxWeight * (passed ? 100 : 0);

    results.push({
      assertionIndex: i,
      field: a.field,
      operator: a.operator,
      passed,
      actual,
      expected: a.expected,
      message: a.message,
      confidenceScore,
    });

    if (!passed) {
      if (a.severity === 'soft') anySoftFailed = true;
      else anyHardFailed = true;
    }
  }

  const stepStatus = anyHardFailed ? 'failed' : anySoftFailed ? 'degraded' : 'passed';
  return { results, stepStatus };
}
