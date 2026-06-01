// src/api-plugins/plugin-security-guard.ts
// Phase E Step 8: RBAC-aware, tenant-safe plugin security guard.

import type {
  IPluginSecurityGuard,
  PluginSecurityContext,
  PluginPermissionResult,
} from './contracts/plugin-isolation.contracts';
import { globalPluginRegistry } from './plugin-registry';

// Operations never permitted at any isolation tier
const FORBIDDEN_OPERATIONS = new Set([
  'alter-dag', 'alter-retries', 'alter-execution-order', 'mutate-workflow-envelope',
  'read-unmasked-secrets', 'bypass-rbac',
]);

// Isolation tier capability allowlist
const TIER_ALLOWED_OPERATIONS: Record<string, Set<string>> = {
  'read-only': new Set(['read-workflow', 'read-replay-summary', 'read-graph-summary', 'read-analytics']),
  'enrichment': new Set(['read-workflow', 'read-replay-summary', 'read-graph-summary', 'read-analytics', 'annotate-replay', 'annotate-graph', 'emit-analytics', 'run-assertion']),
  'integration': new Set(['read-workflow', 'read-replay-summary', 'read-graph-summary', 'read-analytics', 'annotate-replay', 'annotate-graph', 'emit-analytics', 'run-assertion', 'webhook-emit', 'auth-provide']),
};

export class PluginSecurityGuard implements IPluginSecurityGuard {
  createContext(pluginId: string, actorRole: string, tenantId?: string): PluginSecurityContext {
    const reg = globalPluginRegistry.get(pluginId);
    const allowedCapabilities = reg ? [...reg.manifest.capabilities] : [];
    return {
      pluginId,
      tenantId,
      actorRole,
      allowedCapabilities,
      maskedSecretRefs: [],  // secrets never passed to plugins
      contextCreatedAt: new Date().toISOString(),
    };
  }

  checkPermission(context: PluginSecurityContext, capability: string): PluginPermissionResult {
    const checkedAt = new Date().toISOString();
    const reg = globalPluginRegistry.get(context.pluginId);

    if (!reg) {
      return { pluginId: context.pluginId, capability, result: 'capability-denied', allowed: false, reason: 'Plugin not registered.', checkedAt };
    }

    if (reg.status !== 'enabled') {
      return { pluginId: context.pluginId, capability, result: 'plugin-disabled', allowed: false, reason: `Plugin status is "${reg.status}".`, checkedAt };
    }

    // Tenant isolation
    if (reg.manifest.tenantId && context.tenantId && reg.manifest.tenantId !== context.tenantId) {
      return { pluginId: context.pluginId, capability, result: 'tenant-mismatch', allowed: false, reason: 'Plugin tenant does not match request tenant.', checkedAt };
    }

    // Role check
    if (reg.manifest.requiredRoles.length > 0 && !reg.manifest.requiredRoles.includes(context.actorRole)) {
      return { pluginId: context.pluginId, capability, result: 'role-insufficient', allowed: false, reason: `Role "${context.actorRole}" not in requiredRoles.`, checkedAt };
    }

    const allowed = (context.allowedCapabilities as string[]).includes(capability);
    return {
      pluginId: context.pluginId, capability,
      result: allowed ? 'capability-allowed' : 'capability-denied',
      allowed,
      reason: allowed ? 'Capability permitted.' : `Capability "${capability}" not declared in plugin manifest.`,
      checkedAt,
    };
  }

  assertIsolationCompliance(pluginId: string, requestedOperation: string): { compliant: boolean; reason: string } {
    if (FORBIDDEN_OPERATIONS.has(requestedOperation)) {
      return { compliant: false, reason: `Operation "${requestedOperation}" is forbidden for all plugin isolation tiers.` };
    }

    const reg = globalPluginRegistry.get(pluginId);
    if (!reg) return { compliant: false, reason: 'Plugin not registered.' };

    const tier = reg.manifest.isolationTier;
    const allowed = TIER_ALLOWED_OPERATIONS[tier];
    const compliant = !allowed || allowed.has(requestedOperation);

    return {
      compliant,
      reason: compliant
        ? `Operation "${requestedOperation}" permitted for isolation tier "${tier}".`
        : `Operation "${requestedOperation}" not permitted for isolation tier "${tier}".`,
    };
  }
}

export const globalPluginSecurityGuard = new PluginSecurityGuard();
