import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'js-yaml';
import type { ApiCollection, ApiTestStep, ApiRequest, ApiAssertion, ApiAuthConfig } from '../data/types';

// ── Minimal type helpers ──────────────────────────────────────────────────────

interface OASchema { type?: string; properties?: Record<string, OASchema>; required?: string[] }
interface OAResponse { description?: string; content?: Record<string, { schema?: OASchema }> }
interface OAParameter { name: string; in: string; required?: boolean; schema?: OASchema; example?: unknown }
interface OARequestBody { content?: Record<string, { schema?: OASchema; example?: unknown }> }
interface OAOperation {
  operationId?: string;
  tags?: string[];
  parameters?: OAParameter[];
  requestBody?: OARequestBody;
  responses?: Record<string, OAResponse>;
  security?: Record<string, string[]>[];
}
interface OASecurityScheme { type: string; scheme?: string; in?: string; name?: string; flows?: unknown }
interface OA3Spec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string };
  servers?: { url: string }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, OAOperation>>;
  components?: { securitySchemes?: Record<string, OASecurityScheme> };
  securityDefinitions?: Record<string, OASecurityScheme>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

function parseSpec(content: string): OA3Spec {
  try { return JSON.parse(content) as OA3Spec; } catch { /* try yaml */ }
  try { return yaml.load(content) as OA3Spec; } catch (e) {
    throw new Error(`Invalid spec: could not parse as JSON or YAML — ${(e as Error).message}`);
  }
}

function baseUrl(spec: OA3Spec): string {
  if (spec.openapi) return spec.servers?.[0]?.url ?? '';
  // Swagger 2.0
  const scheme = spec.schemes?.[0] ?? 'https';
  const host = spec.host ?? '';
  const base = spec.basePath ?? '';
  return `${scheme}://${host}${base}`;
}

function resolveRef(schema: OASchema, components: Record<string, unknown>): OASchema {
  if (!schema || typeof schema !== 'object') return schema;
  const ref = (schema as Record<string, unknown>)['$ref'] as string | undefined;
  if (ref) {
    // Only resolve local refs like #/components/schemas/Pet
    const parts = ref.replace('#/', '').split('/');
    let resolved: unknown = { components };
    for (const p of parts) resolved = (resolved as Record<string, unknown>)?.[p];
    return (resolved as OASchema) ?? schema;
  }
  return schema;
}

function schemaToAssertion(schema: OASchema, components: Record<string, unknown> = {}): ApiAssertion | null {
  if (!schema || typeof schema !== 'object') return null;
  const resolved = resolveRef(schema, components);
  // Skip if still unresolved $ref or no meaningful properties to validate
  if ((resolved as Record<string, unknown>)['$ref']) return null;
  return {
    field: '$..',
    operator: 'jsonSchemaValid',
    expected: resolved,
    severity: 'high',
    message: 'Response body matches expected schema',
  };
}

function mapSecurityScheme(scheme: OASecurityScheme): ApiAuthConfig {
  if (scheme.type === 'http' && scheme.scheme === 'bearer') return { type: 'bearer', bearer: { token: '' } };
  if (scheme.type === 'apiKey') return { type: 'apiKey', apiKey: { header: scheme.name ?? 'X-Api-Key', value: '' } };
  if (scheme.type === 'oauth2') return { type: 'oauth2CC', oauth2CC: { tokenUrl: '', clientId: '', clientSecret: '' } };
  if (scheme.type === 'http' && scheme.scheme === 'basic') return { type: 'basic', basic: { username: '', password: '' } };
  return { type: 'none' };
}

export function importFromOpenApi(
  specContent: string,
  environmentId: string,
  options: { tag?: string; includeExamples?: boolean } = {}
): ApiCollection {
  const spec = parseSpec(specContent);
  if (!spec.paths) throw new Error("Invalid OpenAPI spec: missing 'paths' object");

  const isSwagger = !!spec.swagger;
  const title = spec.info?.title ?? 'Imported API';
  const base = baseUrl(spec);

  const schemes: Record<string, OASecurityScheme> = spec.components?.securitySchemes
    ?? (spec.securityDefinitions ?? {});

  const steps: ApiTestStep[] = [];

  for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method] as OAOperation | undefined;
      if (!op) continue;

      if (options.tag && (!op.tags || !op.tags.includes(options.tag))) continue;

      const operationId = op.operationId ?? `${method.toUpperCase()} ${pathKey}`;

      // URL — substitute path params as {{paramName}}
      let url = `${base}${pathKey}`.replace(/\{([^}]+)\}/g, '{{$1}}');

      const queryParams: Record<string, string> = {};
      const headers: Record<string, string> = {};
      for (const p of op.parameters ?? []) {
        if (p.in === 'query') queryParams[p.name] = `{{${p.name}}}`;
        if (p.in === 'header') headers[p.name] = `{{${p.name}}}`;
      }

      let body: unknown = undefined;
      let bodyType: ApiRequest['bodyType'] = 'none';
      if (options.includeExamples && op.requestBody?.content) {
        const jsonContent = op.requestBody.content['application/json'];
        if (jsonContent?.example) { body = jsonContent.example; bodyType = 'json'; }
        else if (jsonContent?.schema) { body = {}; bodyType = 'json'; }
      }

      const assertions: ApiAssertion[] = [];
      for (const [statusCode, response] of Object.entries(op.responses ?? {})) {
        if (!statusCode.startsWith('2')) continue;
        assertions.push({ field: 'status', operator: 'greaterThanOrEqual', expected: 200, severity: 'high' });
        assertions.push({ field: 'status', operator: 'lessThan', expected: 300, severity: 'high' });
        if (response.content) {
          const schema = response.content['application/json']?.schema;
          if (schema) {
            const a = schemaToAssertion(schema, (spec.components ?? {}) as Record<string, unknown>);
            if (a) assertions.push(a);
          }
        }
        break; // first 2xx only
      }

      // Auth from operation security or global
      let stepAuth: ApiAuthConfig | undefined;
      const secEntries = op.security ?? [];
      for (const secReq of secEntries) {
        const schemeName = Object.keys(secReq)[0];
        if (schemeName && schemes[schemeName]) {
          stepAuth = mapSecurityScheme(schemes[schemeName]);
          break;
        }
      }

      const request: ApiRequest = {
        method: method.toUpperCase() as ApiRequest['method'],
        url,
        headers: Object.keys(headers).length ? headers : undefined,
        queryParams: Object.keys(queryParams).length ? queryParams : undefined,
        body,
        bodyType,
      };

      steps.push({
        id: uuidv4(),
        name: operationId,
        request,
        assertions,
        extractVariables: [],
        execution: stepAuth ? { onFailure: 'continue' } : {},
        dependsOn: [],
      });
    }
  }

  return {
    id: uuidv4(),
    name: title,
    environmentId,
    steps,
    variables: [],
    onFailure: 'continue',
    executionMode: 'sequential',
    tags: options.tag ? [options.tag] : [],
  };
}
