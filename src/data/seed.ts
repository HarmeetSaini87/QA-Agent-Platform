/**
 * seed.ts
 * Creates default admin user and settings on first startup.
 * Safe to call every startup — skips if already seeded.
 */

import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { readAll, upsert, writeAll, USERS, SETTINGS } from './store';
import { User, AppSettings, DEFAULT_SETTINGS } from './types';
import { logger } from '../utils/logger';

export async function seedDefaults(): Promise<void> {
  // ── Default admin ──────────────────────────────────────────────────────────
  const users = readAll<User>(USERS);
  if (!users.find(u => u.username === 'admin')) {
    const hash = await bcrypt.hash('Admin@123', 12);
    const admin: User = {
      id:                  uuidv4(),
      username:            'admin',
      email:               'admin@localhost',
      passwordHash:        hash,
      role:                'admin',
      isActive:            true,
      forcePasswordChange: true,   // must change on first login
      createdAt:           new Date().toISOString(),
      createdBy:           null,
      lastLogin:           null,
    };
    upsert(USERS, admin);
    logger.info('Seed: default admin created  (username: admin / Admin@123 — change on first login)');
  }

  // ── Default settings ───────────────────────────────────────────────────────
  const settings = readAll<AppSettings & { id: string }>(SETTINGS);
  if (!settings.length) {
    writeAll(SETTINGS, [{ id: 'global', ...DEFAULT_SETTINGS }]);
    logger.info('Seed: default app settings written');
  }
}
