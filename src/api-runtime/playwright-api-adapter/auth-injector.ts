/**
 * auth-injector.ts
 * SKELETON — Phase B implementation target.
 *
 * What moves here from apiAuth.ts (Phase B):
 * - resolveAuthHeaders() function
 * - OAuth2 client credentials token cache
 * - Token refresh logic
 *
 * apiAuth.ts STAYS in place and continues to work — this module
 * will import and re-export it during Phase B transition.
 */

import type { ApiAuthConfig } from '../../data/types';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';

export interface IAuthInjector {
  resolveHeaders(auth: ApiAuthConfig, context: VariableMap): Promise<Record<string, string>>;
  /** Invalidate cached OAuth2 token for a given tokenUrl */
  invalidateToken(tokenUrl: string): void;
}

// ── Phase A stub ──────────────────────────────────────────────────────────────

// SINGLETON RULE (Gate 2 — mandatory before Phase B):
// IAuthInjector implementation MUST be a singleton per server process.
// Phase B: AuthInjector wraps apiAuth.ts resolveAuthHeaders() + its module-level tokenCache.
// Phase C: coordinator receives ONE injector instance at boot via constructor/DI.
// NEVER create a new AuthInjector per request or per worker — the token cache
// becomes isolated per instance, causing redundant OAuth2 fetches and rate-limit exhaustion.
export class AuthInjectorStub implements IAuthInjector {
  async resolveHeaders(_auth: ApiAuthConfig, _context: VariableMap): Promise<Record<string, string>> {
    throw new Error('AuthInjector not implemented yet — Phase B target');
  }
  invalidateToken(_tokenUrl: string): void { /* no-op */ }
}
