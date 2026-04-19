/**
 * licenseManager.ts — P1 + P1-EG License Infrastructure
 *
 * Key format (v2, P1-EG):
 *   QAP-{TIER}-{ORG_ID}-{EXPIRY_YYYYMM}-{SEATS}-{INSTANCES}-{CHECKSUM}
 *   Example: QAP-TEAM-ACME001-202612-010-001-A3F7
 *
 * Key format (v1, P1 — backward compat):
 *   QAP-{TIER}-{ORG_ID}-{EXPIRY_YYYYMM}-{SEATS}-{CHECKSUM}
 *   Treated as maxInstances = 1
 *
 * Tier codes:  STR=starter  TEAM=team  ENT=enterprise
 * Seats:       001–998 = count; 999 = unlimited (-1 internally)
 * Instances:   001–099 = count; 999 = unlimited (-1 internally)
 * Checksum:    first 4 hex chars of HMAC-SHA256(key_body, VENDOR_SECRET)
 *
 * Machine binding (P1-EG):
 *   machineId = SHA-256(primaryMAC + hostname + cpuModel + osPlatform + osArch).slice(0,32)
 *   Stored encrypted in license.json; verified on every server startup.
 *   Mismatch → server refuses to start (unless QA_SKIP_MACHINE_CHECK=1).
 */

import * as crypto from 'crypto';
import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';
import { LicensePayload, FeatureKey } from '../data/types';

export const VENDOR_SECRET = process.env.QA_VENDOR_SECRET ?? 'qa-agent-platform-vendor-secret-v1';

// P3-03: Bundled RSA public key (base64-encoded PEM).
// Replace PLACEHOLDER with the base64 output of tools/genVendorKeys.ts after running it once.
// The actual key is embedded at build time — safe to ship; only used to VERIFY signatures.
const VENDOR_PUBLIC_KEY_B64 = process.env.QA_LICENSE_PUBLIC_KEY_B64 ?? 'PLACEHOLDER';

function getVendorPublicKeyPem(): string | null {
  if (VENDOR_PUBLIC_KEY_B64 === 'PLACEHOLDER') return null;
  try {
    return Buffer.from(VENDOR_PUBLIC_KEY_B64, 'base64').toString('utf-8');
  } catch { return null; }
}

const LICENSE_FILE = path.resolve('data', 'license.json');
const GRACE_DAYS   = 7;

// ── Encryption helpers (AES-256-GCM) ─────────────────────────────────────────

function getEncKey(): Buffer {
  const secret = process.env.QA_SECRET_KEY ?? 'qa-agent-default-enc-key-32chars!';
  return crypto.scryptSync(secret, 'qa-license-salt-v1', 32);
}

function encrypt(text: string): string {
  const key    = getEncKey();
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(encText: string): string {
  const [ivHex, tagHex, dataHex] = encText.split(':');
  const key      = getEncKey();
  const iv       = Buffer.from(ivHex,   'hex');
  const tag      = Buffer.from(tagHex,  'hex');
  const data     = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ── P1-EG-01: Machine fingerprint ────────────────────────────────────────────

let _cachedMachineId: string | null = null;

export function getMachineId(): string {
  if (_cachedMachineId) return _cachedMachineId;

  // Primary non-loopback MAC address
  const nets   = os.networkInterfaces();
  let primaryMAC = '';
  for (const iface of Object.values(nets)) {
    const hit = (iface ?? []).find(n => !n.internal && n.mac && n.mac !== '00:00:00:00:00:00');
    if (hit) { primaryMAC = hit.mac; break; }
  }

  const cpuModel = (os.cpus()[0]?.model ?? 'unknown').replace(/\s+/g, ' ').trim();
  const raw      = [primaryMAC, os.hostname(), cpuModel, os.platform(), os.arch()].join('|');
  _cachedMachineId = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  return _cachedMachineId;
}

// ── P1-EG-02: Key parsing (v1 + v2) ──────────────────────────────────────────

export interface ParsedKey {
  tier:         'starter' | 'team' | 'enterprise' | 'trial';
  orgId:        string;
  expiryYYYYMM: string;
  seats:        number;        // -1 = unlimited
  maxInstances: number;        // -1 = unlimited
  raw:          string;
  keyVersion:   1 | 2;
}

export function parseLicenseKey(key: string): ParsedKey | null {
  const parts = key.trim().toUpperCase().split('-');
  if (parts[0] !== 'QAP') return null;

  const tierMap: Record<string, ParsedKey['tier']> = {
    STR: 'starter', TEAM: 'team', ENT: 'enterprise', EVAL: 'trial',
  };

  // v2: 7 parts — QAP-TIER-ORG-EXPIRY-SEATS-INSTANCES-CHECKSUM
  if (parts.length === 7) {
    const [, tier, orgId, expiry, seatsStr, instancesStr, checksum] = parts;
    if (!tierMap[tier])                          return null;
    if (!/^\d{6}$/.test(expiry))                 return null;
    if (!/^\d{3}$/.test(seatsStr))               return null;
    if (!/^\d{3}$/.test(instancesStr))           return null;
    if (!/^[A-F0-9]{4}$/.test(checksum))         return null;

    const body     = `QAP-${tier}-${orgId}-${expiry}-${seatsStr}-${instancesStr}`;
    const expected = crypto.createHmac('sha256', VENDOR_SECRET)
      .update(body).digest('hex').toUpperCase().slice(0, 4);
    if (expected !== checksum) return null;

    const seatsRaw     = parseInt(seatsStr, 10);
    const instancesRaw = parseInt(instancesStr, 10);
    return {
      tier:         tierMap[tier],
      orgId,
      expiryYYYYMM: expiry,
      seats:        seatsRaw     === 999 ? -1 : seatsRaw,
      maxInstances: instancesRaw === 999 ? -1 : instancesRaw,
      raw:          key.trim().toUpperCase(),
      keyVersion:   2,
    };
  }

  // v1 backward compat: 6 parts — QAP-TIER-ORG-EXPIRY-SEATS-CHECKSUM
  if (parts.length === 6) {
    const [, tier, orgId, expiry, seatsStr, checksum] = parts;
    if (!tierMap[tier])                          return null;
    if (!/^\d{6}$/.test(expiry))                 return null;
    if (!/^\d{3}$/.test(seatsStr))               return null;
    if (!/^[A-F0-9]{4}$/.test(checksum))         return null;

    const body     = `QAP-${tier}-${orgId}-${expiry}-${seatsStr}`;
    const expected = crypto.createHmac('sha256', VENDOR_SECRET)
      .update(body).digest('hex').toUpperCase().slice(0, 4);
    if (expected !== checksum) return null;

    const seatsRaw = parseInt(seatsStr, 10);
    return {
      tier:         tierMap[tier],
      orgId,
      expiryYYYYMM: expiry,
      seats:        seatsRaw === 999 ? -1 : seatsRaw,
      maxInstances: 1,   // legacy keys → single machine
      raw:          key.trim().toUpperCase(),
      keyVersion:   1,
    };
  }

  return null;
}

// ── Feature gate map ──────────────────────────────────────────────────────────

function featuresForTier(tier: ParsedKey['tier']): LicensePayload['features'] {
  switch (tier) {
    case 'enterprise':
      return { recorder: true, debugger: true, scheduler: true, sso: true,  apiAccess: true,  whiteLabel: true,  auditDays: -1, maxProjects: -1 };
    case 'team':
      return { recorder: true, debugger: true, scheduler: true, sso: true,  apiAccess: false, whiteLabel: false, auditDays: 90, maxProjects: -1 };
    case 'trial':
      // Full features except SSO/API/white-label — 30-day evaluation, no machine binding
      return { recorder: true, debugger: true, scheduler: true, sso: false, apiAccess: false, whiteLabel: false, auditDays: 7, maxProjects: -1 };
    case 'starter':
    default:
      return { recorder: true, debugger: true, scheduler: false, sso: false, apiAccess: false, whiteLabel: false, auditDays: 30, maxProjects: 1 };
  }
}

// ── Expiry calculation ────────────────────────────────────────────────────────

export function calcExpiresAt(expiryYYYYMM: string): string {
  const year       = parseInt(expiryYYYYMM.slice(0, 4), 10);
  const month      = parseInt(expiryYYYYMM.slice(4, 6), 10) - 1;
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0));
  endOfMonth.setUTCDate(endOfMonth.getUTCDate() + GRACE_DAYS);
  return endOfMonth.toISOString();
}

// ── Key validation → LicensePayload ──────────────────────────────────────────

export async function validateLicenseKey(key: string): Promise<LicensePayload | null> {
  const parsed = parseLicenseKey(key);
  if (!parsed) return null;
  return {
    tier:         parsed.tier,
    orgId:        parsed.orgId,
    orgName:      parsed.orgId,   // Phase 3: enriched from license server
    seats:        parsed.seats,
    maxInstances: parsed.maxInstances,
    expiresAt:    calcExpiresAt(parsed.expiryYYYYMM),
    features:     featuresForTier(parsed.tier),
  };
}

// ── Enterprise .lic file validation ──────────────────────────────────────────

export interface LicFile {
  payload:   LicensePayload;
  issuedAt:  string;
  signature: string;
}

// P3-03: Validate a .lic file — RSA signature + expiry + optional machineId binding.
// publicKeyPem: override for testing; defaults to bundled VENDOR_PUBLIC_KEY_B64.
// skipMachineCheck: set true only in transfer/admin flows where machine hasn't been rebound yet.
export function validateLicFile(
  licPath:        string,
  publicKeyPem?:  string,
  skipMachineCheck = false,
): LicensePayload | null {
  try {
    const raw: LicFile = JSON.parse(fs.readFileSync(licPath, 'utf-8'));

    // RSA signature verification
    const keyPem = publicKeyPem ?? getVendorPublicKeyPem();
    if (!keyPem) return null;    // no public key configured — cannot verify
    const body   = JSON.stringify({ payload: raw.payload, issuedAt: raw.issuedAt });
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(body);
    if (!verify.verify(keyPem, raw.signature, 'hex')) return null;

    // Expiry check
    if (new Date(raw.payload.expiresAt) < new Date()) return null;

    // P3-02/P3-03: Machine binding — if machineId signed into .lic, verify it matches
    if (!skipMachineCheck && raw.payload.machineId) {
      if (process.env.QA_SKIP_MACHINE_CHECK !== '1') {
        if (raw.payload.machineId !== getMachineId()) return null;
      }
    }

    return raw.payload;
  } catch { return null; }
}

// Re-verify RSA signature on a .lic from its stored path — used at startup (P3-04)
export function reVerifyStoredLic(licPath: string): boolean {
  return validateLicFile(licPath, undefined, false) !== null;
}

// ── P1-EG-03: Persistent storage — fully encrypted, no plaintext payload ────────
//
// Gap fix: entire LicensePayload (including expiresAt) is AES-256-GCM encrypted.
// Editing license.json directly cannot extend expiry — tampered ciphertext fails
// decryption and getLicensePayload() returns null → server enters read-only mode.

interface StoredLicense {
  encKey:       string;   // AES-256-GCM encrypted license key (or '.lic' sentinel)
  encMachineId: string;   // AES-256-GCM encrypted machineId
  encPayload:   string;   // AES-256-GCM encrypted JSON(LicensePayload) — NO plaintext
  activatedAt:  string;
  licFilePath?: string;   // P3-04: absolute path to .lic file (for RSA re-verify on startup)
}

export function storeLicense(key: string, payload: LicensePayload, licFilePath?: string): void {
  fs.mkdirSync(path.resolve('data'), { recursive: true });
  const stored: StoredLicense = {
    encKey:       encrypt(key),
    // Trial licenses skip machine binding; others bind to current machine
    encMachineId: encrypt(payload.tier === 'trial' ? '' : getMachineId()),
    encPayload:   encrypt(JSON.stringify(payload)),
    activatedAt:  new Date().toISOString(),
    ...(licFilePath ? { licFilePath } : {}),
  };
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(stored, null, 2));
}

export function loadStoredLicense(): { key: string; payload: LicensePayload; machineId: string; licFilePath?: string } | null {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    const stored: StoredLicense = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));

    // Backward compat: old format had plaintext payload field
    let payload: LicensePayload;
    if (stored.encPayload) {
      payload = JSON.parse(decrypt(stored.encPayload)) as LicensePayload;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload = (stored as any).payload as LicensePayload;
    }

    const key         = decrypt(stored.encKey);
    const machineId   = stored.encMachineId ? decrypt(stored.encMachineId) : '';
    const licFilePath = stored.licFilePath;
    return { key, payload, machineId, licFilePath };
  } catch { return null; }
}

// P3-04: On startup, re-verify RSA signature of stored .lic file (tamper detection)
export type LicFileStartupResult =
  | { ok: true }
  | { ok: false; reason: 'lic_file_missing'; path: string }
  | { ok: false; reason: 'lic_file_invalid'; path: string };

export function checkStoredLicFile(): LicFileStartupResult {
  const stored = loadStoredLicense();
  if (!stored?.licFilePath) return { ok: true };   // no .lic used — HMAC key, skip
  const licPath = stored.licFilePath;
  if (!fs.existsSync(licPath)) return { ok: false, reason: 'lic_file_missing', path: licPath };
  // Re-verify full RSA chain (signature + expiry + machineId)
  const valid = reVerifyStoredLic(licPath);
  if (!valid) return { ok: false, reason: 'lic_file_invalid', path: licPath };
  return { ok: true };
}

// P1-EG-05: Re-store with updated machineId (transfer to new machine)
export function transferLicense(): boolean {
  try {
    const stored = loadStoredLicense();
    if (!stored) return false;
    storeLicense(stored.key, stored.payload);  // storeLicense recomputes getMachineId()
    clearLicenseCache();
    return true;
  } catch { return false; }
}

// ── P1-EG-04: Startup machine fingerprint check ───────────────────────────────

export type MachineCheckResult =
  | { ok: true }
  | { ok: false; reason: 'no_license' }
  | { ok: false; reason: 'mismatch'; storedId: string; currentId: string };

export function checkMachineBinding(): MachineCheckResult {
  if (process.env.QA_SKIP_MACHINE_CHECK === '1') return { ok: true };

  const stored = loadStoredLicense();
  if (!stored) return { ok: false, reason: 'no_license' };
  // Trial licenses have no machine binding
  if (stored.payload.tier === 'trial') return { ok: true };
  if (!stored.machineId) return { ok: true };  // pre-P1-EG license → allow (no binding stored)

  const current = getMachineId();
  if (stored.machineId === current) return { ok: true };

  return { ok: false, reason: 'mismatch', storedId: stored.machineId, currentId: current };
}

// ── Active license payload (runtime cache) ────────────────────────────────────
//
// Gap fix: expiry is checked on EVERY call against current time — not just at
// first load. A license that expires while the server is running will be detected
// on the next request that calls getLicensePayload(), without a server restart.

let _cachedPayload: LicensePayload | null | undefined = undefined;

export function isExpired(payload: LicensePayload): boolean {
  return new Date(payload.expiresAt) < new Date();
}

export function getLicensePayload(): LicensePayload | null {
  // Always re-check expiry against wall clock — even on cached payload
  if (_cachedPayload !== undefined && _cachedPayload !== null) {
    if (isExpired(_cachedPayload)) {
      _cachedPayload = null;   // expire the cache
      return null;
    }
    return _cachedPayload;
  }
  if (_cachedPayload === null) return null;  // already known invalid

  const stored = loadStoredLicense();
  if (!stored)                { _cachedPayload = null; return null; }
  if (isExpired(stored.payload)) { _cachedPayload = null; return null; }
  _cachedPayload = stored.payload;
  return _cachedPayload;
}

export function refreshLicenseCache(payload: LicensePayload): void {
  _cachedPayload = payload;
}

export function clearLicenseCache(): void {
  _cachedPayload = undefined;
}

// ── Auto-Trial (Option A) ─────────────────────────────────────────────────────
// Called at server startup when no license.json exists.
// Activates a 14-day local trial — all features, 3 seats, no machine binding.
// The trial key sentinel 'AUTO-TRIAL' is never validated as a real key.

export const AUTO_TRIAL_DAYS = 14;

export function activateAutoTrial(): LicensePayload {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + AUTO_TRIAL_DAYS);

  const payload: LicensePayload = {
    tier:         'trial',
    orgId:        'AUTO-TRIAL',
    orgName:      'Trial',
    seats:        3,
    maxInstances: 1,
    expiresAt:    expiresAt.toISOString(),
    features: {
      recorder:    true,
      debugger:    true,
      scheduler:   true,
      sso:         false,
      apiAccess:   true,
      whiteLabel:  false,
      auditDays:   30,
      maxProjects: 3,
    },
  };

  storeLicense('AUTO-TRIAL', payload);
  refreshLicenseCache(payload);
  return payload;
}

export function isAutoTrial(): boolean {
  const stored = loadStoredLicense();
  return stored?.key === 'AUTO-TRIAL';
}

export function trialDaysRemaining(): number {
  const p = getLicensePayload();
  if (!p || p.tier !== 'trial') return 0;
  const ms = new Date(p.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// Periodic expiry enforcement — call from server on an interval.
// Returns true if license just transitioned from valid → expired.
export function checkExpiryTick(): boolean {
  if (_cachedPayload === undefined || _cachedPayload === null) return false;
  if (isExpired(_cachedPayload)) {
    _cachedPayload = null;
    return true;   // just expired — caller should log + notify
  }
  return false;
}

// ── Feature gate ──────────────────────────────────────────────────────────────

export function isFeatureEnabled(feature: keyof LicensePayload['features']): boolean {
  const p = getLicensePayload();
  if (!p) return false;

  // P4-01: Vendor-signed feature overrides take precedence over tier defaults.
  // Only present in RSA-signed .lic files — cannot be forged in HMAC keys.
  if (p.featureOverrides && (feature as FeatureKey) in p.featureOverrides) {
    const override = p.featureOverrides[feature as FeatureKey];
    if (typeof override === 'boolean') return override;
  }

  const val = p.features[feature];
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number')  return val !== 0;
  return false;
}

// ── Seat tracking ─────────────────────────────────────────────────────────────
// In-memory Map: userId → session count (multi-tab safe).
// Rehydrated from SQLite sessions on server startup via syncSeatsFromSessions().

const _userSessions = new Map<string, number>();

export function recordLogin(userId: string): void {
  _userSessions.set(userId, (_userSessions.get(userId) ?? 0) + 1);
}

export function recordLogout(userId: string): void {
  const n = (_userSessions.get(userId) ?? 1) - 1;
  if (n <= 0) _userSessions.delete(userId);
  else        _userSessions.set(userId, n);
}

export function getSeatsUsed(): number {
  return _userSessions.size;
}

export function isSeatAvailable(userId: string): boolean {
  const p = getLicensePayload();
  if (!p) return true;
  if (p.seats === -1) return true;
  if (_userSessions.has(userId)) return true;
  return _userSessions.size < p.seats;
}

// P2-03: Called once at server startup — rebuilds in-memory seat map from
// the persisted SQLite session store so restart doesn't zero out counts.
export function syncSeatsFromSessions(activeUserIds: string[]): void {
  _userSessions.clear();
  for (const uid of activeUserIds) {
    _userSessions.set(uid, (_userSessions.get(uid) ?? 0) + 1);
  }
}

// P2-04: Returns fraction of seats used (0–1). -1 if unlimited.
export function getSeatUsageRatio(): number {
  const p = getLicensePayload();
  if (!p || p.seats === -1) return -1;
  if (p.seats === 0) return 1;
  return _userSessions.size / p.seats;
}
