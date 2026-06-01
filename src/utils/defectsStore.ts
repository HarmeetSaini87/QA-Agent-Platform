import * as fs from 'fs';
import * as path from 'path';
import type { JiraConfig, DefectsRegistry, DefectRecord, DismissEntry } from '../data/types';

let DATA_DIR = path.resolve(process.cwd(), 'data');

export function setDataDir(dir: string): void {
  DATA_DIR = dir;
}

function configPath(): string  { return path.join(DATA_DIR, 'jira-config.json'); }
function defectsPath(): string { return path.join(DATA_DIR, 'defects.json'); }
function dismissPath(): string { return path.join(DATA_DIR, 'dismissed-defects.ndjson'); }

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWrite(file: string, data: string): void {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadJiraConfig(): JiraConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return JSON.parse(raw) as JiraConfig;
  } catch {
    return null;
  }
}

export function saveJiraConfig(cfg: JiraConfig): void {
  atomicWrite(configPath(), JSON.stringify(cfg, null, 2));
}

export function loadDefectsRegistry(): DefectsRegistry {
  try {
    const raw = fs.readFileSync(defectsPath(), 'utf8');
    const parsed = JSON.parse(raw) as DefectsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, defects: [] };
  }
}

export function saveDefectsRegistry(reg: DefectsRegistry): void {
  atomicWrite(defectsPath(), JSON.stringify(reg, null, 2));
}

export function findOpenDefect(testId: string, suiteId: string): DefectRecord | null {
  const reg = loadDefectsRegistry();
  return reg.defects.find(d =>
    d.testId === testId && d.suiteId === suiteId && d.status === 'open'
  ) || null;
}

export function findOpenDefectsForRun(suiteId: string, environmentId: string): DefectRecord[] {
  const reg = loadDefectsRegistry();
  return reg.defects.filter(d =>
    d.suiteId === suiteId && d.environmentId === environmentId && d.status === 'open'
  );
}

export function appendDismissEntry(entry: DismissEntry): void {
  ensureDir();
  fs.appendFileSync(dismissPath(), JSON.stringify(entry) + '\n', 'utf8');
}
