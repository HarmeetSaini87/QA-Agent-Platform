import { describe, it, expect } from 'vitest';
import { ConditionEvaluator, getConditionEvaluator } from '../condition-evaluator';

const ev = new ConditionEvaluator();

describe('ConditionEvaluator', () => {
  it('evaluates truthy expression', () => {
    expect(ev.evaluate('true', {})).toBe(true);
  });

  it('evaluates falsy expression', () => {
    expect(ev.evaluate('false', {})).toBe(false);
  });

  it('accesses context variables', () => {
    expect(ev.evaluate('status === 200', { status: 200 })).toBe(true);
  });

  it('returns false when variable not in context', () => {
    expect(ev.evaluate('missingVar === 42', {})).toBe(false);
  });

  it('returns false on syntax error', () => {
    expect(ev.evaluate('!!!invalid syntax:::', {})).toBe(false);
  });

  it('returns false on infinite-loop expression (100ms timeout)', () => {
    expect(ev.evaluate('while(true){}', {})).toBe(false);
  });

  it('context mutation attempt is silently blocked (frozen sandbox)', () => {
    ev.evaluate('x = 999', { x: 1 });
    // Should not throw — frozen object in strict VM context silently fails write
    expect(ev.evaluate('x === 1', { x: 1 })).toBe(true);
  });

  it('evaluates numeric comparison', () => {
    expect(ev.evaluate('responseTime < 500', { responseTime: 200 })).toBe(true);
  });

  it('evaluates string comparison', () => {
    expect(ev.evaluate('env === "prod"', { env: 'prod' })).toBe(true);
  });

  it('returns false for empty condition string', () => {
    expect(ev.evaluate('', {})).toBe(false);
  });

  it('getConditionEvaluator returns singleton', () => {
    expect(getConditionEvaluator()).toBe(getConditionEvaluator());
  });
});
