/**
 * assertion-engine.test.ts
 * Unit tests for AssertionEngine — Phase B Step 4 extraction guardrails.
 *
 * Coverage:
 *   A. normaliseAssertions() — all source mappings, pass-through, edge cases
 *   B. AssertionEngine.evaluate() — operators, severity summary, stepStatus mapping
 *   C. AssertionEngine.resolveField() — status, responseTime, header, body JSONPath
 *   D. getAssertionEngine / setAssertionEngine — singleton swap
 *   E. AssertionEngineStub — throws on evaluate/resolveField
 *   F. Backward compat — normalised output matches what evaluateAssertions expects
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AssertionEngine,
  AssertionEngineStub,
  getAssertionEngine,
  setAssertionEngine,
  normaliseAssertions,
} from '../engine';
import type { AssertionBatch } from '../../../shared-core/contracts/assertion.contract';
import type { ApiResponseSnapshot } from '../../../data/types';

const engine = new AssertionEngine();

// ── Shared response fixture ───────────────────────────────────────────────────

const response: ApiResponseSnapshot = {
  status: 200,
  headers: { 'content-type': 'application/json', 'x-request-id': 'req-001' },
  body: { user: { id: 42, name: 'Alice' }, token: 'tok-xyz' },
  bodyTruncated: false,
  durationMs: 80,
};

// ── A. normaliseAssertions() ──────────────────────────────────────────────────

describe('normaliseAssertions — A. Source mapping', () => {
  it('statusCode → field=status', () => {
    const result = normaliseAssertions([{ source: 'statusCode', path: '', operator: 'equals', expected: '200' } as any]);
    expect((result[0] as any).field).toBe('status');
  });

  it('responseTime → field=responseTime', () => {
    const result = normaliseAssertions([{ source: 'responseTime', path: '', operator: 'lt', expected: '500' } as any]);
    expect((result[0] as any).field).toBe('responseTime');
  });

  it('responseHeader + path → field=header.<path>', () => {
    const result = normaliseAssertions([{ source: 'responseHeader', path: 'content-type', operator: 'contains', expected: 'json' } as any]);
    expect((result[0] as any).field).toBe('header.content-type');
  });

  it('responseBody + JSONPath → field=path', () => {
    const result = normaliseAssertions([{ source: 'responseBody', path: '$.user.id', operator: 'equals', expected: '42' } as any]);
    expect((result[0] as any).field).toBe('$.user.id');
  });

  it('responseBody + empty path → field=$', () => {
    const result = normaliseAssertions([{ source: 'responseBody', path: '', operator: 'exists', expected: '' } as any]);
    expect((result[0] as any).field).toBe('$');
  });

  it('already has field → pass through unchanged', () => {
    const assertion = { field: 'status', operator: 'equals', expected: '200' } as any;
    const result = normaliseAssertions([assertion]);
    expect((result[0] as any).field).toBe('status');
  });

  it('multiple assertions all normalised', () => {
    const assertions = [
      { source: 'statusCode', path: '', operator: 'equals', expected: '201' },
      { source: 'responseBody', path: '$.token', operator: 'exists', expected: '' },
      { source: 'responseHeader', path: 'x-request-id', operator: 'exists', expected: '' },
    ] as any[];
    const result = normaliseAssertions(assertions);
    expect((result[0] as any).field).toBe('status');
    expect((result[1] as any).field).toBe('$.token');
    expect((result[2] as any).field).toBe('header.x-request-id');
  });

  it('empty array → empty array', () => {
    expect(normaliseAssertions([])).toHaveLength(0);
  });

  it('unknown source + empty path → field=$', () => {
    const result = normaliseAssertions([{ source: 'unknown', path: '', operator: 'exists', expected: '' } as any]);
    expect((result[0] as any).field).toBe('$');
  });

  it('unknown source + non-empty path → field=path', () => {
    const result = normaliseAssertions([{ source: 'unknown', path: '$.data', operator: 'exists', expected: '' } as any]);
    expect((result[0] as any).field).toBe('$.data');
  });
});

// ── B. AssertionEngine.evaluate() ────────────────────────────────────────────

describe('AssertionEngine — B. evaluate()', () => {
  it('status equals 200 → passed', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [{ source: 'statusCode', path: '', operator: 'equals', expected: '200' } as any],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.passed).toBe(true);
    expect(result.results[0].passed).toBe(true);
  });

  it('status equals 201 → failed (actual 200)', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [{ source: 'statusCode', path: '', operator: 'equals', expected: '201' } as any],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.passed).toBe(false);
    expect(result.results[0].passed).toBe(false);
  });

  it('responseTime lessThan 500 → passed (actual 80ms)', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [{ source: 'responseTime', path: '', operator: 'lessThan', expected: '500' } as any],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.results[0].passed).toBe(true);
  });

  it('body JSONPath exists → passed', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [{ source: 'responseBody', path: '$.user.id', operator: 'exists', expected: '' } as any],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.results[0].passed).toBe(true);
  });

  it('body JSONPath equals 42 → passed', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [{ source: 'responseBody', path: '$.user.id', operator: 'equals', expected: '42' } as any],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.results[0].passed).toBe(true);
  });

  it('header contains → passed', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [{ source: 'responseHeader', path: 'content-type', operator: 'contains', expected: 'json' } as any],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.results[0].passed).toBe(true);
  });

  it('summary.total matches assertion count', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [
        { source: 'statusCode', path: '', operator: 'equals', expected: '200' } as any,
        { source: 'responseBody', path: '$.user.id', operator: 'exists', expected: '' } as any,
      ],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.summary.total).toBe(2);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.failed).toBe(0);
  });

  it('summary.bySeverity tracks severity from assertions', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'step1',
      assertions: [
        { source: 'statusCode', path: '', operator: 'equals', expected: '200', severity: 'critical' } as any,
        { source: 'statusCode', path: '', operator: 'equals', expected: '999', severity: 'low' } as any,
      ],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.summary.bySeverity['critical']?.passed).toBe(1);
    expect(result.summary.bySeverity['low']?.failed).toBe(1);
  });

  it('stepId and stepName preserved in result', () => {
    const batch: AssertionBatch = {
      stepId: 'my-step', stepName: 'My Step',
      assertions: [],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.stepId).toBe('my-step');
    expect(result.stepName).toBe('My Step');
  });

  it('empty assertions → passed=true, summary.total=0', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 's1',
      assertions: [],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.passed).toBe(true);
    expect(result.summary.total).toBe(0);
  });
});

// ── C. AssertionEngine.resolveField() ────────────────────────────────────────

describe('AssertionEngine — C. resolveField()', () => {
  it('field=status → resolvedValue=200', () => {
    const r = engine.resolveField('status', response);
    expect(r.resolvedValue).toBe(200);
    expect(r.source).toBe('status');
  });

  it('field=responseTime → resolvedValue=80', () => {
    const r = engine.resolveField('responseTime', response);
    expect(r.resolvedValue).toBe(80);
    expect(r.source).toBe('responseTime');
  });

  it('field=header.content-type → resolvedValue=application/json', () => {
    const r = engine.resolveField('header.content-type', response);
    expect(r.resolvedValue).toBe('application/json');
    expect(r.source).toBe('header');
  });

  it('header lookup is case-insensitive', () => {
    const r = engine.resolveField('header.Content-Type', response);
    expect(r.resolvedValue).toBe('application/json');
  });

  it('missing header → resolvedValue=undefined', () => {
    const r = engine.resolveField('header.x-missing', response);
    expect(r.resolvedValue).toBeUndefined();
  });

  it('field=$.user.id → resolvedValue=42', () => {
    const r = engine.resolveField('$.user.id', response);
    expect(r.resolvedValue).toBe(42);
    expect(r.source).toBe('body');
  });

  it('non-existent JSONPath → resolvedValue=undefined', () => {
    const r = engine.resolveField('$.nonexistent', response);
    expect(r.resolvedValue).toBeUndefined();
  });

  it('non-$ non-header field treated as body path resolves value', () => {
    // 'user.name' → becomes '$.user.name' internally
    const r = engine.resolveField('user.name', response);
    expect(r.source).toBe('body');
    expect(r.resolvedValue).toBe('Alice');
  });
});

// ── D. Singleton swap ─────────────────────────────────────────────────────────

describe('getAssertionEngine / setAssertionEngine — D. Singleton', () => {
  let original: ReturnType<typeof getAssertionEngine>;

  beforeEach(() => { original = getAssertionEngine(); });

  it('getAssertionEngine returns AssertionEngine by default', () => {
    expect(getAssertionEngine()).toBeInstanceOf(AssertionEngine);
  });

  it('setAssertionEngine replaces singleton', () => {
    const stub = new AssertionEngineStub();
    setAssertionEngine(stub);
    expect(getAssertionEngine()).toBe(stub);
    setAssertionEngine(original);
  });

  it('restored after swap', () => {
    const stub = new AssertionEngineStub();
    setAssertionEngine(stub);
    setAssertionEngine(original);
    expect(getAssertionEngine()).toBe(original);
  });
});

// ── E. AssertionEngineStub ────────────────────────────────────────────────────

describe('AssertionEngineStub — E. throws on use', () => {
  const stub = new AssertionEngineStub();

  it('evaluate() throws', () => {
    expect(() => stub.evaluate({} as any)).toThrow('AssertionEngineStub');
  });

  it('resolveField() throws', () => {
    expect(() => stub.resolveField('status', response)).toThrow('AssertionEngineStub');
  });
});

// ── F. Backward compat — matches existing apiAssertions.ts behavior ───────────

describe('AssertionEngine — F. Backward compat (same results as apiAssertions.ts)', () => {
  it('mixed passing/failing matches expected counts', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'compat',
      assertions: [
        { source: 'statusCode', path: '', operator: 'equals', expected: '200' } as any,   // pass
        { source: 'statusCode', path: '', operator: 'equals', expected: '500' } as any,   // fail
        { source: 'responseBody', path: '$.user.name', operator: 'equals', expected: 'Alice' } as any, // pass
      ],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.failed).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('all pass → criticalFailure=false, degraded=false', () => {
    const batch: AssertionBatch = {
      stepId: 's1', stepName: 'compat',
      assertions: [
        { source: 'statusCode', path: '', operator: 'equals', expected: '200' } as any,
      ],
      response,
    };
    const result = engine.evaluate(batch);
    expect(result.criticalFailure).toBe(false);
    expect(result.degraded).toBe(false);
  });
});
