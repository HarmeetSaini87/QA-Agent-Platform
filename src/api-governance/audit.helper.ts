/**
 * audit.helper.ts — logApiAudit wrapper around existing logAudit.
 * logAudit is UNCHANGED. This helper composes typed action + extras
 * into the existing AuditEntry shape.
 */

import { Request } from 'express';
import { logAudit } from '../auth/audit';
import { getClientIp } from '../auth/getClientIp';
import { ApiAuditAction, ApiAuditExtras } from './audit.contracts';

export function logApiAudit(
  action: ApiAuditAction,
  resourceId: string | null,
  req: Request,
  extras?: ApiAuditExtras,
): void {
  const userId   = req.session?.userId   ?? null;
  const username = req.session?.username ?? ((req as any).apiKeyName ?? null);
  const ip       = getClientIp(req);

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

function deriveResourceType(action: ApiAuditAction): string {
  const parts = action.split(':');
  return parts.slice(0, 2).join('-');
}
