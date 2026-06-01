import * as fs from 'fs';
import * as path from 'path';
import type { ApiDefectRecord, ApiDefectsRegistry } from './contracts/api-defect.contracts';

function dataDir(): string { return path.resolve(process.env.DATA_DIR || 'data'); }
function defectsPath(): string { return path.join(dataDir(), 'api-defects.json'); }

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadApiDefectsRegistry(): ApiDefectsRegistry {
  try {
    const raw = fs.readFileSync(defectsPath(), 'utf8');
    const parsed = JSON.parse(raw) as ApiDefectsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, defects: [] };
  }
}

export function saveApiDefectsRegistry(reg: ApiDefectsRegistry): void {
  atomicWrite(defectsPath(), JSON.stringify(reg, null, 2));
}

export function findOpenApiDefect(stepId: string, collectionId: string): ApiDefectRecord | null {
  const reg = loadApiDefectsRegistry();
  return reg.defects.find(d =>
    d.stepId === stepId && d.collectionId === collectionId && d.status === 'open'
  ) ?? null;
}

export function appendApiDefectRecord(record: ApiDefectRecord): void {
  const reg = loadApiDefectsRegistry();
  reg.defects.push(record);
  saveApiDefectsRegistry(reg);
}
