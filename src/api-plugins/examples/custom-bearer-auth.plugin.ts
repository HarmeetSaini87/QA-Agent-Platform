// src/api-plugins/examples/custom-bearer-auth.plugin.ts
// Phase F — Example Plugin: custom-bearer-auth (auth-provider type)
//
// Demonstrates how to register an auth-provider plugin and a before-request hook.
// This example registers the plugin manifest and records a hook registration entry.
// In a real integration, the hook executor would call the token endpoint and inject
// the resulting Bearer token into the request headers.
//
// ADVISORY: example only. Register via loadExamplePlugins(). Never auto-registered.

import type { PluginManifest } from '../contracts/plugin-manifest.contracts';
import { globalPluginRegistry } from '../plugin-registry';
import { globalHookRegistry, makeHookRegistration } from '../hook-registry';

export const CUSTOM_BEARER_AUTH_PLUGIN_ID = 'example.custom-bearer-auth';

export const customBearerAuthManifest: PluginManifest = {
  pluginId: CUSTOM_BEARER_AUTH_PLUGIN_ID,
  name: 'Custom Bearer Auth Exchange',
  version: '1.0.0',
  author: 'TestForge Examples',
  description:
    'Exchanges a custom X-Custom-Auth header value for a Bearer token via a ' +
    'configurable token endpoint. Demonstrates auth-provider plugin pattern. ' +
    'Advisory only — does not alter execution, retries, or DAG.',
  capabilities: ['auth-provider'],
  isolationTier: 'enrichment',
  requiredRoles: ['admin', 'editor'],
  registeredAt: new Date().toISOString(),
};

/** Configuration supplied at registration time. */
export interface CustomBearerAuthConfig {
  /** Full URL of the token exchange endpoint. */
  tokenEndpoint: string;
  /** Custom header name carrying the raw auth credential. Default: X-Custom-Auth. */
  customAuthHeaderName?: string;
}

/**
 * Registers the custom-bearer-auth plugin manifest + before-request hook.
 * Call only via loadExamplePlugins() — never called automatically.
 */
export function registerCustomBearerAuthPlugin(config: CustomBearerAuthConfig): void {
  globalPluginRegistry.register(customBearerAuthManifest);
  globalPluginRegistry.enable(CUSTOM_BEARER_AUTH_PLUGIN_ID);

  const hookReg = makeHookRegistration(CUSTOM_BEARER_AUTH_PLUGIN_ID, 'before-request', 10);
  globalHookRegistry.registerHook(hookReg);

  // Config is stored for documentation/introspection — actual token exchange
  // is performed by the auth resolution layer when it finds a matching plugin.
  (customBearerAuthManifest as any)._exampleConfig = {
    tokenEndpoint: config.tokenEndpoint,
    customAuthHeaderName: config.customAuthHeaderName ?? 'X-Custom-Auth',
  };
}

export const CUSTOM_BEARER_AUTH_USAGE = `
## custom-bearer-auth plugin

**Type:** auth-provider
**Hook:** before-request (priority 10)

### How it works
1. Step request carries header: \`X-Custom-Auth: <credential>\`
2. Plugin annotates the request with the configured tokenEndpoint.
3. Auth resolution layer exchanges the credential for a Bearer token.
4. Bearer token injected into \`Authorization: Bearer <token>\` before the HTTP call.

### Registration
\`\`\`typescript
registerCustomBearerAuthPlugin({ tokenEndpoint: 'https://auth.example.com/token' });
\`\`\`

### Config
| Field | Type | Default | Description |
|---|---|---|---|
| tokenEndpoint | string | required | Token exchange URL |
| customAuthHeaderName | string | X-Custom-Auth | Header carrying the credential |
`;
