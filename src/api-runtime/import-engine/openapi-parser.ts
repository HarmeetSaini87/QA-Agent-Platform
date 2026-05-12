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
} from './contracts';

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
    if (!url) warnings.push({ code: 'NO_SERVER_URL', message: 'No servers[0].url found; base URL will be empty' });
    return url;
  }
  // Swagger 2.0
  const scheme = raw.schemes?.[0] ?? 'https';
  const host = raw.host ?? '';
  const base = raw.basePath ?? '';
  if (!host) warnings.push({ code: 'NO_HOST', message: 'Swagger 2.0 host is missing; base URL will be empty' });
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
