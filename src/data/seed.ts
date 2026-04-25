/**
 * seed.ts
 * Creates default admin user, settings, and demo project on first startup.
 * Safe to call every startup — all blocks skip if already seeded.
 */

import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { readAll, upsert, writeAll, USERS, SETTINGS, PROJECTS, SCRIPTS, LOCATORS } from './store';
import { User, AppSettings, DEFAULT_SETTINGS, Project, TestScript, Locator, ScriptStep } from './types';
import { logger } from '../utils/logger';

export async function seedDefaults(): Promise<void> {
  const now = new Date().toISOString();

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
      createdAt:           now,
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

  // ── Demo project ───────────────────────────────────────────────────────────
  // Skip if any project already exists (fresh install only)
  const existingProjects = readAll<Project>(PROJECTS);
  if (existingProjects.length > 0) return;

  const projectId = uuidv4();
  const locatorId = uuidv4();
  const scriptId  = uuidv4();

  const project: Project = {
    id:          projectId,
    name:        'Demo Project',
    description: 'Sample project created on first install. Rename or delete once you create your own.',
    tcIdPrefix:  'DEMO',
    tcIdCounter: 2,   // next script gets DEMO-02
    environments: [
      { id: uuidv4(), name: 'DEV', url: 'https://example.com' },
      { id: uuidv4(), name: 'QA',  url: 'https://qa.example.com' },
    ],
    isActive:  true,
    createdAt: now,
    createdBy: 'admin',
  };

  // Sample locator — Login button on a generic login page
  const locator: Locator = {
    id:           locatorId,
    name:         'Login Button',
    selector:     '#login-btn',
    selectorType: 'id',
    pageModule:   'Login Page',
    projectId:    projectId,
    description:  'Primary login submit button. Update selector to match your application.',
    createdBy:    'admin',
    createdAt:    now,
    updatedAt:    now,
  };

  // Sample script steps
  const steps: ScriptStep[] = [
    {
      id:          uuidv4(),
      order:       1,
      keyword:     'NAVIGATE',
      locator:     null,
      locatorId:   null,
      locatorType: 'css',
      valueMode:   'static',
      value:       'https://example.com/login',
      testData:    [],
      description: 'Open the login page',
      screenshot:  false,
    },
    {
      id:          uuidv4(),
      order:       2,
      keyword:     'FILL',
      locator:     '#username',
      locatorId:   null,
      locatorType: 'id',
      valueMode:   'static',
      value:       'testuser@example.com',
      testData:    [],
      description: 'Enter username',
      screenshot:  false,
    },
    {
      id:          uuidv4(),
      order:       3,
      keyword:     'FILL',
      locator:     '#password',
      locatorId:   null,
      locatorType: 'id',
      valueMode:   'static',
      value:       'Password123',
      testData:    [],
      description: 'Enter password',
      screenshot:  false,
    },
    {
      id:          uuidv4(),
      order:       4,
      keyword:     'CLICK',
      locator:     locator.selector,
      locatorId:   locatorId,
      locatorType: 'id',
      valueMode:   'static',
      value:       null,
      testData:    [],
      description: 'Click Login button',
      screenshot:  true,
    },
    {
      id:          uuidv4(),
      order:       5,
      keyword:     'ASSERT_URL_CONTAINS',
      locator:     null,
      locatorId:   null,
      locatorType: 'css',
      valueMode:   'static',
      value:       '/dashboard',
      testData:    [],
      description: 'Verify redirect to dashboard after login',
      screenshot:  true,
    },
  ];

  const script: TestScript = {
    id:          scriptId,
    projectId:   projectId,
    tcId:        'DEMO-01',
    component:   'Authentication',
    title:       'Login — Happy Path',
    description: 'Verifies a user can log in with valid credentials and reach the dashboard. Update selectors and URL to match your application.',
    tags:        ['smoke', 'login', 'demo'],
    priority:    'critical',
    steps,
    createdBy:   'admin',
    createdAt:   now,
    modifiedBy:  'admin',
    modifiedAt:  now,
  };

  upsert(PROJECTS, project);
  upsert(LOCATORS, locator);
  upsert(SCRIPTS,  script);

  logger.info('Seed: demo project created (Demo Project / DEMO-01 / Login Button locator)');
}
