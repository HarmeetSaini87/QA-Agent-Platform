// src/api-intelligence/engines/assertion-suggester.ts
// Pure function — no DB/HTTP calls. Input: ApiStepResult → Output: AssertionSuggestion[]
// ADVISORY ONLY — never modifies steps or runtime state.

import { nanoid } from 'nanoid';
import type { ApiStepResult } from '../../data/types';
import { getDomainPack } from '../domain-assertions/domain-assertion-library';

export type AssertionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'exists'
  | 'lessThan'
  | 'greaterThan'
  | 'matches'
  | 'arrayLengthEquals'
  | 'arrayLengthGreaterThan'
  | 'arrayNotEmpty'
  | 'arrayContains';

export interface AssertionSuggestion {
  id: string;
  stepId: string;
  stepName: string;
  /** Where to assert: 'status' | 'header' | 'body' | 'responseTime' | 'array' | 'domain' */
  target: 'status' | 'header' | 'body' | 'responseTime' | 'array' | 'domain';
  field: string;
  operator: AssertionOperator;
  expectedValue: unknown;
  rationale: string;
  confidence: number;
  advisoryNote: string;
  /** ApiAssertion-compatible object ready to inject into a step */
  assertionPayload: {
    field: string;
    operator: string;
    expected?: unknown;
    severity: string;
    weight: number;
  };
}

export interface AssertionSuggestionBundle {
  stepId: string;
  stepName: string;
  runId: string;
  generatedAt: string;
  totalSuggestions: number;
  suggestions: AssertionSuggestion[];
  detectedDomain: string | null;
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

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSuggestion(
  step: ApiStepResult,
  target: AssertionSuggestion['target'],
  field: string,
  operator: AssertionOperator,
  expectedValue: unknown,
  rationale: string,
  confidence: number,
  severity = 'high',
  weight = 7,
): AssertionSuggestion {
  return {
    id: nanoid(8),
    stepId: step.stepId,
    stepName: step.stepName,
    target,
    field,
    operator,
    expectedValue,
    rationale,
    confidence,
    advisoryNote: ADVISORY,
    assertionPayload: { field, operator, expected: expectedValue, severity, weight },
  };
}

// ── suggestion generators ─────────────────────────────────────────────────────

function suggestStatusCode(step: ApiStepResult): AssertionSuggestion | null {
  if (!step.response) return null;
  return makeSuggestion(
    step, 'status', 'status', 'equals', step.response.status,
    `The step returned HTTP ${step.response.status}. Assert this status to detect regressions.`,
    95, 'critical', 10,
  );
}

function suggestContentTypeHeader(step: ApiStepResult): AssertionSuggestion | null {
  if (!step.response?.headers) return null;
  const ct = Object.entries(step.response.headers).find(([k]) => k.toLowerCase() === 'content-type');
  if (!ct) return null;
  const baseMime = ct[1].split(';')[0].trim();
  return makeSuggestion(
    step, 'header', 'header.content-type', 'contains', baseMime,
    `Response Content-Type is "${ct[1]}". Assert it contains "${baseMime}" to catch accidental format changes.`,
    85, 'high', 8,
  );
}

function suggestBodyFieldExists(step: ApiStepResult): AssertionSuggestion[] {
  const body = step.response?.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const paths = flattenBodyPaths(body);
  const results: AssertionSuggestion[] = [];
  for (const { path, value } of paths.slice(0, 8)) {
    // Scalar with a specific observed value → suggest equals (more precise than just exists)
    if (value !== null && value !== undefined && typeof value !== 'object' && !Array.isArray(value)) {
      const strVal = String(value);
      // Only suggest equals for short, stable-looking values (IDs, codes, statuses)
      if (strVal.length <= 40 && (typeof value === 'number' || typeof value === 'boolean' || strVal.match(/^[a-z0-9_\-]+$/i))) {
        results.push(makeSuggestion(
          step, 'body', path, 'equals', strVal,
          `Observed value of "${path}" was "${strVal}". Assert exact value to catch regressions. Change if value varies per request.`,
          78, 'medium', 6,
        ));
        continue;
      }
    }
    // Otherwise just assert exists
    results.push(makeSuggestion(
      step, 'body', path, 'exists', undefined,
      `Field "${path}" exists in the response. Assert it is present to catch missing fields.`,
      75, 'high', 7,
    ));
  }
  return results;
}

function suggestResponseTimeSla(step: ApiStepResult): AssertionSuggestion | null {
  if (!step.durationMs || step.durationMs <= 0) return null;
  const sla = Math.ceil((step.durationMs * 2) / 100) * 100;
  return makeSuggestion(
    step, 'responseTime', 'responseTime', 'lessThan', String(sla),
    `Step completed in ${step.durationMs}ms. SLA suggested at ${sla}ms (2× observed). Adjust per environment.`,
    70, 'soft', 4,
  );
}

// ── Phase III: Array assertion suggester ─────────────────────────────────────

function suggestArrayAssertions(step: ApiStepResult): AssertionSuggestion[] {
  const body = step.response?.body;
  if (!body || typeof body !== 'object') return [];
  const results: AssertionSuggestion[] = [];

  // Top-level array body
  if (Array.isArray(body)) {
    results.push(makeSuggestion(
      step, 'array', '$', 'arrayNotEmpty', undefined,
      `Response body is an array with ${body.length} item(s). Assert it is not empty.`,
      88, 'high', 8,
    ));
    results.push(makeSuggestion(
      step, 'array', '$', 'arrayLengthGreaterThan', '0',
      `Response body array has ${body.length} item(s). Assert length > 0 to catch empty-list regressions.`,
      85, 'high', 7,
    ));
    return results;
  }

  // Nested array fields — scan one level deep
  for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
    if (!Array.isArray(val)) continue;
    const path = `$.${key}`;
    results.push(makeSuggestion(
      step, 'array', `@arrayLength:${path}`, 'greaterThan', '0',
      `Field "${key}" is an array with ${val.length} item(s). Assert length > 0.`,
      84, 'high', 7,
    ));
    if (val.length > 0) {
      results.push(makeSuggestion(
        step, 'array', path, 'arrayNotEmpty', undefined,
        `Field "${key}" array is non-empty (${val.length} item(s)). Assert it stays non-empty.`,
        82, 'high', 7,
      ));
    }
    // Only suggest for first 3 array fields to avoid noise
    if (results.length >= 6) break;
  }

  return results;
}

// ── Phase III: Domain auto-detection + domain assertion suggester ─────────────

function detectDomain(step: ApiStepResult): string | null {
  const url = (step as any).request?.url ?? '';
  const body = step.response?.body;
  const headers = step.response?.headers ?? {};

  const urlLower = url.toLowerCase();
  const bodyStr = body ? JSON.stringify(body).toLowerCase() : '';

  // Fintech signals
  if (
    urlLower.match(/payment|transaction|ledger|transfer|account|balance|invoice|stripe|plaid|bank/) ||
    bodyStr.match(/"transaction_id"|"amount"|"currency"[^_]|"account_number"/)
  ) return 'fintech';

  // Salesforce/CRM signals
  if (
    urlLower.match(/salesforce|\.force\.com|hubspot|crm|dynamics|\/sobjects\/|\/query\//) ||
    bodyStr.match(/"totalSize"|"records"\s*:\s*\[|"done"\s*:\s*(true|false)|"Id"\s*:/)
  ) return 'salesforce-crm';

  // eCommerce signals
  if (
    urlLower.match(/product|catalog|cart|order|checkout|inventory|sku|shopify|magento|woocommerce/) ||
    bodyStr.match(/"price"|"sku"|"product_id"|"order_id"|"cart"/)
  ) return 'ecommerce';

  // Paginated API signals
  const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (
    bodyStr.match(/"total"|"page"|"pageSize"|"cursor"|"nextPage"|"items"\s*:\s*\[|"data"\s*:\s*\[/) &&
    ct.includes('application/json')
  ) return 'paginated-api';

  return null;
}

function suggestDomainAssertions(step: ApiStepResult, domainId: string): AssertionSuggestion[] {
  const pack = getDomainPack(domainId);
  if (!pack) return [];
  // Only include domain assertions whose fields are NOT already covered by the
  // generic generators (status, content-type, responseTime) — avoid duplication
  const genericFields = new Set(['status', 'statusCode', 'header.content-type', 'responseTime']);
  return pack.assertions
    .filter(a => !genericFields.has(a.field))
    .map(a =>
      makeSuggestion(
        step, 'domain', a.field, (a.operator as AssertionOperator), a.expected,
        `${pack.name} domain pattern: ${a.message ?? `Assert ${a.field} ${a.operator}`}. Based on auto-detected domain from this run.`,
        72, a.severity ?? 'medium', a.weight ?? 6,
      )
    );
}

// ── main export ───────────────────────────────────────────────────────────────

export function suggestAssertions(step: ApiStepResult, runId = ''): AssertionSuggestionBundle {
  const suggestions: AssertionSuggestion[] = [];

  // Existing: status, content-type, body fields, response time
  const status = suggestStatusCode(step);
  if (status) suggestions.push(status);

  const ct = suggestContentTypeHeader(step);
  if (ct) suggestions.push(ct);

  suggestions.push(...suggestBodyFieldExists(step));

  const sla = suggestResponseTimeSla(step);
  if (sla) suggestions.push(sla);

  // Phase III: array assertions
  suggestions.push(...suggestArrayAssertions(step));

  // Phase III: domain-matched assertions
  const detectedDomain = detectDomain(step);
  if (detectedDomain) {
    suggestions.push(...suggestDomainAssertions(step, detectedDomain));
  }

  // Deduplicate by field+operator to avoid same assertion from multiple generators
  const seen = new Set<string>();
  const deduped = suggestions.filter(s => {
    const key = `${s.field}::${s.operator}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    stepId: step.stepId,
    stepName: step.stepName,
    runId,
    generatedAt: new Date().toISOString(),
    totalSuggestions: deduped.length,
    suggestions: deduped,
    detectedDomain,
    advisoryNote: ADVISORY,
  };
}
