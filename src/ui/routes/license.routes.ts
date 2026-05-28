import express, { Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { requireAuth, requireAdmin } from '../../auth/middleware';
import { logAudit } from '../../auth/audit';
import { validateLicenseKey, validateLicFile, storeLicense, loadStoredLicense, getLicensePayload, refreshLicenseCache, clearLicenseCache, isAutoTrial, trialDaysRemaining, getSeatsUsed, getSeatUsageRatio, transferLicense, getMachineId, getMachineIdComponents, checkMachineBinding } from '../../utils/licenseManager';

const licUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 } });

export function registerLicenseRoutes(app: express.Application, sessionStore: any): void {
  app.get('/api/admin/license', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    const stored = loadStoredLicense();
    if (!stored) { res.json({ activated: false }); return; }
    const p = stored.payload;
    const now = new Date();
    const expires = new Date(p.expiresAt);
    const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / 86400000);
    res.json({
      activated: true,
      tier: p.tier,
      orgId: p.orgId,
      orgName: p.orgName,
      seats: p.seats,
      seatsUsed: getSeatsUsed(),
      seatRatio: getSeatUsageRatio(),
      maxInstances: p.maxInstances,
      expiresAt: p.expiresAt,
      daysLeft,
      expired: expires < now,
      features: p.features,
      featureOverrides: p.featureOverrides ?? {},
      isAutoTrial: isAutoTrial(),
      trialDaysLeft: isAutoTrial() ? trialDaysRemaining() : null,
    });
  });

  app.post('/api/admin/license/activate', requireAuth, requireAdmin, licUpload.single('licFile'), async (req: Request, res: Response) => {
    if (req.file) {
      const licDir = path.resolve('data');
      const persistPath = path.join(licDir, 'license.lic');
      fs.mkdirSync(licDir, { recursive: true });
      fs.writeFileSync(persistPath, req.file.buffer);

      const payload = validateLicFile(persistPath);
      if (!payload) {
        fs.unlinkSync(persistPath);
        res.status(400).json({ error: 'Invalid, expired, or machine-mismatched .lic file' });
        return;
      }
      storeLicense('lic-file', payload, persistPath);
      refreshLicenseCache(payload);
      logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_ACTIVATED', resourceType: 'license', resourceId: null, details: `tier=${payload.tier} org=${payload.orgId} lic=file`, ip: req.ip ?? null });
      res.json({ success: true, tier: payload.tier, orgName: payload.orgName, expiresAt: payload.expiresAt });
      return;
    }

    const { key } = req.body as { key?: string };
    if (!key) { res.status(400).json({ error: 'key is required' }); return; }
    const payload = await validateLicenseKey(key.trim());
    if (!payload) { res.status(400).json({ error: 'Invalid license key — check the key and try again' }); return; }
    if (new Date(payload.expiresAt) < new Date()) { res.status(400).json({ error: 'License key has expired' }); return; }

    if (payload.tier === 'team' || payload.tier === 'enterprise') {
      res.status(400).json({
        error: 'Team and Enterprise licenses require a .lic file from your vendor — HMAC key activation is not supported for these tiers.',
        upgrade: 'lic_required',
      });
      return;
    }

    storeLicense(key.trim(), payload);
    refreshLicenseCache(payload);
    logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_ACTIVATED', resourceType: 'license', resourceId: null, details: `tier=${payload.tier} org=${payload.orgId}`, ip: req.ip ?? null });
    res.json({ success: true, tier: payload.tier, orgName: payload.orgName, expiresAt: payload.expiresAt });
  });

  app.delete('/api/admin/license', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const licPath = path.resolve('data', 'license.json');
    try { fs.unlinkSync(licPath); } catch { /* ok */ }
    clearLicenseCache();
    logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_DEACTIVATED', resourceType: 'license', resourceId: null, details: null, ip: req.ip ?? null });
    res.json({ success: true });
  });

  app.post('/api/admin/license/transfer', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const result = checkMachineBinding();
    if (result.ok) {
      res.status(400).json({ error: 'License is already bound to this machine — transfer not needed' });
      return;
    }
    const ok = transferLicense();
    if (!ok) { res.status(500).json({ error: 'Transfer failed — no active license found' }); return; }
    clearLicenseCache();
    logAudit({ userId: req.session.userId ?? null, username: req.session.username ?? null, action: 'LICENSE_TRANSFERRED', resourceType: 'license', resourceId: null, details: `new machineId=${getMachineId().slice(0, 8)}…`, ip: req.ip ?? null });
    res.json({ success: true, machineId: getMachineId() });
  });

  app.get('/api/admin/license/machine', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    const components = getMachineIdComponents();
    const current    = components.machineId;
    const stored     = loadStoredLicense();
    const bound      = stored?.machineId ?? null;
    const signals    = [components.windowsMachineGuid, components.biosUuid, components.volumeSerial, components.stableMAC].filter(Boolean);
    const stability  = signals.length >= 3 ? 'excellent' : signals.length === 2 ? 'good' : signals.length === 1 ? 'fair' : 'weak';
    res.json({
      currentMachineId:     current,
      currentMachineIdHint: current.slice(0, 8) + '…',
      boundMachineId:       bound,
      boundMachineIdHint:   bound ? bound.slice(0, 8) + '…' : null,
      match:                bound ? bound === current : null,
      components: {
        windowsMachineGuid: components.windowsMachineGuid || null,
        biosUuid:           components.biosUuid           || null,
        volumeSerial:       components.volumeSerial       || null,
        stableMAC:          components.stableMAC          || null,
        hostname:           components.hostname,
        cpuModel:           components.cpuModel,
        platform:           components.platform,
        arch:               components.arch,
      },
      signalCount: signals.length,
      stability,
    });
  });

  app.get('/api/admin/license/audit', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    const AUDIT_FILE = path.resolve('data', 'audit.json');
    try {
      const all: Array<Record<string, unknown>> = fs.existsSync(AUDIT_FILE)
        ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'))
        : [];
      const LICENSE_ACTIONS = new Set(['LICENSE_ACTIVATED', 'LICENSE_DEACTIVATED', 'LICENSE_TRANSFERRED', 'LICENSE_EXPIRED']);
      const events = all.filter(e => LICENSE_ACTIONS.has(e.action as string)).slice(-100).reverse();
      res.json(events);
    } catch { res.json([]); }
  });

  app.get('/api/admin/license/sessions', requireAuth, requireAdmin, (req: Request, res: Response) => {
    sessionStore.all!((err: any, sessions: any) => {
      if (err) { res.status(500).json({ error: 'Failed to read sessions' }); return; }
      const rows = Object.entries(sessions ?? {}).map(([sid, raw]) => {
        const s = raw as Record<string, unknown>;
        return {
          sessionId: sid,
          userId: s.userId ?? null,
          username: s.username ?? null,
          role: s.role ?? null,
          loginAt: s.loginAt ?? null,
          lastActivity: s.lastActivity ?? null,
          ip: s.ip ?? null,
          isCurrent: sid === req.sessionID,
        };
      }).filter(s => s.userId);
      res.json({ sessions: rows, seatsUsed: getSeatsUsed(), seatRatio: getSeatUsageRatio() });
    });
  });

  app.delete('/api/admin/license/sessions/:sessionId', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (sessionId === req.sessionID) { res.status(400).json({ error: 'Cannot revoke your own session' }); return; }
    sessionStore.destroy!(sessionId, (err: Error | undefined) => {
      if (err) { res.status(500).json({ error: 'Failed to destroy session' }); return; }
      res.json({ success: true });
    });
  });

  app.get('/api/branding', (_req: Request, res: Response) => {
    const p = getLicensePayload();
    if (p?.whiteLabelConfig) {
      res.json({
        appName: p.whiteLabelConfig.appName,
        logoUrl: p.whiteLabelConfig.logoUrl ?? null,
        primaryColor: p.whiteLabelConfig.primaryColor ?? null,
      });
    } else {
      res.json({ appName: 'QA Agent Platform', logoUrl: null, primaryColor: null });
    }
  });

  app.get('/api/admin/license/seat-report', requireAuth, requireAdmin, (_req: Request, res: Response) => {
    const USERS_FILE = path.resolve('data', 'users.json');
    const AUDIT_FILE = path.resolve('data', 'audit.json');
    try {
      type UserRec = { id: string; username: string; email: string; role: string; isActive: boolean; lastLogin: string | null };
      const users: UserRec[] = fs.existsSync(USERS_FILE)
        ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'))
        : [];
      const auditEvents: Array<Record<string, unknown>> = fs.existsSync(AUDIT_FILE)
        ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'))
        : [];

      const loginCounts: Record<string, number> = {};
      for (const e of auditEvents) {
        if (e.action === 'LOGIN' && typeof e.userId === 'string') {
          loginCounts[e.userId] = (loginCounts[e.userId] ?? 0) + 1;
        }
      }

      const p = getLicensePayload();
      const csvRows = [
        ['Username', 'Email', 'Role', 'Active', 'Last Login', 'Login Count', 'Seat Used'],
        ...users.map((u, i) => [
          u.username,
          u.email,
          u.role,
          u.isActive ? 'Yes' : 'No',
          u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never',
          String(loginCounts[u.id] ?? 0),
          p && p.seats !== -1 ? (i < p.seats ? 'Yes' : 'No') : 'Unlimited',
        ]),
      ];

      const csv = csvRows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const filename = `seat-report-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (e) { res.status(500).json({ error: 'Failed to generate report' }); }
  });
}