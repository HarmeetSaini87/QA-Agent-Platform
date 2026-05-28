// src/api-graph-editor/__tests__/dag-validator.test.ts
import { describe, it, expect } from 'vitest';
import { DagValidator } from '../dag-validator';

describe('DagValidator', () => {
  const validator = new DagValidator();

  it('valid linear chain — no violations', () => {
    const result = validator.validate(['a', 'b', 'c'], { b: ['a'], c: ['b'] });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('topological order produced for valid DAG', () => {
    const result = validator.validate(['a', 'b', 'c'], { b: ['a'], c: ['b'] });
    expect(result.topologicalOrder).toBeDefined();
    const order = result.topologicalOrder!;
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('cycle detection: a→b→a', () => {
    const result = validator.validate(['a', 'b'], { a: ['b'], b: ['a'] });
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === 'cycle')).toBe(true);
    expect(result.topologicalOrder).toBeUndefined();
  });

  it('self-loop detected', () => {
    const result = validator.validate(['a'], { a: ['a'] });
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === 'self-loop')).toBe(true);
  });

  it('unknown dependency flagged', () => {
    const result = validator.validate(['a', 'b'], { b: ['phantom'] });
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === 'unknown-dependency')).toBe(true);
  });

  it('hasCycle: false for clean graph', () => {
    expect(validator.hasCycle({ b: ['a'], c: ['b'] })).toBe(false);
  });

  it('hasCycle: true for cyclic graph', () => {
    expect(validator.hasCycle({ a: ['b'], b: ['c'], c: ['a'] })).toBe(true);
  });

  it('empty graph — valid with empty topological order', () => {
    const result = validator.validate([], {});
    expect(result.valid).toBe(true);
  });
});
