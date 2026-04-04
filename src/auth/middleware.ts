/**
 * middleware.ts — Express auth + RBAC middleware
 */

import { Request, Response, NextFunction } from 'express';
import { Role } from '../data/types';

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
