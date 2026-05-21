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
      reason: `Permission '${permission}' requires one of: ${
        (['admin', 'editor', 'tester', 'viewer'] as Role[])
          .filter(r => hasPermission(r, permission))
          .join(', ')
      }. Your role: ${role}`,
    });
  };
}
