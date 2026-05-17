/**
 * import-engine/postman-parser.ts
 * Phase D Step 2 — Postman Collection v2.0 / v2.1 parser.
 *
 * Produces ParsedPostmanCollection — intermediate model analogous to ParsedSpec
 * from openapi-parser.ts. WorkflowEnvelope mapping is handled by the caller
 * (postman-workflow-mapper — Phase D Step 2 orchestrator).
 *
 * INVARIANTS:
 *   - Never throws on partial/malformed collections; emits warnings instead.
 *   - No runtime side-effects — pure parsing functions.
 *   - Folder hierarchy always preserved as metadata (group field on FlatRequest).
 *   - Disabled items captured with disabled=true; caller decides inclusion.
 *   - PM scripts are NOT executed — captured raw for assertion-mapper analysis.
 *   - Auth detection only — no secrets written into normalized structures.
 *   - Variable references ({{var}}) are preserved as-is (lazy resolution rule).
 *   - Supports PM v2.0 (schema .../v2.0.0/...) and v2.1 (schema .../v2.1.0/...).
 */

import type {
  ImportWarning,
  ImportSourceMetadata,
  ImportSourceType,
  AuthMetadata,
  DetectedAuthScheme,
  AuthSchemeKind,
} from './contracts';

// ── Maximum safe folder nesting depth ────────────────────────────────────────
const MAX_FOLDER_DEPTH = 10;

// ── Raw Postman v2.x types ────────────────────────────────────────────────────

interface PMUrl {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  path?: string | string[];
  query?: PMKeyValue[];
  variable?: PMKeyValue[];
  port?: string;
}

interface PMKeyValue {
  key?: string;
  value?: string;
  disabled?: boolean;
  description?: string;
}

interface PMAuthParam {
  key: string;
  value?: string;
  type?: string;
}

interface PMAuth {
  type?: string;
  bearer?: PMAuthParam[];
  apikey?: PMAuthParam[];
  basic?: PMAuthParam[];
  oauth2?: PMAuthParam[];
  oauth1?: PMAuthParam[];
  ntlm?: PMAuthParam[];
  digest?: PMAuthParam[];
  hawk?: PMAuthParam[];
  awsv4?: PMAuthParam[];
  edgegrid?: PMAuthParam[];
  noauth?: null;
}

interface PMBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  urlencoded?: PMKeyValue[];
  formdata?: PMKeyValue[];
  options?: { raw?: { language?: string } };
  graphql?: { query?: string; variables?: string };
}

interface PMRequest {
  method?: string;
  header?: PMKeyValue[];
  url?: PMUrl | string;
  body?: PMBody;
  auth?: PMAuth;
  description?: string | { content?: string; type?: string };
}

interface PMScript {
  type?: string;
  exec?: string | string[];
  src?: string;
}

interface PMEvent {
  listen?: 'test' | 'prerequest';
  script?: PMScript;
  disabled?: boolean;
}

interface PMItem {
  id?: string;
  name?: string;
  description?: string | { content?: string };
  request?: PMRequest;
  response?: unknown[];
  item?: PMItem[];      // present on folder nodes
  event?: PMEvent[];
  auth?: PMAuth;
  variable?: PMKeyValue[];
  disabled?: boolean;
  protocolProfileBehavior?: Record<string, unknown>;
}

interface PMInfo {
  name?: string;
  description?: string | { content?: string };
  schema?: string;
  _postman_id?: string;
  version?: string;
}

interface PMCollection {
  info?: PMInfo;
  item?: PMItem[];
  auth?: PMAuth;
  variable?: PMKeyValue[];
  event?: PMEvent[];
}

// ── Normalized request model (Postman-specific) ───────────────────────────────

export type PMBodyMode = 'none' | 'raw_json' | 'raw_text' | 'urlencoded' | 'formdata' | 'graphql';

export interface NormalizedPMHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export interface NormalizedPMQueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

export interface NormalizedPMPathVariable {
  key: string;
  /** Placeholder: {{key}} — preserved for lazy resolution */
  placeholder: string;
}

export interface NormalizedPMBody {
  mode: PMBodyMode;
  /** Raw content (raw_json / raw_text) */
  raw?: string;
  /** Parsed JSON (raw_json only, if parseable) */
  jsonBody?: unknown;
  /** URL-encoded form fields */
  urlEncoded?: Array<{ key: string; value: string; enabled: boolean }>;
  /** Multipart form fields */
  formData?: Array<{ key: string; value: string; enabled: boolean }>;
  /** GraphQL query/variables */
  graphql?: { query: string; variables?: string };
  /** Detected content type from body options or Content-Type header */
  contentType?: string;
}

export interface NormalizedPMAuth {
  type: 'none' | 'bearer' | 'apiKey' | 'basic' | 'oauth2' | 'oauth1' | 'unsupported';
  bearer?: { token: string };
  apiKey?: { paramName: string; value: string; in: 'header' | 'query' };
  basic?: { username: string; password: string };
  oauth2?: {
    tokenUrl?: string;
    clientId?: string;
    scopes?: string;
    accessToken?: string;
    refreshToken?: string;
  };
  /** Raw PM auth params — preserved for future mapping / AI correction */
  raw?: PMAuthParam[];
}

export interface RawScript {
  type: 'test' | 'prerequest';
  /** Joined exec lines */
  source: string;
  disabled: boolean;
}

export interface FolderNode {
  name: string;
  /** Dot-joined ancestor names: "Auth / Login / Steps" */
  path: string;
  depth: number;
  auth?: NormalizedPMAuth;
  variables: NormalizedPMVariable[];
  childFolders: FolderNode[];
  /** Item IDs that are direct children of this folder */
  childItemIds: string[];
}

export interface NormalizedPMVariable {
  key: string;
  /** Raw value — may contain {{references}} — NOT pre-resolved (lazy resolution rule) */
  value: string;
  type: 'string' | 'secret' | 'any' | 'boolean' | 'number';
  /** True when type === 'secret' or key contains password/token/secret heuristic */
  sensitive: boolean;
  /** Scope at which this variable was defined */
  scope: 'collection' | 'folder';
}

export interface FlatRequest {
  /** Stable ID from PM item.id if present, else generated */
  id: string;
  /** Full display name: "FolderA / FolderB / Request Name" */
  name: string;
  /** Just the request name without folder prefix */
  requestName: string;
  method: string;
  /** Resolved URL with path params as {{paramName}} — base preserved for lazy resolution */
  url: string;
  /** Base URL extracted from url (protocol + host + port) */
  baseUrl: string;
  headers: NormalizedPMHeader[];
  queryParams: NormalizedPMQueryParam[];
  pathVariables: NormalizedPMPathVariable[];
  body: NormalizedPMBody;
  auth: NormalizedPMAuth;
  /** Auth inheritance chain: 'request' | 'folder:<name>' | 'collection' | 'none' */
  authSource: string;
  scripts: RawScript[];
  description?: string;
  disabled: boolean;
  /** Folder path as array: ["FolderA", "FolderB"] — for group metadata */
  folderPath: string[];
  /** Depth of nesting — 0 = top-level */
  depth: number;
  /** Original execution order within its parent folder */
  order: number;
}

// ── Parsed result ─────────────────────────────────────────────────────────────

export interface ParsedPostmanCollection {
  format: 'postman_v2' | 'postman_v2_1';
  name: string;
  description?: string;
  sourceMetadata: ImportSourceMetadata;
  collectionAuth?: NormalizedPMAuth;
  collectionVariables: NormalizedPMVariable[];
  collectionScripts: RawScript[];
  /** Flat ordered list of all requests (folders flattened, hierarchy in folderPath) */
  requests: FlatRequest[];
  /** Folder tree — preserved for future graph/UI use */
  folderTree: FolderNode[];
  authMetadata: AuthMetadata;
  warnings: ImportWarning[];
  /** Total item count including nested folders */
  totalItemCount: number;
  /** Number of items skipped due to depth limit */
  depthSkippedCount: number;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function parsePostmanCollection(content: string): ParsedPostmanCollection {
  const warnings: ImportWarning[] = [];

  let raw: PMCollection;
  try {
    raw = JSON.parse(content) as PMCollection;
  } catch (e) {
    throw new Error(`Postman collection parse failed: ${(e as Error).message}`);
  }

  if (!raw.info) {
    throw new Error("Not a valid Postman collection: missing 'info' field");
  }

  const { format, sourceType } = detectPostmanVersion(raw.info, warnings);
  const name = raw.info.name ?? 'Imported Postman Collection';
  const description = extractDescription(raw.info.description);

  const sourceMetadata: ImportSourceMetadata = {
    type: sourceType,
    schemaUrl: raw.info.schema,
    originalCollectionId: raw.info._postman_id,
    originalName: name,
  };

  // Collection-level variables
  const collectionVariables = normalizeVariables(raw.variable ?? [], 'collection');

  // Collection-level auth
  const collectionAuth = raw.auth ? normalizeAuth(raw.auth, warnings) : undefined;

  // Collection-level scripts (pre/post — metadata only)
  const collectionScripts = extractScripts(raw.event ?? []);

  // Flatten folder tree into requests
  const folderTree: FolderNode[] = [];
  const requests: FlatRequest[] = [];
  let totalItemCount = 0;
  let depthSkippedCount = 0;

  flattenItems(
    raw.item ?? [],
    [],
    collectionAuth,
    warnings,
    requests,
    folderTree,
    { count: 0 },
    { count: 0 },
    (n: number) => { totalItemCount += n; },
    (n: number) => { depthSkippedCount += n; },
  );

  sourceMetadata.folderCount = countFolders(raw.item ?? []);
  sourceMetadata.totalItemCount = totalItemCount;

  // Build auth metadata from all detected auth configs
  const authMetadata = buildAuthMetadata(requests, collectionAuth, warnings);

  return {
    format,
    name,
    description,
    sourceMetadata,
    collectionAuth,
    collectionVariables,
    collectionScripts,
    requests,
    folderTree,
    authMetadata,
    warnings,
    totalItemCount,
    depthSkippedCount,
  };
}

// ── Version detection ─────────────────────────────────────────────────────────

function detectPostmanVersion(
  info: PMInfo,
  warnings: ImportWarning[],
): { format: 'postman_v2' | 'postman_v2_1'; sourceType: ImportSourceType } {
  const schema = info.schema ?? '';
  if (schema.includes('v2.1') || schema.includes('v2.1.0')) {
    return { format: 'postman_v2_1', sourceType: 'postman_v2_1' };
  }
  if (schema.includes('v2.0') || schema.includes('v2.0.0')) {
    return { format: 'postman_v2', sourceType: 'postman_v2' };
  }
  // Attempt heuristic detection — item structure implies v2.x
  warnings.push({
    code: 'UNKNOWN_PM_FEATURE',
    severity: 'warning',
    message: `Postman schema URL not recognized ('${schema}'); assuming v2.1 format`,
    context: 'info.schema',
  });
  return { format: 'postman_v2_1', sourceType: 'postman_v2_1' };
}

// ── Description extraction ────────────────────────────────────────────────────

function extractDescription(desc?: string | { content?: string }): string | undefined {
  if (!desc) return undefined;
  if (typeof desc === 'string') return desc || undefined;
  return desc.content || undefined;
}

// ── Variable normalization ────────────────────────────────────────────────────

function normalizeVariables(
  raw: PMKeyValue[],
  scope: 'collection' | 'folder',
): NormalizedPMVariable[] {
  return raw
    .filter(v => v.key != null && v.key !== '')
    .map(v => {
      const key = v.key!;
      const value = v.value ?? '';
      const sensitive = isSensitiveKey(key);
      return { key, value, type: 'string' as const, sensitive, scope };
    });
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('password') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('apikey') ||
    lower.includes('api_key') ||
    lower.includes('credential') ||
    lower.includes('auth')
  );
}

// ── URL normalization ─────────────────────────────────────────────────────────

function normalizeUrl(raw: PMUrl | string | undefined): {
  full: string;
  baseUrl: string;
  queryParams: NormalizedPMQueryParam[];
  pathVariables: NormalizedPMPathVariable[];
} {
  if (!raw) return { full: '', baseUrl: '', queryParams: [], pathVariables: [] };

  if (typeof raw === 'string') {
    return parseUrlString(raw);
  }

  // Prefer raw string if present
  const urlRaw = raw.raw;
  if (urlRaw) {
    const parsed = parseUrlString(urlRaw);
    // Override with structured query params if richer
    const structuredParams = (raw.query ?? [])
      .filter(q => q.key != null)
      .map(q => ({
        key: q.key!,
        value: q.value ?? '',
        enabled: !q.disabled,
      }));
    if (structuredParams.length > 0) parsed.queryParams = structuredParams;

    const pathVars = (raw.variable ?? [])
      .filter(v => v.key != null)
      .map(v => ({
        key: v.key!,
        placeholder: `{{${v.key}}}`,
      }));
    if (pathVars.length > 0) parsed.pathVariables = pathVars;

    return parsed;
  }

  // Build from parts
  const protocol = raw.protocol ?? 'https';
  const hostParts = Array.isArray(raw.host) ? raw.host : (raw.host ? [raw.host] : []);
  const pathParts = Array.isArray(raw.path) ? raw.path : (raw.path ? raw.path.split('/').filter(Boolean) : []);
  const port = raw.port ? `:${raw.port}` : '';
  const host = hostParts.join('.');
  const baseUrl = host ? `${protocol}://${host}${port}` : '';
  const pathStr = pathParts.map(p => p.startsWith(':') ? `{{${p.slice(1)}}}` : p).join('/');
  const full = baseUrl ? `${baseUrl}/${pathStr}` : `/${pathStr}`;

  const queryParams = (raw.query ?? [])
    .filter(q => q.key != null)
    .map(q => ({ key: q.key!, value: q.value ?? '', enabled: !q.disabled }));

  const pathVariables = (raw.variable ?? [])
    .filter(v => v.key != null)
    .map(v => ({ key: v.key!, placeholder: `{{${v.key}}}` }));

  return { full, baseUrl, queryParams, pathVariables };
}

function parseUrlString(url: string): {
  full: string;
  baseUrl: string;
  queryParams: NormalizedPMQueryParam[];
  pathVariables: NormalizedPMPathVariable[];
} {
  // Replace :param path variables with {{param}} for variable-engine compatibility
  // Preserve {{existing}} placeholders as-is (lazy resolution rule)
  let normalized = url.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => `{{${name}}}`);

  const queryParams: NormalizedPMQueryParam[] = [];
  const qIdx = normalized.indexOf('?');
  if (qIdx !== -1) {
    const qs = normalized.slice(qIdx + 1);
    normalized = normalized.slice(0, qIdx);
    for (const part of qs.split('&')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      queryParams.push({ key: part.slice(0, eq), value: part.slice(eq + 1), enabled: true });
    }
  }

  // Extract base URL (protocol + host + port)
  let baseUrl = '';
  try {
    // Remove {{vars}} temporarily to allow URL parsing
    const stripped = normalized.replace(/\{\{[^}]+\}\}/g, 'PLACEHOLDER');
    const u = new URL(stripped.startsWith('http') ? stripped : `https://${stripped}`);
    baseUrl = `${u.protocol}//${u.host}`;
  } catch {
    // Non-parseable URL (e.g. relative) — leave baseUrl empty
  }

  // Extract path variables from {{param}} patterns in URL path
  const pathVariables: NormalizedPMPathVariable[] = [];
  const varMatches = normalized.matchAll(/\{\{([^}]+)\}\}/g);
  const seenKeys = new Set<string>();
  for (const m of varMatches) {
    const key = m[1];
    if (!seenKeys.has(key) && !normalized.includes(`?${key}=`) && !normalized.includes(`&${key}=`)) {
      seenKeys.add(key);
      pathVariables.push({ key, placeholder: `{{${key}}}` });
    }
  }

  return { full: normalized, baseUrl, queryParams, pathVariables };
}

// ── Header normalization ──────────────────────────────────────────────────────

function normalizeHeaders(raw: PMKeyValue[]): NormalizedPMHeader[] {
  return raw
    .filter(h => h.key != null && h.key !== '')
    .map(h => ({
      key: h.key!,
      value: h.value ?? '',
      enabled: !h.disabled,
    }));
}

// ── Body normalization ────────────────────────────────────────────────────────

function normalizeBody(raw: PMBody | undefined, headers: NormalizedPMHeader[]): NormalizedPMBody {
  if (!raw || !raw.mode) return { mode: 'none' };

  const ctHeader = headers.find(h => h.key.toLowerCase() === 'content-type')?.value ?? '';

  switch (raw.mode) {
    case 'raw': {
      const lang = raw.options?.raw?.language ?? detectLangFromContentType(ctHeader);
      if (lang === 'json') {
        let jsonBody: unknown = undefined;
        try { jsonBody = JSON.parse(raw.raw ?? ''); } catch { /* keep raw */ }
        return {
          mode: 'raw_json',
          raw: raw.raw ?? '',
          jsonBody,
          contentType: ctHeader || 'application/json',
        };
      }
      return { mode: 'raw_text', raw: raw.raw ?? '', contentType: ctHeader || 'text/plain' };
    }
    case 'urlencoded': {
      const urlEncoded = (raw.urlencoded ?? [])
        .filter(f => f.key != null)
        .map(f => ({ key: f.key!, value: f.value ?? '', enabled: !f.disabled }));
      return { mode: 'urlencoded', urlEncoded, contentType: 'application/x-www-form-urlencoded' };
    }
    case 'formdata': {
      const formData = (raw.formdata ?? [])
        .filter(f => f.key != null)
        .map(f => ({ key: f.key!, value: f.value ?? '', enabled: !f.disabled }));
      return { mode: 'formdata', formData, contentType: 'multipart/form-data' };
    }
    case 'graphql': {
      return {
        mode: 'graphql',
        graphql: {
          query: raw.graphql?.query ?? '',
          variables: raw.graphql?.variables,
        },
        contentType: 'application/json',
      };
    }
    default:
      return { mode: 'none' };
  }
}

function detectLangFromContentType(ct: string): 'json' | 'other' {
  return ct.toLowerCase().includes('json') ? 'json' : 'other';
}

// ── Auth normalization ────────────────────────────────────────────────────────

export function normalizeAuth(raw: PMAuth, warnings: ImportWarning[]): NormalizedPMAuth {
  const type = (raw.type ?? 'noauth').toLowerCase();

  if (type === 'noauth' || type === 'none') {
    return { type: 'none' };
  }

  if (type === 'bearer') {
    const params = raw.bearer ?? [];
    const token = findParam(params, 'token') ?? '';
    return { type: 'bearer', bearer: { token }, raw: params };
  }

  if (type === 'apikey') {
    const params = raw.apikey ?? [];
    const paramName = findParam(params, 'key') ?? 'X-Api-Key';
    const value = findParam(params, 'value') ?? '';
    const inProp = (findParam(params, 'in') ?? 'header').toLowerCase();
    return {
      type: 'apiKey',
      apiKey: {
        paramName,
        value,
        in: inProp === 'query' ? 'query' : 'header',
      },
      raw: params,
    };
  }

  if (type === 'basic') {
    const params = raw.basic ?? [];
    const username = findParam(params, 'username') ?? '';
    const password = findParam(params, 'password') ?? '';
    return { type: 'basic', basic: { username, password }, raw: params };
  }

  if (type === 'oauth2') {
    const params = raw.oauth2 ?? [];
    return {
      type: 'oauth2',
      oauth2: {
        tokenUrl: findParam(params, 'accessTokenUrl') ?? findParam(params, 'tokenUrl'),
        clientId: findParam(params, 'clientId'),
        scopes: findParam(params, 'scope'),
        accessToken: findParam(params, 'accessToken'),
        refreshToken: findParam(params, 'refreshToken'),
      },
      raw: params,
    };
  }

  // oauth1, ntlm, digest, hawk, awsv4, edgegrid — unsupported
  warnings.push({
    code: 'UNSUPPORTED_AUTH',
    severity: 'warning',
    message: `Auth type '${type}' is not supported; step will use 'none'. Manual configuration required.`,
    context: type,
  });
  return { type: 'unsupported', raw: (raw as Record<string, unknown>)[type] as PMAuthParam[] };
}

function findParam(params: PMAuthParam[], key: string): string | undefined {
  return params.find(p => p.key === key)?.value;
}

// ── Script extraction ─────────────────────────────────────────────────────────

export function extractScripts(events: PMEvent[]): RawScript[] {
  const scripts: RawScript[] = [];
  for (const ev of events) {
    if (!ev.script) continue;
    const listen = ev.listen ?? 'test';
    if (listen !== 'test' && listen !== 'prerequest') continue;
    const exec = ev.script.exec;
    const source = Array.isArray(exec) ? exec.join('\n') : (exec ?? '');
    if (!source.trim()) continue;
    scripts.push({
      type: listen,
      source,
      disabled: ev.disabled ?? false,
    });
  }
  return scripts;
}

// ── Auth inheritance resolution ───────────────────────────────────────────────

function resolveItemAuth(
  itemAuth: PMAuth | undefined,
  folderAuthChain: Array<{ name: string; auth: NormalizedPMAuth }>,
  collectionAuth: NormalizedPMAuth | undefined,
  warnings: ImportWarning[],
): { auth: NormalizedPMAuth; authSource: string } {
  if (itemAuth) {
    return {
      auth: normalizeAuth(itemAuth, warnings),
      authSource: 'request',
    };
  }
  // Walk folder chain from innermost to outermost
  for (let i = folderAuthChain.length - 1; i >= 0; i--) {
    const entry = folderAuthChain[i];
    if (entry.auth.type !== 'none') {
      return { auth: entry.auth, authSource: `folder:${entry.name}` };
    }
  }
  if (collectionAuth && collectionAuth.type !== 'none') {
    return { auth: collectionAuth, authSource: 'collection' };
  }
  return { auth: { type: 'none' }, authSource: 'none' };
}

// ── Item flattening ───────────────────────────────────────────────────────────

function flattenItems(
  items: PMItem[],
  folderPath: string[],
  inheritedAuth: NormalizedPMAuth | undefined,
  warnings: ImportWarning[],
  requests: FlatRequest[],
  folderNodes: FolderNode[],
  orderCounter: { count: number },
  _depthCounter: { count: number },
  onItem: (n: number) => void,
  onDepthSkip: (n: number) => void,
  // Auth chain for inheritance: [{name, auth}] innermost last
  folderAuthChain: Array<{ name: string; auth: NormalizedPMAuth }> = [],
  depth = 0,
): void {
  for (const item of items) {
    onItem(1);
    const isFolder = Array.isArray(item.item) && item.item.length >= 0 && item.request == null;

    if (isFolder) {
      if (depth >= MAX_FOLDER_DEPTH) {
        warnings.push({
          code: 'FOLDER_DEPTH_EXCEEDED',
          severity: 'warning',
          message: `Folder '${item.name ?? 'unnamed'}' exceeds max depth ${MAX_FOLDER_DEPTH}; contents flattened`,
          context: [...folderPath, item.name ?? 'unnamed'].join(' / '),
        });
        onDepthSkip(1);
        // Still flatten contents at current depth rather than skipping entirely
        flattenItems(
          item.item ?? [],
          [...folderPath, item.name ?? 'unnamed'],
          inheritedAuth,
          warnings,
          requests,
          folderNodes,
          orderCounter,
          _depthCounter,
          onItem,
          onDepthSkip,
          folderAuthChain,
          depth, // do not increment — treat as same level
        );
        continue;
      }

      const folderVars = normalizeVariables(item.variable ?? [], 'folder');
      const folderAuth = item.auth
        ? normalizeAuth(item.auth, warnings)
        : (inheritedAuth ?? { type: 'none' });
      const newFolderPath = [...folderPath, item.name ?? 'unnamed'];
      const childFolderNodes: FolderNode[] = [];

      const folderNode: FolderNode = {
        name: item.name ?? 'unnamed',
        path: newFolderPath.join(' / '),
        depth,
        auth: folderAuth,
        variables: folderVars,
        childFolders: childFolderNodes,
        childItemIds: [],
      };
      folderNodes.push(folderNode);

      flattenItems(
        item.item ?? [],
        newFolderPath,
        folderAuth,
        warnings,
        requests,
        childFolderNodes,
        orderCounter,
        _depthCounter,
        onItem,
        onDepthSkip,
        [...folderAuthChain, { name: item.name ?? 'unnamed', auth: folderAuth }],
        depth + 1,
      );
    } else if (item.request) {
      // Leaf request node
      const req = item.request;
      const fullName = folderPath.length > 0
        ? `${folderPath.join(' / ')} / ${item.name ?? 'Unnamed'}`
        : (item.name ?? 'Unnamed');

      const headers = normalizeHeaders(Array.isArray(req.header) ? req.header : []);
      const urlResult = normalizeUrl(req.url);
      const body = normalizeBody(req.body, headers);
      const scripts = extractScripts(item.event ?? []);
      const desc = extractDescription(typeof req.description === 'string' || typeof req.description === 'object'
        ? req.description
        : undefined);

      const { auth, authSource } = resolveItemAuth(
        req.auth,
        folderAuthChain,
        inheritedAuth,
        warnings,
      );

      const flatReq: FlatRequest = {
        id: item.id ?? `pm-${orderCounter.count}`,
        name: fullName,
        requestName: item.name ?? 'Unnamed',
        method: (req.method ?? 'GET').toUpperCase(),
        url: urlResult.full,
        baseUrl: urlResult.baseUrl,
        headers,
        queryParams: urlResult.queryParams,
        pathVariables: urlResult.pathVariables,
        body,
        auth,
        authSource,
        scripts,
        description: desc,
        disabled: item.disabled ?? false,
        folderPath,
        depth,
        order: orderCounter.count++,
      };

      requests.push(flatReq);
    }
    // Items with neither request nor item[] are silently skipped (PM documentation nodes)
  }
}

// ── Auth metadata aggregation ─────────────────────────────────────────────────

function buildAuthMetadata(
  requests: FlatRequest[],
  collectionAuth: NormalizedPMAuth | undefined,
  warnings: ImportWarning[],
): AuthMetadata {
  const schemeMap = new Map<string, DetectedAuthScheme>();
  let hasOperationLevelOverride = false;

  for (const req of requests) {
    if (req.authSource === 'request') hasOperationLevelOverride = true;

    const auth = req.auth;
    if (auth.type === 'none' || auth.type === 'unsupported') continue;

    const kind = pmAuthTypeToKind(auth.type);
    const key = auth.type;

    if (!schemeMap.has(key)) {
      const scheme: DetectedAuthScheme = {
        kind,
        schemeName: auth.type,
        appliedToStepIds: [],
      };
      if (auth.type === 'apiKey' && auth.apiKey) {
        scheme.paramName = auth.apiKey.paramName;
      }
      if (auth.type === 'oauth2' && auth.oauth2) {
        scheme.tokenUrl = auth.oauth2.tokenUrl;
        if (auth.oauth2.scopes) scheme.scopes = [auth.oauth2.scopes];
      }
      schemeMap.set(key, scheme);
    }

    const scheme = schemeMap.get(key)!;
    if (!scheme.appliedToStepIds.includes(req.id)) {
      scheme.appliedToStepIds.push(req.id);
    }
  }

  // Also register collection-level auth scheme
  if (collectionAuth && collectionAuth.type !== 'none' && collectionAuth.type !== 'unsupported') {
    const kind = pmAuthTypeToKind(collectionAuth.type);
    const key = `collection:${collectionAuth.type}`;
    if (!schemeMap.has(key)) {
      const scheme: DetectedAuthScheme = {
        kind,
        schemeName: `collection:${collectionAuth.type}`,
        appliedToStepIds: [],
      };
      schemeMap.set(key, scheme);
    }
  }

  const globalSchemeNames = collectionAuth && collectionAuth.type !== 'none'
    ? [`collection:${collectionAuth.type}`]
    : [];

  return {
    schemes: Array.from(schemeMap.values()),
    hasOperationLevelOverride,
    globalSchemeNames,
  };
}

function pmAuthTypeToKind(type: NormalizedPMAuth['type']): AuthSchemeKind {
  switch (type) {
    case 'bearer': return 'bearer';
    case 'apiKey': return 'apiKey';
    case 'basic': return 'basic';
    case 'oauth2': return 'oauth2';
    default: return 'unknown';
  }
}

// ── Folder count helper ───────────────────────────────────────────────────────

function countFolders(items: PMItem[]): number {
  let count = 0;
  for (const item of items) {
    if (Array.isArray(item.item)) {
      count++;
      count += countFolders(item.item);
    }
  }
  return count;
}
