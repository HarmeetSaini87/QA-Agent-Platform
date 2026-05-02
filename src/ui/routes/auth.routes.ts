import express, { Request, Response } from 'express';
import { readAll, upsert, findById, USERS } from '../../data/store';
import type { User } from '../../data/types';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../auth/crypto';
import { logAudit } from '../../auth/audit';
import { isFeatureEnabled, getLicensePayload, isSeatAvailable, getSeatsUsed, recordLogin, recordLogout } from '../../utils/licenseManager';
import { parseRecorderEvent } from '../../utils/recorderParser';
import { recorderSessions, recorderSsePush } from '../helpers/sse';
import { loginRateLimiter } from '../helpers/middleware';

export function registerAuthRoutes(app: express.Application): void {
  app.post('/api/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) { res.status(400).json({ error: 'Username and password are required' }); return; }
    const users = readAll<User>(USERS);
    const user = users.find(u => (u.username === username.trim() || u.email === username.trim()) && u.isActive);
    if (!user) { logAudit({ userId: null, username: username, action: 'LOGIN_FAILED', resourceType: null, resourceId: null, details: 'Unknown user', ip: req.ip ?? null }); res.status(401).json({ error: 'Invalid username or password' }); return; }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) { logAudit({ userId: user.id, username: user.username, action: 'LOGIN_FAILED', resourceType: null, resourceId: null, details: 'Wrong password', ip: req.ip ?? null }); res.status(401).json({ error: 'Invalid username or password' }); return; }
    user.lastLogin = new Date().toISOString();
    upsert(USERS, user);
    logAudit({ userId: user.id, username: user.username, action: 'LOGIN_SUCCESS', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null });
    if (user.forcePasswordChange) { res.json({ forcePasswordChange: true, userId: user.id }); return; }
    const licPayload = getLicensePayload();
    if (licPayload && !isSeatAvailable(user.id)) { res.status(403).json({ error: 'Seat limit reached. All licensed seats are in use.', seatsUsed: getSeatsUsed(), seatsTotal: licPayload.seats ?? 0 }); return; }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.loginAt = new Date().toISOString();
    (req.session as unknown as Record<string, unknown>).ip = req.ip ?? null;
    recordLogin(user.id);
    res.json({ success: true, role: user.role, username: user.username });
  });

  app.post('/api/auth/change-password', async (req: Request, res: Response) => {
    const { userId, newPassword } = req.body as { userId?: string; newPassword?: string };
    if (!userId || !newPassword) { res.status(400).json({ error: 'userId and newPassword are required' }); return; }
    const err = validatePasswordStrength(newPassword);
    if (err) { res.status(400).json({ error: err }); return; }
    const user = findById<User>(USERS, userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    user.passwordHash = await hashPassword(newPassword);
    user.forcePasswordChange = false;
    upsert(USERS, user);
    logAudit({ userId: user.id, username: user.username, action: 'PASSWORD_CHANGED', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.loginAt = new Date().toISOString();
    res.json({ success: true });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const uid = req.session?.userId;
    if (uid) { logAudit({ userId: uid, username: req.session.username ?? null, action: 'LOGOUT', resourceType: null, resourceId: null, details: null, ip: req.ip ?? null }); recordLogout(uid); }
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    if (!req.session?.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
    res.json({ userId: req.session.userId, username: req.session.username, role: req.session.role });
  });

  // CORS middleware for Chrome Extension + AUT cross-origin requests
  app.use((req: Request, res: Response, next) => {
    const origin = req.headers.origin || '';
    if (origin.startsWith('chrome-extension://')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    } else if (req.path === '/api/recorder/step' || req.path === '/api/recorder/heartbeat') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // Recorder step endpoint — token-authenticated, no session cookie needed
  app.post('/api/recorder/step', (req: Request, res: Response) => {
    const event = req.body as any;
    const session = recorderSessions.get(event?.token);
    if (!session || !session.active) { res.status(404).json({ error: 'session not found or inactive' }); return; }
    session.lastActivity = Date.now();
    session.stepCount++;
    const { step, locatorCreated, locatorName } = parseRecorderEvent(event, session.projectId, session.createdBy, session.stepCount);
    session.steps.push(step);
    recorderSsePush(event.token, 'recorder:step', { step, locatorCreated, locatorName, stepNum: session.stepCount });
    res.json({ success: true, stepNum: session.stepCount });
  });
}