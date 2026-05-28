# Enterprise Governance, RBAC & Auditability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add enterprise RBAC governance, typed audit events, multi-tenant isolation contracts, governance policy registry, and a lightweight governance UI — without modifying runtime execution.

**Architecture:** Governance is a pure control/policy/observability layer. All new contracts are additive and JSON-serialisable. Runtime execution, DAG, WorkflowEnvelope, and retries are untouched. Existing `Role` type gains `'editor'`; all existing role checks remain valid.

**Tech Stack:** TypeScript · Express.js · Vitest · Vanilla JS frontend

---

## Task 1 — RBAC Governance Contracts + `requirePermission` middleware

**Files to create/edit:**
- `src/api-governance/rbac.contracts.ts` (new)
- `src/api-governance/rbac.middleware.ts` (new)
- `src/data/types.ts` (edit — extend `Role`)
- `tests/api-governance/rbac.test.ts` (new)

---

### Step 1.1 — Extend `Role` in `src/data/types.ts`

- [ ] Open `src/data/types.ts`. Find line 5:
  ```typescript
  type Role = 'admin' | 'tester' | 'viewer';
  ```
  Change to:
  ```typescript
  // OLD: type Role = 'admin' | 'tester' | 'viewer';
  export type Role = 'admin' | 'editor' | 'tester' | 'viewer';
  ```
  Note: `Role` must be exported (add `export` if not already present) so governance modules can import it.

---

### Step 1.2 — Create `src/api-governance/rbac.contracts.ts`

- [ ] Create the file with the following complete content:

```typescript
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
```

---

### Step 1.3 — Create `src/api-governance/rbac.middleware.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * rbac.middleware.ts — requirePermission middleware factory.
 * Wraps hasPermission; reads role from session.
 * Does NOT modify runtime execution logic.
 */

import { Request, Response, NextFunction } from 'express';
import { ApiResourcePermission, hasPermission } from './rbac.contracts';
import { Role } from '../data/types';

/**
 * Factory: returns an Express middleware that requires the authenticated user
 * (or API-key-authenticated request) to hold the given permission.
 *
 * Usage:
 *   router.get('/sensitive', requireAuth, requirePermission('api:view-audit'), handler);
 */
export function requirePermission(permission: ApiResourcePermission) {
  return function permissionGuard(req: Request, res: Response, next: NextFunction): void {
    // API-key requests are treated as 'editor' trust level unless session provides role
    const role: Role = (req.session?.role as Role) ?? ((req as any).apiKeyId ? 'editor' : 'viewer');

    if (hasPermission(role, permission)) {
      next();
      return;
    }

    res.status(403).json({
      error: 'Forbidden',
      reason: `Permission '${permission}' requires one of: admin, ${
        ([] as Role[])
          .concat(['admin', 'editor', 'tester', 'viewer'] as Role[])
          .filter(r => hasPermission(r, permission))
          .join(', ')
      }. Your role: ${role}`,
    });
  };
}
```

---

### Step 1.4 — Create `tests/api-governance/rbac.test.ts`

- [ ] Create the directory `tests/api-governance/` if it does not exist.
- [ ] Create the file with the following complete content:

```typescript
import { describe, it, expect } from 'vitest';
import { hasPermission, PERMISSION_ROLE_MAP, ApiResourcePermission } from '../../src/api-governance/rbac.contracts';
import { Role } from '../../src/data/types';

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
```

---

### Step 1.5 — Run tests

- [ ] Run:
  ```
  npx vitest run tests/api-governance/rbac.test.ts --reporter=verbose
  ```
  Expected output:
  ```
  ✓ RBAC Governance Contracts > admin has all permissions
  ✓ RBAC Governance Contracts > viewer can only view-replay and view-graph
  ✓ RBAC Governance Contracts > tester can execute, view-replay, view-graph, file-defects but not teardown
  ✓ RBAC Governance Contracts > editor can execute, teardown, healing but not manage-policies
  ✓ RBAC Governance Contracts > PERMISSION_ROLE_MAP has no undefined entries
  ✓ RBAC Governance Contracts > Role type includes editor without breaking existing roles
  Test Files  1 passed (1)
  Tests  6 passed (6)
  ```

---

### Step 1.6 — Git commit

- [ ] Run:
  ```
  git add src/api-governance/rbac.contracts.ts src/api-governance/rbac.middleware.ts src/data/types.ts tests/api-governance/rbac.test.ts
  git commit -m "$(cat <<'EOF'
  feat(governance): RBAC contracts + requirePermission middleware

  Add Role='editor', ApiResourcePermission type, PERMISSION_ROLE_MAP,
  hasPermission() helper, and requirePermission() middleware factory.
  Additive only — no existing auth logic modified.
  EOF
  )"
  ```

---

## Task 2 — Extended Audit Model: `ApiAuditAction`, `logApiAudit`, tenant/correlation extensions

**Files to create/edit:**
- `src/api-governance/audit.contracts.ts` (new)
- `src/api-governance/audit.helper.ts` (new)
- `tests/api-governance/audit.test.ts` (new)

> `src/auth/audit.ts` and `AuditEntry` in `src/data/types.ts` are NOT modified.
> Extensions are additive via intersection / wrapper pattern.

---

### Step 2.1 — Create `src/api-governance/audit.contracts.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * audit.contracts.ts — Typed API audit actions and extended audit entry.
 * Does NOT modify existing AuditEntry or logAudit in src/auth/audit.ts.
 * All extensions are additive.
 */

import { AuditEntry } from '../data/types';

/**
 * Typed audit actions for API governance events.
 * Prefixed with 'api:' to namespace from existing action strings.
 */
export type ApiAuditAction =
  | 'api:collection:execute'
  | 'api:collection:view'
  | 'api:replay:access'
  | 'api:graph:access'
  | 'api:defect:filed'
  | 'api:healing:applied'
  | 'api:suite:execute'
  | 'api:teardown:execute'
  | 'api:environment:accessed'
  | 'api:variable:accessed';

/**
 * Extended audit entry — adds governance fields on top of the base AuditEntry.
 * Stored as a plain AuditEntry (details field carries the extras as JSON).
 * tenantId and correlationId are optional — backward compatible.
 */
export interface ExtendedAuditEntry extends AuditEntry {
  tenantId?:         string;
  correlationId?:    string;
  governanceAction?: ApiAuditAction;
}

/**
 * Extras passed to logApiAudit beyond the standard fields.
 */
export interface ApiAuditExtras {
  tenantId?:      string;
  correlationId?: string;
  details?:       string;
}
```

---

### Step 2.2 — Create `src/api-governance/audit.helper.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * audit.helper.ts — logApiAudit wrapper around existing logAudit.
 * logAudit is UNCHANGED. This helper composes typed action + extras
 * into the existing AuditEntry shape.
 */

import { Request } from 'express';
import { logAudit } from '../auth/audit';
import { getClientIp } from '../auth/getClientIp';
import { ApiAuditAction, ApiAuditExtras } from './audit.contracts';

/**
 * Log a typed API governance audit event.
 *
 * @param action       - Typed ApiAuditAction enum value
 * @param resourceId   - The resource being acted on (collectionId, runId, etc.)
 * @param req          - Express request (for userId, username, IP extraction)
 * @param extras       - Optional: tenantId, correlationId, details override
 */
export function logApiAudit(
  action: ApiAuditAction,
  resourceId: string | null,
  req: Request,
  extras?: ApiAuditExtras,
): void {
  const userId   = req.session?.userId   ?? null;
  const username = req.session?.username ?? ((req as any).apiKeyName ?? null);
  const ip       = getClientIp(req);

  // Build details JSON: merges governanceAction + correlationId + tenantId + any caller details
  const detailsObj: Record<string, unknown> = {
    governanceAction: action,
  };
  if (extras?.correlationId) detailsObj.correlationId = extras.correlationId;
  if (extras?.tenantId)      detailsObj.tenantId      = extras.tenantId;
  if (extras?.details)       detailsObj.extra          = extras.details;

  logAudit({
    userId,
    username,
    action,
    resourceType: deriveResourceType(action),
    resourceId,
    details: JSON.stringify(detailsObj),
    ip,
  });
}

/**
 * Derives a human-readable resourceType string from the action prefix.
 */
function deriveResourceType(action: ApiAuditAction): string {
  const parts = action.split(':');
  // e.g. 'api:collection:execute' → 'api-collection'
  return parts.slice(0, 2).join('-');
}
```

---

### Step 2.3 — Create `tests/api-governance/audit.test.ts`

- [ ] Create the file with the following complete content:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiAuditAction, ApiAuditExtras, ExtendedAuditEntry } from '../../src/api-governance/audit.contracts';
import { AuditEntry } from '../../src/data/types';

// Mock logAudit to intercept calls without file I/O
vi.mock('../../src/auth/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../src/auth/getClientIp', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { logAudit } from '../../src/auth/audit';
import { logApiAudit } from '../../src/api-governance/audit.helper';

function makeReq(overrides: Record<string, unknown> = {}): any {
  return {
    session: { userId: 'u1', username: 'alice', role: 'editor' },
    headers: {},
    ...overrides,
  };
}

describe('Extended Audit Model', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ApiAuditAction values are defined strings', () => {
    const actions: ApiAuditAction[] = [
      'api:collection:execute',
      'api:collection:view',
      'api:replay:access',
      'api:graph:access',
      'api:defect:filed',
      'api:healing:applied',
      'api:suite:execute',
      'api:teardown:execute',
      'api:environment:accessed',
      'api:variable:accessed',
    ];
    expect(actions.length).toBe(10);
    for (const a of actions) {
      expect(typeof a).toBe('string');
      expect(a.startsWith('api:')).toBe(true);
    }
  });

  it('logApiAudit calls logAudit with correct action and resourceId', () => {
    const req = makeReq();
    logApiAudit('api:collection:execute', 'col-123', req);
    expect(logAudit).toHaveBeenCalledOnce();
    const entry = (logAudit as any).mock.calls[0][0];
    expect(entry.action).toBe('api:collection:execute');
    expect(entry.resourceId).toBe('col-123');
    expect(entry.userId).toBe('u1');
  });

  it('logApiAudit embeds correlationId and tenantId in details JSON', () => {
    const req = makeReq();
    const extras: ApiAuditExtras = { correlationId: 'corr-99', tenantId: 'tenant-acme' };
    logApiAudit('api:suite:execute', 'suite-7', req, extras);
    const entry = (logAudit as any).mock.calls[0][0];
    const details = JSON.parse(entry.details);
    expect(details.correlationId).toBe('corr-99');
    expect(details.tenantId).toBe('tenant-acme');
    expect(details.governanceAction).toBe('api:suite:execute');
  });

  it('logApiAudit falls back to apiKeyName when session username absent', () => {
    const req = makeReq({ session: undefined, apiKeyName: 'ci-key' });
    logApiAudit('api:replay:access', 'run-55', req);
    const entry = (logAudit as any).mock.calls[0][0];
    expect(entry.username).toBe('ci-key');
    expect(entry.userId).toBeNull();
  });

  it('ExtendedAuditEntry is structurally compatible with AuditEntry', () => {
    const base: AuditEntry = {
      id: 'ae1',
      userId: 'u1',
      username: 'alice',
      action: 'api:collection:execute',
      resourceType: 'api-collection',
      resourceId: 'col-1',
      details: null,
      ip: '127.0.0.1',
      createdAt: new Date().toISOString(),
    };
    const extended: ExtendedAuditEntry = {
      ...base,
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      governanceAction: 'api:collection:execute',
    };
    expect(extended.tenantId).toBe('tenant-1');
    expect(extended.correlationId).toBe('corr-1');
    expect(extended.id).toBe('ae1');
  });

});
```

---

### Step 2.4 — Run tests

- [ ] Run:
  ```
  npx vitest run tests/api-governance/audit.test.ts --reporter=verbose
  ```
  Expected output:
  ```
  ✓ Extended Audit Model > ApiAuditAction values are defined strings
  ✓ Extended Audit Model > logApiAudit calls logAudit with correct action and resourceId
  ✓ Extended Audit Model > logApiAudit embeds correlationId and tenantId in details JSON
  ✓ Extended Audit Model > logApiAudit falls back to apiKeyName when session username absent
  ✓ Extended Audit Model > ExtendedAuditEntry is structurally compatible with AuditEntry
  Test Files  1 passed (1)
  Tests  5 passed (5)
  ```

---

### Step 2.5 — Git commit

- [ ] Run:
  ```
  git add src/api-governance/audit.contracts.ts src/api-governance/audit.helper.ts tests/api-governance/audit.test.ts
  git commit -m "$(cat <<'EOF'
  feat(governance): typed ApiAuditAction + logApiAudit helper

  Add ApiAuditAction enum, ExtendedAuditEntry interface, and logApiAudit()
  wrapper. logAudit() in src/auth/audit.ts is unchanged. Extras (tenantId,
  correlationId) serialised into details JSON.
  EOF
  )"
  ```

---

## Task 3 — Multi-Tenant Isolation Contracts + `getTenantContext`

**Files to create/edit:**
- `src/api-governance/tenant.contracts.ts` (new)
- `src/api-governance/tenant.helper.ts` (new)
- `tests/api-governance/tenant.test.ts` (new)

---

### Step 3.1 — Create `src/api-governance/tenant.contracts.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * tenant.contracts.ts — Multi-tenant isolation contracts.
 * All types are JSON-serialisable.
 * No storage redesign — tenantId is read from session only.
 */

/**
 * Runtime tenant context resolved per-request.
 * null means single-tenant mode (no tenant isolation).
 */
export interface TenantContext {
  tenantId:      string;
  tenantName:    string;
  isolationMode: 'shared' | 'isolated';
}

/**
 * Policy governing how a tenant's data is isolated.
 * Additive — not enforced by runtime; consumed by governance layer only.
 */
export interface TenantIsolationPolicy {
  tenantId:              string;
  isolationMode:         'shared' | 'isolated';
  allowCrossProjectRead: boolean;
  allowCrossProjectWrite: boolean;
  /** Max collections allowed for this tenant; undefined = unlimited */
  maxCollections?:       number;
  /** Max parallel execution workers; undefined = platform default */
  maxWorkers?:           number;
}

/**
 * Default permissive tenant isolation policy (single-tenant mode).
 */
export const DEFAULT_TENANT_ISOLATION_POLICY: TenantIsolationPolicy = {
  tenantId:               'default',
  isolationMode:          'shared',
  allowCrossProjectRead:  true,
  allowCrossProjectWrite: true,
};
```

---

### Step 3.2 — Create `src/api-governance/tenant.helper.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * tenant.helper.ts — getTenantContext: resolves TenantContext from request session.
 * Returns null in single-tenant mode (no tenantId on session).
 * No storage reads; reads session only.
 */

import { Request } from 'express';
import { TenantContext } from './tenant.contracts';

/**
 * Resolve TenantContext from the Express request.
 *
 * - Returns null when tenantId is not present on session (single-tenant mode).
 * - Returns a TenantContext with isolationMode defaulting to 'shared'.
 */
export function getTenantContext(req: Request): TenantContext | null {
  const tenantId   = (req.session as any)?.tenantId   as string | undefined;
  const tenantName = (req.session as any)?.tenantName as string | undefined;

  if (!tenantId) return null;

  return {
    tenantId,
    tenantName:    tenantName ?? tenantId,
    isolationMode: ((req.session as any)?.tenantIsolationMode as 'shared' | 'isolated') ?? 'shared',
  };
}
```

---

### Step 3.3 — Create `tests/api-governance/tenant.test.ts`

- [ ] Create the file with the following complete content:

```typescript
import { describe, it, expect } from 'vitest';
import {
  TenantContext,
  TenantIsolationPolicy,
  DEFAULT_TENANT_ISOLATION_POLICY,
} from '../../src/api-governance/tenant.contracts';
import { getTenantContext } from '../../src/api-governance/tenant.helper';

function makeReq(sessionOverrides: Record<string, unknown> = {}): any {
  return {
    session: {
      userId: 'u1',
      username: 'alice',
      role: 'admin',
      ...sessionOverrides,
    },
  };
}

describe('Multi-Tenant Isolation Contracts', () => {

  it('getTenantContext returns null when no tenantId on session (single-tenant)', () => {
    const req = makeReq();
    const ctx = getTenantContext(req);
    expect(ctx).toBeNull();
  });

  it('getTenantContext returns TenantContext when tenantId present', () => {
    const req = makeReq({ tenantId: 'acme', tenantName: 'ACME Corp' });
    const ctx = getTenantContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('acme');
    expect(ctx!.tenantName).toBe('ACME Corp');
    expect(ctx!.isolationMode).toBe('shared');
  });

  it('getTenantContext defaults tenantName to tenantId when name absent', () => {
    const req = makeReq({ tenantId: 'beta-corp' });
    const ctx = getTenantContext(req);
    expect(ctx!.tenantName).toBe('beta-corp');
  });

  it('getTenantContext reads isolationMode from session', () => {
    const req = makeReq({ tenantId: 'corp-x', tenantIsolationMode: 'isolated' });
    const ctx = getTenantContext(req);
    expect(ctx!.isolationMode).toBe('isolated');
  });

  it('DEFAULT_TENANT_ISOLATION_POLICY is permissive shared mode', () => {
    const p: TenantIsolationPolicy = DEFAULT_TENANT_ISOLATION_POLICY;
    expect(p.isolationMode).toBe('shared');
    expect(p.allowCrossProjectRead).toBe(true);
    expect(p.allowCrossProjectWrite).toBe(true);
    expect(p.tenantId).toBe('default');
  });

});
```

---

### Step 3.4 — Run tests

- [ ] Run:
  ```
  npx vitest run tests/api-governance/tenant.test.ts --reporter=verbose
  ```
  Expected output:
  ```
  ✓ Multi-Tenant Isolation Contracts > getTenantContext returns null when no tenantId on session (single-tenant)
  ✓ Multi-Tenant Isolation Contracts > getTenantContext returns TenantContext when tenantId present
  ✓ Multi-Tenant Isolation Contracts > getTenantContext defaults tenantName to tenantId when name absent
  ✓ Multi-Tenant Isolation Contracts > getTenantContext reads isolationMode from session
  ✓ Multi-Tenant Isolation Contracts > DEFAULT_TENANT_ISOLATION_POLICY is permissive shared mode
  Test Files  1 passed (1)
  Tests  5 passed (5)
  ```

---

### Step 3.5 — Git commit

- [ ] Run:
  ```
  git add src/api-governance/tenant.contracts.ts src/api-governance/tenant.helper.ts tests/api-governance/tenant.test.ts
  git commit -m "$(cat <<'EOF'
  feat(governance): multi-tenant isolation contracts + getTenantContext helper

  Add TenantContext, TenantIsolationPolicy, DEFAULT_TENANT_ISOLATION_POLICY,
  and getTenantContext(req). Returns null in single-tenant mode.
  No storage redesign — reads session only.
  EOF
  )"
  ```

---

## Task 4 — Governance Policy Registry

**Files to create/edit:**
- `src/api-governance/policy.contracts.ts` (new)
- `src/api-governance/policy.registry.ts` (new)
- `tests/api-governance/policy.test.ts` (new)

---

### Step 4.1 — Create `src/api-governance/policy.contracts.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * policy.contracts.ts — GovernancePolicy, ExecutionGate, PolicyCheckResult.
 * Approval engine is NOT implemented here — requiresApproval is a flag only.
 * All types are JSON-serialisable.
 */

import { Role } from '../data/types';

/**
 * A governance policy applied to API collection execution.
 */
export interface GovernancePolicy {
  policyId:               string;
  name:                   string;
  /** When true, execution should be gated (approval engine is future work) */
  requiresApproval:       boolean;
  /** Roles allowed to execute under this policy */
  allowedRoles:           Role[];
  /** Environment IDs that are restricted under this policy */
  restrictedEnvironmentIds: string[];
  /** Max retries allowed; undefined = platform default */
  maxRetries?:            number;
  /** When true, teardown phases are protected from ad-hoc cancellation */
  teardownProtected:      boolean;
}

/**
 * Result of a policy check.
 */
export interface PolicyCheckResult {
  allowed:          boolean;
  reason?:          string;
  requiresApproval: boolean;
}

/**
 * Contract for an ExecutionGate — evaluates policy before execution.
 * InMemoryGovernancePolicyRegistry implements this.
 */
export interface ExecutionGate {
  checkPolicy(
    collectionId: string,
    userId:       string,
    role:         Role,
    environmentId?: string,
  ): PolicyCheckResult;
}
```

---

### Step 4.2 — Create `src/api-governance/policy.registry.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * policy.registry.ts — InMemoryGovernancePolicyRegistry.
 * Stores policies in-memory; evaluates role + restricted-env checks.
 * No approval engine — requiresApproval is a passthrough flag.
 */

import { GovernancePolicy, PolicyCheckResult, ExecutionGate } from './policy.contracts';
import { Role } from '../data/types';

export class InMemoryGovernancePolicyRegistry implements ExecutionGate {
  private readonly policies = new Map<string, GovernancePolicy>();

  /**
   * Register (or replace) a governance policy.
   */
  registerPolicy(policy: GovernancePolicy): void {
    this.policies.set(policy.policyId, policy);
  }

  /**
   * Retrieve a policy by ID. Returns undefined if not found.
   */
  getPolicy(policyId: string): GovernancePolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * List all registered policies.
   */
  listPolicies(): GovernancePolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Remove a policy by ID.
   */
  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  /**
   * Evaluate whether the user/role may execute the given collection
   * under all registered policies.
   *
   * Logic:
   *  1. No policies registered → allowed (permissive default)
   *  2. For each matching policy (currently: all policies apply globally):
   *     - If role not in allowedRoles → denied
   *     - If environmentId in restrictedEnvironmentIds → denied
   *  3. If any policy has requiresApproval → surface in result
   */
  checkPolicy(
    collectionId: string,
    userId:       string,
    role:         Role,
    environmentId?: string,
  ): PolicyCheckResult {
    const allPolicies = this.listPolicies();

    if (allPolicies.length === 0) {
      return { allowed: true, requiresApproval: false };
    }

    let requiresApproval = false;

    for (const policy of allPolicies) {
      // Role check
      if (!policy.allowedRoles.includes(role)) {
        return {
          allowed:          false,
          requiresApproval: policy.requiresApproval,
          reason:           `Policy '${policy.name}' does not allow role '${role}'. Allowed: ${policy.allowedRoles.join(', ')}.`,
        };
      }

      // Environment restriction check
      if (environmentId && policy.restrictedEnvironmentIds.includes(environmentId)) {
        return {
          allowed:          false,
          requiresApproval: policy.requiresApproval,
          reason:           `Policy '${policy.name}' restricts environment '${environmentId}'.`,
        };
      }

      if (policy.requiresApproval) requiresApproval = true;
    }

    return { allowed: true, requiresApproval };
  }
}

/** Singleton for use in routes. Can be replaced in tests. */
export const globalPolicyRegistry = new InMemoryGovernancePolicyRegistry();
```

---

### Step 4.3 — Create `tests/api-governance/policy.test.ts`

- [ ] Create the file with the following complete content:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GovernancePolicy,
  PolicyCheckResult,
} from '../../src/api-governance/policy.contracts';
import { InMemoryGovernancePolicyRegistry } from '../../src/api-governance/policy.registry';

function makePolicy(overrides: Partial<GovernancePolicy> = {}): GovernancePolicy {
  return {
    policyId:                 'p1',
    name:                     'Test Policy',
    requiresApproval:         false,
    allowedRoles:             ['admin', 'editor', 'tester'],
    restrictedEnvironmentIds: [],
    teardownProtected:        false,
    ...overrides,
  };
}

describe('InMemoryGovernancePolicyRegistry', () => {
  let registry: InMemoryGovernancePolicyRegistry;

  beforeEach(() => {
    registry = new InMemoryGovernancePolicyRegistry();
  });

  it('allows all when no policies registered', () => {
    const result = registry.checkPolicy('col-1', 'u1', 'viewer');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('denies when role not in allowedRoles', () => {
    registry.registerPolicy(makePolicy({ allowedRoles: ['admin', 'editor'] }));
    const result = registry.checkPolicy('col-1', 'u1', 'viewer');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('viewer');
  });

  it('denies when environmentId is restricted', () => {
    registry.registerPolicy(makePolicy({ restrictedEnvironmentIds: ['env-prod'] }));
    const result = registry.checkPolicy('col-1', 'u1', 'tester', 'env-prod');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('env-prod');
  });

  it('allows when environmentId is not restricted', () => {
    registry.registerPolicy(makePolicy({ restrictedEnvironmentIds: ['env-prod'] }));
    const result = registry.checkPolicy('col-1', 'u1', 'tester', 'env-staging');
    expect(result.allowed).toBe(true);
  });

  it('surfaces requiresApproval flag when policy requires it', () => {
    registry.registerPolicy(makePolicy({ requiresApproval: true }));
    const result = registry.checkPolicy('col-1', 'u1', 'admin');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it('listPolicies returns all registered policies', () => {
    registry.registerPolicy(makePolicy({ policyId: 'p1' }));
    registry.registerPolicy(makePolicy({ policyId: 'p2', name: 'Policy 2' }));
    expect(registry.listPolicies().length).toBe(2);
  });

  it('removePolicy removes a policy and subsequent check is permissive', () => {
    registry.registerPolicy(makePolicy({ allowedRoles: ['admin'] }));
    registry.removePolicy('p1');
    const result = registry.checkPolicy('col-1', 'u1', 'viewer');
    expect(result.allowed).toBe(true);
  });

});
```

---

### Step 4.4 — Run tests

- [ ] Run:
  ```
  npx vitest run tests/api-governance/policy.test.ts --reporter=verbose
  ```
  Expected output:
  ```
  ✓ InMemoryGovernancePolicyRegistry > allows all when no policies registered
  ✓ InMemoryGovernancePolicyRegistry > denies when role not in allowedRoles
  ✓ InMemoryGovernancePolicyRegistry > denies when environmentId is restricted
  ✓ InMemoryGovernancePolicyRegistry > allows when environmentId is not restricted
  ✓ InMemoryGovernancePolicyRegistry > surfaces requiresApproval flag when policy requires it
  ✓ InMemoryGovernancePolicyRegistry > listPolicies returns all registered policies
  ✓ InMemoryGovernancePolicyRegistry > removePolicy removes a policy and subsequent check is permissive
  Test Files  1 passed (1)
  Tests  7 passed (7)
  ```

---

### Step 4.5 — Git commit

- [ ] Run:
  ```
  git add src/api-governance/policy.contracts.ts src/api-governance/policy.registry.ts tests/api-governance/policy.test.ts
  git commit -m "$(cat <<'EOF'
  feat(governance): GovernancePolicy contracts + InMemoryGovernancePolicyRegistry

  Add GovernancePolicy, PolicyCheckResult, ExecutionGate contracts.
  InMemoryGovernancePolicyRegistry evaluates role + restricted-env checks.
  requiresApproval is a flag only — no approval engine yet.
  EOF
  )"
  ```

---

## Task 5 — Environment Governance + `maskSensitiveVariables`

**Files to create/edit:**
- `src/api-governance/environment.governance.ts` (new)
- `tests/api-governance/environment.governance.test.ts` (new)

---

### Step 5.1 — Create `src/api-governance/environment.governance.ts`

- [ ] Create the file with the following complete content:

```typescript
/**
 * environment.governance.ts — EnvironmentGovernancePolicy and maskSensitiveVariables.
 * No changes to existing environment store or runtime.
 * All types JSON-serialisable.
 */

import { Role } from '../data/types';

/**
 * Governance policy for a specific environment.
 */
export interface EnvironmentGovernancePolicy {
  environmentId:    string;
  isSensitive:      boolean;
  requiresApproval: boolean;
  /** Roles that may access this environment */
  allowedRoles:     Role[];
  /** When true, every access is written to audit log */
  auditAccess:      boolean;
}

/**
 * A variable with its value potentially masked.
 */
export interface MaskedVariable {
  name:     string;
  value:    string;
  isMasked: boolean;
}

/**
 * Registry of environment governance policies (in-memory).
 */
const environmentPolicies = new Map<string, EnvironmentGovernancePolicy>();

/**
 * Register (or replace) a policy for an environment.
 */
export function registerEnvironmentPolicy(policy: EnvironmentGovernancePolicy): void {
  environmentPolicies.set(policy.environmentId, policy);
}

/**
 * Get the governance policy for an environment.
 * Returns a permissive default policy if no explicit policy is registered.
 */
export function getEnvironmentPolicy(environmentId: string): EnvironmentGovernancePolicy {
  return environmentPolicies.get(environmentId) ?? {
    environmentId,
    isSensitive:      false,
    requiresApproval: false,
    allowedRoles:     ['admin', 'editor', 'tester', 'viewer'],
    auditAccess:      false,
  };
}

/**
 * Remove a registered environment policy.
 */
export function removeEnvironmentPolicy(environmentId: string): boolean {
  return environmentPolicies.delete(environmentId);
}

/**
 * List all registered environment policies.
 */
export function listEnvironmentPolicies(): EnvironmentGovernancePolicy[] {
  return Array.from(environmentPolicies.values());
}

/**
 * Mask variable values when the environment policy marks them as sensitive.
 *
 * @param variables - Array of { name, value } objects (ApiVariable shape — only name/value used)
 * @param policy    - The EnvironmentGovernancePolicy to apply
 * @returns         - MaskedVariable[] with value replaced by '***' when isSensitive
 */
export function maskSensitiveVariables(
  variables: Array<{ name: string; value: string }>,
  policy: EnvironmentGovernancePolicy,
): MaskedVariable[] {
  return variables.map(v => ({
    name:     v.name,
    value:    policy.isSensitive ? '***' : v.value,
    isMasked: policy.isSensitive,
  }));
}
```

---

### Step 5.2 — Create `tests/api-governance/environment.governance.test.ts`

- [ ] Create the file with the following complete content:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EnvironmentGovernancePolicy,
  MaskedVariable,
  registerEnvironmentPolicy,
  getEnvironmentPolicy,
  removeEnvironmentPolicy,
  maskSensitiveVariables,
} from '../../src/api-governance/environment.governance';

describe('Environment Governance', () => {

  beforeEach(() => {
    // Clean up any registered policies from previous tests
    removeEnvironmentPolicy('env-prod');
    removeEnvironmentPolicy('env-staging');
    removeEnvironmentPolicy('env-test');
  });

  it('getEnvironmentPolicy returns permissive default for unregistered environment', () => {
    const policy = getEnvironmentPolicy('env-unknown');
    expect(policy.isSensitive).toBe(false);
    expect(policy.requiresApproval).toBe(false);
    expect(policy.auditAccess).toBe(false);
    expect(policy.allowedRoles).toContain('viewer');
  });

  it('registerEnvironmentPolicy + getEnvironmentPolicy round-trip', () => {
    const p: EnvironmentGovernancePolicy = {
      environmentId:    'env-prod',
      isSensitive:      true,
      requiresApproval: true,
      allowedRoles:     ['admin', 'editor'],
      auditAccess:      true,
    };
    registerEnvironmentPolicy(p);
    const retrieved = getEnvironmentPolicy('env-prod');
    expect(retrieved.isSensitive).toBe(true);
    expect(retrieved.requiresApproval).toBe(true);
    expect(retrieved.allowedRoles).toEqual(['admin', 'editor']);
  });

  it('maskSensitiveVariables masks all values when isSensitive = true', () => {
    const vars = [{ name: 'API_KEY', value: 'secret123' }, { name: 'DB_PASS', value: 'pass99' }];
    const policy = getEnvironmentPolicy('env-prod'); // registers as sensitive from prev test
    // Use an inline sensitive policy
    const sensitivePolicy: EnvironmentGovernancePolicy = {
      environmentId: 'env-prod', isSensitive: true,
      requiresApproval: false, allowedRoles: ['admin'], auditAccess: false,
    };
    const masked = maskSensitiveVariables(vars, sensitivePolicy);
    expect(masked[0].value).toBe('***');
    expect(masked[0].isMasked).toBe(true);
    expect(masked[1].value).toBe('***');
  });

  it('maskSensitiveVariables preserves values when isSensitive = false', () => {
    const vars = [{ name: 'BASE_URL', value: 'https://staging.example.com' }];
    const policy: EnvironmentGovernancePolicy = {
      environmentId: 'env-staging', isSensitive: false,
      requiresApproval: false, allowedRoles: ['admin', 'tester'], auditAccess: false,
    };
    const masked = maskSensitiveVariables(vars, policy);
    expect(masked[0].value).toBe('https://staging.example.com');
    expect(masked[0].isMasked).toBe(false);
  });

  it('maskSensitiveVariables returns empty array for empty input', () => {
    const policy: EnvironmentGovernancePolicy = {
      environmentId: 'e1', isSensitive: true,
      requiresApproval: false, allowedRoles: ['admin'], auditAccess: false,
    };
    const masked = maskSensitiveVariables([], policy);
    expect(masked).toEqual([]);
  });

  it('removeEnvironmentPolicy reverts to default policy', () => {
    const p: EnvironmentGovernancePolicy = {
      environmentId: 'env-test', isSensitive: true,
      requiresApproval: true, allowedRoles: ['admin'], auditAccess: true,
    };
    registerEnvironmentPolicy(p);
    removeEnvironmentPolicy('env-test');
    const policy = getEnvironmentPolicy('env-test');
    expect(policy.isSensitive).toBe(false);
    expect(policy.requiresApproval).toBe(false);
  });

});
```

---

### Step 5.3 — Run tests

- [ ] Run:
  ```
  npx vitest run tests/api-governance/environment.governance.test.ts --reporter=verbose
  ```
  Expected output:
  ```
  ✓ Environment Governance > getEnvironmentPolicy returns permissive default for unregistered environment
  ✓ Environment Governance > registerEnvironmentPolicy + getEnvironmentPolicy round-trip
  ✓ Environment Governance > maskSensitiveVariables masks all values when isSensitive = true
  ✓ Environment Governance > maskSensitiveVariables preserves values when isSensitive = false
  ✓ Environment Governance > maskSensitiveVariables returns empty array for empty input
  ✓ Environment Governance > removeEnvironmentPolicy reverts to default policy
  Test Files  1 passed (1)
  Tests  6 passed (6)
  ```

---

### Step 5.4 — Git commit

- [ ] Run:
  ```
  git add src/api-governance/environment.governance.ts tests/api-governance/environment.governance.test.ts
  git commit -m "$(cat <<'EOF'
  feat(governance): EnvironmentGovernancePolicy + maskSensitiveVariables

  Add EnvironmentGovernancePolicy contract, in-memory registry helpers
  (register/get/remove/list), and maskSensitiveVariables(). Permissive
  default returned for unregistered environments. No runtime changes.
  EOF
  )"
  ```

---

## Task 6 — Governance API Routes

**Files to create/edit:**
- `src/api-governance/routes/governance.routes.ts` (new)
- `src/ui/server.ts` (edit — register routes)

---

### Step 6.1 — Create `src/api-governance/routes/governance.routes.ts`

- [ ] Create the directory `src/api-governance/routes/` if it does not exist.
- [ ] Create the file with the following complete content:

```typescript
/**
 * governance.routes.ts — REST endpoints for governance administration.
 *
 * Routes:
 *   GET  /api/governance/audit         — filtered audit log (requireAdmin)
 *   GET  /api/governance/policies      — list registered policies (requireAdmin)
 *   POST /api/governance/policies      — register a new policy (requireAdmin)
 *   GET  /api/governance/tenant        — current tenant context (requireAuth)
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../../auth/middleware';
import { requireAdmin } from '../../auth/middleware';
import { readAll, AUDIT } from '../../data/store';
import { AuditEntry } from '../../data/types';
import { GovernancePolicy } from '../policy.contracts';
import { globalPolicyRegistry } from '../policy.registry';
import { getTenantContext } from '../tenant.helper';
import { requirePermission } from '../rbac.middleware';

const router = Router();

/**
 * GET /api/governance/audit
 * Query params: limit (default 50), action (filter), resourceId (filter)
 */
router.get('/audit', requireAdmin, (req: Request, res: Response) => {
  try {
    const limit      = Math.min(parseInt(String(req.query.limit  ?? '50'), 10) || 50, 500);
    const actionFilter     = String(req.query.action     ?? '').trim();
    const resourceIdFilter = String(req.query.resourceId ?? '').trim();

    let entries: AuditEntry[] = readAll<AuditEntry>(AUDIT);

    if (actionFilter) {
      entries = entries.filter(e => e.action === actionFilter || e.action.includes(actionFilter));
    }
    if (resourceIdFilter) {
      entries = entries.filter(e => e.resourceId === resourceIdFilter);
    }

    // Return most recent first, up to limit
    const result = entries.slice(-limit).reverse();
    res.json({ entries: result, total: result.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read audit log', detail: String(err) });
  }
});

/**
 * GET /api/governance/policies
 */
router.get('/policies', requireAdmin, (_req: Request, res: Response) => {
  const policies = globalPolicyRegistry.listPolicies();
  res.json({ policies });
});

/**
 * POST /api/governance/policies
 * Body: GovernancePolicy (policyId, name, requiresApproval, allowedRoles, restrictedEnvironmentIds, teardownProtected)
 */
router.post('/policies', requireAdmin, (req: Request, res: Response) => {
  const body = req.body as Partial<GovernancePolicy>;

  if (!body.policyId || !body.name) {
    res.status(400).json({ error: 'policyId and name are required' });
    return;
  }
  if (!Array.isArray(body.allowedRoles)) {
    res.status(400).json({ error: 'allowedRoles must be an array' });
    return;
  }
  if (!Array.isArray(body.restrictedEnvironmentIds)) {
    res.status(400).json({ error: 'restrictedEnvironmentIds must be an array' });
    return;
  }

  const policy: GovernancePolicy = {
    policyId:                 body.policyId,
    name:                     body.name,
    requiresApproval:         body.requiresApproval ?? false,
    allowedRoles:             body.allowedRoles,
    restrictedEnvironmentIds: body.restrictedEnvironmentIds,
    maxRetries:               body.maxRetries,
    teardownProtected:        body.teardownProtected ?? false,
  };

  globalPolicyRegistry.registerPolicy(policy);
  res.status(201).json({ policy });
});

/**
 * GET /api/governance/tenant
 */
router.get('/tenant', requireAuth, (req: Request, res: Response) => {
  const ctx = getTenantContext(req);
  res.json({
    tenant:        ctx,
    singleTenant:  ctx === null,
  });
});

export default router;
```

---

### Step 6.2 — Register routes in `src/ui/server.ts`

- [ ] Open `src/ui/server.ts`. Find the block where other API routes are registered (look for `app.use('/api/worker-pool', ...)` or similar final route registration).

- [ ] Add the following import near the top of the file, after existing governance/api imports:
  ```typescript
  import governanceRoutes from '../api-governance/routes/governance.routes';
  ```

- [ ] Add the route registration after the worker-health routes line:
  ```typescript
  app.use('/api/governance', governanceRoutes);
  ```

---

### Step 6.3 — Build backend

- [ ] Run:
  ```
  npm run build
  ```
  Expected: zero TypeScript errors.

---

### Step 6.4 — Git commit

- [ ] Run:
  ```
  git add src/api-governance/routes/governance.routes.ts src/ui/server.ts
  git commit -m "$(cat <<'EOF'
  feat(governance): governance API routes (audit, policies, tenant)

  Add GET /api/governance/audit, GET/POST /api/governance/policies,
  GET /api/governance/tenant. Register router in server.ts under
  /api/governance. All routes behind requireAdmin or requireAuth.
  EOF
  )"
  ```

---

## Task 7 — Governance UI

**Files to create/edit:**
- `src/ui/public/js/30-governance.js` (new)
- `src/ui/public/styles_addon.css` (edit — append CSS)
- `src/ui/public/index.html` (edit — add nav + panel)
- `scripts/concat-modules.js` or build config (verify 30-governance.js is included)

---

### Step 7.1 — Create `src/ui/public/js/30-governance.js`

- [ ] Create the file with the following complete content:

```javascript
/* 30-governance.js — Governance tab: tenant card, audit log, policies */

/* ------------------------------------------------------------------ */
/* Governance Tab Bootstrap                                            */
/* ------------------------------------------------------------------ */

function governanceLoad() {
  governanceLoadTenantContext();
  governanceLoadAuditLog();
  governanceLoadPolicies();
}

/* ------------------------------------------------------------------ */
/* Tenant Context Card                                                 */
/* ------------------------------------------------------------------ */

function governanceLoadTenantContext() {
  const el = document.getElementById('governance-tenant-card');
  if (!el) return;

  fetch('/api/governance/tenant', { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      if (data.singleTenant) {
        el.innerHTML = `
          <div class="governance-card">
            <span class="policy-badge">Single-Tenant Mode</span>
            <p>No tenant isolation active. All users share a single environment.</p>
          </div>`;
      } else {
        const t = data.tenant;
        el.innerHTML = `
          <div class="governance-card">
            <span class="policy-badge policy-badge--active">Multi-Tenant</span>
            <p><strong>Tenant ID:</strong> ${escapeHtml(t.tenantId)}</p>
            <p><strong>Tenant Name:</strong> ${escapeHtml(t.tenantName)}</p>
            <p><strong>Isolation Mode:</strong> ${escapeHtml(t.isolationMode)}</p>
          </div>`;
      }
    })
    .catch(err => {
      el.innerHTML = `<p class="text-danger">Failed to load tenant context: ${escapeHtml(String(err))}</p>`;
    });
}

/* ------------------------------------------------------------------ */
/* Audit Log Table                                                     */
/* ------------------------------------------------------------------ */

function governanceLoadAuditLog(action, resourceId) {
  const tbody = document.getElementById('governance-audit-tbody');
  const countEl = document.getElementById('governance-audit-count');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Loading…</td></tr>';

  let url = '/api/governance/audit?limit=50';
  if (action)     url += `&action=${encodeURIComponent(action)}`;
  if (resourceId) url += `&resourceId=${encodeURIComponent(resourceId)}`;

  fetch(url, { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      if (countEl) countEl.textContent = `${data.total} entries`;
      if (!data.entries || data.entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No audit entries found.</td></tr>';
        return;
      }
      tbody.innerHTML = data.entries.map(e => `
        <tr class="audit-log-row">
          <td>${escapeHtml(e.createdAt ? e.createdAt.replace('T', ' ').slice(0, 19) : '')}</td>
          <td>${escapeHtml(e.username ?? e.userId ?? '—')}</td>
          <td><span class="audit-action-badge">${escapeHtml(e.action)}</span></td>
          <td>${escapeHtml(e.resourceType ?? '—')}</td>
          <td>${escapeHtml(e.resourceId ?? '—')}</td>
          <td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.details ?? '')}</td>
        </tr>`).join('');
    })
    .catch(err => {
      tbody.innerHTML = `<tr><td colspan="6" class="text-danger">Error: ${escapeHtml(String(err))}</td></tr>`;
    });
}

function governanceAuditFilter() {
  const action     = (document.getElementById('governance-audit-action-filter')?.value ?? '').trim();
  const resourceId = (document.getElementById('governance-audit-rid-filter')?.value ?? '').trim();
  governanceLoadAuditLog(action || undefined, resourceId || undefined);
}

/* ------------------------------------------------------------------ */
/* Policy List                                                         */
/* ------------------------------------------------------------------ */

function governanceLoadPolicies() {
  const container = document.getElementById('governance-policies-list');
  if (!container) return;

  container.innerHTML = '<p class="text-muted">Loading…</p>';

  fetch('/api/governance/policies', { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      if (!data.policies || data.policies.length === 0) {
        container.innerHTML = '<p class="text-muted">No governance policies registered.</p>';
        return;
      }
      container.innerHTML = data.policies.map(p => `
        <div class="policy-row">
          <span class="policy-badge ${p.requiresApproval ? 'policy-badge--approval' : 'policy-badge--active'}">${escapeHtml(p.name)}</span>
          <span class="text-muted" style="font-size:0.8em;">[${escapeHtml(p.policyId)}]</span>
          <ul style="margin:4px 0 0 0;padding-left:18px;font-size:0.85em;">
            <li>Allowed roles: ${p.allowedRoles.map(r => escapeHtml(r)).join(', ')}</li>
            <li>Restricted envs: ${p.restrictedEnvironmentIds.length ? p.restrictedEnvironmentIds.map(e => escapeHtml(e)).join(', ') : 'none'}</li>
            <li>Requires approval: ${p.requiresApproval ? 'Yes' : 'No'}</li>
            <li>Teardown protected: ${p.teardownProtected ? 'Yes' : 'No'}</li>
            ${p.maxRetries !== undefined ? `<li>Max retries: ${p.maxRetries}</li>` : ''}
          </ul>
        </div>`).join('');
    })
    .catch(err => {
      container.innerHTML = `<p class="text-danger">Error: ${escapeHtml(String(err))}</p>`;
    });
}

/* ------------------------------------------------------------------ */
/* Register Policy Form                                                */
/* ------------------------------------------------------------------ */

function governanceSubmitPolicy(event) {
  event.preventDefault();
  const form = event.target;

  const policyId   = form.querySelector('#gov-policy-id')?.value.trim();
  const name       = form.querySelector('#gov-policy-name')?.value.trim();
  const rolesRaw   = form.querySelector('#gov-policy-roles')?.value.trim();
  const envsRaw    = form.querySelector('#gov-policy-envs')?.value.trim();
  const approval   = form.querySelector('#gov-policy-approval')?.checked ?? false;
  const teardown   = form.querySelector('#gov-policy-teardown')?.checked ?? false;

  if (!policyId || !name) {
    alert('Policy ID and Name are required.');
    return;
  }

  const payload = {
    policyId,
    name,
    requiresApproval:         approval,
    allowedRoles:             rolesRaw ? rolesRaw.split(',').map(s => s.trim()).filter(Boolean) : ['admin', 'editor', 'tester'],
    restrictedEnvironmentIds: envsRaw  ? envsRaw.split(',').map(s => s.trim()).filter(Boolean)  : [],
    teardownProtected:        teardown,
  };

  const statusEl = document.getElementById('gov-policy-status');

  fetch('/api/governance/policies', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(payload),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        if (statusEl) statusEl.textContent = `Error: ${data.error}`;
        return;
      }
      if (statusEl) statusEl.textContent = `Policy '${data.policy.name}' registered.`;
      form.reset();
      governanceLoadPolicies();
    })
    .catch(err => {
      if (statusEl) statusEl.textContent = `Error: ${String(err)}`;
    });
}

/* ------------------------------------------------------------------ */
/* Helper: escapeHtml (use shared if already defined, else define)    */
/* ------------------------------------------------------------------ */

if (typeof escapeHtml !== 'function') {
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
```

---

### Step 7.2 — Append CSS to `src/ui/public/styles_addon.css`

- [ ] Open `src/ui/public/styles_addon.css` and append the following at the end:

```css
/* ===== Governance Tab ===== */
.governance-card {
  background: var(--card-bg, #1e2228);
  border: 1px solid var(--border-color, #2d3139);
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 16px;
}
.audit-log-row td {
  font-size: 0.82em;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-color, #2d3139);
  vertical-align: top;
}
.audit-action-badge {
  display: inline-block;
  background: #2a3040;
  color: #7eb8f7;
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 0.78em;
  font-family: monospace;
  white-space: nowrap;
}
.policy-row {
  background: var(--card-bg, #1e2228);
  border: 1px solid var(--border-color, #2d3139);
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 10px;
}
.policy-badge {
  display: inline-block;
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 0.82em;
  font-weight: 600;
  background: #2d3748;
  color: #a0aec0;
  margin-right: 6px;
}
.policy-badge--active {
  background: #1a4731;
  color: #68d391;
}
.policy-badge--approval {
  background: #4a3000;
  color: #f6c23e;
}
```

---

### Step 7.3 — Add nav item and panel to `src/ui/public/index.html`

- [ ] Open `src/ui/public/index.html`.

- [ ] Find the nav item for `worker-health` (search for `data-tab="worker-health"`). Add after it:
  ```html
  <div class="nav-item" data-tab="governance">🏛️ Governance</div>
  ```

- [ ] Find the panel `id="panel-worker-health"`. Add after its closing `</div>`:
  ```html
  <!-- Governance Panel -->
  <div id="panel-governance" class="panel" style="display:none;">
    <h2 style="margin-bottom:16px;">🏛️ Enterprise Governance</h2>

    <!-- Tenant Context -->
    <h4>Tenant Context</h4>
    <div id="governance-tenant-card"></div>

    <!-- Audit Log -->
    <h4 style="margin-top:24px;">Audit Log <span id="governance-audit-count" class="text-muted" style="font-size:0.8em;"></span></h4>
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <input id="governance-audit-action-filter" type="text" placeholder="Filter by action…" class="form-control" style="width:220px;" />
      <input id="governance-audit-rid-filter"    type="text" placeholder="Filter by resource ID…" class="form-control" style="width:220px;" />
      <button class="btn btn-secondary btn-sm" onclick="governanceAuditFilter()">Filter</button>
      <button class="btn btn-secondary btn-sm" onclick="governanceLoadAuditLog()">Reset</button>
    </div>
    <div style="overflow-x:auto;">
      <table class="table table-sm" style="width:100%;">
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Resource Type</th>
            <th>Resource ID</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody id="governance-audit-tbody">
          <tr><td colspan="6" class="text-muted">Select Governance tab to load.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Policies -->
    <h4 style="margin-top:28px;">Governance Policies</h4>
    <div id="governance-policies-list"></div>

    <!-- Register Policy Form -->
    <h4 style="margin-top:24px;">Register New Policy</h4>
    <form onsubmit="governanceSubmitPolicy(event)" style="max-width:480px;">
      <div style="margin-bottom:8px;">
        <label>Policy ID</label>
        <input id="gov-policy-id" type="text" class="form-control" required placeholder="e.g. prod-execution-gate" />
      </div>
      <div style="margin-bottom:8px;">
        <label>Name</label>
        <input id="gov-policy-name" type="text" class="form-control" required placeholder="e.g. Production Execution Gate" />
      </div>
      <div style="margin-bottom:8px;">
        <label>Allowed Roles <span class="text-muted">(comma-separated: admin,editor,tester)</span></label>
        <input id="gov-policy-roles" type="text" class="form-control" placeholder="admin,editor,tester" />
      </div>
      <div style="margin-bottom:8px;">
        <label>Restricted Env IDs <span class="text-muted">(comma-separated, leave blank for none)</span></label>
        <input id="gov-policy-envs" type="text" class="form-control" placeholder="e.g. env-prod,env-uat" />
      </div>
      <div style="margin-bottom:8px;display:flex;gap:16px;">
        <label><input id="gov-policy-approval" type="checkbox" /> Requires Approval</label>
        <label><input id="gov-policy-teardown" type="checkbox" /> Teardown Protected</label>
      </div>
      <button type="submit" class="btn btn-primary btn-sm">Register Policy</button>
      <span id="gov-policy-status" class="text-muted" style="margin-left:12px;font-size:0.85em;"></span>
    </form>
  </div>
  ```

---

### Step 7.4 — Wire tab-switch to call `governanceLoad()`

- [ ] Open `src/ui/public/js/08-tab-switch.js` (or the file that handles tab switching). Find the `switch` or `if/else` chain that calls module load functions when a tab is selected (e.g. `case 'worker-health': workerHealthLoad(); break;`).

- [ ] Add a case for governance. Example (adapt to match the existing pattern in that file):
  ```javascript
  case 'governance':
    governanceLoad();
    break;
  ```

---

### Step 7.5 — Rebuild frontend

- [ ] Run:
  ```
  npm run build:js
  ```
  Expected: `modules.js` regenerated with `30-governance.js` included. Zero errors.

---

### Step 7.6 — Git commit

- [ ] Run:
  ```
  git add src/ui/public/js/30-governance.js src/ui/public/styles_addon.css src/ui/public/index.html src/ui/public/js/08-tab-switch.js
  git commit -m "$(cat <<'EOF'
  feat(governance): Governance UI tab (tenant card, audit log, policy list)

  Add 30-governance.js with tenant context card, filterable audit log table,
  policy list, and register-policy form. CSS classes for governance-card,
  audit-action-badge, policy-badge. Nav + panel wired in index.html.
  EOF
  )"
  ```

---

## Task 8 — `tenantId` on `ApiCollection` + CLAUDE.md update

**Files to edit:**
- `src/data/types.ts` — add `tenantId?: string` to `ApiCollection`
- `CLAUDE.md` — record Phase D Step 13 as complete

---

### Step 8.1 — Add `tenantId` to `ApiCollection` in `src/data/types.ts`

- [ ] Open `src/data/types.ts`. Find the `ApiCollection` interface (currently lines 621-637):
  ```typescript
  export interface ApiCollection {
    id: string;
    projectId?: string;
    name: string;
    environmentId: string;
    steps: ApiTestStep[];
    variables: ApiVariable[];
    onFailure: 'stop' | 'continue' | 'skipDependents';
    executionMode: 'sequential' | 'parallel' | 'dag';
    maxConcurrency?: number;
    logLevel?: 'minimal' | 'standard' | 'verbose';
    rateLimit?: { requestsPerSecond: number };
    tags?: string[];
    autoFileDefects?: boolean;
  }
  ```
  Add `tenantId?: string;` after `projectId?: string;`:
  ```typescript
  export interface ApiCollection {
    id: string;
    projectId?: string;
    tenantId?: string;          // governance: optional tenant scoping (Phase D Step 13)
    name: string;
    environmentId: string;
    steps: ApiTestStep[];
    variables: ApiVariable[];
    onFailure: 'stop' | 'continue' | 'skipDependents';
    executionMode: 'sequential' | 'parallel' | 'dag';
    maxConcurrency?: number;
    logLevel?: 'minimal' | 'standard' | 'verbose';
    rateLimit?: { requestsPerSecond: number };
    tags?: string[];
    autoFileDefects?: boolean;
  }
  ```

---

### Step 8.2 — Build to verify no type errors

- [ ] Run:
  ```
  npm run build
  ```
  Expected: zero TypeScript errors.

---

### Step 8.3 — Update `CLAUDE.md`

- [ ] Open `CLAUDE.md`. Find the line:
  ```
  > **📋 See [docs/superpowers/plans/2026-05-20-phase-d-step12-distributed-execution-readiness.md](...) — Phase D Step 12 implementation plan (8 tasks). **COMPLETE as of 2026-05-20.**
  ```
  Add after it:
  ```
  > **📋 See [docs/superpowers/plans/2026-05-20-phase-d-step13-enterprise-governance.md](docs/superpowers/plans/2026-05-20-phase-d-step13-enterprise-governance.md) — Phase D Step 13 implementation plan (8 tasks). **COMPLETE as of 2026-05-20.**
  ```

- [ ] In the `### Distributed Execution Readiness` shipped features section, add a new section after it:

  ```markdown
  ### Enterprise Governance, RBAC & Auditability (shipped 2026-05-20)
  - Module: `src/api-governance/` — rbac.contracts, rbac.middleware, audit.contracts, audit.helper, tenant.contracts, tenant.helper, policy.contracts, policy.registry, environment.governance, routes/governance.routes
  - `Role` extended with `'editor'` — all existing role checks valid
  - `ApiResourcePermission` type + `hasPermission()` + `requirePermission()` factory middleware
  - `ApiAuditAction` typed enum + `logApiAudit()` wraps existing `logAudit` — original unchanged
  - `TenantContext` + `getTenantContext(req)` — returns null in single-tenant mode
  - `InMemoryGovernancePolicyRegistry` — role + restricted-env policy checks; `globalPolicyRegistry` singleton
  - `EnvironmentGovernancePolicy` + `maskSensitiveVariables()` — masks variable values in sensitive envs
  - Routes: `GET/POST /api/governance/policies`, `GET /api/governance/audit`, `GET /api/governance/tenant`
  - UI: `30-governance.js` — tenant card, audit log (filterable), policy list + register form
  - `ApiCollection.tenantId?: string` — optional, backward-compatible
  - All contracts additive, JSON-serialisable, no runtime execution modified
  ```

---

### Step 8.4 — Run all governance tests together

- [ ] Run:
  ```
  npx vitest run tests/api-governance/ --reporter=verbose
  ```
  Expected output:
  ```
  ✓ tests/api-governance/rbac.test.ts (6 tests)
  ✓ tests/api-governance/audit.test.ts (5 tests)
  ✓ tests/api-governance/tenant.test.ts (5 tests)
  ✓ tests/api-governance/policy.test.ts (7 tests)
  ✓ tests/api-governance/environment.governance.test.ts (6 tests)
  Test Files  5 passed (5)
  Tests  29 passed (29)
  ```

---

### Step 8.5 — Git commit

- [ ] Run:
  ```
  git add src/data/types.ts CLAUDE.md
  git commit -m "$(cat <<'EOF'
  feat(governance): ApiCollection.tenantId + CLAUDE.md Phase D Step 13 checkpoint

  Add optional tenantId field to ApiCollection (backward-compatible).
  Mark Phase D Step 13 as complete in CLAUDE.md with architecture notes.
  EOF
  )"
  ```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| 1 — RBAC contracts + middleware | `src/api-governance/rbac.contracts.ts`, `rbac.middleware.ts`, `src/data/types.ts` | 6 |
| 2 — Extended audit model | `src/api-governance/audit.contracts.ts`, `audit.helper.ts` | 5 |
| 3 — Multi-tenant contracts | `src/api-governance/tenant.contracts.ts`, `tenant.helper.ts` | 5 |
| 4 — Policy registry | `src/api-governance/policy.contracts.ts`, `policy.registry.ts` | 7 |
| 5 — Environment governance | `src/api-governance/environment.governance.ts` | 6 |
| 6 — Governance routes | `src/api-governance/routes/governance.routes.ts`, `src/ui/server.ts` | — |
| 7 — Governance UI | `src/ui/public/js/30-governance.js`, `styles_addon.css`, `index.html` | — |
| 8 — `tenantId` + CLAUDE.md | `src/data/types.ts`, `CLAUDE.md` | — |

**Total unit tests: 29** across 5 test files in `tests/api-governance/`.

All new code lives in `src/api-governance/`. Runtime execution, DAG, WorkflowEnvelope, retries, and all existing auth middleware are untouched.
