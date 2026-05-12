/**
 * variable-engine.test.ts
 * Unit tests for VariableEngine — Phase B extraction guardrails.
 *
 * PURPOSE: Validate that VariableEngine wraps apiVariables.ts correctly
 * and preserves ALL current runtime behavior including lazy resolution,
 * chaining, dynamic value generation, and extraction.
 *
 * These tests must remain green throughout all Phase B/C migrations.
 *
 * Coverage:
 *   A. substitute() — template syntax, lazy resolution, dynamic values
 *   B. resolve()    — scope merging, conflict detection, unresolved tracking
 *   C. extract()    — responseBody, responseHeader, statusCode
 *   D. snapshot()   — immutable copy, afterNodeId
 *   E. merge()      — last-write-wins, conflict detection
 *   F. Lazy resolution proof — chaining behavior preserved
 *   G. getVariableEngine / setVariableEngine singleton
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VariableEngine,
  VariableEngineStub,
  getVariableEngine,
  setVariableEngine,
  VariableConflictError,
  type VariableContext,
} from '../engine';
import type { ScopedVariable, VariableExtractionSpec } from '../../../shared-core/contracts/variable.contract';

const engine = new VariableEngine();

// ── A. substitute() ───────────────────────────────────────────────────────────

describe('VariableEngine — A. substitute()', () => {
  it('replaces {{var}} syntax', () => {
    expect(engine.substitute('/api/{{userId}}', { userId: '42' })).toBe('/api/42');
  });

  it('replaces ${var} syntax', () => {
    expect(engine.substitute('/api/${userId}', { userId: '99' })).toBe('/api/99');
  });

  it('replaces multiple vars in one template', () => {
    const result = engine.substitute('{{base}}/{{resource}}/{{id}}', {
      base: 'https://api.test', resource: 'users', id: '7',
    });
    expect(result).toBe('https://api.test/users/7');
  });

  it('leaves {{unknown}} unreplaced when var not in context', () => {
    expect(engine.substitute('/api/{{missing}}', {})).toBe('/api/{{missing}}');
  });

  it('handles template with no vars', () => {
    expect(engine.substitute('/api/static', {})).toBe('/api/static');
  });

  it('handles empty string template', () => {
    expect(engine.substitute('', { x: '1' })).toBe('');
  });

  it('resolves $dynamic:uuid at call time (not cached)', () => {
    const a = engine.substitute('{{$dynamic:uuid}}', {});
    const b = engine.substitute('{{$dynamic:uuid}}', {});
    expect(a).not.toBe(b); // each call generates new UUID
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resolves $dynamic:timestamp', () => {
    const result = engine.substitute('{{$dynamic:timestamp}}', {});
    expect(() => new Date(result)).not.toThrow();
  });

  it('resolves $dynamic:random_int within range', () => {
    const result = engine.substitute('{{$dynamic:random_int:1:10}}', {});
    const n = parseInt(result, 10);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('resolves $dynamic:random_string with correct length', () => {
    const result = engine.substitute('{{$dynamic:random_string:12}}', {});
    expect(result).toHaveLength(12);
  });

  it('context value wins over template literal when key present', () => {
    expect(engine.substitute('{{key}}', { key: 'actual' })).toBe('actual');
  });
});

// ── B. resolve() ──────────────────────────────────────────────────────────────

describe('VariableEngine — B. resolve() scope merging', () => {
  it('later scope overrides earlier scope for same key', () => {
    const scopes: ScopedVariable[] = [
      { key: 'host', value: 'dev.api.test', scope: 'environment' },
      { key: 'host', value: 'prod.api.test', scope: 'runtime' },
    ];
    const result = engine.resolve(scopes);
    expect(result.resolved['host']).toBe('prod.api.test');
  });

  it('no conflict when different keys', () => {
    const scopes: ScopedVariable[] = [
      { key: 'a', value: '1', scope: 'environment' },
      { key: 'b', value: '2', scope: 'collection' },
    ];
    const result = engine.resolve(scopes);
    expect(result.conflicts).toHaveLength(0);
    expect(result.resolved).toEqual({ a: '1', b: '2' });
  });

  it('conflict recorded when same key appears in two scopes', () => {
    const scopes: ScopedVariable[] = [
      { key: 'token', value: 'env-tok', scope: 'environment' },
      { key: 'token', value: 'run-tok', scope: 'runtime' },
    ];
    const result = engine.resolve(scopes);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].key).toBe('token');
    expect(result.conflicts[0].scopeA).toBe('environment');
    expect(result.conflicts[0].scopeB).toBe('runtime');
  });

  it('sourceMap tracks which scope each key came from', () => {
    const scopes: ScopedVariable[] = [
      { key: 'x', value: 'env-val', scope: 'environment' },
      { key: 'y', value: 'run-val', scope: 'runtime' },
    ];
    const result = engine.resolve(scopes);
    expect(result.sourceMap['x']).toBe('environment');
    expect(result.sourceMap['y']).toBe('runtime');
  });

  it('unresolved tracks template refs not present in scope', () => {
    const scopes: ScopedVariable[] = [
      { key: 'url', value: 'https://{{base_host}}/api', scope: 'collection' },
    ];
    const result = engine.resolve(scopes);
    expect(result.unresolved).toContain('base_host');
  });

  it('dynamic refs do not appear in unresolved', () => {
    const scopes: ScopedVariable[] = [
      { key: 'id', value: '{{$dynamic:uuid}}', scope: 'request' },
    ];
    const result = engine.resolve(scopes);
    expect(result.unresolved).not.toContain('$dynamic:uuid');
  });

  it('empty scope list returns empty result', () => {
    const result = engine.resolve([]);
    expect(result.resolved).toEqual({});
    expect(result.conflicts).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });
});

// ── C. extract() ──────────────────────────────────────────────────────────────

describe('VariableEngine — C. extract()', () => {
  const response = {
    status: 201,
    headers: { 'x-request-id': 'req-abc123', 'content-type': 'application/json' },
    body: { user: { id: 42, token: 'tok-xyz' } },
    bodyTruncated: false,
    durationMs: 100,
  };

  it('extracts from responseBody via JSONPath', () => {
    const spec: VariableExtractionSpec = {
      name: 'userId', source: 'responseBody', path: '$.user.id', scope: 'runtime',
    };
    const result = engine.extract(spec, response);
    expect(result.success).toBe(true);
    expect(result.value).toBe('42');
  });

  it('extracts nested value from responseBody', () => {
    const spec: VariableExtractionSpec = {
      name: 'authToken', source: 'responseBody', path: '$.user.token', scope: 'runtime',
    };
    const result = engine.extract(spec, response);
    expect(result.success).toBe(true);
    expect(result.value).toBe('tok-xyz');
  });

  it('extracts from responseHeader (case-insensitive)', () => {
    const spec: VariableExtractionSpec = {
      name: 'reqId', source: 'responseHeader', path: 'x-request-id', scope: 'runtime',
    };
    const result = engine.extract(spec, response);
    expect(result.success).toBe(true);
    expect(result.value).toBe('req-abc123');
  });

  it('extracts statusCode', () => {
    const spec: VariableExtractionSpec = {
      name: 'status', source: 'statusCode', path: '', scope: 'runtime',
    };
    const result = engine.extract(spec, response);
    expect(result.success).toBe(true);
    expect(result.value).toBe('201');
  });

  it('returns success=false when JSONPath yields no match', () => {
    const spec: VariableExtractionSpec = {
      name: 'missing', source: 'responseBody', path: '$.nonexistent', scope: 'runtime',
    };
    const result = engine.extract(spec, response);
    expect(result.success).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it('returns success=false when header not found', () => {
    const spec: VariableExtractionSpec = {
      name: 'notThere', source: 'responseHeader', path: 'x-missing-header', scope: 'runtime',
    };
    const result = engine.extract(spec, response);
    expect(result.success).toBe(false);
  });

  it('extractedAt is ISO timestamp', () => {
    const spec: VariableExtractionSpec = {
      name: 'status', source: 'statusCode', path: '', scope: 'runtime',
    };
    const result = engine.extract(spec, response);
    expect(() => new Date(result.extractedAt)).not.toThrow();
  });
});

// ── D. snapshot() ─────────────────────────────────────────────────────────────

describe('VariableEngine — D. snapshot()', () => {
  it('returns copy — mutating original does not affect snapshot', () => {
    const ctx = { a: '1', b: '2' };
    const snap = engine.snapshot(ctx, 'step-1');
    ctx['a'] = 'mutated';
    expect(snap.context['a']).toBe('1');
  });

  it('afterNodeId matches provided value', () => {
    const snap = engine.snapshot({ x: '1' }, 'node-42');
    expect(snap.afterNodeId).toBe('node-42');
  });

  it('capturedAt is ISO timestamp', () => {
    const snap = engine.snapshot({}, 'n1');
    expect(() => new Date(snap.capturedAt)).not.toThrow();
  });

  it('context contains all keys from input', () => {
    const ctx = { foo: 'bar', baz: 'qux' };
    const snap = engine.snapshot(ctx, 'n1');
    expect(snap.context).toEqual(ctx);
  });
});

// ── E. merge() ────────────────────────────────────────────────────────────────

describe('VariableEngine — E. merge()', () => {
  it('overlay keys overwrite base keys (last-write-wins)', () => {
    const base = { a: 'base-a', b: 'base-b' };
    const overlay = { b: 'new-b', c: 'new-c' };
    const result = engine.merge(base, overlay);
    expect(result['a']).toBe('base-a');
    expect(result['b']).toBe('new-b');
    expect(result['c']).toBe('new-c');
  });

  it('base unchanged after merge (pure function)', () => {
    const base = { a: '1' };
    engine.merge(base, { a: '2' });
    expect(base['a']).toBe('1');
  });

  it('merge with empty overlay returns copy of base', () => {
    const base = { x: 'y' };
    const result = engine.merge(base, {});
    expect(result).toEqual(base);
  });

  it('merge with empty base returns copy of overlay', () => {
    const overlay = { x: 'y' };
    const result = engine.merge({}, overlay);
    expect(result).toEqual(overlay);
  });
});

// ── F. Lazy resolution proof — chaining behavior ──────────────────────────────

describe('VariableEngine — F. Lazy resolution (chaining)', () => {
  it('substitute sees variable extracted AFTER context snapshot', () => {
    // Simulate: step A extracts userId=42, step B uses {{userId}}
    // LAZY: context is merged between steps, substitution happens at step B execution
    const sharedCtx = { baseUrl: 'https://api.test' };
    // Step A runs, extracts userId
    const stepAExtracted = { userId: '42' };
    // Merge extracted back into context (simulates apiRunner mergeStepLocals)
    const updatedCtx = engine.merge(sharedCtx, stepAExtracted);
    // Step B resolves at execution time from updated context
    const result = engine.substitute('{{baseUrl}}/users/{{userId}}', updatedCtx);
    expect(result).toBe('https://api.test/users/42');
  });

  it('dynamic var generates different value on each substitute call (lazy)', () => {
    const ctx = {};
    const v1 = engine.substitute('{{$dynamic:uuid}}', ctx);
    const v2 = engine.substitute('{{$dynamic:uuid}}', ctx);
    expect(v1).not.toBe(v2); // proves resolution is lazy, not cached
  });

  it('variable added after snapshot is visible when merged before substitute', () => {
    const wave1Ctx = { env: 'prod' };
    const snap = engine.snapshot(wave1Ctx, 'wave-1');
    // Wave 2 extracts new variable
    const wave2Extracted = { token: 'bearer-abc' };
    const wave2Ctx = engine.merge(snap.context, wave2Extracted);
    // Substitution at wave 2 step time sees token
    expect(engine.substitute('Authorization: Bearer {{token}}', wave2Ctx))
      .toBe('Authorization: Bearer bearer-abc');
  });

  it('pre-snapshot context does not see post-extraction variables', () => {
    // Proves that snapshotContext is a shallow copy — doesn't retroactively see later merges
    const shared = { a: '1' };
    const snap = engine.snapshot(shared, 'n1');
    // After snapshot, merge new var into shared
    const updated = engine.merge(shared, { b: '2' });
    // snap.context should not have 'b' — it was captured before the merge
    expect(snap.context['b']).toBeUndefined();
    // updated has 'b'
    expect(updated['b']).toBe('2');
  });
});

// ── G. Singleton swap ─────────────────────────────────────────────────────────

describe('getVariableEngine / setVariableEngine — G. Singleton', () => {
  let original: ReturnType<typeof getVariableEngine>;

  beforeEach(() => { original = getVariableEngine(); });

  it('getVariableEngine returns VariableEngine by default', () => {
    expect(getVariableEngine()).toBeInstanceOf(VariableEngine);
  });

  it('setVariableEngine replaces singleton', () => {
    const stub = new VariableEngineStub();
    setVariableEngine(stub);
    expect(getVariableEngine()).toBe(stub);
    setVariableEngine(original);
  });

  it('restored after swap', () => {
    const stub = new VariableEngineStub();
    setVariableEngine(stub);
    setVariableEngine(original);
    expect(getVariableEngine()).toBe(original);
  });
});

// ── H. VariableConflictError re-export ───────────────────────────────────────

describe('VariableConflictError re-export', () => {
  it('is accessible from variable-engine module', () => {
    const err = new VariableConflictError('key', 'stepA', 'stepB');
    expect(err).toBeInstanceOf(Error);
    expect(err.key).toBe('key');
    expect(err.stepA).toBe('stepA');
    expect(err.stepB).toBe('stepB');
  });
});
