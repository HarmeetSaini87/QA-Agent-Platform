/**
 * pageModelManager.ts — P5-A
 *
 * CRUD helpers for PageModel records.
 * Storage: data/page-models/<id>.json  (one file per model)
 *
 * A PageModel maps a normalised URL pattern (pageKey) to the set of
 * Locator Repo IDs that were seen on that page, so the pre-scan engine
 * knows which locators to validate for a given URL.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PageModel } from '../data/types';

const PAGE_MODELS_DIR = path.resolve('data', 'page-models');

function ensureDir(): void {
  fs.mkdirSync(PAGE_MODELS_DIR, { recursive: true });
}

/** Read all PageModel records for a project. */
export function listPageModels(projectId: string): PageModel[] {
  ensureDir();
  const models: PageModel[] = [];
  try {
    for (const f of fs.readdirSync(PAGE_MODELS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const m: PageModel = JSON.parse(fs.readFileSync(path.join(PAGE_MODELS_DIR, f), 'utf-8'));
        if (m.projectId === projectId) models.push(m);
      } catch { /* skip malformed file */ }
    }
  } catch { /* dir missing */ }
  return models.sort((a, b) => a.pageKey.localeCompare(b.pageKey));
}

/** Look up the PageModel for a specific projectId + pageKey pair. */
export function getPageModelByKey(projectId: string, pageKey: string): PageModel | null {
  return listPageModels(projectId).find(m => m.pageKey === pageKey) ?? null;
}

/** Create or update a PageModel, merging locatorIds (no duplicates). */
export function upsertPageModel(data: {
  projectId:    string;
  pageKey:      string;
  pageName?:    string;
  locatorIds:   string[];
  capturedFrom: 'recorder' | 'prescan';
}): PageModel {
  ensureDir();
  const existing = getPageModelByKey(data.projectId, data.pageKey);
  const now = new Date().toISOString();

  if (existing) {
    const merged: string[] = Array.from(new Set([...existing.locatorIds, ...data.locatorIds]));
    const updated: PageModel = {
      ...existing,
      locatorIds:   merged,
      capturedAt:   now,
      capturedFrom: data.capturedFrom,
    };
    fs.writeFileSync(path.join(PAGE_MODELS_DIR, `${existing.id}.json`), JSON.stringify(updated, null, 2));
    return updated;
  }

  const model: PageModel = {
    id:           uuidv4(),
    projectId:    data.projectId,
    pageKey:      data.pageKey,
    pageName:     data.pageName ?? data.pageKey,
    locatorIds:   [...new Set(data.locatorIds)],
    capturedAt:   now,
    capturedFrom: data.capturedFrom,
  };
  fs.writeFileSync(path.join(PAGE_MODELS_DIR, `${model.id}.json`), JSON.stringify(model, null, 2));
  return model;
}

/** Delete a PageModel by id. */
export function deletePageModel(id: string): void {
  const file = path.join(PAGE_MODELS_DIR, `${id}.json`);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
}
