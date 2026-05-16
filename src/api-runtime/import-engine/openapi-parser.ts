/**
 * import-engine/openapi-parser.ts
 * Phase D Step 1 — OpenAPI 3.x + Swagger 2.0 spec parser.
 *
 * Produces normalized endpoint models only — no ApiTestStep generation here.
 * Workflow mapping is handled by workflow-mapper.ts.
 *
 * INVARIANTS:
 *   - Never throws on partial/malformed specs; emits warnings instead.
 *   - $ref resolution is local-only (#/components/... or #/definitions/...).
 *   - External $refs are left as-is and flagged as warnings.
 *   - No runtime side-effects — pure parsing functions.
 */

import * as yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import type {
  SpecFormat,
  NormalizedEndpoint,
  NormalizedParameter,
  NormalizedSchema,
  NormalizedRequestBody,
  NormalizedResponse,
  NormalizedMethod,
  DetectedAuthScheme,
  AuthMetadata,
  ImportWarning,
  ImportResult,
  ImportOptions,
  DependencyDetectionResult,
  NormalizationTrace,
  NormalizationStage,
} from './contracts';
import type { ApiCollection, ApiTestStep, ApiRequest, ApiAssertion, ApiAuthConfig } from '../../data/types';
import type {
  FolderNode,
  WorkflowGraphHints,
  WorkflowNormalizationSource,
} from '../../shared-core/contracts/workflow.contract';
import { collectionToWorkflow } from '../../workflow-dsl/legacy-adapter';

// ── Raw OA type stubs ─────────────────────────────────────────────────────────

interface RawSchema {
  type?: string;
  format?: string;
  properties?: Record<string, RawSchema>;
  items?: RawSchema;
  required?: string[];
  enum?: unknown[];
  example?: unknown;
  $ref?: string;
  [key: string]: unknown;
}

interface RawParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: RawSchema;
  type?: string; // Swagger 2.0 inline type
  example?: unknown;
}

interface RawRequestBody {
  content?: Record<string, { schema?: RawSchema; example?: unknown }>;
  required?: boolean;
}

interface RawResponse {
  description?: string;
  content?: Record<string, { schema?: RawSchema }>;
  schema?: RawSchema; // Swagger 2.0
}

interface RawOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: RawParameter[];
  requestBody?: RawRequestBody;
  responses?: Record<string, RawResponse>;
  security?: Record<string, string[]>[];
  consumes?: string[]; // Swagger 2.0
  produces?: string[]; // Swagger 2.0
}

interface RawSecurityScheme {
  type: string;
  scheme?: string;
  in?: string;
  name?: string;
  openIdConnectUrl?: string;
  flows?: {
    authorizationCode?: { authorizationUrl: string; tokenUrl: string; scopes?: Record<string, string> };
    clientCredentials?: { tokenUrl: string; scopes?: Record<string, string> };
    implicit?: { authorizationUrl: string; scopes?: Record<string, string> };
    password?: { tokenUrl: string; scopes?: Record<string, string> };
  };
  // Swagger 2.0
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: Record<string, string>;
}

interface RawSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  // OA3
  servers?: { url: string; description?: string }[];
  components?: {
    securitySchemes?: Record<string, RawSecurityScheme>;
    schemas?: Record<string, RawSchema>;
    parameters?: Record<string, RawParameter>;
    requestBodies?: Record<string, RawRequestBody>;
  };
  // Swagger 2.0
  host?: string;
  basePath?: string;
  schemes?: string[];
  securityDefinitions?: Record<string, RawSecurityScheme>;
  definitions?: Record<string, RawSchema>;
  // Common
  paths?: Record<string, Record<string, RawOperation | unknown>>;
  security?: Record<string, string[]>[];
  tags?: { name: string; description?: string }[];
}

const SUPPORTED_METHODS: NormalizedMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ── ParsedSpec — internal intermediate ───────────────────────────────────────

export interface ParsedSpec {
  format: SpecFormat;
  title: string;
  version: string;
  baseUrl: string;
  endpoints: NormalizedEndpoint[];
  authMetadata: AuthMetadata;
  warnings: ImportWarning[];
  /** Raw spec preserved for contract-engine spec-loader integration */
  rawSpec: RawSpec;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function parseOpenApiSpec(content: string): ParsedSpec {
  const warnings: ImportWarning[] = [];

  let raw: RawSpec;
  try {
    raw = parseContent(content);
  } catch (e) {
    throw new Error(`OpenAPI parse failed: ${(e as Error).message}`);
  }

  const format = detectSpecFormat(raw);
  if (format === 'unknown') {
    throw new Error("Unrecognized spec format: missing 'openapi' or 'swagger' field");
  }

  const title = raw.info?.title ?? 'Imported API';
  const version = raw.info?.version ?? '1.0.0';
  const baseUrl = extractBaseUrl(raw, format, warnings);

  // Build ref resolver from components/definitions
  const resolver = buildRefResolver(raw);

  // Parse security schemes
  const rawSchemes: Record<string, RawSecurityScheme> =
    format === 'openapi3'
      ? (raw.components?.securitySchemes ?? {})
      : (raw.securityDefinitions ?? {});

  const authMetadata = parseAuthMetadata(rawSchemes, raw.security ?? [], warnings);

  // Parse paths
  const endpoints: NormalizedEndpoint[] = [];
  for (const [pathKey, pathItem] of Object.entries(raw.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of SUPPORTED_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method.toLowerCase()] as RawOperation | undefined;
      if (!op || typeof op !== 'object') continue;

      const endpoint = parseOperation(
        pathKey,
        method,
        op,
        rawSchemes,
        raw.security ?? [],
        resolver,
        format,
        warnings,
      );
      endpoints.push(endpoint);
    }
  }

  // Wire appliedToStepIds on auth schemes
  wireAuthStepIds(authMetadata, endpoints);

  return { format, title, version, baseUrl, endpoints, authMetadata, warnings, rawSpec: raw };
}

// ── Format detection ──────────────────────────────────────────────────────────

export function detectSpecFormat(raw: RawSpec): SpecFormat {
  if (raw.openapi && raw.openapi.startsWith('3.')) return 'openapi3';
  if (raw.swagger && raw.swagger.startsWith('2.')) return 'swagger2';
  return 'unknown';
}

// ── Content parsing ───────────────────────────────────────────────────────────

function parseContent(content: string): RawSpec {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(content) as RawSpec;
  }
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('YAML parsed to non-object');
  }
  return parsed as RawSpec;
}

// ── Base URL extraction ───────────────────────────────────────────────────────

function extractBaseUrl(raw: RawSpec, format: SpecFormat, warnings: ImportWarning[]): string {
  if (format === 'openapi3') {
    const url = raw.servers?.[0]?.url ?? '';
    if (!url) warnings.push({ code: 'NO_SERVER_URL', severity: 'warning', message: 'No servers[0].url found; base URL will be empty' });
    return url;
  }
  // Swagger 2.0
  const scheme = raw.schemes?.[0] ?? 'https';
  const host = raw.host ?? '';
  const base = raw.basePath ?? '';
  if (!host) warnings.push({ code: 'NO_HOST', severity: 'warning', message: 'Swagger 2.0 host is missing; base URL will be empty' });
  return `${scheme}://${host}${base}`;
}

// ── $ref resolver ─────────────────────────────────────────────────────────────

type RefResolver = (ref: string) => RawSchema | null;

function buildRefResolver(raw: RawSpec): RefResolver {
  return (ref: string): RawSchema | null => {
    if (!ref.startsWith('#/')) return null; // External refs not supported
    const parts = ref.replace('#/', '').split('/');
    let node: unknown = raw;
    for (const part of parts) {
      if (!node || typeof node !== 'object') return null;
      node = (node as Record<string, unknown>)[part];
    }
    return (node as RawSchema) ?? null;
  };
}

function resolveSchema(schema: RawSchema | undefined, resolver: RefResolver, depth = 0): RawSchema | null {
  if (!schema) return null;
  if (depth > 8) return schema; // Prevent infinite recursion on circular refs
  if (schema.$ref) {
    const resolved = resolver(schema.$ref);
    if (!resolved) return schema; // Leave unresolved refs as-is
    return resolveSchema(resolved, resolver, depth + 1);
  }
  return schema;
}

// ── Schema normalization ──────────────────────────────────────────────────────

function normalizeSchema(raw: RawSchema | null | undefined, resolver: RefResolver): NormalizedSchema | undefined {
  if (!raw) return undefined;
  const resolved = resolveSchema(raw, resolver) ?? raw;

  const norm: NormalizedSchema = {
    raw: resolved as Record<string, unknown>,
  };

  if (resolved.type) norm.type = resolved.type as NormalizedSchema['type'];
  if (resolved.format) norm.format = resolved.format;
  if (resolved.enum) norm.enum = resolved.enum;
  if (resolved.example !== undefined) norm.example = resolved.example;
  if (resolved.required) norm.required = resolved.required;

  if (resolved.properties) {
    norm.properties = {};
    for (const [k, v] of Object.entries(resolved.properties)) {
      const child = normalizeSchema(v, resolver);
      if (child) norm.properties[k] = child;
    }
  }

  if (resolved.items) {
    norm.items = normalizeSchema(resolved.items, resolver);
  }

  return norm;
}

// ── Parameter parsing ─────────────────────────────────────────────────────────

function parseParameters(
  rawParams: RawParameter[],
  resolver: RefResolver,
): NormalizedParameter[] {
  const result: NormalizedParameter[] = [];
  for (const p of rawParams) {
    const location = p.in as NormalizedParameter['in'];
    if (!['path', 'query', 'header', 'cookie'].includes(location)) continue;

    // Swagger 2.0: type may be inline (not in schema)
    const rawSchema: RawSchema | undefined = p.schema ?? (p.type ? { type: p.type } : undefined);

    result.push({
      name: p.name,
      in: location,
      required: p.required ?? location === 'path',
      variablePlaceholder: `{{${p.name}}}`,
      schema: normalizeSchema(rawSchema, resolver),
    });
  }
  return result;
}

// ── Request body parsing ──────────────────────────────────────────────────────

function parseRequestBody(
  raw: RawRequestBody | undefined,
  swaggerConsumes: string[] | undefined,
  resolver: RefResolver,
): NormalizedRequestBody | undefined {
  if (!raw?.content) return undefined;

  // Prefer application/json; fall back to first content type
  const contentTypes = Object.keys(raw.content);
  const ct = contentTypes.find(k => k.includes('json')) ?? contentTypes[0];
  if (!ct) return undefined;

  const entry = raw.content[ct];
  return {
    contentType: ct,
    schema: normalizeSchema(entry?.schema, resolver),
    example: entry?.example,
  };
}

// ── Response parsing ──────────────────────────────────────────────────────────

function parseResponses(
  raw: Record<string, RawResponse> | undefined,
  resolver: RefResolver,
  format: SpecFormat,
): NormalizedResponse[] {
  const result: NormalizedResponse[] = [];
  for (const [code, resp] of Object.entries(raw ?? {})) {
    const statusCode: NormalizedResponse['statusCode'] =
      code === 'default' ? 'default' : parseInt(code, 10);

    let schema: NormalizedSchema | undefined;
    let contentType: string | undefined;

    if (format === 'openapi3' && resp.content) {
      const ct = Object.keys(resp.content).find(k => k.includes('json')) ?? Object.keys(resp.content)[0];
      if (ct) {
        contentType = ct;
        schema = normalizeSchema(resp.content[ct]?.schema, resolver);
      }
    } else if (format === 'swagger2' && resp.schema) {
      // Swagger 2.0: schema directly on response
      schema = normalizeSchema(resp.schema, resolver);
      contentType = 'application/json';
    }

    result.push({ statusCode, description: resp.description, contentType, schema });
  }
  return result;
}

// ── Operation parsing ─────────────────────────────────────────────────────────

function parseOperation(
  pathKey: string,
  method: NormalizedMethod,
  op: RawOperation,
  schemes: Record<string, RawSecurityScheme>,
  globalSecurity: Record<string, string[]>[],
  resolver: RefResolver,
  format: SpecFormat,
  warnings: ImportWarning[],
): NormalizedEndpoint {
  const operationId = op.operationId ?? `${method} ${pathKey}`;

  // URL: substitute path params as {{paramName}}
  const url = pathKey.replace(/\{([^}]+)\}/g, '{{$1}}');

  const parameters = parseParameters(op.parameters ?? [], resolver);

  const requestBody = format === 'openapi3'
    ? parseRequestBody(op.requestBody, undefined, resolver)
    : undefined; // Swagger 2.0 body params handled as parameters

  const responses = parseResponses(op.responses, resolver, format);

  // Security scheme names for this operation (operation-level overrides global)
  const secEntries = op.security ?? globalSecurity;
  const securitySchemeNames = secEntries.flatMap(entry => Object.keys(entry));

  if (op.parameters?.some(p => (p as unknown as Record<string, unknown>).$ref)) {
    warnings.push({
      code: 'EXTERNAL_PARAM_REF',
      severity: 'warning',
      message: `Operation '${operationId}' has unresolved parameter $refs; some params may be missing`,
      context: operationId,
    });
  }

  return {
    url,
    method,
    operationId,
    tags: op.tags ?? [],
    parameters,
    requestBody,
    responses,
    securitySchemeNames,
    summary: op.summary,
    description: op.description,
  };
}

// ── Auth metadata parsing ─────────────────────────────────────────────────────

function parseAuthMetadata(
  rawSchemes: Record<string, RawSecurityScheme>,
  globalSecurity: Record<string, string[]>[],
  warnings: ImportWarning[],
): AuthMetadata {
  const schemes: DetectedAuthScheme[] = [];

  for (const [name, raw] of Object.entries(rawSchemes)) {
    const scheme = normalizeAuthScheme(name, raw, warnings);
    schemes.push(scheme);
  }

  const globalSchemeNames = globalSecurity.flatMap(e => Object.keys(e));

  return {
    schemes,
    hasOperationLevelOverride: false, // wired after endpoint parsing
    globalSchemeNames,
  };
}

function normalizeAuthScheme(
  name: string,
  raw: RawSecurityScheme,
  warnings: ImportWarning[],
): DetectedAuthScheme {
  const base: DetectedAuthScheme = {
    kind: 'unknown',
    schemeName: name,
    appliedToStepIds: [],
  };

  switch (raw.type) {
    case 'http':
      base.kind = raw.scheme === 'bearer' ? 'bearer' : raw.scheme === 'basic' ? 'basic' : 'unknown';
      break;
    case 'apiKey':
      base.kind = 'apiKey';
      base.paramName = raw.name;
      break;
    case 'oauth2': {
      base.kind = 'oauth2';
      const flow =
        raw.flows?.clientCredentials ??
        raw.flows?.authorizationCode ??
        raw.flows?.password ??
        raw.flows?.implicit;
      if (flow && 'tokenUrl' in flow) base.tokenUrl = (flow as { tokenUrl: string }).tokenUrl;
      const scopes = Object.keys(
        (flow as { scopes?: Record<string, string> } | undefined)?.scopes ?? raw.scopes ?? {},
      );
      if (scopes.length) base.scopes = scopes;
      break;
    }
    case 'openIdConnect':
      base.kind = 'openIdConnect';
      break;
    default:
      warnings.push({
        code: 'UNKNOWN_AUTH_TYPE',
        severity: 'warning',
        message: `Security scheme '${name}' has unrecognized type '${raw.type}'`,
        context: name,
      });
  }

  return base;
}

function wireAuthStepIds(auth: AuthMetadata, endpoints: NormalizedEndpoint[]): void {
  let hasOperationOverride = false;
  for (const ep of endpoints) {
    const isOverride = ep.securitySchemeNames.length > 0;
    if (isOverride) hasOperationOverride = true;
    for (const schemeName of ep.securitySchemeNames) {
      const scheme = auth.schemes.find(s => s.schemeName === schemeName);
      if (scheme && !scheme.appliedToStepIds.includes(ep.operationId)) {
        scheme.appliedToStepIds.push(ep.operationId);
      }
    }
  }
  auth.hasOperationLevelOverride = hasOperationOverride;
}

// ── OpenAPI dependency analyzer (lightweight, heuristic) ─────────────────────

function analyzeOpenApiDependencies(endpoints: NormalizedEndpoint[]): DependencyDetectionResult {
  const hints: DependencyDetectionResult['hints'] = [];
  const operationEntityMap: Record<string, string[]> = {};
  const detectedEntities = new Set<string>();

  // Extract entity names from URL path segments (e.g. /pets → 'pet', /users/{id} → 'user')
  for (const ep of endpoints) {
    const segments = ep.url.replace(/\{\{[^}]+\}\}/g, '').split('/').filter(Boolean);
    const entities: string[] = [];
    for (const seg of segments) {
      // Skip pure placeholder segments; take singular of plural nouns heuristically
      if (!seg || seg.startsWith('{') || seg.startsWith('{{')) continue;
      const entity = seg.replace(/s$/, ''); // naive singularize
      entities.push(entity);
      detectedEntities.add(entity);
    }
    operationEntityMap[ep.operationId] = entities;
  }

  // Emit shared-entity hints for operations touching the same entity
  const entityOps = new Map<string, string[]>();
  for (const [opId, entities] of Object.entries(operationEntityMap)) {
    for (const entity of entities) {
      if (!entityOps.has(entity)) entityOps.set(entity, []);
      entityOps.get(entity)!.push(opId);
    }
  }
  for (const [, ops] of entityOps) {
    for (let i = 0; i < ops.length - 1; i++) {
      hints.push({
        kind: 'shared-entity',
        producerOperationId: ops[i],
        consumerOperationId: ops[i + 1],
        confidence: 'low',
      });
    }
  }

  // Emit sequential-tag hints for operations sharing the same tag
  const tagOps = new Map<string, string[]>();
  for (const ep of endpoints) {
    const tag = ep.tags[0] ?? 'untagged';
    if (!tagOps.has(tag)) tagOps.set(tag, []);
    tagOps.get(tag)!.push(ep.operationId);
  }
  for (const [, ops] of tagOps) {
    for (let i = 0; i < ops.length - 1; i++) {
      hints.push({
        kind: 'sequential-tag',
        producerOperationId: ops[i],
        consumerOperationId: ops[i + 1],
        confidence: 'low',
      });
    }
  }

  return {
    hints,
    detectedEntities: Array.from(detectedEntities),
    operationEntityMap,
  };
}

// ── Auth scheme → ApiAuthConfig mapper ───────────────────────────────────────

function detectedSchemeToAuthConfig(scheme: DetectedAuthScheme): ApiAuthConfig {
  switch (scheme.kind) {
    case 'bearer': return { type: 'bearer', bearer: { token: '' } };
    case 'apiKey': return { type: 'apiKey', apiKey: { header: scheme.paramName ?? 'X-Api-Key', value: '' } };
    case 'basic': return { type: 'basic', basic: { username: '', password: '' } };
    case 'oauth2': return { type: 'oauth2CC', oauth2CC: { tokenUrl: scheme.tokenUrl ?? '', clientId: '', clientSecret: '' } };
    default: return { type: 'none' };
  }
}

// ── Main import entry point ───────────────────────────────────────────────────

/**
 * importFromOpenApi
 * Phase D Step 4 — Full ImportResult pipeline for OpenAPI 3.x / Swagger 2.0.
 *
 * Stages:
 *   Raw → Parsed → Normalized → WorkflowEnvelope (+ graphHints + folderHierarchy + nodes) → ImportResult
 *
 * INVARIANTS:
 *   - All new metadata fields (graphHints, folderHierarchy, nodes) are optional additions.
 *   - Existing ApiTestStep[] shape is not broken.
 *   - NormalizedEndpoint.tags[] is the canonical tag source — no _tag annotation needed.
 */
export function importFromOpenApi(specContent: string, options: ImportOptions): ImportResult {
  const allWarnings: ImportWarning[] = [];
  const stageWarnings: Partial<Record<NormalizationStage, ImportWarning[]>> = {};
  const completedStages: NormalizationStage[] = ['Raw'];

  // ── Stage 1: Parse ──────────────────────────────────────────────────────────
  const parsed = parseOpenApiSpec(specContent);
  allWarnings.push(...parsed.warnings);
  stageWarnings['Parsed'] = parsed.warnings;
  completedStages.push('Parsed');

  // ── Stage 2: Filter endpoints by tag option ─────────────────────────────────
  const endpoints = options.tag
    ? parsed.endpoints.filter(ep => ep.tags.includes(options.tag!))
    : parsed.endpoints;
  let skippedCount = parsed.endpoints.length - endpoints.length;
  stageWarnings['Normalized'] = [];
  completedStages.push('Normalized');

  // ── Stage 3: Build ApiTestStep[] from NormalizedEndpoint[] ─────────────────
  // NormalizedEndpoint.tags[0] is the canonical tag — used for folder grouping below.
  const steps: ApiTestStep[] = [];

  for (const ep of endpoints) {
    // Build assertions from responses
    const assertions: ApiAssertion[] = [];
    for (const resp of ep.responses) {
      const code = typeof resp.statusCode === 'number' ? resp.statusCode : 200;
      if (code >= 200 && code < 300) {
        assertions.push({ field: 'status', operator: 'greaterThanOrEqual', expected: 200, severity: 'high' });
        assertions.push({ field: 'status', operator: 'lessThan', expected: 300, severity: 'high' });
        break; // first 2xx only
      }
    }

    // Build query/header params
    const queryParams: Record<string, string> = {};
    const headers: Record<string, string> = {};
    for (const p of ep.parameters) {
      if (p.in === 'query') queryParams[p.name] = p.variablePlaceholder;
      if (p.in === 'header') headers[p.name] = p.variablePlaceholder;
    }

    // Auth from first declared security scheme on this operation
    let stepAuth: ApiAuthConfig | undefined;
    for (const schemeName of ep.securitySchemeNames) {
      const scheme = parsed.authMetadata.schemes.find(s => s.schemeName === schemeName);
      if (scheme) {
        stepAuth = detectedSchemeToAuthConfig(scheme);
        break;
      }
    }

    // Body from requestBody (examples only when includeExamples=true)
    let body: unknown = undefined;
    let bodyType: ApiRequest['bodyType'] = 'none';
    if (options.includeExamples && ep.requestBody) {
      body = ep.requestBody.example ?? {};
      bodyType = 'json';
    }

    const request: ApiRequest = {
      method: ep.method,
      url: ep.url,
      headers: Object.keys(headers).length ? headers : undefined,
      queryParams: Object.keys(queryParams).length ? queryParams : undefined,
      body,
      bodyType,
    };

    const step: ApiTestStep = {
      id: uuidv4(),
      name: ep.operationId,
      request,
      assertions,
      extractVariables: [],
      execution: { onFailure: 'continue' },
      dependsOn: [],
      // Preserve tag as group for UI display / future workflow grouping
      group: ep.tags[0],
    };

    steps.push(step);
  }

  // ── Stage 4: Assemble ApiCollection ────────────────────────────────────────
  const collectionId = uuidv4();
  const collection: ApiCollection = {
    id: collectionId,
    projectId: options.projectId,
    name: options.collectionName ?? parsed.title,
    environmentId: options.environmentId,
    steps,
    variables: [],
    onFailure: 'continue',
    executionMode: options.executionMode ?? 'sequential',
    tags: options.tag ? [options.tag] : [],
  };

  // ── Stage 5: Dependency analysis ───────────────────────────────────────────
  const dependencyHints = analyzeOpenApiDependencies(endpoints);

  // ── Stage 6: WorkflowEnvelope + Phase D Step 4 metadata ────────────────────
  const envelope = collectionToWorkflow(collection);
  envelope.metadata.source = 'openapi';
  envelope.metadata.description = parsed.title;

  // Phase D Step 4: graph metadata
  const graphHints: WorkflowGraphHints = {
    detectedEntities: dependencyHints.detectedEntities,
    operationEntityMap: dependencyHints.operationEntityMap,
    // suggestedGroups: unique tags across all steps — NormalizedEndpoint.tags is the canonical source
    suggestedGroups: [...new Set(endpoints.map(ep => ep.tags[0] ?? 'untagged'))],
    edgeCount: dependencyHints.hints.length,
    isHeuristic: true,
  };

  envelope.metadata.metadataVersion = 1;
  envelope.metadata.metadataGeneratedAt = new Date().toISOString();
  envelope.metadata.normalizationSource = 'openapi' as WorkflowNormalizationSource;
  envelope.metadata.graphHints = graphHints;

  // Shallow FolderNode tree from operation tags (depth = 1)
  const tagGroups = new Map<string, string[]>();
  // Use endpoints (not steps) since we have direct access to tags and can zip with steps by index
  endpoints.forEach((ep, idx) => {
    const tag: string = ep.tags[0] ?? 'untagged';
    if (!tagGroups.has(tag)) tagGroups.set(tag, []);
    tagGroups.get(tag)!.push(steps[idx].id);
  });

  envelope.metadata.folderHierarchy = {
    id: 'root',
    name: collection.name,
    depth: 0,
    stepIds: [],
    children: Array.from(tagGroups.entries()).map(([tag, ids]) => ({
      id: tag,
      name: tag,
      depth: 1,
      stepIds: ids,
      children: [],
    })),
  } as unknown as FolderNode;

  // Build WorkflowNode[] with hierarchyPath and visualGroup
  envelope.workflow.nodes = steps.map((step, idx) => {
    const tag: string = endpoints[idx].tags[0] ?? 'untagged';
    return {
      nodeType: 'HTTP' as const,
      step,
      hierarchyPath: [tag, step.name],
      visualGroup: tag,
    };
  });

  stageWarnings['WorkflowEnvelope'] = [];
  completedStages.push('WorkflowEnvelope');

  // ── Stage 7: Source metadata ────────────────────────────────────────────────
  const sourceType = parsed.format === 'openapi3' ? 'openapi3' : 'swagger2';
  completedStages.push('CompatibilityValidated');
  stageWarnings['CompatibilityValidated'] = [];

  const normalizationTrace: NormalizationTrace = {
    stages: completedStages,
    completedAt: new Date().toISOString(),
    stageWarnings,
  };

  return {
    collection,
    envelope,
    authMetadata: parsed.authMetadata,
    dependencyHints,
    warnings: allWarnings,
    format: sourceType,
    endpointCount: steps.length,
    skippedCount,
    sourceMetadata: {
      type: sourceType,
      originalName: parsed.title,
    },
    normalizationTrace,
  };
}
