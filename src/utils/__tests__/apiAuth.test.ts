import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAuthHeaders } from '../apiAuth';
import type { ApiAuthConfig } from '../../data/types';
import type { VariableContext } from '../apiVariables';

vi.mock('../apiSecrets', () => ({
  decryptSensitiveVars: (vars: { key: string; value: string }[]) => vars,
}));

function makeAuth(type: ApiAuthConfig['type'], overrides: Partial<ApiAuthConfig> = {}): ApiAuthConfig {
  return { type, ...overrides } as ApiAuthConfig;
}

describe('apiAuth — resolveAuthHeaders', () => {
  const emptyCtx: VariableContext = {};

  describe('auth type: none', () => {
    it('returns empty headers', async () => {
      const headers = await resolveAuthHeaders({ type: 'none' }, emptyCtx);
      expect(headers).toEqual({});
    });

    it('null auth returns empty headers', async () => {
      const headers = await resolveAuthHeaders(null as any, emptyCtx);
      expect(headers).toEqual({});
    });
  });

  describe('auth type: bearer', () => {
    it('injects Authorization: Bearer header', async () => {
      const headers = await resolveAuthHeaders(
        makeAuth('bearer', { bearer: { token: 'mytoken123' } }),
        emptyCtx
      );
      expect(headers.Authorization).toBe('Bearer mytoken123');
    });

    it('resolves {{var}} in token from context', async () => {
      const ctx: VariableContext = { authToken: 'dynamic-jwt' };
      const headers = await resolveAuthHeaders(
        makeAuth('bearer', { bearer: { token: '{{authToken}}' } }),
        ctx
      );
      expect(headers.Authorization).toBe('Bearer dynamic-jwt');
    });

    it('empty token sends "Bearer " (no crash)', async () => {
      const headers = await resolveAuthHeaders(
        makeAuth('bearer', { bearer: { token: '' } }),
        emptyCtx
      );
      expect(headers.Authorization).toBe('Bearer ');
    });

    it('missing bearer field returns empty', async () => {
      const headers = await resolveAuthHeaders({ type: 'bearer' } as ApiAuthConfig, emptyCtx);
      expect(headers).toEqual({});
    });
  });

  describe('auth type: apiKey', () => {
    it('injects custom header', async () => {
      const headers = await resolveAuthHeaders(
        makeAuth('apiKey', { apiKey: { header: 'X-API-Key', value: 'key-value-123' } }),
        emptyCtx
      );
      expect(headers['X-API-Key']).toBe('key-value-123');
    });

    it('resolves {{var}} in apiKey value', async () => {
      const ctx: VariableContext = { myApiKey: 'resolved-key' };
      const headers = await resolveAuthHeaders(
        makeAuth('apiKey', { apiKey: { header: 'X-API-Key', value: '{{myApiKey}}' } }),
        ctx
      );
      expect(headers['X-API-Key']).toBe('resolved-key');
    });

    it('missing apiKey field returns empty', async () => {
      const headers = await resolveAuthHeaders({ type: 'apiKey' } as ApiAuthConfig, emptyCtx);
      expect(headers).toEqual({});
    });
  });

  describe('auth type: basic', () => {
    it('injects Authorization: Basic header with base64(user:pass)', async () => {
      const headers = await resolveAuthHeaders(
        makeAuth('basic', { basic: { username: 'user', password: 'pass' } }),
        emptyCtx
      );
      const expected = Buffer.from('user:pass').toString('base64');
      expect(headers.Authorization).toBe(`Basic ${expected}`);
    });

    it('resolves {{var}} in username and password', async () => {
      const ctx: VariableContext = { apiUser: 'admin@test.com', apiPass: 's3cret' };
      const headers = await resolveAuthHeaders(
        makeAuth('basic', { basic: { username: '{{apiUser}}', password: '{{apiPass}}' } }),
        ctx
      );
      const expected = Buffer.from('admin@test.com:s3cret').toString('base64');
      expect(headers.Authorization).toBe(`Basic ${expected}`);
    });

    it('handles special characters in credentials', async () => {
      const headers = await resolveAuthHeaders(
        makeAuth('basic', { basic: { username: 'user@domain.com', password: 'p@$$w0rd!' } }),
        emptyCtx
      );
      const expected = Buffer.from('user@domain.com:p@$$w0rd!').toString('base64');
      expect(headers.Authorization).toBe(`Basic ${expected}`);
    });

    it('missing basic field returns empty', async () => {
      const headers = await resolveAuthHeaders({ type: 'basic' } as ApiAuthConfig, emptyCtx);
      expect(headers).toEqual({});
    });
  });

  describe('auth type: oauth2CC', () => {
    it('fetches token and returns Bearer header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'fetched-oauth-token', expires_in: 3600 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const headers = await resolveAuthHeaders(
        makeAuth('oauth2CC', {
          oauth2CC: { tokenUrl: 'https://auth.example.com/token', clientId: 'my-client', clientSecret: 'my-secret', scope: 'api:read' },
        }),
        emptyCtx
      );

      expect(mockFetch).toHaveBeenCalled();
      expect(headers.Authorization).toBe('Bearer fetched-oauth-token');

      vi.restoreAllMocks();
    });

    it('uses cached token on second call (within expiry)', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ access_token: `token-${callCount}`, expires_in: 3600 }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const auth = makeAuth('oauth2CC', {
        oauth2CC: { tokenUrl: 'https://auth.example.com/token', clientId: 'cache-client', clientSecret: 'cache-secret', scope: 'api:read' },
      });

      await resolveAuthHeaders(auth, emptyCtx);
      await resolveAuthHeaders(auth, emptyCtx);

      expect(callCount).toBe(1);

      vi.restoreAllMocks();
    });

    it('throws on 401 from token endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        resolveAuthHeaders(
          makeAuth('oauth2CC', {
            oauth2CC: { tokenUrl: 'https://auth.example.com/token', clientId: 'bad-client', clientSecret: 'bad-secret' },
          }),
          emptyCtx
        )
      ).rejects.toThrow('OAuth2 token fetch failed: 401');

      vi.restoreAllMocks();
    });

    it('resolves {{var}} in clientId, clientSecret, tokenUrl', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'resolved-token', expires_in: 3600 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const ctx: VariableContext = { tokenHost: 'https://auth.example.com', cId: 'my-client', cSecret: 'my-secret' };
      await resolveAuthHeaders(
        makeAuth('oauth2CC', {
          oauth2CC: { tokenUrl: '{{tokenHost}}/oauth/token', clientId: '{{cId}}', clientSecret: '{{cSecret}}' },
        }),
        ctx
      );

      expect(mockFetch).toHaveBeenCalled();
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toBe('https://auth.example.com/oauth/token');

      vi.restoreAllMocks();
    });
  });

  describe('edge cases', () => {
    it('unknown auth type returns empty headers', async () => {
      const headers = await resolveAuthHeaders({ type: 'unknown' } as ApiAuthConfig, emptyCtx);
      expect(headers).toEqual({});
    });

    it('bearer with undefined context variable leaves placeholder', async () => {
      const headers = await resolveAuthHeaders(
        makeAuth('bearer', { bearer: { token: '{{MISSING_TOKEN}}' } }),
        {}
      );
      expect(headers.Authorization).toBe('Bearer {{MISSING_TOKEN}}');
    });
  });
});