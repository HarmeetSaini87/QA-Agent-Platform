import { v4 as uuidv4 } from 'uuid';
import type { ApiCollection, ApiTestStep, ApiRequest, ApiAuthConfig, ApiVariable } from '../data/types';

// ── Minimal Postman types ─────────────────────────────────────────────────────

interface PMAuth { type?: string; bearer?: { key: string; value: string }[]; apikey?: { key: string; value: string }[]; basic?: { key: string; value: string }[] }
interface PMHeader { key: string; value: string; disabled?: boolean }
interface PMBody { mode?: string; raw?: string; urlencoded?: { key: string; value: string; disabled?: boolean }[]; formdata?: { key: string; value: string; disabled?: boolean }[] }
interface PMUrl { raw?: string; host?: string[]; path?: string[]; query?: { key: string; value: string; disabled?: boolean }[] }
interface PMRequest { method?: string; header?: PMHeader[]; body?: PMBody; url?: PMUrl | string; auth?: PMAuth }
interface PMEvent { listen?: string }
interface PMItem { name?: string; request?: PMRequest; item?: PMItem[]; event?: PMEvent[]; disabled?: boolean }
interface PMVariable { key?: string; value?: string; type?: string }
interface PMInfo { name?: string; schema?: string }
interface PMCollection { info?: PMInfo; item?: PMItem[]; auth?: PMAuth; variable?: PMVariable[] }

function mapAuth(auth: PMAuth | undefined): ApiAuthConfig | undefined {
  if (!auth || !auth.type) return undefined;
  const t = auth.type.toLowerCase();
  if (t === 'bearer') {
    const token = auth.bearer?.find(b => b.key === 'token')?.value ?? '';
    return { type: 'bearer', bearer: { token } };
  }
  if (t === 'apikey') {
    const key = auth.apikey?.find(b => b.key === 'key')?.value ?? 'X-Api-Key';
    const value = auth.apikey?.find(b => b.key === 'value')?.value ?? '';
    return { type: 'apiKey', apiKey: { header: key, value } };
  }
  if (t === 'basic') {
    const username = auth.basic?.find(b => b.key === 'username')?.value ?? '';
    const password = auth.basic?.find(b => b.key === 'password')?.value ?? '';
    return { type: 'basic', basic: { username, password } };
  }
  return { type: 'none' };
}

function resolveUrl(url: PMUrl | string | undefined): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  return url.raw ?? [url.host?.join('.') ?? '', ...(url.path ?? [])].join('/');
}

function mapRequest(req: PMRequest): ApiRequest {
  const headers: Record<string, string> = {};
  for (const h of req.header ?? []) {
    if (!h.disabled) headers[h.key] = h.value;
  }

  let body: unknown = undefined;
  let bodyType: ApiRequest['bodyType'] = 'none';
  if (req.body) {
    if (req.body.mode === 'raw' && req.body.raw) {
      body = req.body.raw;
      bodyType = headers['Content-Type']?.includes('application/json') ? 'json' : 'raw';
      if (bodyType === 'json') {
        try { body = JSON.parse(req.body.raw); } catch { /* keep raw */ }
      }
    } else if (req.body.mode === 'urlencoded' && req.body.urlencoded) {
      const form: Record<string, string> = {};
      for (const f of req.body.urlencoded) {
        if (!f.disabled) form[f.key] = f.value;
      }
      body = form;
      bodyType = 'form';
    }
  }

  const url = resolveUrl(req.url);
  const method = (req.method ?? 'GET').toUpperCase() as ApiRequest['method'];

  return { method, url, headers: Object.keys(headers).length ? headers : undefined, body, bodyType };
}

function flattenItems(items: PMItem[], prefix: string): { item: PMItem; prefix: string }[] {
  const out: { item: PMItem; prefix: string }[] = [];
  for (const item of items) {
    if (item.item && item.item.length > 0) {
      const folderPrefix = prefix ? `${prefix} / ${item.name ?? ''}` : (item.name ?? '');
      out.push(...flattenItems(item.item, folderPrefix));
    } else if (item.request) {
      out.push({ item, prefix });
    }
  }
  return out;
}

export function importFromPostman(collectionJson: string, environmentId: string): ApiCollection {
  let col: PMCollection;
  try { col = JSON.parse(collectionJson) as PMCollection; }
  catch (e) { throw new Error(`Invalid Postman JSON: ${(e as Error).message}`); }

  const name = col.info?.name ?? 'Imported Postman Collection';
  const collectionAuth = mapAuth(col.auth);
  const variables: ApiVariable[] = (col.variable ?? [])
    .filter(v => v.key)
    .map(v => ({ key: v.key!, value: v.value ?? '', sensitive: false }));

  const flat = flattenItems(col.item ?? [], '');
  const steps: ApiTestStep[] = flat.map(({ item, prefix }) => {
    const stepName = prefix ? `${prefix} / ${item.name ?? 'Unnamed'}` : (item.name ?? 'Unnamed');
    const hasScripts = (item.event ?? []).some(e => e.listen === 'test' || e.listen === 'prerequest');
    if (hasScripts) {
      console.warn(`[postmanImport] "${stepName}" has test/pre-request scripts — not imported`);
    }

    const request = mapRequest(item.request ?? {});
    const condition = item.disabled ? 'false' : undefined;

    return {
      id: uuidv4(),
      name: stepName,
      request,
      assertions: [],
      extractVariables: [],
      execution: condition ? { condition } : {},
      dependsOn: [],
    };
  });

  return {
    id: uuidv4(),
    name,
    environmentId,
    steps,
    variables,
    onFailure: 'continue',
    executionMode: 'sequential',
    ...(collectionAuth ? { } : {}), // authConfig on ApiCollection not in spec §4 — skip
  };
}
