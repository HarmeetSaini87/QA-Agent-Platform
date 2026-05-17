/**
 * import-engine/compatibility-validator.ts
 * Phase D Step 2 — Shared compatibility validator for all ImportResult instances.
 *
 * USED BY: OpenAPI importer (Phase D Step 1) and Postman importer (Phase D Step 2).
 * One validation boundary for both importers — architectural decision from review.
 *
 * VALIDATES AGAINST:
 *   1. variable-engine   — all {{var}} references are valid template syntax
 *   2. assertion-engine  — all assertion operators are in the supported union
 *   3. workflow-engine   — dependsOn IDs exist; no circular references
 *   4. contract-engine   — openapiSpecId references are syntactically valid UUIDs
 *
 * INVARIANTS:
 *   - Never modifies the ImportResult — read-only validation.
 *   - Never throws — all issues returned as CompatibilityIssue[].
 *   - compatible=true if no 'error' severity issues exist (warnings are non-blocking).
 *   - unsupportedScriptWarnings and script counts populated from existing warnings array.
 *   - Designed to run after all mapping stages complete (NormalizationStage = 'WorkflowEnvelope').
 */

import type { ImportResult, CompatibilityReport, CompatibilityIssue, UnsupportedScriptWarning } from './contracts';
import type { ApiTestStep, ApiAssertion } from '../../data/types';

// ── Supported assertion operators (from ApiAssertion.operator union) ──────────

const SUPPORTED_OPERATORS = new Set([
  'eq', 'neq', 'equals', 'notEquals',
  'contains', 'notContains',
  'startsWith', 'endsWith',
  'gt', 'lt', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual',
  'exists', 'notExists',
  'matches',
  'isEmpty', 'isType', 'jsonSchemaValid',
]);

// ── Variable template syntax pattern ─────────────────────────────────────────

// Matches well-formed {{key}} or ${key} — same as variable-engine substitution
const VALID_VAR_RE = /^\{\{[A-Za-z0-9_.\-:$]+\}\}$|^\$\{[A-Za-z0-9_.\-:$]+\}$/;
// Detects malformed: {{ with no closing }}, nested braces, empty key
const MALFORMED_VAR_RE = /\{\{[^}]*$|\{\{\}\}/;

// ── Main entry ────────────────────────────────────────────────────────────────

export function validateCompatibility(result: ImportResult): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  const steps = result.collection.steps;

  // 1. Variable-engine compatibility
  const variableEngineCompatible = validateVariableEngine(steps, issues);

  // 2. Assertion-engine compatibility
  const assertionEngineCompatible = validateAssertionEngine(steps, issues);

  // 3. Workflow-engine compatibility (dependsOn graph)
  const workflowEngineCompatible = validateWorkflowEngine(steps, issues);

  // 4. Contract-engine compatibility (openapiSpecId syntax)
  const contractEngineCompatible = validateContractEngine(steps, issues);

  // 5. Extract script warnings from import warnings
  const unsupportedScriptWarnings = result.warnings.filter(
    (w): w is UnsupportedScriptWarning =>
      w.code === 'UNSUPPORTED_SCRIPT' ||
      w.code === 'UNSUPPORTED_PRE_REQUEST' ||
      w.code === 'PARTIAL_ASSERTION',
  );

  const unmappedScriptCount = result.warnings.filter(
    w => w.code === 'UNSUPPORTED_SCRIPT',
  ).length;

  const mappedAssertionCount = steps.reduce((sum, s) => sum + s.assertions.length, 0);

  const compatible = !issues.some(i => i.severity === 'error');

  return {
    compatible,
    issues,
    variableEngineCompatible,
    assertionEngineCompatible,
    workflowEngineCompatible,
    contractEngineCompatible,
    unsupportedScriptWarnings,
    unmappedScriptCount,
    mappedAssertionCount,
  };
}

// ── 1. Variable-engine validation ─────────────────────────────────────────────

function validateVariableEngine(steps: ApiTestStep[], issues: CompatibilityIssue[]): boolean {
  let ok = true;
  for (const step of steps) {
    const templates = collectTemplateStrings(step);
    for (const tpl of templates) {
      if (MALFORMED_VAR_RE.test(tpl)) {
        issues.push({
          severity: 'error',
          stepId: step.id,
          field: 'template',
          message: `Step '${step.name}': malformed variable template — unclosed or empty \`{{}}\` in: ${truncate(tpl, 60)}`,
        });
        ok = false;
      }
    }
  }
  return ok;
}

function collectTemplateStrings(step: ApiTestStep): string[] {
  const templates: string[] = [];
  const req = step.request;

  if (req.url) templates.push(req.url);

  if (req.headers) {
    for (const v of Object.values(req.headers)) templates.push(v);
  }
  if (req.queryParams) {
    for (const v of Object.values(req.queryParams)) templates.push(v);
  }
  if (typeof req.body === 'string') templates.push(req.body);
  if (req.body && typeof req.body === 'object') {
    templates.push(JSON.stringify(req.body));
  }

  for (const ext of step.extractVariables) {
    templates.push(ext.path);
  }

  return templates;
}

// ── 2. Assertion-engine validation ────────────────────────────────────────────

function validateAssertionEngine(steps: ApiTestStep[], issues: CompatibilityIssue[]): boolean {
  let ok = true;
  for (const step of steps) {
    for (const assertion of step.assertions) {
      if (!isValidAssertion(assertion)) {
        issues.push({
          severity: 'error',
          stepId: step.id,
          field: 'assertion.operator',
          message: `Step '${step.name}': unsupported assertion operator '${assertion.operator}' on field '${assertion.field}'`,
        });
        ok = false;
      }
      // field must be non-empty
      if (!assertion.field || assertion.field.trim() === '') {
        issues.push({
          severity: 'warning',
          stepId: step.id,
          field: 'assertion.field',
          message: `Step '${step.name}': assertion has empty field; will be skipped by assertion-engine`,
        });
      }
    }
  }
  return ok;
}

function isValidAssertion(a: ApiAssertion): boolean {
  return SUPPORTED_OPERATORS.has(a.operator);
}

// ── 3. Workflow-engine validation ─────────────────────────────────────────────

function validateWorkflowEngine(steps: ApiTestStep[], issues: CompatibilityIssue[]): boolean {
  let ok = true;
  const stepIds = new Set(steps.map(s => s.id));

  for (const step of steps) {
    for (const depId of step.dependsOn) {
      if (!stepIds.has(depId)) {
        issues.push({
          severity: 'error',
          stepId: step.id,
          field: 'dependsOn',
          message: `Step '${step.name}': dependsOn references unknown step ID '${depId}'`,
        });
        ok = false;
      }
    }
  }

  // Cycle detection via DFS
  if (ok && hasCycle(steps)) {
    issues.push({
      severity: 'error',
      field: 'dependsOn',
      message: 'Collection contains a circular dependency in dependsOn graph; workflow-engine cannot build DAG',
    });
    ok = false;
  }

  return ok;
}

function hasCycle(steps: ApiTestStep[]): boolean {
  const adj = new Map<string, string[]>();
  for (const s of steps) adj.set(s.id, s.dependsOn);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const s of steps) color.set(s.id, WHITE);

  function dfs(id: string): boolean {
    color.set(id, GRAY);
    for (const dep of (adj.get(id) ?? [])) {
      if (color.get(dep) === GRAY) return true; // back-edge = cycle
      if (color.get(dep) === WHITE && dfs(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const s of steps) {
    if (color.get(s.id) === WHITE && dfs(s.id)) return true;
  }
  return false;
}

// ── 4. Contract-engine validation ─────────────────────────────────────────────

// UUID v4 pattern — openapiSpecId must be a valid UUID if present
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateContractEngine(steps: ApiTestStep[], issues: CompatibilityIssue[]): boolean {
  let ok = true;
  for (const step of steps) {
    const specId = step.request.openapiSpecId;
    if (specId && !UUID_RE.test(specId)) {
      issues.push({
        severity: 'warning',
        stepId: step.id,
        field: 'request.openapiSpecId',
        message: `Step '${step.name}': openapiSpecId '${specId}' is not a valid UUID; contract-engine drift detection will be skipped`,
      });
      // warning only — does not block execution
    }
  }
  return ok;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
