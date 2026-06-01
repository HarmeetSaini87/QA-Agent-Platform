// src/api-intelligence/engines/negative-test-generator.ts
// Pure function — no DB/HTTP calls. Input: ApiCollection → Output: NegativeTestSuite[]
// ADVISORY ONLY — never modifies collection or runtime state.

import { nanoid } from 'nanoid';
import { ApiCollection, ApiTestStep } from '../../data/types';
import { makeProvenance } from './engine-helpers';

export type NegativeStrategy =
  | 'missing-field'
  | 'wrong-type'
  | 'boundary-violation'
  | 'auth-stripped'
  | 'wrong-method';

export interface NegativeTestCase {
  id: string;
  stepId: string;
  stepName: string;
  strategy: NegativeStrategy;
  title: string;
  description: string;
  /** Mutated request — caller uses this as a suggestion only */
  suggestedRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  expectedStatusCodes: number[];
  advisoryNote: string;
}

export interface NegativeTestSuite {
  collectionId: string;
  collectionName: string;
  generatedAt: string;
  totalCases: number;
  cases: NegativeTestCase[];
  advisoryNote: string;
}

const ADVISORY = 'These test cases are suggestions only. Review before use. The platform never auto-runs or auto-modifies collections based on generated negatives.';

// ── helpers ──────────────────────────────────────────────────────────────────

function baseHeaders(step: ApiTestStep): Record<string, string> {
  return { ...(step.request.headers ?? {}) };
}

function parseBody(step: ApiTestStep): Record<string, unknown> | null {
  const body = step.request.body;
  if (!body) return null;
  if (typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return null; }
  }
  return null;
}

// ── strategy generators ───────────────────────────────────────────────────────

function generateMissingFieldCases(step: ApiTestStep): NegativeTestCase[] {
  const body = parseBody(step);
  if (!body || typeof body !== 'object') return [];
  const keys = Object.keys(body);
  if (keys.length === 0) return [];

  return keys.map(key => {
    const mutated = { ...body };
    delete mutated[key];
    return {
      id: nanoid(8),
      stepId: step.id,
      stepName: step.name,
      strategy: 'missing-field' as NegativeStrategy,
      title: `${step.name} — missing required field: "${key}"`,
      description: `Remove "${key}" from the request body to verify the server returns a 400/422 validation error.`,
      suggestedRequest: {
        method: step.request.method,
        url: step.request.url,
        headers: baseHeaders(step),
        body: mutated,
      },
      expectedStatusCodes: [400, 422],
      advisoryNote: ADVISORY,
    };
  });
}

function generateWrongTypeCases(step: ApiTestStep): NegativeTestCase[] {
  const body = parseBody(step);
  if (!body) return [];
  const cases: NegativeTestCase[] = [];

  for (const [key, val] of Object.entries(body)) {
    let wrongVal: unknown;
    let fromType: string;
    let toType: string;

    if (typeof val === 'number') {
      wrongVal = 'not-a-number';
      fromType = 'number'; toType = 'string';
    } else if (typeof val === 'boolean') {
      wrongVal = 'not-a-boolean';
      fromType = 'boolean'; toType = 'string';
    } else if (typeof val === 'string' && val.match(/^\d+$/)) {
      wrongVal = -999;
      fromType = 'numeric-string'; toType = 'negative-number';
    } else {
      continue;
    }

    cases.push({
      id: nanoid(8),
      stepId: step.id,
      stepName: step.name,
      strategy: 'wrong-type',
      title: `${step.name} — wrong type for field "${key}" (${fromType} → ${toType})`,
      description: `Send "${key}": ${JSON.stringify(wrongVal)} instead of ${fromType} value to verify type validation.`,
      suggestedRequest: {
        method: step.request.method,
        url: step.request.url,
        headers: baseHeaders(step),
        body: { ...body, [key]: wrongVal },
      },
      expectedStatusCodes: [400, 422],
      advisoryNote: ADVISORY,
    });
  }
  return cases;
}

function generateBoundaryViolationCases(step: ApiTestStep): NegativeTestCase[] {
  const body = parseBody(step);
  const cases: NegativeTestCase[] = [];

  if (body) {
    for (const [key, val] of Object.entries(body)) {
      if (typeof val === 'number') {
        cases.push({
          id: nanoid(8),
          stepId: step.id,
          stepName: step.name,
          strategy: 'boundary-violation',
          title: `${step.name} — boundary: "${key}" = 0`,
          description: `Send ${key}=0 to test zero-value boundary handling.`,
          suggestedRequest: {
            method: step.request.method,
            url: step.request.url,
            headers: baseHeaders(step),
            body: { ...body, [key]: 0 },
          },
          expectedStatusCodes: [400, 422],
          advisoryNote: ADVISORY,
        });
        cases.push({
          id: nanoid(8),
          stepId: step.id,
          stepName: step.name,
          strategy: 'boundary-violation',
          title: `${step.name} — boundary: "${key}" = -1`,
          description: `Send ${key}=-1 to test negative value boundary handling.`,
          suggestedRequest: {
            method: step.request.method,
            url: step.request.url,
            headers: baseHeaders(step),
            body: { ...body, [key]: -1 },
          },
          expectedStatusCodes: [400, 422],
          advisoryNote: ADVISORY,
        });
      } else if (typeof val === 'string') {
        cases.push({
          id: nanoid(8),
          stepId: step.id,
          stepName: step.name,
          strategy: 'boundary-violation',
          title: `${step.name} — boundary: "${key}" = empty string`,
          description: `Send ${key}="" to test empty string boundary handling.`,
          suggestedRequest: {
            method: step.request.method,
            url: step.request.url,
            headers: baseHeaders(step),
            body: { ...body, [key]: '' },
          },
          expectedStatusCodes: [400, 422],
          advisoryNote: ADVISORY,
        });
        cases.push({
          id: nanoid(8),
          stepId: step.id,
          stepName: step.name,
          strategy: 'boundary-violation',
          title: `${step.name} — boundary: "${key}" = 9999999 chars`,
          description: `Send oversized string for ${key} to test max-length validation.`,
          suggestedRequest: {
            method: step.request.method,
            url: step.request.url,
            headers: baseHeaders(step),
            body: { ...body, [key]: 'x'.repeat(9999) },
          },
          expectedStatusCodes: [400, 413, 422],
          advisoryNote: ADVISORY,
        });
      }
    }
  }

  // Query param boundaries for GET steps
  if (step.request.method === 'GET' && step.request.queryParams && Object.keys(step.request.queryParams as object).length > 0) {
    const qp = step.request.queryParams as Record<string, unknown>;
    for (const [key, val] of Object.entries(qp)) {
      if (typeof val === 'number' || (typeof val === 'string' && val.match(/^\d+$/))) {
        cases.push({
          id: nanoid(8),
          stepId: step.id,
          stepName: step.name,
          strategy: 'boundary-violation',
          title: `${step.name} — boundary: query param "${key}" = -1`,
          description: `Send ${key}=-1 in query params to test boundary validation.`,
          suggestedRequest: {
            method: step.request.method,
            url: `${step.request.url}?${key}=-1`,
            headers: baseHeaders(step),
            body: null,
          },
          expectedStatusCodes: [400, 422],
          advisoryNote: ADVISORY,
        });
      }
    }
  }

  return cases;
}

function generateAuthStrippedCases(step: ApiTestStep): NegativeTestCase[] {
  const headers = baseHeaders(step);
  const hasAuth = Object.keys(headers).some(k =>
    k.toLowerCase() === 'authorization' || k.toLowerCase() === 'x-api-key' || k.toLowerCase() === 'accesstoken'
  );
  if (!hasAuth) return [];

  const strippedHeaders = { ...headers };
  for (const k of Object.keys(strippedHeaders)) {
    if (['authorization', 'x-api-key', 'accesstoken'].includes(k.toLowerCase())) {
      delete strippedHeaders[k];
    }
  }

  return [{
    id: nanoid(8),
    stepId: step.id,
    stepName: step.name,
    strategy: 'auth-stripped',
    title: `${step.name} — auth stripped (no auth header)`,
    description: 'Remove all auth headers to verify the endpoint returns 401/403 for unauthenticated requests.',
    suggestedRequest: {
      method: step.request.method,
      url: step.request.url,
      headers: strippedHeaders,
      body: parseBody(step),
    },
    expectedStatusCodes: [401, 403],
    advisoryNote: ADVISORY,
  }];
}

const METHOD_ALTERNATES: Record<string, string[]> = {
  GET: ['POST', 'DELETE'],
  POST: ['GET', 'PUT'],
  PUT: ['GET', 'DELETE'],
  PATCH: ['GET', 'DELETE'],
  DELETE: ['GET', 'POST'],
};

function generateWrongMethodCases(step: ApiTestStep): NegativeTestCase[] {
  const alternates = METHOD_ALTERNATES[step.request.method.toUpperCase()] ?? [];
  return alternates.slice(0, 1).map(alt => ({
    id: nanoid(8),
    stepId: step.id,
    stepName: step.name,
    strategy: 'wrong-method' as NegativeStrategy,
    title: `${step.name} — wrong HTTP method (${alt} instead of ${step.request.method})`,
    description: `Send ${alt} to an endpoint that expects ${step.request.method} to verify 405 Method Not Allowed.`,
    suggestedRequest: {
      method: alt,
      url: step.request.url,
      headers: baseHeaders(step),
      body: parseBody(step),
    },
    expectedStatusCodes: [405],
    advisoryNote: ADVISORY,
  }));
}

// ── main export ───────────────────────────────────────────────────────────────

export function generateNegativeTests(collection: ApiCollection): NegativeTestSuite {
  const steps: ApiTestStep[] = collection.steps ?? [];
  const allCases: NegativeTestCase[] = [];

  for (const step of steps) {
    allCases.push(...generateMissingFieldCases(step));
    allCases.push(...generateWrongTypeCases(step));
    allCases.push(...generateBoundaryViolationCases(step));
    allCases.push(...generateAuthStrippedCases(step));
    allCases.push(...generateWrongMethodCases(step));
  }

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    generatedAt: new Date().toISOString(),
    totalCases: allCases.length,
    cases: allCases,
    advisoryNote: ADVISORY,
  };
}
