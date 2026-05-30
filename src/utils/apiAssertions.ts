import { JSONPath } from 'jsonpath-plus';
import Ajv from 'ajv';
import type { ApiAssertion, ApiAssertionResult, ApiResponseSnapshot } from '../data/types';

const ajv = new Ajv();

function resolveField(field: string, response: ApiResponseSnapshot): unknown {
  // Status code — accept both 'status' (engine format) and 'statusCode' (UI format)
  if (field === 'status' || field === 'statusCode') return response.status;
  if (field === 'responseTime') return response.durationMs;

  // Response payload size in bytes (approximate via JSON serialisation)
  if (field === 'responseSize') {
    try { return JSON.stringify(response.body).length; } catch { return 0; }
  }

  // HTTP version — read from gateway/proxy header if present
  if (field === 'httpVersion') {
    return response.headers['x-http-version'] ?? response.headers['http-version'] ?? undefined;
  }

  // Named response header — field = 'header.<name>'
  if (field.startsWith('header.')) {
    const name = field.slice(7).toLowerCase();
    const key = Object.keys(response.headers).find(k => k.toLowerCase() === name);
    return key ? response.headers[key] : undefined;
  }

  // Cookie value by name — field = 'cookie.<name>'
  if (field.startsWith('cookie.')) {
    const cookieName = field.slice(7).toLowerCase();
    const raw = response.headers['set-cookie'] ?? response.headers['Set-Cookie'] ?? '';
    const pairs = raw.split(/[;,]/).map((s: string) => s.trim());
    const match = pairs.find((p: string) => p.toLowerCase().startsWith(cookieName + '='));
    return match ? match.split('=').slice(1).join('=') : undefined;
  }

  // Array length — field = '@arrayLength:<jsonpath>'
  if (field.startsWith('@arrayLength:')) {
    const path = field.slice(13);
    if (!path) return undefined;
    try {
      const results = JSONPath({ path, json: response.body as object });
      const val = results[0];
      return Array.isArray(val) ? val.length : undefined;
    } catch { return undefined; }
  }

  // Object field count — field = '@fieldCount:<jsonpath>'
  if (field.startsWith('@fieldCount:')) {
    const path = field.slice(12);
    if (!path) return undefined;
    try {
      const results = JSONPath({ path, json: response.body as object });
      const val = results[0];
      return (val && typeof val === 'object' && !Array.isArray(val))
        ? Object.keys(val as object).length
        : undefined;
    } catch { return undefined; }
  }

  // Body contains — stringify so the `contains` operator can search the full payload as text
  if (field === 'bodyContains') {
    try { return typeof response.body === 'string' ? response.body : JSON.stringify(response.body); }
    catch { return ''; }
  }

  // Body is valid JSON — return boolean; body already parsed means true; raw string: try parse
  if (field === 'bodyIsJson') {
    if (response.body === null || response.body === undefined) return false;
    if (typeof response.body === 'object') return true;
    if (typeof response.body === 'string') {
      try { JSON.parse(response.body); return true; } catch { return false; }
    }
    return false;
  }

  // JSONPath into body (direct path or legacy 'body' fallback)
  if (field === 'body') return response.body;
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
    // Array operators
    case 'arrayLengthEquals':      return Array.isArray(actual) && actual.length === Number(expected);
    case 'arrayLengthGreaterThan': return Array.isArray(actual) && actual.length > Number(expected);
    case 'arrayLengthLessThan':    return Array.isArray(actual) && actual.length < Number(expected);
    case 'arrayNotEmpty':          return Array.isArray(actual) && actual.length > 0;
    case 'arrayContains':          return Array.isArray(actual) && actual.some(item => String(item) === String(expected));
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
