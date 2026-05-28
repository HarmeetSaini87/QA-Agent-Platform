// src/api-intelligence/engines/assertion-suggester.ts
// Pure function — no DB/HTTP calls. Input: ApiStepResult → Output: AssertionSuggestion[]
// ADVISORY ONLY — never modifies steps or runtime state.

import { nanoid } from 'nanoid';
import type { ApiStepResult } from '../../data/types';

export type AssertionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'exists'
  | 'lessThan'
  | 'greaterThan'
  | 'matches';

export interface AssertionSuggestion {
  id: string;
  stepId: string;
  stepName: string;
  /** Where to assert: 'status' | 'header' | 'body' | 'responseTime' */
  target: 'status' | 'header' | 'body' | 'responseTime';
  field: string;
  operator: AssertionOperator;
  expectedValue: unknown;
  rationale: string;
  confidence: number;
  advisoryNote: string;
}

export interface AssertionSuggestionBundle {
  stepId: string;
  stepName: string;
  runId: string;
  generatedAt: string;
  totalSuggestions: number;
  suggestions: AssertionSuggestion[];
  advisoryNote: string;
}

const ADVISORY = 'These assertion suggestions are advisory only. Review and add to your steps manually. The platform never auto-applies suggestions.';

// ── helpers ──────────────────────────────────────────────────────────────────

function flattenBodyPaths(obj: unknown, prefix = '$'): Array<{ path: string; value: unknown }> {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return [{ path: prefix, value: obj }];
  }
  const result: Array<{ path: string; value: unknown }> = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const childPath = `${prefix}.${key}`;
    result.push({ path: childPath, value: val });
    // One level deep only — avoid combinatorial explosion on large payloads
  }
  return result;
}

// ── suggestion generators ─────────────────────────────────────────────────────

function suggestStatusCode(step: ApiStepResult): AssertionSuggestion | null {
  if (!step.response) return null;
  return {
    id: nanoid(8),
    stepId: step.stepId,
    stepName: step.stepName,
    target: 'status',
    field: 'status',
    operator: 'equals',
    expectedValue: step.response.status,
    rationale: `The step returned HTTP ${step.response.status}. Assert this status to detect regressions.`,
    confidence: 95,
    advisoryNote: ADVISORY,
  };
}

function suggestContentTypeHeader(step: ApiStepResult): AssertionSuggestion | null {
  if (!step.response?.headers) return null;
  const ct = Object.entries(step.response.headers).find(
    ([k]) => k.toLowerCase() === 'content-type'
  );
  if (!ct) return null;
  // Normalise to base MIME without charset
  const baseMime = ct[1].split(';')[0].trim();
  return {
    id: nanoid(8),
    stepId: step.stepId,
    stepName: step.stepName,
    target: 'header',
    field: 'content-type',
    operator: 'contains',
    expectedValue: baseMime,
    rationale: `Response Content-Type is "${ct[1]}". Assert it contains "${baseMime}" to catch accidental format changes.`,
    confidence: 85,
    advisoryNote: ADVISORY,
  };
}

function suggestBodyFieldExists(step: ApiStepResult): AssertionSuggestion[] {
  if (!step.response?.body || typeof step.response.body !== 'object') return [];
  const paths = flattenBodyPaths(step.response.body);
  // Limit to top 8 fields to keep suggestions actionable
  return paths.slice(0, 8).map(({ path }) => ({
    id: nanoid(8),
    stepId: step.stepId,
    stepName: step.stepName,
    target: 'body' as const,
    field: path,
    operator: 'exists' as AssertionOperator,
    expectedValue: true,
    rationale: `Response body has field "${path}". Assert it exists to catch missing fields in future responses.`,
    confidence: 80,
    advisoryNote: ADVISORY,
  }));
}

function suggestResponseTimeSla(step: ApiStepResult): AssertionSuggestion | null {
  if (!step.durationMs || step.durationMs <= 0) return null;
  // SLA = 2× actual observed duration, rounded up to nearest 100ms
  const sla = Math.ceil((step.durationMs * 2) / 100) * 100;
  return {
    id: nanoid(8),
    stepId: step.stepId,
    stepName: step.stepName,
    target: 'responseTime',
    field: 'durationMs',
    operator: 'lessThan',
    expectedValue: sla,
    rationale: `Step completed in ${step.durationMs}ms. SLA suggested at ${sla}ms (2× observed). Adjust based on environment baseline.`,
    confidence: 70,
    advisoryNote: ADVISORY,
  };
}

// ── main export ───────────────────────────────────────────────────────────────

export function suggestAssertions(step: ApiStepResult, runId = ''): AssertionSuggestionBundle {
  const suggestions: AssertionSuggestion[] = [];

  const status = suggestStatusCode(step);
  if (status) suggestions.push(status);

  const ct = suggestContentTypeHeader(step);
  if (ct) suggestions.push(ct);

  suggestions.push(...suggestBodyFieldExists(step));

  const sla = suggestResponseTimeSla(step);
  if (sla) suggestions.push(sla);

  return {
    stepId: step.stepId,
    stepName: step.stepName,
    runId,
    generatedAt: new Date().toISOString(),
    totalSuggestions: suggestions.length,
    suggestions,
    advisoryNote: ADVISORY,
  };
}
