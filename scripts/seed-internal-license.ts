/**
 * seed-internal-license.ts
 * One-shot script: writes a perpetual internal-use license to data/license.json.
 * Run once per instance (dev + prod) to prevent auto-trial from activating.
 *
 * Usage:
 *   cd "e:/AI Agent/qa-agent-platform-dev"
 *   npx tsx scripts/seed-internal-license.ts
 *
 *   cd "e:/AI Agent/qa-agent-platform"
 *   npx tsx scripts/seed-internal-license.ts
 */

import * as path from 'path';

// Allow DATA_DIR override so this works for both dev and prod instances
process.env.DATA_DIR = process.env.DATA_DIR || path.resolve('data');

import { storeLicense, loadStoredLicense } from '../src/utils/licenseManager';
import { LicensePayload } from '../src/data/types';

const existing = loadStoredLicense();
if (existing) {
  console.log(`[seed-license] license.json already exists (tier=${existing.payload.tier}, key=${existing.key.slice(0,12)}…) — skipping.`);
  process.exit(0);
}

const payload: LicensePayload = {
  tier:         'enterprise',
  orgId:        'INTERNAL',
  orgName:      'QA Agent Platform (Internal)',
  seats:        -1,          // unlimited
  maxInstances: -1,          // unlimited
  expiresAt:    '9999-12-31T23:59:59.000Z',   // perpetual
  features: {
    recorder:    true,
    debugger:    true,
    scheduler:   true,
    sso:         true,
    apiAccess:   true,
    whiteLabel:  true,
    auditDays:   -1,         // unlimited
    maxProjects: -1,         // unlimited
  },
};

storeLicense('INTERNAL-PERPETUAL', payload);
console.log('[seed-license] Perpetual internal license written to data/license.json');
console.log('[seed-license] Tier: enterprise | Seats: unlimited | Expires: never');
console.log('[seed-license] Restart the server to apply.');
