import type { ApiAuthConfig } from '../data/types';
import type { VariableContext } from './apiVariables';
import { substituteVars } from './apiVariables';
import { decryptSensitiveVars } from './apiSecrets';

interface TokenCacheEntry { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenCacheEntry>();

function resolve(val: string, context: VariableContext): string {
  return substituteVars(val, context);
}

export async function resolveAuthHeaders(
  auth: ApiAuthConfig,
  context: VariableContext
): Promise<Record<string, string>> {
  if (!auth || auth.type === 'none') return {};

  if (auth.type === 'bearer' && auth.bearer) {
    const token = resolve(auth.bearer.token, context);
    return { Authorization: `Bearer ${token}` };
  }

  if (auth.type === 'apiKey' && auth.apiKey) {
    const value = resolve(auth.apiKey.value, context);
    return { [auth.apiKey.header]: value };
  }

  if (auth.type === 'basic' && auth.basic) {
    const [vars] = [decryptSensitiveVars([
      { key: 'u', value: auth.basic.username },
      { key: 'p', value: auth.basic.password },
    ])];
    const user = resolve(vars[0].value, context);
    const pass = resolve(vars[1].value, context);
    const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  if (auth.type === 'oauth2CC' && auth.oauth2CC) {
    const { tokenUrl, clientId, clientSecret, scope } = auth.oauth2CC;
    const cacheKey = `${clientId}::${tokenUrl}`;
    const cached = tokenCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt - now > 60_000) {
      return { Authorization: `Bearer ${cached.token}` };
    }

    // Fetch new token
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: resolve(clientId, context),
      client_secret: resolve(clientSecret, context),
      ...(scope ? { scope } : {}),
    });

    const resp = await fetch(resolve(tokenUrl, context), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) throw new Error(`OAuth2 token fetch failed: ${resp.status}`);
    const data = await resp.json() as { access_token: string; expires_in?: number };
    const expiresIn = (data.expires_in ?? 3600) * 1000;
    tokenCache.set(cacheKey, { token: data.access_token, expiresAt: now + expiresIn });
    return { Authorization: `Bearer ${data.access_token}` };
  }

  return {};
}
