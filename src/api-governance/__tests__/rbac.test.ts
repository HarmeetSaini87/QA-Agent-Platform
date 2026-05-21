import { describe, it, expect } from 'vitest';
import { hasPermission, PERMISSION_ROLE_MAP, ApiResourcePermission } from '../rbac.contracts';
import { Role } from '../../data/types';

describe('RBAC Governance Contracts', () => {

  it('admin has all permissions', () => {
    const permissions = Object.keys(PERMISSION_ROLE_MAP) as ApiResourcePermission[];
    for (const perm of permissions) {
      expect(hasPermission('admin', perm)).toBe(true);
    }
  });

  it('viewer can only view-replay and view-graph', () => {
    expect(hasPermission('viewer', 'api:view-replay')).toBe(true);
    expect(hasPermission('viewer', 'api:view-graph')).toBe(true);
    expect(hasPermission('viewer', 'api:execute')).toBe(false);
    expect(hasPermission('viewer', 'api:file-defects')).toBe(false);
    expect(hasPermission('viewer', 'api:manage-policies')).toBe(false);
  });

  it('tester can execute, view-replay, view-graph, file-defects but not teardown', () => {
    expect(hasPermission('tester', 'api:execute')).toBe(true);
    expect(hasPermission('tester', 'api:view-replay')).toBe(true);
    expect(hasPermission('tester', 'api:file-defects')).toBe(true);
    expect(hasPermission('tester', 'api:run-teardown')).toBe(false);
    expect(hasPermission('tester', 'api:apply-healing')).toBe(false);
  });

  it('editor can execute, teardown, healing but not manage-policies', () => {
    expect(hasPermission('editor', 'api:execute')).toBe(true);
    expect(hasPermission('editor', 'api:run-teardown')).toBe(true);
    expect(hasPermission('editor', 'api:apply-healing')).toBe(true);
    expect(hasPermission('editor', 'api:manage-policies')).toBe(false);
    expect(hasPermission('editor', 'api:view-audit')).toBe(false);
  });

  it('PERMISSION_ROLE_MAP has no undefined entries', () => {
    const permissions = Object.keys(PERMISSION_ROLE_MAP) as ApiResourcePermission[];
    expect(permissions.length).toBeGreaterThan(0);
    for (const perm of permissions) {
      expect(Array.isArray(PERMISSION_ROLE_MAP[perm])).toBe(true);
      expect(PERMISSION_ROLE_MAP[perm].length).toBeGreaterThan(0);
    }
  });

  it('Role type includes editor without breaking existing roles', () => {
    const validRoles: Role[] = ['admin', 'editor', 'tester', 'viewer'];
    expect(validRoles).toContain('editor');
    expect(validRoles).toContain('admin');
    expect(validRoles).toContain('tester');
    expect(validRoles).toContain('viewer');
  });

});
