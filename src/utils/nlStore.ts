import * as fs   from 'fs';
import * as path from 'path';
import type { NlConfig, NlAliasMap } from '../data/types';
import { readAll, LOCATORS } from '../data/store';
import type { Locator } from '../data/types';

let DATA_DIR = path.resolve(process.cwd(), 'data');

export function setNlDataDir(dir: string): void { DATA_DIR = dir; }

function configPath(): string  { return path.join(DATA_DIR, 'nl-config.json'); }
function aliasPath():  string  { return path.join(DATA_DIR, 'nl-locator-aliases.json'); }

function atomicWrite(file: string, data: string): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export const DEFAULT_NL_CONFIG: NlConfig = {
  enabled:             false,
  provider:            'openai',
  model:               'gpt-4o-mini',
  baseUrl:             '',
  apiKeyEncrypted:     '',
  confidenceThreshold: 0.5,
  timeoutMs:           3000,
};

export function loadNlConfig(): NlConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULT_NL_CONFIG, ...JSON.parse(raw) } as NlConfig;
  } catch {
    return { ...DEFAULT_NL_CONFIG };
  }
}

export function saveNlConfig(cfg: NlConfig): void {
  atomicWrite(configPath(), JSON.stringify(cfg, null, 2));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalizeAlias(a: string): string {
  return a.toLowerCase().trim().replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Convert a name-keyed map (from UI) → id-keyed map (for storage).
 * Locator name lookup is case-insensitive. Unmatched names are dropped with a warning.
 */
export function aliasMapNamesToIds(nameKeyed: NlAliasMap, projectId?: string): NlAliasMap {
  const locators = readAll<Locator>(LOCATORS);
  const scoped   = projectId ? locators.filter(l => !l.projectId || l.projectId === projectId) : locators;
  const byName   = new Map(scoped.map(l => [l.name.toLowerCase().trim(), l.id]));

  const idKeyed: NlAliasMap = {};
  for (const [name, aliases] of Object.entries(nameKeyed)) {
    const id = byName.get(name.toLowerCase().trim());
    if (!id) {
      // Keep the name as-is if no matching locator found (avoids silent data loss)
      idKeyed[name] = aliases;
      continue;
    }
    idKeyed[id] = aliases;
  }
  return idKeyed;
}

/**
 * Convert an id-keyed map (from storage) → name-keyed map (for UI / rule engine).
 * IDs with no matching locator are kept as-is (stale but visible to admin).
 */
export function aliasMapIdsToNames(idKeyed: NlAliasMap, projectId?: string): NlAliasMap {
  const locators = readAll<Locator>(LOCATORS);
  const scoped   = projectId ? locators.filter(l => !l.projectId || l.projectId === projectId) : locators;
  const byId     = new Map(scoped.map(l => [l.id, l.name]));

  const nameKeyed: NlAliasMap = {};
  for (const [key, aliases] of Object.entries(idKeyed)) {
    // key is either a UUID (new format) or a name (legacy format — pre-migration entries)
    const name = byId.get(key) ?? key;
    nameKeyed[name] = aliases;
  }
  return nameKeyed;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load alias map from disk and return it as name-keyed (UI/rule-engine format).
 * Handles both legacy name-keyed files and new id-keyed files transparently.
 */
export function loadAliasMap(): NlAliasMap {
  try {
    const raw = JSON.parse(fs.readFileSync(aliasPath(), 'utf8')) as NlAliasMap;
    return aliasMapIdsToNames(raw);
  } catch {
    return {};
  }
}

/**
 * Load alias map as id-keyed (storage format) — used internally by routes
 * that need to merge/persist without a round-trip through name resolution.
 */
export function loadAliasMapRaw(): NlAliasMap {
  try {
    return JSON.parse(fs.readFileSync(aliasPath(), 'utf8')) as NlAliasMap;
  } catch {
    return {};
  }
}

/**
 * Save alias map. Accepts name-keyed map (from UI), converts to id-keyed before writing.
 * Enforces max 10 aliases per locator and normalizes alias strings.
 */
export function saveAliasMap(nameKeyed: NlAliasMap): void {
  // Convert name → id keys for storage
  const idKeyed = aliasMapNamesToIds(nameKeyed);

  // Normalize alias values, enforce max 10
  const clean: NlAliasMap = {};
  for (const [key, aliases] of Object.entries(idKeyed)) {
    clean[key] = aliases
      .map(normalizeAlias)
      .filter(Boolean)
      .slice(0, 10);
  }
  atomicWrite(aliasPath(), JSON.stringify(clean, null, 2));
}
