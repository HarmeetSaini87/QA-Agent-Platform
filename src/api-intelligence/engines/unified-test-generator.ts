// src/api-intelligence/engines/unified-test-generator.ts
// Pure function — no DB/HTTP calls. Advisory only — never modifies collection or runtime.

import { nanoid } from 'nanoid';
import { ApiCollection, ApiTestStep } from '../../data/types';

export type TestCategory =
  | 'Positive'
  | 'Negative'
  | 'Security'
  | 'Edge'
  | 'Contract'
  | 'Authorization'
  | 'Boundary'
  | 'Business Rules'
  | 'Content-Type'
  | 'Idempotency'
  | 'Token Lifecycle'
  | 'Unicode';

export interface GeneratedTestCase {
  id: string;
  stepId: string;
  stepName: string;
  category: TestCategory;
  title: string;
  description: string;
  suggestedRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  expectedStatusCodes: number[];
  expectedBehavior: string;
  assertions: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  advisoryNote: string;
}

export interface GeneratedTestSuite {
  collectionId: string;
  collectionName: string;
  category: TestCategory;
  generatedAt: string;
  totalCases: number;
  cases: GeneratedTestCase[];
  advisoryNote: string;
}

const ADVISORY = 'Advisory only — review before use. Platform never auto-runs or auto-modifies collections based on generated tests.';

function baseReq(step: ApiTestStep) {
  return {
    method: step.request.method,
    url: step.request.url,
    headers: { ...(step.request.headers ?? {}) } as Record<string, string>,
    body: step.request.body ?? null,
  };
}

function parseBody(step: ApiTestStep): Record<string, unknown> | null {
  const body = step.request.body;
  if (!body) return null;
  if (typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') { try { return JSON.parse(body); } catch { return null; } }
  return null;
}

// ── POSITIVE ──────────────────────────────────────────────────────────────────

function generatePositive(step: ApiTestStep): GeneratedTestCase[] {
  const req = baseReq(step);
  const cases: GeneratedTestCase[] = [];
  const body = parseBody(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Positive',
    title: `[Positive] Happy path — ${step.name}`,
    description: 'Send valid request with all required fields and correct auth. Expect success response.',
    suggestedRequest: req,
    expectedStatusCodes: [200, 201],
    expectedBehavior: 'Returns 2xx with expected response body and headers.',
    assertions: ['status in [200, 201]', 'response.body is not null', 'response time < 3000ms', 'Content-Type: application/json'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  if (body && Object.keys(body).length > 0) {
    cases.push({
      id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Positive',
      title: `[Positive] All optional fields included — ${step.name}`,
      description: 'Send request with all optional fields populated. Expect same success response.',
      suggestedRequest: req,
      expectedStatusCodes: [200, 201],
      expectedBehavior: 'Server accepts optional fields without error.',
      assertions: ['status in [200, 201]', 'no validation error in response', 'all sent fields reflected in response'],
      severity: 'medium',
      advisoryNote: ADVISORY,
    });

    // Per-field positive: verify each body field is returned correctly
    Object.entries(body).slice(0, 5).forEach(([key, value]) => {
      cases.push({
        id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Positive',
        title: `[Positive] Field "${key}" value is persisted — ${step.name}`,
        description: `Send request with ${key}=${JSON.stringify(value)}. Verify response contains matching value.`,
        suggestedRequest: req,
        expectedStatusCodes: [200, 201],
        expectedBehavior: `response.body.${key} equals sent value "${JSON.stringify(value)}".`,
        assertions: [`response.body.${key} === ${JSON.stringify(value)}`],
        severity: 'medium',
        advisoryNote: ADVISORY,
      });
    });
  }

  // User flow: create then retrieve
  if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
    cases.push({
      id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Positive',
      title: `[Positive] Create then retrieve — ${step.name}`,
      description: 'Create resource via POST, then GET the returned ID. Verify data matches.',
      suggestedRequest: req,
      expectedStatusCodes: [200, 201],
      expectedBehavior: 'Created resource is retrievable via GET and matches sent data.',
      assertions: ['POST returns id', 'GET /resource/{id} returns 200', 'response data matches request body'],
      severity: 'high',
      advisoryNote: ADVISORY,
    });
  }

  return cases;
}

// ── NEGATIVE ──────────────────────────────────────────────────────────────────

function generateNegative(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);
  const body = parseBody(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Negative',
    title: `[Negative] Empty body — ${step.name}`,
    description: 'Send request with empty body. Expect 400 validation error.',
    suggestedRequest: { ...req, body: {} },
    expectedStatusCodes: [400, 422],
    expectedBehavior: 'Server rejects empty body with validation message.',
    assertions: ['status in [400, 422]', 'response.body contains error message'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  if (body) {
    // Remove each field one at a time
    Object.keys(body).slice(0, 4).forEach(key => {
      const mutated = { ...body };
      delete mutated[key];
      cases.push({
        id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Negative',
        title: `[Negative] Missing field "${key}" — ${step.name}`,
        description: `Omit field "${key}". Expect 400 if required.`,
        suggestedRequest: { ...req, body: mutated },
        expectedStatusCodes: [400, 422],
        expectedBehavior: `Server returns error indicating "${key}" is missing.`,
        assertions: [`status in [400, 422]`, `response.body mentions "${key}"`],
        severity: 'high',
        advisoryNote: ADVISORY,
      });
    });

    // Wrong type for each field
    Object.entries(body).slice(0, 3).forEach(([key, val]) => {
      const wrongVal = typeof val === 'string' ? 99999 : 'wrong_type_string';
      cases.push({
        id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Negative',
        title: `[Negative] Wrong type for "${key}" (${typeof wrongVal}) — ${step.name}`,
        description: `Set "${key}" to ${JSON.stringify(wrongVal)} (wrong type). Expect 400.`,
        suggestedRequest: { ...req, body: { ...body, [key]: wrongVal } },
        expectedStatusCodes: [400, 422],
        expectedBehavior: `Server rejects wrong type for "${key}".`,
        assertions: [`status in [400, 422]`, `response mentions "${key}"`],
        severity: 'high',
        advisoryNote: ADVISORY,
      });
    });
  }

  // Wrong HTTP methods
  ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].filter(m => m !== req.method.toUpperCase()).slice(0, 2).forEach(method => {
    cases.push({
      id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Negative',
      title: `[Negative] Wrong method ${method} — ${step.name}`,
      description: `Send as ${method} instead of ${req.method}. Expect 405.`,
      suggestedRequest: { ...req, method },
      expectedStatusCodes: [405],
      expectedBehavior: 'Server returns 405 Method Not Allowed.',
      assertions: ['status === 405', 'Allow header present in response'],
      severity: 'medium',
      advisoryNote: ADVISORY,
    });
  });

  return cases;
}

// ── SECURITY ──────────────────────────────────────────────────────────────────

function generateSecurity(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);

  const headersNoAuth = { ...req.headers };
  delete headersNoAuth['Authorization'];
  delete headersNoAuth['authorization'];
  delete headersNoAuth['x-api-key'];
  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Security',
    title: `[Security] No auth header — ${step.name}`,
    description: 'Remove all auth headers. Expect 401.',
    suggestedRequest: { ...req, headers: headersNoAuth },
    expectedStatusCodes: [401],
    expectedBehavior: 'Server rejects unauthenticated request.',
    assertions: ['status === 401', 'response.body contains "unauthorized" or "authentication"'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Security',
    title: `[Security] Invalid auth token — ${step.name}`,
    description: 'Send with malformed/expired token. Expect 401 or 403.',
    suggestedRequest: { ...req, headers: { ...req.headers, Authorization: 'Bearer invalid_token_xyz' } },
    expectedStatusCodes: [401, 403],
    expectedBehavior: 'Server rejects invalid token.',
    assertions: ['status in [401, 403]'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  const body = parseBody(step);
  if (body) {
    cases.push({
      id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Security',
      title: `[Security] SQL injection payload — ${step.name}`,
      description: 'Inject SQL payload into body fields. Server must sanitize.',
      suggestedRequest: { ...req, body: { ...body, id: "' OR '1'='1", name: "'; DROP TABLE users;--" } },
      expectedStatusCodes: [400, 422],
      expectedBehavior: 'Server sanitizes or rejects SQL injection attempts.',
      assertions: ['status in [400, 422]', 'response does not expose DB error'],
      severity: 'critical',
      advisoryNote: ADVISORY,
    });

    cases.push({
      id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Security',
      title: `[Security] XSS payload — ${step.name}`,
      description: 'Inject XSS script tag into fields. Server must not reflect unescaped.',
      suggestedRequest: { ...req, body: { ...body, name: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' } },
      expectedStatusCodes: [400, 422, 200],
      expectedBehavior: 'Server escapes or rejects XSS payload. Response must not contain raw <script>.',
      assertions: ['response.body does not contain unescaped <script>'],
      severity: 'critical',
      advisoryNote: ADVISORY,
    });
  }

  return cases;
}

// ── EDGE ──────────────────────────────────────────────────────────────────────

function generateEdge(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);
  const body = parseBody(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Edge',
    title: `[Edge] Null body — ${step.name}`,
    description: 'Send request with null as body. Expect graceful error.',
    suggestedRequest: { ...req, body: null },
    expectedStatusCodes: [400, 415, 422],
    expectedBehavior: 'Server handles null body gracefully without 500.',
    assertions: ['status !== 500', 'response.body contains error message'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Edge',
    title: `[Edge] Extremely large payload — ${step.name}`,
    description: 'Send a body with very large string values. Check for 413 or graceful rejection.',
    suggestedRequest: { ...req, body: { ...body, data: 'A'.repeat(100000) } },
    expectedStatusCodes: [400, 413, 422],
    expectedBehavior: 'Server rejects oversized payload without crashing.',
    assertions: ['status in [400, 413, 422]', 'status !== 500'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Edge',
    title: `[Edge] Duplicate request (rapid fire) — ${step.name}`,
    description: 'Send the same request twice in quick succession. Check for idempotency or race condition.',
    suggestedRequest: req,
    expectedStatusCodes: [200, 201, 409],
    expectedBehavior: 'Server handles duplicate request — either returns same result or 409 Conflict.',
    assertions: ['status !== 500', 'no race condition error'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── CONTRACT ──────────────────────────────────────────────────────────────────

function generateContract(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Contract',
    title: `[Contract] Response schema validation — ${step.name}`,
    description: 'Validate response body matches expected schema (required fields, types).',
    suggestedRequest: req,
    expectedStatusCodes: [200, 201],
    expectedBehavior: 'Response body contains all documented fields with correct types.',
    assertions: ['response schema matches contract', 'no undocumented fields in response', 'all required fields present'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Contract',
    title: `[Contract] Content-Type header in response — ${step.name}`,
    description: 'Validate response Content-Type is application/json.',
    suggestedRequest: req,
    expectedStatusCodes: [200, 201],
    expectedBehavior: 'Response Content-Type header is application/json.',
    assertions: ['response.headers["content-type"] contains "application/json"'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Contract',
    title: `[Contract] Wrong input type (string vs number) — ${step.name}`,
    description: 'Send string where number is expected. Server should return 400.',
    suggestedRequest: { ...req, body: { id: 'not-a-number', count: 'abc' } },
    expectedStatusCodes: [400, 422],
    expectedBehavior: 'Server enforces field type contract.',
    assertions: ['status in [400, 422]', 'response mentions type error'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── AUTHORIZATION ─────────────────────────────────────────────────────────────

function generateAuthorization(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Authorization',
    title: `[Authorization] Access with insufficient role — ${step.name}`,
    description: 'Send request using a read-only or lower-privilege token. Expect 403.',
    suggestedRequest: { ...req, headers: { ...req.headers, Authorization: 'Bearer readonly_token' } },
    expectedStatusCodes: [403],
    expectedBehavior: 'Server returns 403 Forbidden for insufficient role.',
    assertions: ['status === 403', 'response.body contains "forbidden" or "permission"'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Authorization',
    title: `[Authorization] Access another user's resource — ${step.name}`,
    description: 'Modify resource ID to access a different user\'s data. Expect 403 or 404.',
    suggestedRequest: { ...req, url: req.url.replace(/\/[^/]+$/, '/other-user-id-9999') },
    expectedStatusCodes: [403, 404],
    expectedBehavior: 'Server prevents cross-user data access.',
    assertions: ['status in [403, 404]'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Authorization',
    title: `[Authorization] Privilege escalation attempt — ${step.name}`,
    description: 'Include admin role claim in body/header without proper token. Expect rejection.',
    suggestedRequest: { ...req, body: { role: 'admin', isAdmin: true } },
    expectedStatusCodes: [400, 403],
    expectedBehavior: 'Server ignores or rejects client-supplied role escalation.',
    assertions: ['status in [400, 403]', 'user role not elevated'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── BOUNDARY ──────────────────────────────────────────────────────────────────

function generateBoundary(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Boundary',
    title: `[Boundary] Min value (0 / empty string) — ${step.name}`,
    description: 'Set numeric fields to 0 and string fields to empty. Test min boundary.',
    suggestedRequest: { ...req, body: { id: 0, count: 0, name: '', amount: 0 } },
    expectedStatusCodes: [200, 201, 400],
    expectedBehavior: 'Server either accepts minimum values or returns clear validation error.',
    assertions: ['status !== 500', 'response body is valid JSON'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Boundary',
    title: `[Boundary] Max value (INT_MAX / very long string) — ${step.name}`,
    description: 'Set numeric fields to 2147483647 and strings to 255 chars. Test max boundary.',
    suggestedRequest: { ...req, body: { id: 2147483647, count: 9999999, name: 'X'.repeat(255), amount: 999999.99 } },
    expectedStatusCodes: [200, 201, 400],
    expectedBehavior: 'Server handles max boundary values without overflow or crash.',
    assertions: ['status !== 500', 'no integer overflow in response'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Boundary',
    title: `[Boundary] Negative numbers — ${step.name}`,
    description: 'Set numeric fields to -1. Test negative boundary.',
    suggestedRequest: { ...req, body: { id: -1, count: -1, amount: -0.01 } },
    expectedStatusCodes: [400, 422],
    expectedBehavior: 'Server rejects or handles negative values per business rules.',
    assertions: ['status !== 500'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── BUSINESS RULES ────────────────────────────────────────────────────────────

function generateBusinessRules(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Business Rules',
    title: `[Business Rules] Duplicate resource creation — ${step.name}`,
    description: 'Create same resource twice. Expect 409 Conflict on second request.',
    suggestedRequest: req,
    expectedStatusCodes: [409, 422],
    expectedBehavior: 'Server prevents duplicate resource creation.',
    assertions: ['second request returns 409', 'error message mentions duplicate'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Business Rules',
    title: `[Business Rules] Operation on non-existent resource — ${step.name}`,
    description: 'Reference a resource ID that does not exist. Expect 404.',
    suggestedRequest: { ...req, url: req.url.replace(/\/[^/]+$/, '/non-existent-id-00000') },
    expectedStatusCodes: [404],
    expectedBehavior: 'Server returns 404 with descriptive message.',
    assertions: ['status === 404', 'response.body.error is not null'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Business Rules',
    title: `[Business Rules] Invalid state transition — ${step.name}`,
    description: 'Attempt an operation that violates workflow state (e.g. cancel already-cancelled order).',
    suggestedRequest: req,
    expectedStatusCodes: [400, 409, 422],
    expectedBehavior: 'Server enforces valid state transitions.',
    assertions: ['status in [400, 409, 422]', 'response explains invalid state'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── CONTENT-TYPE ──────────────────────────────────────────────────────────────

function generateContentType(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);
  const body = parseBody(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Content-Type',
    title: `[Content-Type] Send as form-urlencoded — ${step.name}`,
    description: 'Change Content-Type to application/x-www-form-urlencoded. Expect 415 or 400.',
    suggestedRequest: { ...req, headers: { ...req.headers, 'Content-Type': 'application/x-www-form-urlencoded' } },
    expectedStatusCodes: [400, 415],
    expectedBehavior: 'Server rejects wrong content type with 415 Unsupported Media Type.',
    assertions: ['status in [400, 415]'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Content-Type',
    title: `[Content-Type] No Content-Type header — ${step.name}`,
    description: 'Omit Content-Type header entirely. Expect 415 or 400.',
    suggestedRequest: { ...req, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== 'content-type')) },
    expectedStatusCodes: [400, 415],
    expectedBehavior: 'Server requires Content-Type header.',
    assertions: ['status in [400, 415]'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Content-Type',
    title: `[Content-Type] Send XML body with JSON content-type — ${step.name}`,
    description: 'Send XML payload but claim application/json. Expect parse error.',
    suggestedRequest: { ...req, body: `<root><item>${JSON.stringify(body)}</item></root>` },
    expectedStatusCodes: [400],
    expectedBehavior: 'Server returns 400 for malformed JSON body.',
    assertions: ['status === 400', 'response mentions parse error'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── IDEMPOTENCY ───────────────────────────────────────────────────────────────

function generateIdempotency(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Idempotency',
    title: `[Idempotency] Same GET request twice — ${step.name}`,
    description: 'Run same GET request twice. Responses must be identical.',
    suggestedRequest: req,
    expectedStatusCodes: [200],
    expectedBehavior: 'Both responses return identical data. GET is idempotent.',
    assertions: ['response1 === response2', 'status === 200 both times'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Idempotency',
    title: `[Idempotency] Same PUT request twice — ${step.name}`,
    description: 'Run same PUT request twice. Second request must not create a new resource.',
    suggestedRequest: { ...req, method: 'PUT' },
    expectedStatusCodes: [200],
    expectedBehavior: 'Second PUT returns same result, no duplicate created.',
    assertions: ['resource count unchanged after second PUT'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Idempotency',
    title: `[Idempotency] Idempotency-Key header — ${step.name}`,
    description: 'Send POST with Idempotency-Key header twice. Second must return cached result.',
    suggestedRequest: { ...req, headers: { ...req.headers, 'Idempotency-Key': 'idem-key-test-' + nanoid(6) } },
    expectedStatusCodes: [200, 201],
    expectedBehavior: 'Server honors Idempotency-Key and returns same result without duplicate action.',
    assertions: ['response1.id === response2.id', 'no duplicate resource'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── TOKEN LIFECYCLE ───────────────────────────────────────────────────────────

function generateTokenLifecycle(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Token Lifecycle',
    title: `[Token Lifecycle] Expired JWT token — ${step.name}`,
    description: 'Send request with an expired JWT. Expect 401.',
    suggestedRequest: { ...req, headers: { ...req.headers, Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIiwiZXhwIjoxfQ.expired' } },
    expectedStatusCodes: [401],
    expectedBehavior: 'Server detects token expiry and returns 401 with WWW-Authenticate header.',
    assertions: ['status === 401', 'response mentions "expired" or "token"'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Token Lifecycle',
    title: `[Token Lifecycle] Malformed JWT structure — ${step.name}`,
    description: 'Send JWT with only 2 parts instead of 3. Expect 401.',
    suggestedRequest: { ...req, headers: { ...req.headers, Authorization: 'Bearer header.payload' } },
    expectedStatusCodes: [401],
    expectedBehavior: 'Server rejects malformed token structure.',
    assertions: ['status === 401'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Token Lifecycle',
    title: `[Token Lifecycle] Token with tampered payload — ${step.name}`,
    description: 'Modify JWT payload to elevate role. Signature check must fail.',
    suggestedRequest: { ...req, headers: { ...req.headers, Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4ifQ.tampered_sig' } },
    expectedStatusCodes: [401],
    expectedBehavior: 'Server rejects token with invalid signature.',
    assertions: ['status === 401', 'signature verification failed'],
    severity: 'critical',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── UNICODE ───────────────────────────────────────────────────────────────────

function generateUnicode(step: ApiTestStep): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const req = baseReq(step);
  const body = parseBody(step);

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Unicode',
    title: `[Unicode] Emoji and special characters — ${step.name}`,
    description: 'Send string fields with emoji and special Unicode chars.',
    suggestedRequest: { ...req, body: { ...body, name: '🚀 Test 名前 العربية', description: '日本語テスト 한국어 тест' } },
    expectedStatusCodes: [200, 201, 400],
    expectedBehavior: 'Server stores and returns Unicode correctly, or rejects with clear error.',
    assertions: ['status !== 500', 'Unicode not corrupted in response'],
    severity: 'medium',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Unicode',
    title: `[Unicode] Null bytes and control characters — ${step.name}`,
    description: 'Inject null byte (\\u0000) and control chars into fields.',
    suggestedRequest: { ...req, body: { ...body, name: 'test injection', value: '' } },
    expectedStatusCodes: [400, 422],
    expectedBehavior: 'Server sanitizes or rejects null bytes and control characters.',
    assertions: ['status !== 500', 'no null byte in response'],
    severity: 'high',
    advisoryNote: ADVISORY,
  });

  cases.push({
    id: nanoid(8), stepId: step.id, stepName: step.name, category: 'Unicode',
    title: `[Unicode] Right-to-left text — ${step.name}`,
    description: 'Send Arabic/Hebrew RTL text in string fields.',
    suggestedRequest: { ...req, body: { ...body, name: 'مرحباً بالعالم', description: 'שלום עולם' } },
    expectedStatusCodes: [200, 201],
    expectedBehavior: 'Server stores and returns RTL text without corruption.',
    assertions: ['status in [200, 201]', 'RTL text preserved in response'],
    severity: 'low',
    advisoryNote: ADVISORY,
  });

  return cases;
}

// ── DISPATCHER ────────────────────────────────────────────────────────────────

const generators: Record<TestCategory, (step: ApiTestStep) => GeneratedTestCase[]> = {
  'Positive': generatePositive,
  'Negative': generateNegative,
  'Security': generateSecurity,
  'Edge': generateEdge,
  'Contract': generateContract,
  'Authorization': generateAuthorization,
  'Boundary': generateBoundary,
  'Business Rules': generateBusinessRules,
  'Content-Type': generateContentType,
  'Idempotency': generateIdempotency,
  'Token Lifecycle': generateTokenLifecycle,
  'Unicode': generateUnicode,
};

export function generateTestsByCategory(collection: ApiCollection, category: TestCategory): GeneratedTestSuite {
  const allCases: GeneratedTestCase[] = [];
  const generator = generators[category];
  if (!generator) {
    return { collectionId: collection.id, collectionName: collection.name, category, generatedAt: new Date().toISOString(), totalCases: 0, cases: [], advisoryNote: ADVISORY };
  }
  for (const step of (collection.steps || [])) {
    allCases.push(...generator(step));
  }
  return {
    collectionId: collection.id,
    collectionName: collection.name,
    category,
    generatedAt: new Date().toISOString(),
    totalCases: allCases.length,
    cases: allCases,
    advisoryNote: ADVISORY,
  };
}

export const ALL_TEST_CATEGORIES: TestCategory[] = [
  'Positive', 'Negative', 'Security', 'Edge', 'Contract',
  'Authorization', 'Boundary', 'Business Rules', 'Content-Type',
  'Idempotency', 'Token Lifecycle', 'Unicode',
];
