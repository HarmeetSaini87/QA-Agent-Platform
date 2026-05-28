// src/api-plugins/__tests__/plugin-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../plugin-registry';
import type { PluginManifest } from '../contracts/plugin-manifest.contracts';

function makeManifest(id: string, capabilities: PluginManifest['capabilities'] = ['custom-assertion']): PluginManifest {
  return {
    pluginId: id, name: `Plugin ${id}`, version: '1.0.0', author: 'test',
    capabilities, isolationTier: 'enrichment',
    requiredRoles: ['admin'], description: 'Test plugin', registeredAt: new Date().toISOString(),
  };
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  beforeEach(() => { registry = new PluginRegistry(); });

  it('register: initial status is registered', () => {
    const reg = registry.register(makeManifest('p1'));
    expect(reg.status).toBe('registered');
    expect(reg.manifest.pluginId).toBe('p1');
  });

  it('get: returns null for unknown plugin', () => {
    expect(registry.get('ghost')).toBeNull();
  });

  it('enable: transitions to enabled', () => {
    registry.register(makeManifest('p1'));
    expect(registry.enable('p1')).toBe(true);
    expect(registry.get('p1')?.status).toBe('enabled');
  });

  it('disable: transitions to disabled with reason', () => {
    registry.register(makeManifest('p1'));
    registry.disable('p1', 'audit-triggered');
    expect(registry.get('p1')?.status).toBe('disabled');
    expect(registry.get('p1')?.lastErrorMessage).toBe('audit-triggered');
  });

  it('list: filters by capability', () => {
    registry.register(makeManifest('p1', ['custom-assertion']));
    registry.register(makeManifest('p2', ['auth-provider']));
    const results = registry.list({ capability: 'custom-assertion' });
    expect(results.map(r => r.manifest.pluginId)).toContain('p1');
    expect(results.map(r => r.manifest.pluginId)).not.toContain('p2');
  });

  it('list: filters by status', () => {
    registry.register(makeManifest('p1'));
    registry.register(makeManifest('p2'));
    registry.enable('p2');
    expect(registry.list({ status: 'enabled' }).map(r => r.manifest.pluginId)).toContain('p2');
    expect(registry.list({ status: 'registered' }).map(r => r.manifest.pluginId)).toContain('p1');
  });

  it('unregister: removes plugin', () => {
    registry.register(makeManifest('p1'));
    expect(registry.unregister('p1')).toBe(true);
    expect(registry.get('p1')).toBeNull();
  });
});
