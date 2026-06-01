/**
 * config-store.ts
 * Lightweight wrapper for singleton config records.
 *
 * Wraps three distinct config storage patterns already in use:
 *
 *   1. AppSettings  → data/settings.json  (SETTINGS collection, array of 1 via store.ts)
 *   2. NlConfig     → data/nl-config.json (standalone JSON file via nlStore.ts)
 *   3. JiraConfig   → data/jira-config.json (standalone JSON — CREDENTIAL FILE, atomic write only)
 *
 * Phase A: thin delegation only — no new storage logic, no schema changes.
 * Phase B+: swap to a typed config table without callers changing.
 *
 * IMPORTANT — jira-config.json:
 *   Contains AES-256-GCM encrypted apiTokenEnc. NEVER read the raw file and
 *   re-serialize it without going through the existing atomic write path.
 *   This store exposes only load/save — callers must use the /api/jira/config
 *   endpoint for mutations (see CLAUDE.md credential protection rule).
 *
 * DEPENDENCY BOUNDARY:
 *   - No Playwright, no Express, no auth imports
 *   - Delegates to existing store.ts (for AppSettings) and direct fs (for JSON configs)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { readAll, writeAll, SETTINGS } from '../data/store';
import type { AppSettings, NlConfig, JiraConfig } from '../data/types';
import { DEFAULT_SETTINGS } from '../data/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || 'data');
}

function atomicWrite(filePath: string, data: string): void {
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

// ── AppSettings (SETTINGS collection — singleton array-of-1 pattern) ─────────

/** Load global app settings. Returns DEFAULT_SETTINGS if not yet saved. */
export function loadAppSettings(): AppSettings & { id: string } {
  const row = readAll<AppSettings & { id: string }>(SETTINGS)[0];
  return row ?? { id: 'global', ...DEFAULT_SETTINGS };
}

/** Save global app settings. Overwrites the single settings record. */
export function saveAppSettings(settings: AppSettings): void {
  writeAll(SETTINGS, [{ id: 'global', ...settings }]);
}

// ── NlConfig (data/nl-config.json — standalone atomic JSON) ──────────────────

const DEFAULT_NL_CONFIG: NlConfig = {
  enabled:             false,
  provider:            'openai',
  model:               'gpt-4o-mini',
  baseUrl:             '',
  apiKeyEncrypted:     '',
  confidenceThreshold: 0.5,
  timeoutMs:           3000,
};

function nlConfigPath(): string {
  return path.join(dataDir(), 'nl-config.json');
}

/** Load NL provider config. Returns defaults if file absent. */
export function loadNlConfig(): NlConfig {
  try {
    const raw = fs.readFileSync(nlConfigPath(), 'utf-8');
    return { ...DEFAULT_NL_CONFIG, ...JSON.parse(raw) } as NlConfig;
  } catch {
    return { ...DEFAULT_NL_CONFIG };
  }
}

/** Save NL provider config atomically. */
export function saveNlConfig(cfg: NlConfig): void {
  atomicWrite(nlConfigPath(), JSON.stringify(cfg, null, 2));
}

// ── JiraConfig (data/jira-config.json — CREDENTIAL FILE, atomic only) ─────────

function jiraConfigPath(): string {
  return path.join(dataDir(), 'jira-config.json');
}

/**
 * Load Jira config. Returns undefined if not yet configured.
 * Caller is responsible for decrypting apiTokenEnc before use.
 */
export function loadJiraConfig(): JiraConfig | undefined {
  try {
    const raw = fs.readFileSync(jiraConfigPath(), 'utf-8');
    return JSON.parse(raw) as JiraConfig;
  } catch {
    return undefined;
  }
}

/**
 * Save Jira config atomically.
 * IMPORTANT: apiTokenEnc MUST already be AES-GCM encrypted before calling this.
 * Never pass a plaintext token — use the existing encryptToken() from server.ts.
 */
export function saveJiraConfig(cfg: JiraConfig): void {
  atomicWrite(jiraConfigPath(), JSON.stringify(cfg, null, 2));
}

export function jiraConfigExists(): boolean {
  return fs.existsSync(jiraConfigPath());
}
