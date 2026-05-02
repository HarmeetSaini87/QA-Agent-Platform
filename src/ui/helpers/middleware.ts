import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { isFeatureEnabled, getLicensePayload } from '../../utils/licenseManager';
import type { LicensePayload } from '../../data/types';

const UPGRADE_TIER: Record<string, string> = {
  scheduler: 'team',
  sso: 'team',
  apiAccess: 'enterprise',
  whiteLabel: 'enterprise',
};

export function requireFeature(feature: keyof LicensePayload['features']) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!isFeatureEnabled(feature)) {
      const p = getLicensePayload();
      const upgrade = UPGRADE_TIER[feature as string] ?? 'enterprise';
      res.status(402).json({
        error: 'Feature not available on your license tier',
        feature,
        tier: p?.tier ?? 'none',
        upgrade,
      });
      return;
    }
    next();
  };
}

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});