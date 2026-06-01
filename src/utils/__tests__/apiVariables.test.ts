import { describe, it, expect } from 'vitest';
import {
  substituteVars,
  snapshotContext,
  mergeStepLocals,
  extractVariables,
  VariableConflictError,
} from '../apiVariables';
import type { ApiVariableExtraction, ApiResponseSnapshot } from '../../data/types';

function makeResponse(overrides: Partial<ApiResponseSnapshot> = {}): ApiResponseSnapshot {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'abc-123' },
    body: { data: { id: 42, token: 'secret-token', items: [1, 2, 3], nested: { deep: 'value' } } },
    durationMs: 150,
    bodyTruncated: false,
    ...overrides,
  };
}

describe('apiVariables — substituteVars', () => {
  it('replaces {{var}} from context', () => {
    expect(substituteVars('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('replaces ${var} from context', () => {
    expect(substituteVars('id=${userId}', { userId: '42' })).toBe('id=42');
  });

  it('replaces multiple variables in one template', () => {
    expect(substituteVars('{{base}}/users/{{userId}}', { base: 'https://api.example.com', userId: '99' }))
      .toBe('https://api.example.com/users/99');
  });

  it('leaves unresolved {{var}} as-is when not in context', () => {
    expect(substituteVars('{{UNDEFINED_VAR}}/endpoint', {})).toBe('{{UNDEFINED_VAR}}/endpoint');
  });

  it('mixed {{}} and ${} both resolve', () => {
    expect(substituteVars('{{host}}/api/${version}', { host: 'https://api.io', version: 'v2' }))
      .toBe('https://api.io/api/v2');
  });

  it('variable in header value', () => {
    expect(substituteVars('Bearer {{token}}', { token: 'my-jwt' })).toBe('Bearer my-jwt');
  });

  it('syntactic glue — variable adjacent to static text', () => {
    expect(substituteVars('id={{patientId}}-suffix', { patientId: 'pt-001' }))
      .toBe('id=pt-001-suffix');
  });

  it('empty context — unresolved vars remain as {{key}} placeholders', () => {
    const result = substituteVars('{{a}}/${b}', {});
    expect(result).toBe('{{a}}/{{b}}');
  });

  it('unicode value in variable', () => {
    expect(substituteVars('{"note": "{{note}}"}', { note: '测试备注' }))
      .toBe('{"note": "测试备注"}');
  });

  it('empty string value', () => {
    expect(substituteVars('prefix-{{val}}-suffix', { val: '' })).toBe('prefix--suffix');
  });

  describe('dynamic value generators', () => {
    it('$dynamic:uuid generates a valid UUID v4 format', () => {
      const result = substituteVars('{{$dynamic:uuid}}', {});
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('$dynamic:faker_uuid generates a valid UUID', () => {
      const result = substituteVars('{{$dynamic:faker_uuid}}', {});
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('$dynamic:timestamp generates ISO 8601 format', () => {
      const result = substituteVars('{{$dynamic:timestamp}}', {});
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('$dynamic:timestamp:unix generates numeric epoch', () => {
      const result = substituteVars('{{$dynamic:timestamp:unix}}', {});
      expect(result).toMatch(/^\d+$/);
      expect(Number(result)).toBeGreaterThan(1700000000);
    });

    it('$dynamic:random_int:min:max generates integer in range', () => {
      for (let i = 0; i < 20; i++) {
        const result = substituteVars('{{$dynamic:random_int:1:100}}', {});
        const val = Number(result);
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(100);
      }
    });

    it('$dynamic:random_string:len generates string of correct length', () => {
      const result = substituteVars('{{$dynamic:random_string:16}}', {});
      expect(result).toHaveLength(16);
      expect(result).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('$dynamic:faker_name generates non-empty name', () => {
      const result = substituteVars('{{$dynamic:faker_name}}', {});
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain(' ');
    });

    it('$dynamic:faker_email generates email format', () => {
      const result = substituteVars('{{$dynamic:faker_email}}', {});
      expect(result).toContain('@');
      expect(result).toContain('.');
    });

    it('$dynamic:env:VAR reads from process.env', () => {
      process.env.TEST_API_VAR = 'hello123';
      const result = substituteVars('{{$dynamic:env:TEST_API_VAR}}', {});
      expect(result).toBe('hello123');
      delete process.env.TEST_API_VAR;
    });

    it('$dynamic:env:NONEXISTENT returns empty string', () => {
      const result = substituteVars('{{$dynamic:env:NONEXISTENT_VAR_XYZ}}', {});
      expect(result).toBe('');
    });

    it('dynamic values are different on each call', () => {
      const a = substituteVars('{{$dynamic:uuid}}', {});
      const b = substituteVars('{{$dynamic:uuid}}', {});
      expect(a).not.toBe(b);
    });

    it('unknown $dynamic type returns empty string', () => {
      const result = substituteVars('{{$dynamic:unknown_type}}', {});
      expect(result).toBe('');
    });
  });
});

describe('apiVariables — snapshotContext', () => {
  it('creates an independent copy', () => {
    const ctx = { a: '1', b: '2' };
    const snap = snapshotContext(ctx);
    snap.a = 'modified';
    expect(ctx.a).toBe('1');
  });
});

describe('apiVariables — mergeStepLocals', () => {
  it('merges variables from multiple steps', () => {
    const shared = { token: 'abc' };
    const locals = {
      step1: { userId: '42' },
      step2: { orderId: '99' },
    };
    const result = mergeStepLocals(shared, locals, 'last-write-wins');
    expect(result.token).toBe('abc');
    expect(result.userId).toBe('42');
    expect(result.orderId).toBe('99');
  });

  it('last-write-wins policy: last step wins on conflict', () => {
    const shared = {};
    const locals = {
      step1: { token: 'first' },
      step2: { token: 'second' },
    };
    const result = mergeStepLocals(shared, locals, 'last-write-wins');
    expect(result.token).toBe('second');
  });

  it('error-on-conflict policy: throws VariableConflictError on conflict', () => {
    const shared = {};
    const locals = {
      step1: { token: 'first' },
      step2: { token: 'second' },
    };
    expect(() => mergeStepLocals(shared, locals, 'error-on-conflict')).toThrow(VariableConflictError);
  });

  it('error-on-conflict: no error when steps write different keys', () => {
    const shared = {};
    const locals = {
      step1: { a: '1' },
      step2: { b: '2' },
    };
    const result = mergeStepLocals(shared, locals, 'error-on-conflict');
    expect(result.a).toBe('1');
    expect(result.b).toBe('2');
  });

  it('merges into shared context (shared values preserved)', () => {
    const shared = { env: 'staging' };
    const locals = { step1: { token: 'abc' } };
    const result = mergeStepLocals(shared, locals, 'last-write-wins');
    expect(result.env).toBe('staging');
    expect(result.token).toBe('abc');
  });
});

describe('apiVariables — extractVariables', () => {
  it('extracts from statusCode', () => {
    const res = makeResponse({ status: 201 });
    const result = extractVariables([
      { name: 'lastStatus', source: 'statusCode', path: '', scope: 'collection' },
    ], res);
    expect(result.lastStatus).toBe('201');
  });

  it('extracts from responseHeader', () => {
    const res = makeResponse();
    const result = extractVariables([
      { name: 'reqId', source: 'responseHeader', path: 'x-request-id', scope: 'step' },
    ], res);
    expect(result.reqId).toBe('abc-123');
  });

  it('extracts from responseBody via JSONPath', () => {
    const res = makeResponse();
    const result = extractVariables([
      { name: 'userId', source: 'responseBody', path: '$.data.id', scope: 'collection' },
    ], res);
    expect(result.userId).toBe('42');
  });

  it('extracts nested JSONPath value', () => {
    const res = makeResponse();
    const result = extractVariables([
      { name: 'deepVal', source: 'responseBody', path: '$.data.nested.deep', scope: 'collection' },
    ], res);
    expect(result.deepVal).toBe('value');
  });

  it('extracts token from body', () => {
    const res = makeResponse();
    const result = extractVariables([
      { name: 'authToken', source: 'responseBody', path: '$.data.token', scope: 'collection' },
    ], res);
    expect(result.authToken).toBe('secret-token');
  });

  it('JSONPath with no match returns empty (non-fatal)', () => {
    const res = makeResponse({ body: { data: [] } });
    const result = extractVariables([
      { name: 'missing', source: 'responseBody', path: '$.data[0].id', scope: 'collection' },
    ], res);
    expect(result.missing).toBeUndefined();
  });

  it('header extraction case-insensitive', () => {
    const res = makeResponse({ headers: { 'Content-Type': 'application/json' } });
    const result = extractVariables([
      { name: 'ct', source: 'responseHeader', path: 'content-type', scope: 'step' },
    ], res);
    expect(result.ct).toBe('application/json');
  });

  it('multiple extractions in one call', () => {
    const res = makeResponse({ status: 201, headers: { 'x-trace': 't-001' } });
    const result = extractVariables([
      { name: 'statusCode', source: 'statusCode', path: '', scope: 'collection' },
      { name: 'traceId', source: 'responseHeader', path: 'x-trace', scope: 'step' },
      { name: 'dataId', source: 'responseBody', path: '$.data.id', scope: 'collection' },
    ], res);
    expect(result.statusCode).toBe('201');
    expect(result.traceId).toBe('t-001');
    expect(result.dataId).toBe('42');
  });

  it('extraction with invalid JSONPath does not throw', () => {
    const res = makeResponse();
    expect(() => extractVariables([
      { name: 'bad', source: 'responseBody', path: '$[invalid', scope: 'step' },
    ], res)).not.toThrow();
  });
});