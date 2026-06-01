#!/usr/bin/env npx ts-node
/**
 * genLicense.ts — Vendor CLI to issue QA Agent Platform license keys (v2)
 *
 * Usage (online key, single machine):
 *   npx tsx tools/genLicense.ts --tier TEAM --org ACME001 --seats 10 --instances 1 --expiry 202612
 *
 * Usage (Enterprise, unlimited seats + instances):
 *   npx tsx tools/genLicense.ts --tier ENT --org CORP01 --seats 999 --instances 999 --expiry 202612
 *
 * Usage (Enterprise .lic file for air-gapped):
 *   npx tsx tools/genLicense.ts --tier ENT --org CORP01 --seats 999 --instances 999 --expiry 202612 \
 *     --lic --privkey ./vendor-private.pem --out ./license.lic
 *
 * Usage (Starter + Scheduler add-on — feature override):
 *   npx tsx tools/genLicense.ts --tier STR --org ACME001 --seats 5 --expiry 202612 \
 *     --lic --privkey ./vendor-private.pem --enable scheduler
 *
 * Usage (Team without SSO — feature revoke):
 *   npx tsx tools/genLicense.ts --tier TEAM --org ACME001 --seats 10 --expiry 202612 \
 *     --lic --privkey ./vendor-private.pem --disable sso
 *
 * Tier codes:  STR | TEAM | ENT | EVAL
 * Seats:       1–998; use 999 for unlimited
 * Instances:   1–099; use 999 for unlimited (Enterprise HA clusters)
 * Expiry:      YYYYMM — 7-day grace period applies automatically
 * --enable:    comma-separated FeatureKeys to grant above tier default
 * --disable:   comma-separated FeatureKeys to revoke from tier default
 *              (overrides require --lic; RSA signature makes them tamper-proof)
 */

import * as crypto from 'crypto';
import * as fs     from 'fs';
import * as path   from 'path';
import { VENDOR_SECRET, calcExpiresAt } from '../src/utils/licenseManager';
import type { LicensePayload, FeatureKey } from '../src/data/types';

// ── Arg parsing ───────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const tier       = (arg('tier')       ?? '').toUpperCase();
const orgId      = (arg('org')        ?? '').toUpperCase();
const seats      = arg('seats')       ?? '';
const instances  = arg('instances')   ?? '1';   // default: 1 machine
const expiry     = arg('expiry')      ?? '';
const orgName    = arg('orgname')     ?? orgId;
const machineId  = arg('machineid')   ?? '';     // P3-02: bind .lic to a specific machine
const genLic     = flag('lic');
const privKey    = arg('privkey')     ?? '';
const outFile    = arg('out')         ?? 'license.lic';
const whiteLabelAppName    = arg('wl-appname')    ?? '';
const whiteLabelLogoUrl    = arg('wl-logourl')    ?? '';
const whiteLabelPrimaryColor = arg('wl-color')    ?? '';

// P4-01: Per-feature overrides — only honoured in .lic (RSA-signed) mode
const enableArg  = arg('enable')  ?? '';   // comma-separated: scheduler,sso
const disableArg = arg('disable') ?? '';   // comma-separated: recorder

// ── Validate ──────────────────────────────────────────────────────────────────

const VALID_TIERS  = ['STR', 'TEAM', 'ENT', 'EVAL'];
const seatsNum     = parseInt(seats, 10);
const instancesNum = parseInt(instances, 10);

if (!VALID_TIERS.includes(tier)) {
  console.error('ERROR: --tier must be STR, TEAM, ENT, or EVAL'); process.exit(1);
}

// EVAL tier: enforce max 30-day expiry
if (tier === 'EVAL') {
  const expiryDate = new Date(Date.UTC(
    parseInt(expiry.slice(0, 4), 10),
    parseInt(expiry.slice(4, 6), 10),  // end of that month = day 0 of next month
    0
  ));
  const maxAllowed = new Date();
  maxAllowed.setUTCDate(maxAllowed.getUTCDate() + 30);
  if (expiryDate > maxAllowed) {
    console.error('ERROR: EVAL (trial) keys cannot exceed 30 days from today'); process.exit(1);
  }
}
if (!orgId || !/^[A-Z0-9]{3,8}$/.test(orgId)) {
  console.error('ERROR: --org must be 3–8 alphanumeric chars'); process.exit(1);
}
if (!/^\d{6}$/.test(expiry)) {
  console.error('ERROR: --expiry must be YYYYMM (e.g. 202612)'); process.exit(1);
}
if (isNaN(seatsNum) || seatsNum < 1 || seatsNum > 999) {
  console.error('ERROR: --seats must be 1–999 (999 = unlimited)'); process.exit(1);
}
if (isNaN(instancesNum) || instancesNum < 1 || instancesNum > 999) {
  console.error('ERROR: --instances must be 1–999 (999 = unlimited)'); process.exit(1);
}

// ── Build v2 key ──────────────────────────────────────────────────────────────

const seatsPad     = seatsNum.toString().padStart(3, '0');
const instancesPad = instancesNum.toString().padStart(3, '0');
const keyBody      = `QAP-${tier}-${orgId}-${expiry}-${seatsPad}-${instancesPad}`;
const checksum     = crypto.createHmac('sha256', VENDOR_SECRET)
  .update(keyBody).digest('hex').toUpperCase().slice(0, 4);
const licenseKey   = `${keyBody}-${checksum}`;

// ── Feature map ───────────────────────────────────────────────────────────────

function featuresForTier(t: string): LicensePayload['features'] {
  switch (t) {
    case 'ENT':  return { recorder: true, debugger: true, scheduler: true, sso: true,  apiAccess: true,  whiteLabel: true,  auditDays: -1, maxProjects: -1 };
    case 'TEAM': return { recorder: true, debugger: true, scheduler: true, sso: true,  apiAccess: false, whiteLabel: false, auditDays: 90, maxProjects: -1 };
    case 'EVAL': return { recorder: true, debugger: true, scheduler: true, sso: false, apiAccess: false, whiteLabel: false, auditDays: 7,  maxProjects: -1 };
    default:     return { recorder: true, debugger: true, scheduler: false, sso: false, apiAccess: false, whiteLabel: false, auditDays: 30, maxProjects: 1  };
  }
}

const tierMap: Record<string, LicensePayload['tier']> = {
  STR: 'starter', TEAM: 'team', ENT: 'enterprise', EVAL: 'trial',
};

// Validate machineId format if provided (32-char hex)
if (machineId && !/^[a-f0-9]{32}$/i.test(machineId)) {
  console.error('ERROR: --machineid must be a 32-char hex string (copy from Admin → License → Machine ID)');
  process.exit(1);
}
// TEAM/ENT .lic files: machineId required for machine binding
if (genLic && (tier === 'TEAM' || tier === 'ENT') && !machineId) {
  console.warn('WARN: --machineid not provided. This .lic will NOT be machine-bound (any machine can activate).');
}

// P4-01: Parse and validate feature overrides
const VALID_FEATURE_KEYS: FeatureKey[] = ['recorder', 'debugger', 'scheduler', 'sso', 'apiAccess', 'whiteLabel'];

function parseFeatureList(csv: string): FeatureKey[] {
  if (!csv) return [];
  return csv.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    if (!VALID_FEATURE_KEYS.includes(s as FeatureKey)) {
      console.error(`ERROR: Unknown feature key "${s}". Valid keys: ${VALID_FEATURE_KEYS.join(', ')}`);
      process.exit(1);
    }
    return s as FeatureKey;
  });
}

const enableList  = parseFeatureList(enableArg);
const disableList = parseFeatureList(disableArg);

// Overrides require .lic mode — unsigned HMAC keys cannot carry overrides safely
if ((enableList.length || disableList.length) && !genLic) {
  console.error('ERROR: --enable/--disable require --lic mode (overrides must be RSA-signed)');
  process.exit(1);
}

const featureOverrides: Partial<Record<FeatureKey, boolean>> = {};
for (const k of enableList)  featureOverrides[k] = true;
for (const k of disableList) featureOverrides[k] = false;

const payload: LicensePayload = {
  tier:         tierMap[tier],
  orgId,
  orgName,
  seats:        seatsNum     === 999 ? -1 : seatsNum,
  maxInstances: instancesNum === 999 ? -1 : instancesNum,
  expiresAt:    calcExpiresAt(expiry),
  ...(machineId ? { machineId } : {}),
  features:     featuresForTier(tier),
  ...(Object.keys(featureOverrides).length ? { featureOverrides } : {}),
  ...(whiteLabelAppName && tier === 'ENT' ? {
    whiteLabelConfig: {
      appName:       whiteLabelAppName,
      ...(whiteLabelLogoUrl    ? { logoUrl:      whiteLabelLogoUrl    } : {}),
      ...(whiteLabelPrimaryColor ? { primaryColor: whiteLabelPrimaryColor } : {}),
    },
  } : {}),
};

// ── Output ────────────────────────────────────────────────────────────────────

function monthLabel(yyyymm: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(yyyymm.slice(4,6), 10) - 1]} ${yyyymm.slice(0,4)}`;
}

console.log('\n=== QA Agent Platform License Key (v2) ===');
console.log(`Key:        ${licenseKey}`);
console.log(`Tier:       ${payload.tier}`);
console.log(`Org:        ${orgName} (${orgId})`);
console.log(`Seats:      ${seatsNum === 999 ? 'Unlimited' : seatsNum}`);
console.log(`Instances:  ${instancesNum === 999 ? 'Unlimited' : instancesNum} machine${instancesNum === 1 ? '' : 's'}`);
console.log(`Expires:    ${payload.expiresAt.slice(0, 10)} (end of ${monthLabel(expiry)} + 7 day grace)`);
console.log(`Features:   ${Object.entries(payload.features).filter(([,v]) => v === true || (typeof v === 'number' && v !== 0)).map(([k]) => k).join(', ')}`);
if (machineId) console.log(`Machine ID: ${machineId}  (bound — only this machine can activate)`);
if (payload.whiteLabelConfig) console.log(`White-label: ${payload.whiteLabelConfig.appName}`);
if (Object.keys(featureOverrides).length) {
  const granted  = enableList.length  ? `+[${enableList.join(', ')}]`  : '';
  const revoked  = disableList.length ? `-[${disableList.join(', ')}]` : '';
  console.log(`Overrides:  ${[granted, revoked].filter(Boolean).join('  ')}  (vendor-signed, tier-independent)`);
}

// ── Enterprise .lic file ──────────────────────────────────────────────────────

if (genLic) {
  if (!privKey || !fs.existsSync(privKey)) {
    console.error('\nERROR: --privkey path required for --lic mode (RSA-2048 private key PEM)');
    process.exit(1);
  }
  const issuedAt  = new Date().toISOString();
  const body      = JSON.stringify({ payload, issuedAt });
  const sign      = crypto.createSign('RSA-SHA256');
  sign.update(body);
  const signature = sign.sign(fs.readFileSync(privKey, 'utf-8'), 'hex');
  const licFile   = { payload, issuedAt, signature };
  const outPath   = path.resolve(outFile);
  fs.writeFileSync(outPath, JSON.stringify(licFile, null, 2));
  console.log(`\n.lic file written: ${outPath}`);
}

console.log('');
