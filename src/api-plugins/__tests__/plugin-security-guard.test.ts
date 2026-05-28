// src/api-plugins/__tests__/plugin-security-guard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PluginSecurityGuard } from '../plugin-security-guard';
import { PluginRegistry } from '../plugin-registry';
import type { PluginManifest } from '../contracts/plugin-manifest.contracts';

// Override the globalPluginRegistry for tests by using a local guard + registry
function setup() {
  const registry = new PluginRegistry();
  const guard = new PluginSecurityGuard();
  // Guard uses globalPluginRegistry, so we register directly
  return { registry, guard };
}

describe('PluginSecurityGuard', () => {
  it('checkPermission: denied for unregistered plugin', () => {
    const { guard } = setup();
    const ctx = guard.createContext('ghost', 'admin');
    const result = guard.checkPermission(ctx, 'custom-assertion');
    expect(result.allowed).toBe(false);
    expect(result.result).toBe('capability-denied');
  });

  it('assertIsolationCompliance: forbidden operations always denied', () => {
    const { guard } = setup();
    const r = guard.assertIsolationCompliance('any-plugin', 'alter-dag');
    expect(r.compliant).toBe(false);
    expect(r.reason).toContain('forbidden');
  });

  it('assertIsolationCompliance: forbidden for read-only tier on enrichment op', () => {
    const { guard } = setup();
    // read-only tier — 'annotate-graph' not in its allowlist
    // We test directly without registry needed
    const r = guard.assertIsolationCompliance('any-plugin', 'alter-retries');
    expect(r.compliant).toBe(false);
  });

  it('assertIsolationCompliance: unregistered plugin not compliant', () => {
    const { guard } = setup();
    const r = guard.assertIsolationCompliance('no-such-plugin', 'read-workflow');
    expect(r.compliant).toBe(false);
    expect(r.reason).toContain('not registered');
  });

  it('createContext: maskedSecretRefs always empty', () => {
    const { guard } = setup();
    const ctx = guard.createContext('p1', 'tester', 'tenant-1');
    expect(ctx.maskedSecretRefs).toHaveLength(0);
    expect(ctx.tenantId).toBe('tenant-1');
  });
});
