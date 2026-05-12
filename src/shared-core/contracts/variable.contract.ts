/**
 * variable.contract.ts
 * Contracts for the variable resolution engine.
 *
 * Mirrors existing VariableContext from apiVariables.ts — no change to that file.
 * All new types are ADDITIVE — existing variable system is unchanged.
 */

// ── Core types ────────────────────────────────────────────────────────────────

/** Flat resolved variable map — same shape as existing VariableContext */
export type VariableMap = Record<string, string>;

/**
 * Variable scope hierarchy — resolved in this order (lower index wins):
 *   runtime > request > workflow > collection > environment > project > global
 * Higher-specificity scopes override lower ones.
 */
export type VariableScope =
  | 'global'       // platform-wide defaults
  | 'project'      // project-level shared variables
  | 'environment'  // ApiEnvironment.variables
  | 'collection'   // ApiCollection.variables
  | 'workflow'     // WorkflowEnvelope-level overrides (Phase B)
  | 'request'      // ApiTestStep-level overrides
  | 'runtime';     // extracted at runtime from responses

// ── Variable definition (static, design-time) ─────────────────────────────────

/** A variable as defined at design time — not yet resolved to a value */
export interface VariableDefinition {
  key: string;
  /** Default value or template string e.g. "{{base_url}}/api" */
  defaultValue?: string;
  scope: VariableScope;
  sensitive: boolean;
  /** Human description shown in Variable Explorer (Phase D UI) */
  description?: string;
  /** If true, resolution fails when this variable is missing — no silent empty string */
  required?: boolean;
}

// ── Scoped variable (runtime value at a specific scope) ───────────────────────

export interface ScopedVariable {
  key: string;
  value: string;
  scope: VariableScope;
  sensitive?: boolean;
}

// ── Extraction — mirrors ApiVariableExtraction from data/types ────────────────

export type ExtractionSource = 'responseBody' | 'responseHeader' | 'statusCode';

export interface VariableExtractionSpec {
  name: string;
  source: ExtractionSource;
  /** JSONPath, header name, or regex depending on source */
  path: string;
  scope: VariableScope;
  /** If true, extraction failure is a hard error (default: false = silent skip) */
  required?: boolean;
}

export interface VariableExtractionResult {
  spec: VariableExtractionSpec;
  success: boolean;
  value?: string;
  /** Populated when success=false */
  error?: string;
  extractedAt: string;
}

// ── Resolution result ─────────────────────────────────────────────────────────

export interface VariableResolutionResult {
  resolved: VariableMap;
  /** Keys that referenced undefined variables — templates with {{missing}} */
  unresolved: string[];
  /** Keys where two scopes provided different values */
  conflicts: Array<{ key: string; scopeA: VariableScope; scopeB: VariableScope; valueA: string; valueB: string }>;
  /** Which scope each key was resolved from — for Variable Explorer UI */
  sourceMap: Record<string, VariableScope>;
}

// ── Runtime variable state — full snapshot at a point in execution ────────────

export interface RuntimeVariableState {
  /** ISO timestamp of this snapshot */
  capturedAt: string;
  /** Node/step ID after which this snapshot was taken */
  afterNodeId: string;
  /** Full resolved context at this point */
  context: VariableMap;
  /** Which variables were extracted in this step */
  extractedThisStep: VariableExtractionResult[];
  /** Variables that changed value vs previous snapshot */
  changedKeys: string[];
}

// ── Engine contract ───────────────────────────────────────────────────────────

/** Contract for the variable-engine module (Phase B implementation target) */
export interface IVariableEngine {
  resolve(scopes: ScopedVariable[]): VariableResolutionResult;
  substitute(template: string, context: VariableMap): string;
  extract(spec: VariableExtractionSpec, response: unknown): VariableExtractionResult;
  snapshot(context: VariableMap, afterNodeId: string): RuntimeVariableState;
  merge(base: VariableMap, overlay: VariableMap): VariableMap;
}
