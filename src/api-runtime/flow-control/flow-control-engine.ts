/**
 * flow-control-engine.ts
 * Pure evaluator — no DB/HTTP calls.
 * Reads flowRules from a completed step, evaluates conditions against the
 * actual response, and returns a FlowDecision telling the WorkflowEngine
 * what to do next.
 *
 * Reuses resolveField + evaluate from apiAssertions.ts — same field encoding,
 * same operator set, zero duplication.
 */

import type { FlowRule, FlowRuleAction } from '../../data/types';
import type { ApiResponseSnapshot } from '../../data/types';
import { JSONPath } from 'jsonpath-plus';

// ── Field resolver (mirrors apiAssertions.ts resolveField) ────────────────────
// Kept local so flow-control-engine has zero runtime dependency on assertion engine.

function resolveField(field: string, response: ApiResponseSnapshot): unknown {
  if (field === 'status' || field === 'statusCode') return response.status;
  if (field === 'responseTime') return response.durationMs;
  if (field === 'responseSize') {
    try { return JSON.stringify(response.body).length; } catch { return 0; }
  }
  if (field.startsWith('header.')) {
    const name = field.slice(7).toLowerCase();
    const key = Object.keys(response.headers).find(k => k.toLowerCase() === name);
    return key ? response.headers[key] : undefined;
  }
  if (field.startsWith('cookie.')) {
    const cookieName = field.slice(7).toLowerCase();
    const raw = response.headers['set-cookie'] ?? response.headers['Set-Cookie'] ?? '';
    const pairs = raw.split(/[;,]/).map((s: string) => s.trim());
    const match = pairs.find((p: string) => p.toLowerCase().startsWith(cookieName + '='));
    return match ? match.split('=').slice(1).join('=') : undefined;
  }
  if (field.startsWith('@arrayLength:')) {
    const path = field.slice(13);
    try {
      const results = JSONPath({ path, json: response.body as object });
      const val = results[0];
      return Array.isArray(val) ? val.length : undefined;
    } catch { return undefined; }
  }
  if (field === 'bodyContains') {
    try { return typeof response.body === 'string' ? response.body : JSON.stringify(response.body); }
    catch { return ''; }
  }
  if (field === 'bodyIsJson') {
    if (response.body === null || response.body === undefined) return false;
    if (typeof response.body === 'object') return true;
    if (typeof response.body === 'string') {
      try { JSON.parse(response.body); return true; } catch { return false; }
    }
    return false;
  }
  if (field === 'body') return response.body;
  try {
    const results = JSONPath({ path: field.startsWith('$') ? field : `$.${field}`, json: response.body as object });
    return results.length > 0 ? results[0] : undefined;
  } catch { return undefined; }
}

// ── Operator evaluator (mirrors apiAssertions.ts evaluate) ────────────────────

function evaluate(op: string, actual: unknown, expected: string): boolean {
  switch (op) {
    case 'equals':             return String(actual) === expected;
    case 'notEquals':          return String(actual) !== expected;
    case 'contains':           return typeof actual === 'string' && actual.includes(expected);
    case 'notContains':        return typeof actual === 'string' && !actual.includes(expected);
    case 'startsWith':         return typeof actual === 'string' && actual.startsWith(expected);
    case 'endsWith':           return typeof actual === 'string' && actual.endsWith(expected);
    case 'greaterThan':        return Number(actual) > Number(expected);
    case 'lessThan':           return Number(actual) < Number(expected);
    case 'greaterThanOrEqual': return Number(actual) >= Number(expected);
    case 'lessThanOrEqual':    return Number(actual) <= Number(expected);
    case 'matches':            return typeof actual === 'string' && new RegExp(expected).test(actual);
    case 'exists':             return actual !== undefined && actual !== null;
    case 'notExists':          return actual === undefined || actual === null;
    case 'isEmpty':            return actual === '' || actual === null || actual === undefined ||
                                      (Array.isArray(actual) && actual.length === 0) ||
                                      (typeof actual === 'object' && actual !== null && Object.keys(actual as object).length === 0);
    case 'isNotEmpty':         return actual !== '' && actual !== null && actual !== undefined;
    default:                   return false;
  }
}

// ── FlowDecision ──────────────────────────────────────────────────────────────

export type FlowDecisionType = 'default' | 'stop' | 'continue' | 'jump' | 'repeat';

export interface FlowDecision {
  action: FlowDecisionType;
  /** jump: target step name | repeat: max repeat count (number) */
  target?: string | number;
  /** Human-readable reason logged to step result */
  reason: string;
}

const DEFAULT_DECISION: FlowDecision = { action: 'default', reason: 'No flow rules matched — continuing sequentially.' };

// ── Main export ───────────────────────────────────────────────────────────────

export function evaluateFlowRules(
  rules: FlowRule[] | undefined,
  response: ApiResponseSnapshot | undefined,
): FlowDecision {
  if (!rules || rules.length === 0) return DEFAULT_DECISION;
  if (!response) return DEFAULT_DECISION;

  for (const rule of rules) {
    // Evaluate condition — if absent the rule is unconditional
    let conditionMet = true;
    if (rule.condition) {
      const actual = resolveField(rule.condition.field, response);
      conditionMet = evaluate(rule.condition.operator, actual, rule.condition.value);
    }
    if (!conditionMet) continue;

    // Condition passed — translate action
    switch (rule.action as FlowRuleAction) {
      case '__stop__':
        return { action: 'stop', reason: 'Flow rule matched: Stop the collection.' };

      case '__continue__':
        return { action: 'continue', reason: 'Flow rule matched: Skip to next request.' };

      case '__jump__':
        if (!rule.target) return { action: 'continue', reason: 'Flow rule: Jump configured but no target name — skipping to next.' };
        return { action: 'jump', target: rule.target, reason: `Flow rule matched: Jump to request "${rule.target}".` };

      case '__repeat__': {
        const max = rule.target ? parseInt(rule.target, 10) : 3;
        return { action: 'repeat', target: isNaN(max) ? 3 : max, reason: `Flow rule matched: Repeat this request (max ${isNaN(max) ? 3 : max} times).` };
      }

      default:
        return { action: 'continue', reason: 'Flow rule: Unknown action — continuing.' };
    }
  }

  return DEFAULT_DECISION;
}
