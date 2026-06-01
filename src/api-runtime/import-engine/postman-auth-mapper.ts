/**
 * import-engine/postman-auth-mapper.ts
 * Phase D Step 2 — Map normalized Postman auth to ApiAuthConfig + DetectedAuthScheme.
 *
 * INVARIANTS:
 *   - Produces ApiAuthConfig compatible with existing execution-engine / playwright-api-adapter.
 *   - No secrets written — token/password values are template placeholders ({{var}}) or empty.
 *   - unsupported PM auth types ('oauth1', 'ntlm', etc.) produce type:'none' + warning.
 *   - oauth2 maps to oauth2CC (client_credentials) when tokenUrl present; else type:'none' + warning.
 *   - ApiAuthConfig shape is NEVER changed here — only mapping logic lives here.
 */

import type { ApiAuthConfig } from '../../data/types';
import type { DetectedAuthScheme } from './contracts';
import type { ImportWarning } from './contracts';
import type { NormalizedPMAuth } from './postman-parser';

// ── Public result ─────────────────────────────────────────────────────────────

export interface AuthMapResult {
  /** Runtime-compatible auth config for ApiCollection / ApiTestStep */
  authConfig: ApiAuthConfig;
  /** Detection metadata for ImportResult.authMetadata */
  detectedScheme: DetectedAuthScheme;
  warnings: ImportWarning[];
}

// ── Main mapper ───────────────────────────────────────────────────────────────

export function mapPostmanAuth(
  pmAuth: NormalizedPMAuth,
  stepId: string,
  contextName: string,
): AuthMapResult {
  const warnings: ImportWarning[] = [];

  switch (pmAuth.type) {
    case 'none':
      return {
        authConfig: { type: 'none' },
        detectedScheme: noneScheme(stepId),
        warnings,
      };

    case 'bearer': {
      const token = pmAuth.bearer?.token ?? '';
      return {
        authConfig: { type: 'bearer', bearer: { token } },
        detectedScheme: {
          kind: 'bearer',
          schemeName: 'bearer',
          appliedToStepIds: [stepId],
        },
        warnings,
      };
    }

    case 'apiKey': {
      const ak = pmAuth.apiKey;
      // ApiAuthConfig.apiKey uses 'header' field name (not 'paramName')
      const header = ak?.paramName ?? 'X-Api-Key';
      const value = ak?.value ?? '';
      // Query-param API keys: execution-engine handles header placement only.
      // If location is 'query', emit a warning — runtime will inject as header.
      if (ak?.in === 'query') {
        warnings.push({
          code: 'UNSUPPORTED_AUTH',
          severity: 'warning',
          message: `API key for '${contextName}' is configured as query param; imported as header '${header}'. Adjust manually if query placement is required.`,
          context: contextName,
        });
      }
      return {
        authConfig: { type: 'apiKey', apiKey: { header, value } },
        detectedScheme: {
          kind: 'apiKey',
          schemeName: 'apiKey',
          paramName: header,
          appliedToStepIds: [stepId],
        },
        warnings,
      };
    }

    case 'basic': {
      const b = pmAuth.basic;
      return {
        authConfig: {
          type: 'basic',
          basic: { username: b?.username ?? '', password: b?.password ?? '' },
        },
        detectedScheme: {
          kind: 'basic',
          schemeName: 'basic',
          appliedToStepIds: [stepId],
        },
        warnings,
      };
    }

    case 'oauth2': {
      const o = pmAuth.oauth2;
      if (!o?.tokenUrl) {
        // No tokenUrl — cannot map to oauth2CC; fall back to none
        warnings.push({
          code: 'UNSUPPORTED_AUTH',
          severity: 'warning',
          message: `OAuth2 auth for '${contextName}' has no tokenUrl; mapped to 'none'. Configure manually or set tokenUrl in environment.`,
          context: contextName,
        });
        return {
          authConfig: { type: 'none' },
          detectedScheme: {
            kind: 'oauth2',
            schemeName: 'oauth2',
            tokenUrl: undefined,
            appliedToStepIds: [stepId],
          },
          warnings,
        };
      }
      return {
        authConfig: {
          type: 'oauth2CC',
          oauth2CC: {
            tokenUrl: o.tokenUrl,
            clientId: o.clientId ?? '',
            clientSecret: '', // never populate from Postman export — secrets not exported
            scope: o.scopes,
          },
        },
        detectedScheme: {
          kind: 'oauth2',
          schemeName: 'oauth2CC',
          tokenUrl: o.tokenUrl,
          scopes: o.scopes ? [o.scopes] : undefined,
          appliedToStepIds: [stepId],
        },
        warnings,
      };
    }

    case 'unsupported':
    default: {
      warnings.push({
        code: 'UNSUPPORTED_AUTH',
        severity: 'warning',
        message: `Auth type '${pmAuth.type}' for '${contextName}' has no runtime mapping; set to 'none'. Manual configuration required.`,
        context: contextName,
      });
      return {
        authConfig: { type: 'none' },
        detectedScheme: {
          kind: 'unknown',
          schemeName: pmAuth.type,
          appliedToStepIds: [stepId],
        },
        warnings,
      };
    }
  }
}

// ── Collection-level auth → ApiCollection authConfig ─────────────────────────

/**
 * Map collection-level Postman auth to ApiAuthConfig for ApiCollection.
 * Same logic as mapPostmanAuth but context is 'collection' not a step.
 */
export function mapCollectionAuth(
  pmAuth: NormalizedPMAuth | undefined,
  warnings: ImportWarning[],
): ApiAuthConfig {
  if (!pmAuth || pmAuth.type === 'none') return { type: 'none' };
  const result = mapPostmanAuth(pmAuth, 'collection', 'collection');
  warnings.push(...result.warnings);
  return result.authConfig;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function noneScheme(stepId: string): DetectedAuthScheme {
  return { kind: 'none', schemeName: 'none', appliedToStepIds: [stepId] };
}
