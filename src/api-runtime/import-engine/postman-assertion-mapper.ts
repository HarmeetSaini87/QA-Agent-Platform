/**
 * import-engine/postman-assertion-mapper.ts
 * Phase D Step 2 — Map recognized Postman pm.test() script patterns into ApiAssertion[].
 *
 * INVARIANTS:
 *   - Only well-known, recognizable pm.test / pm.expect patterns are mapped.
 *   - NO pm API emulation. NO arbitrary JS execution. NO eval().
 *   - Unrecognized patterns are captured as UnsupportedScriptWarning with rawScript.
 *   - Partially recognized scripts produce both ApiAssertion[] AND UnsupportedScriptWarning.
 *   - assertion-engine and apiAssertions.ts are NEVER modified by this module.
 *   - Mapped assertions use only operator values from ApiAssertion.operator union.
 *
 * SUPPORTED PATTERNS (test-phase scripts):
 *   pm.response.to.have.status(N)          → { field:'status', operator:'equals', expected:N }
 *   pm.response.to.have.status("text")     → { field:'status', operator:'equals', expected:N } (text mapped)
 *   pm.expect(pm.response.code).to.equal(N)→ same
 *   pm.response.to.have.header("H")        → { field:'header.H', operator:'exists' }
 *   pm.response.to.have.header("H","V")    → { field:'header.H', operator:'equals', expected:"V" }
 *   pm.expect(jsonData.field).to.equal(V)  → { field:'$.field', operator:'equals', expected:V }
 *   pm.expect(jsonData.field).to.include(V)→ { field:'$.field', operator:'contains', expected:V }
 *   pm.expect(jsonData.field).to.exist     → { field:'$.field', operator:'exists' }
 *   pm.expect(jsonData.field).to.be.a("T") → { field:'$.field', operator:'isType', expected:T }
 *   pm.response.to.be.ok                   → { field:'status', operator:'lessThan', expected:400 }
 *   pm.response.responseTime.to.be.below(N)→ { field:'responseTime', operator:'lessThan', expected:N }
 *   pm.response.to.have.jsonBody(...)      → { field:'$.', operator:'exists' } (shallow check)
 *
 * UNSUPPORTED (captured as warnings, rawScript preserved):
 *   - pm.sendRequest()
 *   - pm.environment.set() / pm.globals.set()  (variable extractions — handled separately)
 *   - arbitrary JS logic (loops, conditionals, custom functions)
 *   - pm.test() with complex multi-line assertion bodies
 */

import type { ApiAssertion } from '../../data/types';
import type { UnsupportedScriptWarning } from './contracts';
import type { RawScript } from './postman-parser';

// ── Result ────────────────────────────────────────────────────────────────────

export interface AssertionMapResult {
  assertions: ApiAssertion[];
  unsupportedWarnings: UnsupportedScriptWarning[];
  /** Lines that were fully mapped (for metrics) */
  mappedCount: number;
  /** Lines that could not be mapped (for metrics) */
  unmappedCount: number;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function mapPostmanScriptsToAssertions(
  scripts: RawScript[],
  requestName: string,
): AssertionMapResult {
  const assertions: ApiAssertion[] = [];
  const unsupportedWarnings: UnsupportedScriptWarning[] = [];
  let mappedCount = 0;
  let unmappedCount = 0;

  for (const script of scripts) {
    if (script.disabled) continue;
    if (script.type !== 'test') {
      // pre-request scripts: metadata only — never mapped to assertions
      if (script.source.trim()) {
        unsupportedWarnings.push({
          code: 'UNSUPPORTED_PRE_REQUEST',
          severity: 'info',
          message: `Pre-request script in '${requestName}' captured as metadata only; not executed at import time`,
          context: requestName,
          scriptType: 'prerequest',
          rawScript: script.source,
          partiallyExtracted: [],
        });
      }
      continue;
    }

    const lines = script.source.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
    const partiallyExtracted: string[] = [];

    for (const line of lines) {
      const result = tryMapLine(line);
      if (result.kind === 'mapped') {
        assertions.push(result.assertion);
        partiallyExtracted.push(line);
        mappedCount++;
      } else if (result.kind === 'skip') {
        // blank/comment/non-assertion line — no warning needed
      } else {
        // unmapped — emit warning with raw line
        unmappedCount++;
        unsupportedWarnings.push({
          code: result.partial ? 'PARTIAL_ASSERTION' : 'UNSUPPORTED_SCRIPT',
          severity: result.partial ? 'warning' : 'info',
          message: result.partial
            ? `Script line in '${requestName}' partially recognized but not fully mappable: ${truncate(line, 80)}`
            : `Script line in '${requestName}' not mappable to assertion: ${truncate(line, 80)}`,
          context: requestName,
          scriptType: 'test',
          rawScript: line,
          partiallyExtracted,
        });
      }
    }
  }

  return { assertions, unsupportedWarnings, mappedCount, unmappedCount };
}

// ── Line classifier ───────────────────────────────────────────────────────────

type MapLineResult =
  | { kind: 'mapped'; assertion: ApiAssertion }
  | { kind: 'skip' }
  | { kind: 'unmatched'; partial: boolean };

function tryMapLine(line: string): MapLineResult {
  // Skip: pm.test() wrapper lines, variable declarations, blank
  if (!line || SKIP_PATTERNS.some(p => p.test(line))) {
    return { kind: 'skip' };
  }

  // pm.response.to.have.status(N)
  const statusNum = line.match(/pm\.response\.to\.have\.status\s*\(\s*(\d+)\s*\)/);
  if (statusNum) {
    return { kind: 'mapped', assertion: statusAssertion(parseInt(statusNum[1], 10)) };
  }

  // pm.response.to.have.status("text") — e.g. "OK", "Created"
  const statusText = line.match(/pm\.response\.to\.have\.status\s*\(\s*["']([^"']+)["']\s*\)/);
  if (statusText) {
    const code = HTTP_STATUS_TEXT_MAP[statusText[1].toUpperCase()];
    if (code) return { kind: 'mapped', assertion: statusAssertion(code) };
    return { kind: 'unmatched', partial: true };
  }

  // pm.expect(pm.response.code).to.equal(N) or .eql(N)
  const responseCode = line.match(/pm\.expect\s*\(\s*pm\.response\.code\s*\)\s*\.to\s*\.eql?\s*\(\s*(\d+)\s*\)/);
  if (responseCode) {
    return { kind: 'mapped', assertion: statusAssertion(parseInt(responseCode[1], 10)) };
  }

  // pm.response.to.be.ok  (any 2xx)
  if (/pm\.response\.to\.be\.ok\b/.test(line)) {
    return { kind: 'mapped', assertion: { field: 'status', operator: 'lessThan', expected: 400, severity: 'high' } };
  }

  // pm.response.responseTime.to.be.below(N)
  const rtBelow = line.match(/pm\.response\.responseTime\.to\.be\.below\s*\(\s*(\d+)\s*\)/);
  if (rtBelow) {
    return { kind: 'mapped', assertion: { field: 'responseTime', operator: 'lessThan', expected: parseInt(rtBelow[1], 10), severity: 'soft' } };
  }

  // pm.response.to.have.header("Name")
  const headerExists = line.match(/pm\.response\.to\.have\.header\s*\(\s*["']([^"']+)["']\s*\)/);
  if (headerExists) {
    return { kind: 'mapped', assertion: { field: `header.${headerExists[1]}`, operator: 'exists', expected: '', severity: 'soft' } };
  }

  // pm.response.to.have.header("Name", "Value")
  const headerValue = line.match(/pm\.response\.to\.have\.header\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/);
  if (headerValue) {
    return { kind: 'mapped', assertion: { field: `header.${headerValue[1]}`, operator: 'equals', expected: headerValue[2], severity: 'soft' } };
  }

  // pm.response.to.have.jsonBody() — shallow "body is parseable JSON" check
  if (/pm\.response\.to\.have\.jsonBody\s*\(/.test(line)) {
    return { kind: 'mapped', assertion: { field: '$.', operator: 'exists', expected: '', severity: 'soft' } };
  }

  // pm.expect(jsonData.FIELD).to.equal("VALUE") or .eql("VALUE")
  const jsonEqual = line.match(/pm\.expect\s*\(\s*(?:jsonData|responseJson|res|body|data)\.([A-Za-z0-9_.[\]]+)\s*\)\s*\.to\s*\.(?:eql?|equals?)\s*\(\s*(.+?)\s*\)\s*;?\s*$/);
  if (jsonEqual) {
    const field = `$.${jsonEqual[1]}`;
    const expected = parseExpectedValue(jsonEqual[2]);
    if (expected !== undefined) {
      return { kind: 'mapped', assertion: { field, operator: 'equals', expected, severity: 'soft' } };
    }
    return { kind: 'unmatched', partial: true };
  }

  // pm.expect(jsonData.FIELD).to.include("VALUE")
  const jsonInclude = line.match(/pm\.expect\s*\(\s*(?:jsonData|responseJson|res|body|data)\.([A-Za-z0-9_.[\]]+)\s*\)\s*\.to\s*\.include\s*\(\s*(.+?)\s*\)\s*;?\s*$/);
  if (jsonInclude) {
    const field = `$.${jsonInclude[1]}`;
    const expected = parseExpectedValue(jsonInclude[2]);
    if (expected !== undefined) {
      return { kind: 'mapped', assertion: { field, operator: 'contains', expected: String(expected), severity: 'soft' } };
    }
    return { kind: 'unmatched', partial: true };
  }

  // pm.expect(jsonData.FIELD).to.exist  (no parens — property access)
  const jsonExists = line.match(/pm\.expect\s*\(\s*(?:jsonData|responseJson|res|body|data)\.([A-Za-z0-9_.[\]]+)\s*\)\s*\.to\s*\.exist\b/);
  if (jsonExists) {
    return { kind: 'mapped', assertion: { field: `$.${jsonExists[1]}`, operator: 'exists', expected: '', severity: 'soft' } };
  }

  // pm.expect(jsonData.FIELD).to.be.a("type")
  const jsonType = line.match(/pm\.expect\s*\(\s*(?:jsonData|responseJson|res|body|data)\.([A-Za-z0-9_.[\]]+)\s*\)\s*\.to\s*\.be\.a\s*\(\s*["']([^"']+)["']\s*\)/);
  if (jsonType) {
    const jsType = jsonType[2].toLowerCase();
    const engineType = JS_TYPE_MAP[jsType] ?? jsType;
    return { kind: 'mapped', assertion: { field: `$.${jsonType[1]}`, operator: 'isType', expected: engineType, severity: 'soft' } };
  }

  // pm.expect(jsonData.FIELD).to.be.above(N) / below(N)
  const jsonAbove = line.match(/pm\.expect\s*\(\s*(?:jsonData|responseJson|res|body|data)\.([A-Za-z0-9_.[\]]+)\s*\)\s*\.to\s*\.be\.above\s*\(\s*(\d+(?:\.\d+)?)\s*\)/);
  if (jsonAbove) {
    return { kind: 'mapped', assertion: { field: `$.${jsonAbove[1]}`, operator: 'greaterThan', expected: parseFloat(jsonAbove[2]), severity: 'soft' } };
  }

  const jsonBelow = line.match(/pm\.expect\s*\(\s*(?:jsonData|responseJson|res|body|data)\.([A-Za-z0-9_.[\]]+)\s*\)\s*\.to\.be\.below\s*\(\s*(\d+(?:\.\d+)?)\s*\)/);
  if (jsonBelow) {
    return { kind: 'mapped', assertion: { field: `$.${jsonBelow[1]}`, operator: 'lessThan', expected: parseFloat(jsonBelow[2]), severity: 'soft' } };
  }

  // pm.environment.set / pm.globals.set / pm.collectionVariables.set — variable extraction, not assertion
  if (/pm\.(environment|globals|collectionVariables|variables)\.set\s*\(/.test(line)) {
    return { kind: 'skip' }; // handled by variable-extractor, not here
  }

  // pm.sendRequest — async side-effect, never mappable
  if (/pm\.sendRequest\s*\(/.test(line)) {
    return { kind: 'unmatched', partial: false };
  }

  // lines that look like pm.test/pm.expect wrappers but aren't matched above
  if (/pm\.(test|expect|response|request)\b/.test(line)) {
    return { kind: 'unmatched', partial: true };
  }

  // Other JS (variable declarations, logic) — skip silently
  return { kind: 'skip' };
}

// ── Skip pattern list ─────────────────────────────────────────────────────────

const SKIP_PATTERNS: RegExp[] = [
  /^pm\.test\s*\(\s*["']/, // pm.test("...", function() { — wrapper line
  /^\}\s*\)\s*;?\s*$/,     // closing }); of pm.test block
  /^var\s+|^let\s+|^const\s+/, // variable declarations
  /^\/\//, // comment lines
  /^console\./, // console.log etc.
];

// ── HTTP status text → code map ───────────────────────────────────────────────

const HTTP_STATUS_TEXT_MAP: Record<string, number> = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  'NO CONTENT': 204,
  'BAD REQUEST': 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  'NOT FOUND': 404,
  'UNPROCESSABLE ENTITY': 422,
  'TOO MANY REQUESTS': 429,
  'INTERNAL SERVER ERROR': 500,
  'SERVICE UNAVAILABLE': 503,
};

// ── JS type → engine type map ─────────────────────────────────────────────────

const JS_TYPE_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  null: 'null',
  undefined: 'string', // degrade gracefully
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusAssertion(code: number): ApiAssertion {
  return { field: 'status', operator: 'equals', expected: code, severity: 'high' };
}

function parseExpectedValue(raw: string): string | number | boolean | undefined {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return 'null';
  const n = Number(s);
  if (!isNaN(n) && s !== '') return n;
  // Complex expression — not parseable statically
  return undefined;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
