import express, { Request, Response } from 'express';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { readAll, upsert, remove, findById, writeAll, USERS, APIKEYS, AUDIT, SETTINGS } from '../../data/store';
import type { User, AppSettings, NotificationSettings, ApiKey } from '../../data/types';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../../auth/crypto';
import { requireAdmin, sanitizeInput } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { DEFAULT_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS } from '../../data/types';
import { sendRunNotification } from '../../utils/notifier';
import multer from 'multer';
import * as path from 'path';

export function registerAdminRoutes(app: express.Application): void {
  // Users
  app.get('/api/admin/users', requireAdmin, (_req, res) => { const users = readAll<User>(USERS).map(u => ({ ...u, passwordHash: undefined })); res.json(users); });
  app.post('/api/admin/users', requireAdmin, async (req: Request, res: Response) => {
    const { username, email, password, role } = req.body as any;
    if (!username || !password || !role) { res.status(400).json({ error: 'username, password and role are required' }); return; }
    const err = validatePasswordStrength(password); if (err) { res.status(400).json({ error: err }); return; }
    const existing = readAll<User>(USERS); if (existing.find(u => u.username === username)) { res.status(409).json({ error: 'Username already exists' }); return; }
    const user: User = { id: uuidv4(), username: sanitizeInput(username), email: sanitizeInput(email ?? ''), passwordHash: await hashPassword(password), role: role === 'admin' ? 'admin' : 'tester', isActive: true, forcePasswordChange: true, createdAt: new Date().toISOString(), createdBy: req.session.username ?? null, lastLogin: null };
    upsert(USERS, user); logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'USER_CREATED', resourceType: 'user', resourceId: user.id, details: user.username, ip: req.ip ?? null }); res.json({ success: true, id: user.id });
  });
  app.put('/api/admin/users/:id', requireAdmin, async (req: Request, res: Response) => {
    const user = findById<User>(USERS, req.params.id); if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const { email, role, isActive, forcePasswordChange, password } = req.body as any;
    if (email !== undefined) user.email = sanitizeInput(email); if (role !== undefined) user.role = role === 'admin' ? 'admin' : 'tester'; if (isActive !== undefined) user.isActive = !!isActive; if (forcePasswordChange !== undefined) user.forcePasswordChange = !!forcePasswordChange;
    if (password) { const e = validatePasswordStrength(password); if (e) { res.status(400).json({ error: e }); return; } user.passwordHash = await hashPassword(password); }
    upsert(USERS, user); logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'USER_UPDATED', resourceType: 'user', resourceId: user.id, details: user.username, ip: req.ip ?? null }); res.json({ success: true });
  });
  app.delete('/api/admin/users/:id', requireAdmin, (req: Request, res: Response) => {
    if (req.params.id === req.session.userId) { res.status(400).json({ error: 'Cannot delete your own account' }); return; }
    const removed = remove(USERS, req.params.id); if (!removed) { res.status(404).json({ error: 'User not found' }); return; }
    logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'USER_DELETED', resourceType: 'user', resourceId: req.params.id, details: null, ip: req.ip ?? null }); res.json({ success: true });
  });

  // API Keys
  app.get('/api/admin/apikeys', requireAdmin, (_req: Request, res: Response) => { const keys = readAll<ApiKey>(APIKEYS).map(k => ({ ...k, keyHash: undefined })); res.json(keys); });
  app.post('/api/admin/apikeys', requireAdmin, (req: Request, res: Response) => {
    const { name, projectId, expiresAt } = req.body as any; if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    const rawKey = crypto.randomBytes(32).toString('hex'); const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const key: ApiKey = { id: uuidv4(), name: sanitizeInput(name), keyHash, prefix: rawKey.slice(0, 8), projectId: projectId ?? null, createdBy: req.session.username ?? 'admin', createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: expiresAt ?? null };
    upsert(APIKEYS, key); logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'APIKEY_CREATED', resourceType: 'apikey', resourceId: key.id, details: key.name, ip: req.ip ?? null }); res.json({ success: true, key: rawKey, prefix: key.prefix, id: key.id });
  });
  app.delete('/api/admin/apikeys/:id', requireAdmin, (req: Request, res: Response) => { const removed = remove(APIKEYS, req.params.id); if (!removed) { res.status(404).json({ error: 'API key not found' }); return; } logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'APIKEY_DELETED', resourceType: 'apikey', resourceId: req.params.id, details: null, ip: req.ip ?? null }); res.json({ success: true }); });

  // Audit
  app.get('/api/admin/audit', requireAdmin, (req: Request, res: Response) => { const all = readAll<AuditEntry>(AUDIT); const page = parseInt((req.query.page as string) ?? '1') || 1; const size = parseInt((req.query.size as string) ?? '50') || 50; const start = (page - 1) * size; res.json({ total: all.length, page, size, entries: all.slice().reverse().slice(start, start + size) }); });

  // Settings
  app.get('/api/admin/settings', requireAdmin, (_req, res) => { const rows = readAll<AppSettings & { id: string }>(SETTINGS); const s = rows[0] ?? { id: 'global', ...DEFAULT_SETTINGS }; const { nlApiKey, anthropicApiKey, ...safe } = s as any; const keyIsSet = !!((nlApiKey || anthropicApiKey || '').trim()); res.json({ ...safe, nlApiKeySet: keyIsSet }); });
  app.put('/api/admin/settings', requireAdmin, (req: Request, res: Response) => {
    const current = readAll<AppSettings & { id: string }>(SETTINGS)[0] ?? { id: 'global', ...DEFAULT_SETTINGS };
    const notifications: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(current.notifications ?? {}), ...(req.body.notifications ?? {}) };
    const incomingKey = (req.body.nlApiKey || req.body.anthropicApiKey || '').trim();
    const nlApiKey = incomingKey || (current as any).nlApiKey || (current as any).anthropicApiKey || '';
    const { nlApiKey: _d1, anthropicApiKey: _d2, ...restBody } = req.body as any;
    const updated = { ...current, ...restBody, notifications, nlApiKey, id: 'global' };
    writeAll(SETTINGS, [updated]); logAudit({ userId: req.session.userId!, username: req.session.username!, action: 'SETTINGS_UPDATED', resourceType: 'settings', resourceId: 'global', details: null, ip: req.ip ?? null }); res.json({ success: true });
  });
  app.post('/api/admin/settings/test-notification', requireAdmin, async (req: Request, res: Response) => {
    try {
      const settingsRow = readAll<AppSettings & { id: string }>(SETTINGS)[0]; const notifCfg = settingsRow?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS;
      const platformUrl = `${req.protocol}://${req.get('host')}`; const errors = await sendRunNotification(notifCfg, { runId: '', suiteName: '', projectName: '', status: 'done' as const, passed: 0, failed: 0, total: 0, duration: '', startedAt: '', executedBy: '', environmentName: '', platformUrl }); const hasError = Object.values(errors).some(Boolean);
      if (hasError) { res.json({ success: false, errors }); } else { res.json({ success: true }); }
    } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });

  // Change own password
  app.post('/api/user/change-password', async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body as any; if (!currentPassword || !newPassword) { res.status(400).json({ error: 'Both passwords are required' }); return; }
    const user = findById<User>(USERS, req.session.userId!); if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) { res.status(400).json({ error: 'Current password is incorrect' }); return; }
    const err = validatePasswordStrength(newPassword); if (err) { res.status(400).json({ error: err }); return; }
    user.passwordHash = await hashPassword(newPassword); upsert(USERS, user);
    logAudit({ userId: user.id, username: user.username, action: 'PASSWORD_CHANGED', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null }); res.json({ success: true });
  });

  // Keywords
  app.get('/api/keywords/playwright', (_req, res) => { const f = path.resolve('src', 'data', 'keywords.json'); try { res.json(JSON.parse(require('fs').readFileSync(f, 'utf-8'))); } catch { res.json({ categories: [], dynamicTokens: [] }); } });

  // Graceful restart — monitor script (service-monitor.ps1) sees port down and restarts within 30s
  app.post('/api/admin/restart-server', requireAdmin, (_req: Request, res: Response) => {
    res.json({ ok: true, message: 'Server restarting — monitor will restore in ~30s' });
    setTimeout(() => process.exit(1), 500);
  });
}

import type { AuditEntry } from '../../data/types';