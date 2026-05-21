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
import { requireAuth, requireAdmin } from '../../auth/middleware';
import { readAll, AUDIT } from '../../data/store';
import { AuditEntry } from '../../data/types';
import { GovernancePolicy } from '../policy.contracts';
import { globalPolicyRegistry } from '../policy.registry';
import { getTenantContext } from '../tenant.helper';

const router = Router();

/**
 * GET /api/governance/audit
 * Query params: limit (default 50, max 500), action (filter), resourceId (filter)
 */
router.get('/audit', requireAdmin, (req: Request, res: Response) => {
  try {
    const limit            = Math.min(parseInt(String(req.query.limit  ?? '50'), 10) || 50, 500);
    const actionFilter     = String(req.query.action     ?? '').trim();
    const resourceIdFilter = String(req.query.resourceId ?? '').trim();

    let entries: AuditEntry[] = readAll<AuditEntry>(AUDIT);

    if (actionFilter) {
      entries = entries.filter(e => e.action === actionFilter || e.action.includes(actionFilter));
    }
    if (resourceIdFilter) {
      entries = entries.filter(e => e.resourceId === resourceIdFilter);
    }

    const result = entries.slice(-limit).reverse();
    void res.json({ entries: result, total: result.length });
  } catch (err) {
    void res.status(500).json({ error: 'Failed to read audit log', detail: String(err) });
  }
});

/**
 * GET /api/governance/policies
 */
router.get('/policies', requireAdmin, (_req: Request, res: Response) => {
  const policies = globalPolicyRegistry.listPolicies();
  void res.json({ policies });
});

/**
 * POST /api/governance/policies
 * Body: GovernancePolicy
 */
router.post('/policies', requireAdmin, (req: Request, res: Response) => {
  const body = req.body as Partial<GovernancePolicy>;

  if (!body.policyId || !body.name) {
    void res.status(400).json({ error: 'policyId and name are required' });
    return;
  }
  if (!Array.isArray(body.allowedRoles)) {
    void res.status(400).json({ error: 'allowedRoles must be an array' });
    return;
  }
  if (!Array.isArray(body.restrictedEnvironmentIds)) {
    void res.status(400).json({ error: 'restrictedEnvironmentIds must be an array' });
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
  void res.status(201).json({ policy });
});

/**
 * GET /api/governance/tenant
 */
router.get('/tenant', requireAuth, (req: Request, res: Response) => {
  const ctx = getTenantContext(req);
  void res.json({
    tenant:       ctx,
    singleTenant: ctx === null,
  });
});

export default router;
