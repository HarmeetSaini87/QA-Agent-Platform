// src/api-plugins/contracts/plugin-isolation.contracts.ts
// Phase E Step 8: Plugin isolation — tenant-safe, RBAC-aware, secret-safe execution contexts.

export interface PluginSecurityContext {
  readonly pluginId: string;
  readonly tenantId?: string;
  readonly actorRole: string;
  readonly allowedCapabilities: readonly string[];
  /** Secrets are NEVER passed to plugins — only masked references. */
  readonly maskedSecretRefs: readonly string[];
  readonly contextCreatedAt: string;
}

export type PluginPermissionCheck =
  | 'capability-allowed'
  | 'capability-denied'
  | 'tenant-mismatch'
  | 'role-insufficient'
  | 'plugin-disabled';

export interface PluginPermissionResult {
  readonly pluginId: string;
  readonly capability: string;
  readonly result: PluginPermissionCheck;
  readonly allowed: boolean;
  readonly reason: string;
  readonly checkedAt: string;
}

export interface IPluginSecurityGuard {
  createContext(pluginId: string, actorRole: string, tenantId?: string): PluginSecurityContext;
  checkPermission(context: PluginSecurityContext, capability: string): PluginPermissionResult;
  /** Advisory — checks if plugin isolation tier permits the requested operation. */
  assertIsolationCompliance(pluginId: string, requestedOperation: string): { compliant: boolean; reason: string };
}
