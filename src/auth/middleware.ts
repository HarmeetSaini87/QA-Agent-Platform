/**
 * middleware.ts — Express auth + RBAC middleware
 */

import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { Role, ApiKey } from '../data/types';
import { readAll, writeAll, APIKEYS } from '../data/store';

// Augment Express session type
declare module 'express-session' {
  interface SessionData {
    userId:   string;
    username: string;
    role:     Role;
    loginAt:  string;
  }
}

/** Require authenticated session — redirects to /login for browser requests */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.userId) { next(); return; }
  // Use originalUrl (not req.path, which strips mount prefix) to distinguish API vs browser
  if (req.originalUrl.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
  } else {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
}

/** Require admin role — returns 403 if not admin */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    if (req.originalUrl.startsWith('/api/')) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.redirect('/login'); return;
  }
  if (req.session.role !== 'admin') {
    if (req.path.startsWith('/api/')) { res.status(403).json({ error: 'Forbidden — admin only' }); return; }
    res.status(403).send('Access denied');
    return;
  }
  next();
}

/**
 * Accepts either a valid session cookie OR `Authorization: Bearer <rawKey>`.
 * Bearer key is SHA-256 hashed and looked up in apikeys.json.
 * On success: updates lastUsedAt and attaches req.apiKeyId for audit.
 */
export function requireAuthOrApiKey(req: Request, res: Response, next: NextFunction): void {
  // 1. Session auth (normal browser path)
  if (req.session?.userId) { next(); return; }

  // 2. Bearer token path (CI/CD pipelines)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const raw  = authHeader.slice(7).trim();
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const keys = readAll<ApiKey>(APIKEYS);
    const key  = keys.find(k => k.keyHash === hash && (k.expiresAt === null || new Date(k.expiresAt) > new Date()));
    if (key) {
      // Update lastUsedAt without blocking
      const updated = keys.map(k => k.id === key.id ? { ...k, lastUsedAt: new Date().toISOString() } : k);
      writeAll(APIKEYS, updated);
      (req as any).apiKeyId  = key.id;
      (req as any).apiKeyName = key.name;
      (req as any).apiKeyProjectId = key.projectId;
      next(); return;
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}

/** Escape HTML to prevent XSS in any server-rendered output */
export function escHtml(str: string): string {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/** Strip HTML tags from user input */
export function sanitizeInput(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}
