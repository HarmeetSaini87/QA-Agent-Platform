import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../framework/config';
import { requireAuth } from '../../auth/middleware';
import { requireAuthOrApiKey } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { sanitizeInput } from '../../auth/middleware';
import type { RunRecord } from '../helpers/types';
import { v4 as uuidv4 } from 'uuid';

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const TRACE_VIEWER_DIR = path.join(PUBLIC_DIR, 'trace-viewer');
const TEST_FILES_DIR = path.resolve('test-files');
const UPLOAD_DIR = path.resolve(config.paths.requirements, 'uploads');

function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

export function registerFilesRoutes(app: express.Application, testFileUpload: any): void {
  // Standalone Execution Report
  app.get('/execution-report', (_req: Request, res: Response) => {
    res.sendFile(path.join(PUBLIC_DIR, 'execution-report.html'));
  });

  // Screenshots
  app.get('/screenshots/*', requireAuth, (req: Request, res: Response) => {
    const rel = (req.params as any)[0] as string;
    const base = config.paths.testResults;
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(path.resolve(base))) { res.status(403).end(); return; }
    if (fs.existsSync(abs)) { res.sendFile(abs); return; }
    res.status(404).end();
  });

  // Test artifacts (video + trace)
  app.get('/test-artifacts/*', requireAuth, (req: Request, res: Response) => {
    const rel = (req.params as any)[0] as string;
    const base = config.paths.testResults;
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(path.resolve(base))) { res.status(403).end(); return; }
    if (!fs.existsSync(abs)) { res.status(404).end(); return; }
    if (abs.endsWith('.zip')) { res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`); res.setHeader('Content-Type', 'application/zip'); }
    else if (abs.endsWith('.webm')) { res.setHeader('Content-Type', 'video/webm'); }
    res.sendFile(abs);
  });

  // Debug screenshot serving
  app.get('/debug-screenshot/:path(*)', requireAuth, (req: Request, res: Response) => {
    const rel = decodeURIComponent(req.params.path as string);
    const abs = path.resolve(rel);
    if (!abs.startsWith(path.resolve('debug-runs'))) { res.status(403).end(); return; }
    if (fs.existsSync(abs)) { res.sendFile(abs); return; }
    res.status(404).end();
  });

  // Test files upload
  app.post('/api/test-files/upload', testFileUpload.single('file'), (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: 'No file received or file type not allowed' }); return; }
    const projectId = (req.query.projectId as string || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const serverPath = path.join('test-files', projectId, req.file.filename).replace(/\\/g, '/');
    res.json({ filename: req.file.filename, serverPath });
  });

  // Test files list
  app.get('/api/test-files', (req: Request, res: Response) => {
    const projectId = ((req.query.projectId as string) || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!projectId) { res.json([]); return; }
    const dir = path.join(TEST_FILES_DIR, projectId);
    if (!fs.existsSync(dir)) { res.json([]); return; }
    const files = fs.readdirSync(dir).map(name => ({ filename: name, serverPath: `test-files/${projectId}/${name}`, sizeBytes: fs.statSync(path.join(dir, name)).size }));
    res.json(files);
  });

  // Test files delete
  app.delete('/api/test-files/:projectId/:filename', (req: Request, res: Response) => {
    const projectId = req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(TEST_FILES_DIR, projectId, filename);
    if (!filePath.startsWith(TEST_FILES_DIR)) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  });
}