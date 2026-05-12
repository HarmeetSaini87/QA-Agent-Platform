/**
 * getClientIp.ts
 * Enterprise-grade utility to resolve the real remote client IP address.
 *
 * WHY THIS EXISTS:
 *   The platform runs behind an IIS ARR reverse proxy. From Node.js's raw
 *   TCP socket perspective, every request originates from 127.0.0.1 (IIS
 *   loopback). The real client IP is carried in the X-Forwarded-For header
 *   injected by IIS. Express `trust proxy` must be enabled for req.ip to
 *   resolve correctly; this helper adds a defensive fallback chain so the
 *   audit log never silently records a loopback address.
 *
 * HEADER PRIORITY (first non-loopback value wins):
 *   1. X-Forwarded-For   — standard proxy header (IIS ARR injects this)
 *   2. X-Real-IP         — used by nginx and some CDN setups
 *   3. req.ip            — Express-resolved IP (correct when trust proxy = 1)
 *   4. null              — logged as null; never silently swallowed
 *
 * USAGE:
 *   import { getClientIp } from '../../auth/getClientIp';
 *   logAudit({ ..., ip: getClientIp(req) });
 */

import { Request } from 'express';

/** Loopback addresses that should never be stored as the "real" client IP. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Returns the real remote client IP from the request.
 *
 * Handles:
 *  - Single proxy hop (IIS ARR on same machine)
 *  - Chained proxies (load balancer → IIS → Node.js); takes the LEFTMOST
 *    (originating) entry in X-Forwarded-For.
 *  - IPv6-mapped IPv4 addresses (strips `::ffff:` prefix).
 */
export function getClientIp(req: Request): string | null {
  // ── 1. X-Forwarded-For ────────────────────────────────────────────────────
  // Value can be a single IP or a comma-separated list:
  //   "client, proxy1, proxy2"
  // The LEFTMOST entry is the original client; rightmost entries are added
  // by each successive proxy and may be attacker-controlled — do NOT trust
  // the rightmost entry in an untrusted network.
  const xffHeader = req.headers['x-forwarded-for'];
  if (xffHeader) {
    const raw = Array.isArray(xffHeader) ? xffHeader[0] : xffHeader;
    const firstHop = raw.split(',')[0].trim();
    const normalised = normaliseIp(firstHop);
    if (normalised && !LOOPBACK.has(normalised)) return normalised;
  }

  // ── 2. X-Real-IP ──────────────────────────────────────────────────────────
  // Single-value header set by nginx / some CDN configurations.
  const xRealIp = req.headers['x-real-ip'];
  if (xRealIp) {
    const raw = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
    const normalised = normaliseIp(raw.trim());
    if (normalised && !LOOPBACK.has(normalised)) return normalised;
  }

  // ── 3. req.ip (Express-resolved) ──────────────────────────────────────────
  // Correct when `app.set('trust proxy', 1)` is configured.
  // Falls back gracefully if trust proxy is not set (returns socket address).
  if (req.ip) {
    const normalised = normaliseIp(req.ip);
    if (normalised && !LOOPBACK.has(normalised)) return normalised;
  }

  // ── 4. Raw socket address (last resort) ───────────────────────────────────
  const socketAddr = (req.socket?.remoteAddress ?? '').trim();
  if (socketAddr) {
    const normalised = normaliseIp(socketAddr);
    if (normalised) return normalised; // may be loopback — store for visibility
  }

  return null;
}

/**
 * Strips the IPv6-mapped IPv4 prefix (`::ffff:`) so that addresses like
 * `::ffff:192.168.1.1` are stored as plain `192.168.1.1`.
 */
function normaliseIp(raw: string): string | null {
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}
