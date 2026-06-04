/**
 * systemRunnerKey.ts
 *
 * Manages the QA System Runner API key — a server-provisioned key used exclusively
 * by generated Playwright specs to authenticate calls to /api/visual-baselines/compare.
 *
 * Design:
 *   - Key is auto-created at server startup if it doesn't exist
 *   - Raw key stored in data/.runner-key (server-side only, never sent to browser)
 *   - Key hash stored in data/apikeys.json (same as user-created keys — uses existing auth path)
 *   - Codegen reads raw key via getSystemRunnerKey() and embeds as Bearer token in generated spec
 *   - Works from any remote machine — key travels in the spec, validated by server on every compare call
 *   - Admin can rotate by deleting data/.runner-key — next restart provisions a fresh key
 */

import * as crypto from 'crypto';
import * as fs     from 'fs';
import * as path   from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readAll, writeAll, APIKEYS } from '../data/store';
import type { ApiKey } from '../data/types';
import { logger } from './logger';

const SYSTEM_KEY_NAME = 'QA System Runner';
const RUNNER_KEY_FILE = path.resolve('data', '.runner-key');

/** Returns the raw runner key, or null if not yet provisioned. */
export function getSystemRunnerKey(): string | null {
  try {
    if (fs.existsSync(RUNNER_KEY_FILE)) {
      return fs.readFileSync(RUNNER_KEY_FILE, 'utf-8').trim();
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Called once at server startup.
 * Idempotent — skips provisioning if key file and apikeys entry both exist.
 */
export function ensureSystemRunnerKey(): void {
  try {
    // If raw key file exists and matching hash in apikeys store → already provisioned
    const existingRaw = getSystemRunnerKey();
    if (existingRaw) {
      const existingHash = crypto.createHash('sha256').update(existingRaw).digest('hex');
      const keys = readAll<ApiKey>(APIKEYS);
      if (keys.find(k => k.name === SYSTEM_KEY_NAME && k.keyHash === existingHash)) {
        logger.info('[runner-key] System runner key already provisioned');
        return;
      }
    }

    // Generate a new cryptographically random key
    const rawKey  = 'qar-' + crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const prefix  = rawKey.slice(0, 8);

    // Persist raw key to file (server-side only)
    fs.mkdirSync(path.dirname(RUNNER_KEY_FILE), { recursive: true });
    fs.writeFileSync(RUNNER_KEY_FILE, rawKey, { encoding: 'utf-8', mode: 0o600 });

    // Remove any stale system runner entry, then add fresh one
    const keys = readAll<ApiKey>(APIKEYS).filter(k => k.name !== SYSTEM_KEY_NAME);
    const entry: ApiKey = {
      id:          uuidv4(),
      name:        SYSTEM_KEY_NAME,
      keyHash,
      prefix,
      projectId:   null,       // all projects
      createdBy:   'system',
      createdAt:   new Date().toISOString(),
      lastUsedAt:  null,
      expiresAt:   null,       // never expires
    };
    writeAll(APIKEYS, [...keys, entry]);

    logger.info(`[runner-key] System runner key provisioned (prefix: ${prefix}…)`);
  } catch (err) {
    logger.error(`[runner-key] Failed to provision system runner key: ${(err as Error).message}`);
  }
}
