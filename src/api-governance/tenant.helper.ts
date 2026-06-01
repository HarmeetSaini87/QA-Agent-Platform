/**
 * tenant.helper.ts — getTenantContext: resolves TenantContext from request session.
 * Returns null in single-tenant mode (no tenantId on session).
 */

import { Request } from 'express';
import { TenantContext } from './tenant.contracts';

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
