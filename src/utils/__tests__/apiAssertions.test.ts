import { describe, it, expect } from 'vitest';
import { evaluateAssertions } from '../apiAssertions';
import type { ApiAssertion, ApiResponseSnapshot } from '../../data/types';

function makeResponse(overrides: Partial<ApiResponseSnapshot> = {}): ApiResponseSnapshot {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { data: { id: 42, name: 'Alice', active: true, scores: [95, 87, 92], nested: { deep: { value: 'hidden' } } } },
    durationMs: 150,
    bodyTruncated: false,
    ...overrides,
  };
}

function makeAssertion(overrides: Partial<ApiAssertion> = {}): ApiAssertion {
  return {
    field: 'status',
    operator: 'equals',
    expected: '200',
    weight: 10,
    severity: 'critical',
    message: '',
    ...overrides,
  };
}

describe('apiAssertions — evaluateAssertions', () => {

  describe('statusCode assertions', () => {
    it('equals — passes when status matches', () => {
      const res = makeResponse({ status: 200 });
      const { results, stepStatus } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200' }),
      ], res);
      expect(results[0].passed).toBe(true);
      expect(stepStatus).toBe('passed');
    });

    it('equals — fails when status differs', () => {
      const res = makeResponse({ status: 404 });
      const { results, stepStatus } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200' }),
      ], res);
      expect(results[0].passed).toBe(false);
      expect(stepStatus).toBe('failed');
    });

    it('notEquals — passes when status differs', () => {
      const res = makeResponse({ status: 500 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'notEquals', expected: '200' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('notEquals — fails when status is same', () => {
      const res = makeResponse({ status: 200 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'notEquals', expected: '200' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('responseTime assertions', () => {
    it('lessThan — passes for fast response', () => {
      const res = makeResponse({ durationMs: 150 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'responseTime', operator: 'lessThan', expected: '500' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('lessThan — fails for slow response', () => {
      const res = makeResponse({ durationMs: 800 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'responseTime', operator: 'lessThan', expected: '500' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('greaterThan — passes for slow response', () => {
      const res = makeResponse({ durationMs: 800 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'responseTime', operator: 'greaterThan', expected: '500' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('greaterThanOrEqual — passes when equal', () => {
      const res = makeResponse({ durationMs: 500 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'responseTime', operator: 'greaterThanOrEqual', expected: '500' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('lessThanOrEqual — passes when equal', () => {
      const res = makeResponse({ durationMs: 500 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'responseTime', operator: 'lessThanOrEqual', expected: '500' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });
  });

  describe('header assertions', () => {
    it('contains — header value contains substring', () => {
      const res = makeResponse({ headers: { 'content-type': 'application/json; charset=utf-8' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'header.content-type', operator: 'contains', expected: 'json' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('notContains — header value does not contain substring', () => {
      const res = makeResponse({ headers: { 'content-type': 'text/html' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'header.content-type', operator: 'notContains', expected: 'json' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('startsWith — header starts with prefix', () => {
      const res = makeResponse({ headers: { 'x-request-id': 'abc-123-def' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'header.x-request-id', operator: 'startsWith', expected: 'abc' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('endsWith — header ends with suffix', () => {
      const res = makeResponse({ headers: { 'x-request-id': 'abc-123-def' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'header.x-request-id', operator: 'endsWith', expected: 'def' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('exists — header is present', () => {
      const res = makeResponse({ headers: { 'x-trace-id': 'trace-001' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'header.x-trace-id', operator: 'exists', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('notExists — header is absent', () => {
      const res = makeResponse({ headers: {} });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'header.x-trace-id', operator: 'notExists', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('header lookup is case-insensitive', () => {
      const res = makeResponse({ headers: { 'Content-Type': 'application/json' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'header.content-type', operator: 'contains', expected: 'json' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });
  });

  describe('body (JSONPath) assertions', () => {
    it('equals — body field matches expected value', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.name', operator: 'equals', expected: 'Alice' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('equals — fails for wrong value', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.name', operator: 'equals', expected: 'Bob' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('contains — string contains substring', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.name', operator: 'contains', expected: 'lic' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('matches — regex matches body field', () => {
      const res = makeResponse({ body: { email: 'user@example.com' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.email', operator: 'matches', expected: '^[\\w.]+@[\\w.]+\\.\\w+$' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('matches — invalid regex throws SyntaxError (bug: should handle gracefully)', () => {
      const res = makeResponse({ body: { email: 'test@test.com' } });
      expect(() => evaluateAssertions([
        makeAssertion({ field: '$.email', operator: 'matches', expected: '[invalid(regex' }),
      ], res)).toThrow(SyntaxError);
    });

    it('exists — field is present and non-null', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.id', operator: 'exists', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('notExists — field is absent', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.password', operator: 'notExists', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('isType — checks field type', () => {
      const res = makeResponse();
      const r = evaluateAssertions([
        makeAssertion({ field: '$.data.id', operator: 'isType', expected: 'number' }),
        makeAssertion({ field: '$.data.name', operator: 'isType', expected: 'string' }),
        makeAssertion({ field: '$.data.active', operator: 'isType', expected: 'boolean' }),
        makeAssertion({ field: '$.data.scores', operator: 'isType', expected: 'object' }),
      ], res);
      expect(r.results.every(a => a.passed)).toBe(true);
    });

    it('isType — fails for wrong type', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.id', operator: 'isType', expected: 'string' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('isEmpty — empty array', () => {
      const res = makeResponse({ body: { items: [] } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.items', operator: 'isEmpty', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('isEmpty — null value', () => {
      const res = makeResponse({ body: { data: null } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data', operator: 'isEmpty', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('isEmpty — non-empty array fails', () => {
      const res = makeResponse({ body: { items: [1, 2] } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.items', operator: 'isEmpty', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('isNotEmpty — non-empty string passes', () => {
      const res = makeResponse({ body: { name: 'Alice' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.name', operator: 'isNotEmpty', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('isNotEmpty — empty string fails', () => {
      const res = makeResponse({ body: { name: '' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.name', operator: 'isNotEmpty', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('deeply nested JSONPath resolves correctly', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.nested.deep.value', operator: 'equals', expected: 'hidden' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('greaterThan — numeric comparison on body field', () => {
      const res = makeResponse();
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data.id', operator: 'greaterThan', expected: '10' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('greaterThan — fails when string compared to number', () => {
      const res = makeResponse({ body: { count: 'ten' } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.count', operator: 'greaterThan', expected: '5' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('jsonSchemaValid — matching schema passes', () => {
      const res = makeResponse({ body: { id: 1, name: 'Alice' } });
      const { results } = evaluateAssertions([
        makeAssertion({
          field: '$',
          operator: 'jsonSchemaValid',
          expected: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'number' }, name: { type: 'string' } } },
        }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('jsonSchemaValid — violating schema fails', () => {
      const res = makeResponse({ body: { id: 'not-a-number', name: 'Alice' } });
      const { results } = evaluateAssertions([
        makeAssertion({
          field: '$',
          operator: 'jsonSchemaValid',
          expected: { type: 'object', required: ['id'], properties: { id: { type: 'number' } } },
        }),
      ], res);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('severity and step status', () => {
    it('hard assertion failure → step status "failed"', () => {
      const res = makeResponse({ status: 500 });
      const { stepStatus } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200', severity: 'critical' }),
      ], res);
      expect(stepStatus).toBe('failed');
    });

    it('soft assertion failure only → step status "degraded"', () => {
      const res = makeResponse({ status: 200, durationMs: 800 });
      const { stepStatus } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200', severity: 'critical' }),
        makeAssertion({ field: 'responseTime', operator: 'lessThan', expected: '500', severity: 'soft' }),
      ], res);
      expect(stepStatus).toBe('degraded');
    });

    it('mix: hard pass + soft fail → status "degraded"', () => {
      const res = makeResponse({ status: 200, durationMs: 800 });
      const { results, stepStatus } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200', severity: 'critical' }),
        makeAssertion({ field: 'responseTime', operator: 'lessThan', expected: '500', severity: 'soft' }),
      ], res);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
      expect(stepStatus).toBe('degraded');
    });

    it('all pass → status "passed"', () => {
      const res = makeResponse({ status: 200, durationMs: 100 });
      const { stepStatus } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200' }),
        makeAssertion({ field: 'responseTime', operator: 'lessThan', expected: '500' }),
      ], res);
      expect(stepStatus).toBe('passed');
    });
  });

  describe('confidence scores', () => {
    it('passing assertion gets positive confidence, failing gets 0', () => {
      const res = makeResponse({ status: 200, durationMs: 800 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200', weight: 10 }),
        makeAssertion({ field: 'responseTime', operator: 'lessThan', expected: '500', weight: 2 }),
      ], res);
      expect(results[0].confidenceScore).toBe(100);
      expect(results[1].confidenceScore).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('empty assertions array → status "passed"', () => {
      const res = makeResponse();
      const { stepStatus, results } = evaluateAssertions([], res);
      expect(stepStatus).toBe('passed');
      expect(results).toHaveLength(0);
    });

    it('undefined body field → exists returns false', () => {
      const res = makeResponse({ body: {} });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.nonexistent', operator: 'exists', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('null body value → exists returns false', () => {
      const res = makeResponse({ body: { data: null } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data', operator: 'exists', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('null body value → notExists returns true', () => {
      const res = makeResponse({ body: { data: null } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.data', operator: 'notExists', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('unknown operator → returns false (no crash)', () => {
      const res = makeResponse({ status: 200 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'unknownOp' as any, expected: '200' }),
      ], res);
      expect(results[0].passed).toBe(false);
    });

    it('equals coerces types via String()', () => {
      const res = makeResponse({ status: 200 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'status', operator: 'equals', expected: '200' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('responseTime equals numeric string', () => {
      const res = makeResponse({ durationMs: 150 });
      const { results } = evaluateAssertions([
        makeAssertion({ field: 'responseTime', operator: 'equals', expected: '150' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('size assertions work on numeric fields', () => {
      const res = makeResponse({ body: { count: 5 } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.count', operator: 'lessThan', expected: '10' }),
        makeAssertion({ field: '$.count', operator: 'greaterThan', expected: '3' }),
      ], res);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(true);
    });

    it('isEmpty on empty object passes', () => {
      const res = makeResponse({ body: { meta: {} } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.meta', operator: 'isEmpty', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });

    it('isNotEmpty on non-empty object passes', () => {
      const res = makeResponse({ body: { meta: { key: 'val' } } });
      const { results } = evaluateAssertions([
        makeAssertion({ field: '$.meta', operator: 'isNotEmpty', expected: '' }),
      ], res);
      expect(results[0].passed).toBe(true);
    });
  });
});