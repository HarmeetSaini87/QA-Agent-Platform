import * as fs   from 'fs';
import * as path from 'path';
import type { NlConfig, NlAliasMap } from '../data/types';

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

export function loadAliasMap(): NlAliasMap {
  try {
    return JSON.parse(fs.readFileSync(aliasPath(), 'utf8')) as NlAliasMap;
  } catch {
    return {};
  }
}

export function saveAliasMap(map: NlAliasMap): void {
  // enforce max 10 aliases per locator, normalize entries
  const clean: NlAliasMap = {};
  for (const [loc, aliases] of Object.entries(map)) {
    clean[loc] = aliases
      .map(a => a.toLowerCase().trim().replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  atomicWrite(aliasPath(), JSON.stringify(clean, null, 2));
}
