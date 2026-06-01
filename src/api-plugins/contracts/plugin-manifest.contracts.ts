// src/api-plugins/contracts/plugin-manifest.contracts.ts
// Phase E Step 8: Plugin manifest contracts — declare capabilities, permissions, isolation tier.

export type PluginCapability =
  | 'custom-assertion'
  | 'auth-provider'
  | 'request-transformer'
  | 'replay-enricher'
  | 'analytics-enricher'
  | 'graph-overlay-enricher'
  | 'ai-recommendation-enricher'
  | 'webhook-sink';

export type PluginIsolationTier = 'read-only' | 'enrichment' | 'integration';

export type PluginStatus = 'registered' | 'enabled' | 'disabled' | 'error';

export interface PluginManifest {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly capabilities: readonly PluginCapability[];
  readonly isolationTier: PluginIsolationTier;
  /** Roles that may activate this plugin. */
  readonly requiredRoles: readonly string[];
  readonly tenantId?: string;
  readonly description: string;
  readonly registeredAt: string;
}

export interface PluginRegistration {
  readonly manifest: PluginManifest;
  readonly status: PluginStatus;
  readonly enabledAt?: string;
  readonly disabledAt?: string;
  readonly lastErrorMessage?: string;
}

export interface IPluginRegistry {
  register(manifest: PluginManifest): PluginRegistration;
  enable(pluginId: string): boolean;
  disable(pluginId: string, reason?: string): boolean;
  get(pluginId: string): PluginRegistration | null;
  list(filter?: { capability?: PluginCapability; tenantId?: string; status?: PluginStatus }): PluginRegistration[];
  unregister(pluginId: string): boolean;
}
