import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../framework/config';
import { logAudit } from '../../auth/audit';
import type { RunRecord } from '../helpers/types';

const TRACE_VIEWER_DIR = path.resolve(__dirname, '..', 'public', 'trace-viewer');

function canAccessTrace(_req: Request, _runId: string): boolean { return true; }

function handleTraceRequest(req: Request, res: Response, streamFile: boolean): void {
  const { runId, testId } = req.params;
  const requestId = uuidv4();
  if (!/^[a-zA-Z0-9_-]+$/.test(runId) || !/^[a-zA-Z0-9_-]+$/.test(testId)) { res.setHeader('X-Error-Code', 'BAD_REQUEST'); res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } }); return; }
  if (!canAccessTrace(req, runId)) { res.setHeader('X-Error-Code', 'FORBIDDEN'); res.status(404).end(); return; }
  const runFile = path.join(config.paths.results, `run-${runId}.json`);
  if (!fs.existsSync(runFile)) { res.setHeader('X-Error-Code', 'RUN_NOT_FOUND'); res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found' } }); return; }
  let record: RunRecord;
  try { record = JSON.parse(fs.readFileSync(runFile, 'utf-8')) as RunRecord; } catch { res.setHeader('X-Error-Code', 'RUN_NOT_FOUND'); res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found' } }); return; }
  const ev = record.tests.find(t => t.testId === testId);
  if (!ev) { res.setHeader('X-Error-Code', 'TEST_NOT_FOUND'); res.status(404).json({ error: { code: 'TEST_NOT_FOUND', message: 'Test not found in run' } }); return; }
  if (!ev.tracePath || path.isAbsolute(ev.tracePath)) { res.setHeader('X-Error-Code', 'TRACE_NOT_FOUND'); res.status(404).json({ error: { code: 'TRACE_NOT_FOUND', message: 'Trace not found' } }); return; }
  const baseDir = path.resolve(config.paths.testResults);
  const relPath = ev.tracePath.replace(/^test-results[\\/]/, '');
  const resolved = path.resolve(baseDir, relPath);
  if (!resolved.toLowerCase().startsWith((baseDir + path.sep).toLowerCase())) { res.setHeader('X-Error-Code', 'BAD_REQUEST'); res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } }); return; }
  const MAX_TRACE_BYTES = 50 * 1024 * 1024;
  let stat: fs.Stats;
  try { stat = fs.statSync(resolved); } catch { res.setHeader('X-Error-Code', 'TRACE_MISSING_ON_DISK'); res.status(404).json({ error: { code: 'TRACE_MISSING_ON_DISK', message: 'Trace artifact not found' } }); return; }
  if (stat.size > MAX_TRACE_BYTES) { res.setHeader('X-Error-Code', 'TRACE_TOO_LARGE'); res.status(413).json({ error: { code: 'TRACE_TOO_LARGE', message: 'Trace too large to preview' } }); return; }
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'inline; filename="trace.zip"');
  res.setHeader('Content-Length', stat.size); res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Accept-Ranges', 'none'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Request-Id', requestId);
  if (!streamFile) { res.end(); return; }
  logAudit({ userId: (req as any).session?.userId ?? null, username: (req as any).session?.username ?? null, action: 'TRACE_VIEWED', resourceType: 'trace', resourceId: `${runId}::${testId}`, details: requestId, ip: req.ip ?? null });
  const stream = fs.createReadStream(resolved);
  stream.on('error', () => { if (!res.headersSent) { res.status(500).json({ error: { code: 'TRACE_READ_FAILED', message: 'Failed to read trace' } }); } else { stream.unpipe(res); res.end(); } });
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

export function registerTraceRoutes(app: express.Application): void {
  app.use('/trace-viewer', express.static(TRACE_VIEWER_DIR));
  app.get('/trace-viewer/*', (_req: Request, res: Response) => { res.sendFile(path.join(TRACE_VIEWER_DIR, 'index.html')); });
  app.get('/api/trace/:runId/:testId', (req: Request, res: Response) => handleTraceRequest(req, res, true));
  app.head('/api/trace/:runId/:testId', (req: Request, res: Response) => handleTraceRequest(req, res, false));
}