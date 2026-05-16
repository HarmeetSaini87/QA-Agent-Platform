/**
 * import-engine/contracts.ts
 * Phase D Step 1 — Import pipeline public contracts.
 * Phase D Step 2 — Extended with Postman import contracts, ImportWarning model,
 *                  NormalizationStage, UnsupportedScriptWarning, source metadata.
 *
 * INVARIANTS:
 *   - All importers produce ImportResult; never mutate existing collections.
 *   - WorkflowEnvelope produced here is backward-compatible with legacy-adapter.
 *   - Auth metadata is always detection-only; no secrets are written.
 *   - Dependency hints are metadata only; DAG synthesis deferred to Phase D Step 2+.
 *   - Postman script parsing is metadata-only; no JS execution or pm API emulation.
 */

import type { ApiCollection, ApiTestStep } from '../../data/types';
import type { WorkflowEnvelope, WorkflowSource } from '../../shared-core/contracts/workflow.contract';

// ── Spec version discriminator ────────────────────────────────────────────────

export type SpecFormat = 'openapi3' | 'swagger2' | 'postman' | 'curl' | 'unknown';

// ── Auth metadata (detection only — no secrets) ───────────────────────────────

export type AuthSchemeKind =
  | 'bearer'
  | 'apiKey'
  | 'basic'
  | 'oauth2'
  | 'openIdConnect'
  | 'none'
  | 'unknown';

export interface DetectedAuthScheme {
  kind: AuthSchemeKind;
  /** Security scheme name as declared in spec */
  schemeName: string;
  /** Header/query param name for apiKey schemes */
  paramName?: string;
  /** Token URL for oauth2 flows */
  tokenUrl?: string;
  /** Scopes declared in spec */
  scopes?: string[];
  /** Which step IDs reference this scheme */
  appliedToStepIds: string[];
}

export interface AuthMetadata {
  schemes: DetectedAuthScheme[];
  /** True if any step has operation-level security override */
  hasOperationLevelOverride: boolean;
  /** Global scheme names applied to all operations unless overridden */
  globalSchemeNames: string[];
}

// ── Normalized request model ──────────────────────────────────────────────────

export type NormalizedMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface NormalizedParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  /** Placeholder variable name for runtime substitution: {{paramName}} */
  variablePlaceholder: string;
  schema?: NormalizedSchema;
}

export interface NormalizedSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  format?: string;
  properties?: Record<string, NormalizedSchema>;
  items?: NormalizedSchema;
  required?: string[];
  enum?: unknown[];
  example?: unknown;
  /** Preserved for contract-engine AJV validation */
  raw?: Record<string, unknown>;
}

export interface NormalizedRequestBody {
  contentType: string;
  schema?: NormalizedSchema;
  example?: unknown;
}

export interface NormalizedResponse {
  statusCode: number | 'default';
  description?: string;
  contentType?: string;
  schema?: NormalizedSchema;
}

export interface NormalizedEndpoint {
  /** Full URL with path params substituted as {{paramName}} */
  url: string;
  method: NormalizedMethod;
  operationId: string;
  tags: string[];
  parameters: NormalizedParameter[];
  requestBody?: NormalizedRequestBody;
  responses: NormalizedResponse[];
  /** Security scheme names declared on this operation */
  securitySchemeNames: string[];
  /** Summary/description from spec */
  summary?: string;
  description?: string;
}

// ── Dependency detection hints (metadata only — no DAG synthesis) ─────────────

export type DependencyHintKind =
  | 'crud-resource'     // GET /pets → POST /pets likely creates same resource
  | 'id-producer'       // step extracts an ID field used by sibling steps
  | 'id-consumer'       // step URL/body references an ID likely from another step
  | 'shared-entity'     // steps reference the same entity type
  | 'sequential-tag';   // steps share a tag suggesting ordered workflow

export interface DependencyHint {
  kind: DependencyHintKind;
  producerOperationId: string;
  consumerOperationId: string;
  /** Field or param name that creates the link (e.g. 'petId', 'id') */
  linkField?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DependencyDetectionResult {
  hints: DependencyHint[];
  /** Entity names extracted from paths (e.g. 'pet', 'user', 'order') */
  detectedEntities: string[];
  /** operationId → entity names it touches */
  operationEntityMap: Record<string, string[]>;
}

// ── Import warnings ───────────────────────────────────────────────────────────

/**
 * Warning severity levels — used in enterprise UX to triage import issues.
 *   info     = cosmetic difference, no runtime impact
 *   warning  = partial normalization, feature degrades gracefully
 *   critical = assertion/auth/variable will not execute correctly
 */
export type ImportWarningSeverity = 'info' | 'warning' | 'critical';

/**
 * Warning codes — stable identifiers for UX filtering and telemetry.
 * Phase D Step 1 codes (OpenAPI):
 *   NO_SERVER_URL, NO_HOST, EXTERNAL_PARAM_REF, UNKNOWN_AUTH_TYPE
 * Phase D Step 2 codes (Postman):
 *   UNSUPPORTED_SCRIPT        — pm.test/pre-request script not parseable into assertions
 *   UNSUPPORTED_AUTH          — PM auth type has no ApiAuthConfig mapping
 *   PARTIAL_ASSERTION         — script pattern recognized but incompletely mapped
 *   UNSUPPORTED_PRE_REQUEST   — pre-request script captured as metadata only
 *   UNKNOWN_PM_FEATURE        — PM collection uses a feature not yet supported
 *   PM_VARIABLE_UNRESOLVABLE  — PM variable reference present but no value in scope
 *   FOLDER_DEPTH_EXCEEDED     — folder nesting depth > MAX_FOLDER_DEPTH (flattened)
 */
export type ImportWarningCode =
  // OpenAPI (Phase D Step 1)
  | 'NO_SERVER_URL'
  | 'NO_HOST'
  | 'EXTERNAL_PARAM_REF'
  | 'UNKNOWN_AUTH_TYPE'
  // Postman (Phase D Step 2)
  | 'UNSUPPORTED_SCRIPT'
  | 'UNSUPPORTED_AUTH'
  | 'PARTIAL_ASSERTION'
  | 'UNSUPPORTED_PRE_REQUEST'
  | 'UNKNOWN_PM_FEATURE'
  | 'PM_VARIABLE_UNRESOLVABLE'
  | 'FOLDER_DEPTH_EXCEEDED';

export interface ImportWarning {
  code: ImportWarningCode | string; // string fallback for forward-compat
  severity: ImportWarningSeverity;
  message: string;
  /** operationId, request name, or folder path that triggered the warning */
  context?: string;
}

/**
 * Specialized warning for unsupported PM script content.
 * Carries the raw script fragment for future AI-assisted normalization.
 */
export interface UnsupportedScriptWarning extends ImportWarning {
  code: 'UNSUPPORTED_SCRIPT' | 'UNSUPPORTED_PRE_REQUEST' | 'PARTIAL_ASSERTION';
  scriptType: 'test' | 'prerequest';
  /** Raw script source — preserved for future AI/manual correction */
  rawScript: string;
  /** Patterns that were successfully extracted before giving up */
  partiallyExtracted: string[];
}

// ── Normalization pipeline stage tracker ─────────────────────────────────────

/**
 * NormalizationStage — tracks which pipeline stages have completed.
 * Used for debugging import issues, RCA, and future AI-assisted correction.
 *
 * Stages are additive — a result at 'CompatibilityValidated' has passed all prior stages.
 */
export type NormalizationStage =
  | 'Raw'                   // raw bytes received
  | 'Parsed'                // structure parsed into intermediate model
  | 'Normalized'            // mapped to WorkflowEnvelope-compatible types
  | 'WorkflowEnvelope'      // wrapped in WorkflowEnvelope with source metadata
  | 'CompatibilityValidated'; // validated against all 4 engines

export interface NormalizationTrace {
  stages: NormalizationStage[];
  completedAt: string; // ISO timestamp of last completed stage
  /** Warnings emitted per stage */
  stageWarnings: Partial<Record<NormalizationStage, ImportWarning[]>>;
}

// ── Stable source metadata ────────────────────────────────────────────────────

export type ImportSourceType = 'openapi3' | 'swagger2' | 'postman_v2' | 'postman_v2_1' | 'curl';

export interface ImportSourceMetadata {
  type: ImportSourceType;
  /** Postman schema URL (e.g. "https://schema.getpostman.com/json/collection/v2.1.0/collection.json") */
  schemaUrl?: string;
  /** Postman collection._postman_id */
  originalCollectionId?: string;
  /** Collection name as declared in source */
  originalName?: string;
  /** Number of folders in source (Postman only) */
  folderCount?: number;
  /** Total items including nested (Postman only) */
  totalItemCount?: number;
}

// ── Import result ─────────────────────────────────────────────────────────────

export interface ImportResult {
  /** Produced collection — always backward-compatible with existing runtime */
  collection: ApiCollection;
  /** WorkflowEnvelope wrapping the collection — source metadata attached */
  envelope: WorkflowEnvelope;
  /** Detected auth metadata — never contains secrets */
  authMetadata: AuthMetadata;
  /** Dependency hints for future DAG suggestion */
  dependencyHints: DependencyDetectionResult;
  /** Non-fatal issues during import */
  warnings: ImportWarning[];
  /** Format detected from spec content */
  format: SpecFormat;
  /** Number of endpoints/requests successfully mapped */
  endpointCount: number;
  /** Number of endpoints/requests skipped (filtered by tag, unsupported method, disabled, etc.) */
  skippedCount: number;
  /** Stable source provenance — present for all importers */
  sourceMetadata: ImportSourceMetadata;
  /** Normalization pipeline trace — present after CompatibilityValidated stage */
  normalizationTrace?: NormalizationTrace;
}

// ── Importer interface ────────────────────────────────────────────────────────

export interface ImportOptions {
  /** Filter by OpenAPI tag */
  tag?: string;
  /** Include request body examples in generated steps */
  includeExamples?: boolean;
  /** Target environment ID for the produced collection */
  environmentId: string;
  /** Project ID for the produced collection */
  projectId?: string;
  /** Execution mode for produced collection */
  executionMode?: 'sequential' | 'parallel' | 'dag';
  /** Override collection name */
  collectionName?: string;
  /** Attach openapiSpecId for contract-engine drift detection */
  openapiSpecId?: string;
}

export interface PostmanImportOptions {
  /** Target environment ID for the produced collection */
  environmentId: string;
  /** Project ID for the produced collection */
  projectId?: string;
  /** Override collection name */
  collectionName?: string;
  /** Execution mode for produced collection */
  executionMode?: 'sequential' | 'parallel' | 'dag';
  /**
   * Include disabled items as steps with condition='false'.
   * Default: true (preserves intent; scheduler skips them at runtime).
   */
  includeDisabled?: boolean;
  /**
   * Maximum folder nesting depth to flatten.
   * Deeper nesting is flattened with a warning.
   * Default: 10.
   */
  maxFolderDepth?: number;
  /**
   * Preserve folder hierarchy as group metadata on WorkflowNode.
   * Default: true — always preserve for future graph/AI use.
   */
  preserveFolderHierarchy?: boolean;
}

export interface IImportEngine {
  /** Detect the format of raw spec content */
  detectFormat(content: string): SpecFormat;
  /** Import OpenAPI 3.x or Swagger 2.0 spec content */
  importOpenApi(specContent: string, options: ImportOptions): ImportResult;
  /**
   * Import Postman Collection v2.0 or v2.1 JSON.
   * Produces the same ImportResult shape as importOpenApi — unified pipeline.
   * DOES NOT execute or emulate PM scripts — unsupported scripts emit warnings only.
   */
  importPostman(collectionJson: string, options: PostmanImportOptions): ImportResult;
  /** Validate that an ImportResult collection is runtime-compatible */
  validateCompatibility(result: ImportResult): CompatibilityReport;
}

// ── Compatibility report ──────────────────────────────────────────────────────

export interface CompatibilityIssue {
  severity: 'error' | 'warning';
  stepId?: string;
  field: string;
  message: string;
}

export interface CompatibilityReport {
  compatible: boolean;
  issues: CompatibilityIssue[];
  /** True if all steps can execute with existing variable-engine */
  variableEngineCompatible: boolean;
  /** True if all assertions use supported operators */
  assertionEngineCompatible: boolean;
  /** True if workflow-engine can build valid DAG */
  workflowEngineCompatible: boolean;
  /** True if contract-engine can validate responses */
  contractEngineCompatible: boolean;
  /**
   * Unsupported script warnings — Postman only.
   * Scripts captured here are metadata-only; they do NOT block execution.
   * enterprise UX can surface these for manual review.
   */
  unsupportedScriptWarnings: UnsupportedScriptWarning[];
  /** Count of PM test scripts that could NOT be mapped to any assertion */
  unmappedScriptCount: number;
  /** Count of PM test scripts fully mapped to ApiAssertion[] */
  mappedAssertionCount: number;
}

// ── Phase D Step 4: Re-exports from workflow.contract for import-engine consumers ──
export type {
  FolderNode,
  WorkflowGraphHints,
  WorkflowAiReadiness,
  WorkflowNormalizationSource,
} from '../../shared-core/contracts/workflow.contract';
export { DEFAULT_MAX_FOLDER_DEPTH } from '../../shared-core/contracts/workflow.contract';
