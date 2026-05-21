/**
 * rbac.contracts.ts — RBAC governance contracts for API resource permissions.
 * Additive layer: no changes to runtime execution.
 */

import { Role } from '../data/types';

/**
 * Named permissions that can be checked against a user's Role.
 * Each permission maps to a set of allowed roles.
 */
export type ApiResourcePermission =
  | 'api:execute'
  | 'api:view-replay'
  | 'api:view-graph'
  | 'api:file-defects'
  | 'api:run-teardown'
  | 'api:apply-healing'
  | 'api:manage-policies'
  | 'api:view-audit';

/**
 * Maps each ApiResourcePermission to the minimum roles that may exercise it.
 * Admin always has all permissions (checked separately in hasPermission).
 */
export const PERMISSION_ROLE_MAP: Record<ApiResourcePermission, Role[]> = {
  'api:execute':        ['admin', 'editor', 'tester'],
  'api:view-replay':    ['admin', 'editor', 'tester', 'viewer'],
  'api:view-graph':     ['admin', 'editor', 'tester', 'viewer'],
  'api:file-defects':   ['admin', 'editor', 'tester'],
  'api:run-teardown':   ['admin', 'editor'],
  'api:apply-healing':  ['admin', 'editor'],
  'api:manage-policies':['admin'],
  'api:view-audit':     ['admin'],
};

/**
 * Returns true if the given role has the given permission.
 * Admin always returns true regardless of the map.
 */
export function hasPermission(role: Role, permission: ApiResourcePermission): boolean {
  if (role === 'admin') return true;
  const allowed = PERMISSION_ROLE_MAP[permission];
  return allowed.includes(role);
}
