// src/api-plugins/plugin-registry.ts
// Phase E Step 8: Plugin registry — register, enable, disable, list plugins.

import type {
  IPluginRegistry,
  PluginManifest,
  PluginRegistration,
  PluginCapability,
  PluginStatus,
} from './contracts/plugin-manifest.contracts';

export class PluginRegistry implements IPluginRegistry {
  private readonly _plugins = new Map<string, PluginRegistration>();

  register(manifest: PluginManifest): PluginRegistration {
    const registration: PluginRegistration = {
      manifest,
      status: 'registered',
    };
    this._plugins.set(manifest.pluginId, registration);
    return registration;
  }

  enable(pluginId: string): boolean {
    const reg = this._plugins.get(pluginId);
    if (!reg) return false;
    this._plugins.set(pluginId, { ...reg, status: 'enabled', enabledAt: new Date().toISOString(), disabledAt: undefined });
    return true;
  }

  disable(pluginId: string, reason?: string): boolean {
    const reg = this._plugins.get(pluginId);
    if (!reg) return false;
    this._plugins.set(pluginId, {
      ...reg,
      status: 'disabled',
      disabledAt: new Date().toISOString(),
      ...(reason && { lastErrorMessage: reason }),
    });
    return true;
  }

  get(pluginId: string): PluginRegistration | null {
    return this._plugins.get(pluginId) ?? null;
  }

  list(filter?: { capability?: PluginCapability; tenantId?: string; status?: PluginStatus }): PluginRegistration[] {
    let results = Array.from(this._plugins.values());
    if (filter?.capability) {
      results = results.filter(r => r.manifest.capabilities.includes(filter.capability!));
    }
    if (filter?.tenantId) {
      results = results.filter(r => !r.manifest.tenantId || r.manifest.tenantId === filter.tenantId);
    }
    if (filter?.status) {
      results = results.filter(r => r.status === filter.status);
    }
    return results;
  }

  unregister(pluginId: string): boolean {
    return this._plugins.delete(pluginId);
  }
}

export const globalPluginRegistry = new PluginRegistry();
