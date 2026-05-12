/**
 * import-engine/contracts.ts
 * Phase D Step 1 — Import pipeline public contracts.
 *
 * INVARIANTS:
 *   - All importers produce ImportResult; never mutate existing collections.
 *   - WorkflowEnvelope produced here is backward-compatible with legacy-adapter.
 *   - Auth metadata is always detection-only; no secrets are written.
 *   - Dependency hints are metadata only; DAG synthesis deferred to Phase D Step 2+.
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

// ── Import result ─────────────────────────────────────────────────────────────

export interface ImportWarning {
  code: string;
  message: string;
  /** operationId or path that triggered the warning */
  context?: string;
}

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
  /** Number of endpoints successfully mapped */
  endpointCount: number;
  /** Number of endpoints skipped (filtered by tag, unsupported method, etc.) */
  skippedCount: number;
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

export interface IImportEngine {
  /** Detect the format of raw spec content */
  detectFormat(content: string): SpecFormat;
  /** Import OpenAPI 3.x or Swagger 2.0 spec content */
  importOpenApi(specContent: string, options: ImportOptions): ImportResult;
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
}
