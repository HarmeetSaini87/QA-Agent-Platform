/**
 * data-file.routes.ts — Upload, list, retrieve, rename, and delete data files.
 *
 * Uses multer memoryStorage: file buffer is parsed in-process and only the
 * parsed JSON rows are stored on disk — no raw file is ever written.
 *
 * Supports CSV and JSON uploads.  Replace flow: client sends replaceId in body;
 * this route deletes the old record before saving the new one.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import { requireAuth } from '../../auth/middleware';
import { readAll, SETTINGS } from '../../data/store';
import type { AppSettings } from '../../data/types';
import {
  saveDataFile,
  listDataFiles,
  getDataFile,
  getDataFileRows,
  deleteDataFile,
  updateDataFileLastUsed,
  renameDataFile,
} from '../../data/data-file-store';

// Memory storage — parse in-process; store only parsed JSON (no raw file on disk)
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },   // 5 MB cap
});

function parseFile(buffer: Buffer, originalname: string): Record<string, string>[] {
  const ext = originalname.split('.').pop()?.toLowerCase();
  if (ext === 'csv') {
    const rows = csvParse(buffer.toString('utf-8'), {
      columns:           true,
      skip_empty_lines:  true,
      trim:              true,
    }) as Record<string, string>[];
    return rows;
  }
  if (ext === 'json') {
    const parsed = JSON.parse(buffer.toString('utf-8')) as unknown;
    if (Array.isArray(parsed)) return parsed as Record<string, string>[];
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'data' in (parsed as object) &&
      Array.isArray((parsed as { data: unknown }).data)
    ) {
      return (parsed as { data: Record<string, string>[] }).data;
    }
    throw new Error('JSON must be an array or { data: [...] }');
  }
  throw new Error('Only CSV and JSON files are supported');
}

function readMaxRows(): number {
  try {
    const rows = readAll<AppSettings & { id: string; dataFileMaxRows?: number }>(SETTINGS);
    const val = rows[0]?.dataFileMaxRows;
    if (val && Number.isInteger(val) && val > 0) return val;
  } catch { /* use default */ }
  return 500;
}

export function registerDataFileRoutes(app: express.Application): void {

  // ── Upload (new or replace) ─────────────────────────────────────────────────
  app.post(
    '/api/data-files/upload',
    requireAuth,
    memUpload.single('file'),
    (req: Request, res: Response) => {
      try {
        if (!req.file) { res.status(400).json({ error: 'No file received' }); return; }

        const projectId = (req.body.projectId as string || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

        const name      = ((req.body.name as string || req.file.originalname.replace(/\.[^.]+$/, '')) as string)
                            .trim().slice(0, 100);
        const replaceId = req.body.replaceId as string | undefined;

        // Parse the file
        const rows = parseFile(req.file.buffer, req.file.originalname);
        if (!rows.length) { res.status(400).json({ error: 'File has no data rows' }); return; }
        const columns = Object.keys(rows[0]);
        if (!columns.length) {
          res.status(400).json({ error: 'No column headers found — CSV must have a header row' });
          return;
        }

        // Delete old file if replacing
        if (replaceId) deleteDataFile(replaceId);

        const maxRows     = readMaxRows();
        const limitedRows = rows.slice(0, maxRows);
        const truncated   = rows.length > maxRows;

        const record = saveDataFile(
          { name, originalFilename: req.file.originalname, columns, rowCount: limitedRows.length, projectId },
          limitedRows,
        );

        res.json({
          ...record,
          truncated,
          totalRowsInFile: rows.length,
          preview:         limitedRows.slice(0, 5),
        });
      } catch (err: unknown) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Parse error' });
      }
    },
  );

  // ── List saved files ────────────────────────────────────────────────────────
  app.get('/api/data-files', requireAuth, (req: Request, res: Response) => {
    const projectId = (req.query.projectId as string || '').replace(/[^a-zA-Z0-9_-]/g, '');
    res.json(listDataFiles(projectId || undefined));
  });

  // ── Get single file metadata + rows ────────────────────────────────────────
  app.get('/api/data-files/:id', requireAuth, (req: Request, res: Response) => {
    const record = getDataFile(req.params.id);
    if (!record) { res.status(404).json({ error: 'Not found' }); return; }
    const rows = getDataFileRows(req.params.id);
    updateDataFileLastUsed(req.params.id);
    res.json({ ...record, rows, preview: rows.slice(0, 5) });
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  app.delete('/api/data-files/:id', requireAuth, (req: Request, res: Response) => {
    const deleted = deleteDataFile(req.params.id);
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ok: true });
  });

  // ── Rename ──────────────────────────────────────────────────────────────────
  app.patch('/api/data-files/:id/name', requireAuth, (req: Request, res: Response) => {
    const newName = String(req.body.name || '').trim().slice(0, 100);
    const updated = renameDataFile(req.params.id, newName);
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  });
}
