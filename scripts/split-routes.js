#!/usr/bin/env node
// Route extraction script — reads server.ts.routes-backup and creates route files + new server.ts
// Run: node scripts/split-routes.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKUP = fs.readFileSync(path.join(ROOT, 'src/ui/server.ts.routes-backup'), 'utf8');
const ROUTES_DIR = path.join(ROOT, 'src/ui/routes');
const LINES = BACKUP.split('\n');

if (!fs.existsSync(ROUTES_DIR)) fs.mkdirSync(ROUTES_DIR, { recursive: true });

// Line ranges (1-indexed, inclusive) for each route group extracted from the backup
const groups = {
  'files':       { start: 2376, end: 2718, imports: `import express, { Request, Response } from 'express';\nimport * as fs from 'fs';\nimport * as path from 'path';\nimport { config } from '../../framework/config';\nimport { requireAuth } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport { runs } from '../helpers/state';\nimport { sanitizeInput } from '../../auth/middleware';\n` },
  'trace':       { start: 2555, end: 2705, imports: `import express, { Request, Response } from 'express';\nimport * as fs from 'fs';\nimport * as path from 'path';\nimport { v4 as uuidv4 } from 'uuid';\nimport { config } from '../../framework/config';\nimport { requireAuth, requireAuthOrApiKey } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport type { RunRecord } from '../helpers/types';\n` },
  'tc':          { start: 2719, end: 2842, imports: `import express, { Request, Response } from 'express';\nimport * as fs from 'fs';\nimport * as path from 'path';\nimport { config } from '../../framework/config';\nimport { v4 as uuidv4 } from 'uuid';\nimport { logger } from '../../utils/logger';\n` },
  'admin':       { start: 2844, end: 2973, imports: `import express, { Request, Response } from 'express';\nimport * as crypto from 'crypto';\nimport { v4 as uuidv4 } from 'uuid';\nimport { readAll, upsert, remove, findById, writeAll, USERS, APIKEYS, AUDIT, SETTINGS } from '../../data/store';\nimport type { User, AppSettings, NotificationSettings, ApiKey } from '../../data/types';\nimport { hashPassword, validatePasswordStrength } from '../../auth/crypto';\nimport { requireAdmin, sanitizeInput } from '../../auth/middleware';\nimport { requireEditor } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport { DEFAULT_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS } from '../../data/types';\nimport { sendRunNotification } from '../../utils/notifier';\n` },
  'jira':         { start: 3022, end: 3333, imports: `import express, { Request, Response } from 'express';\nimport * as path from 'path';\nimport { config } from '../../framework/config';\nimport { logger } from '../../utils/logger';\nimport { readAll, findById, LOCATORS } from '../../data/store';\nimport type { RunRecord } from '../../data/types';\nimport { requireAuth, requireEditor, requireAdmin } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport { loadJiraConfig, saveJiraConfig, loadDefectsRegistry, saveDefectsRegistry, appendDismissEntry, findOpenDefect, findOpenDefectsForRun } from '../../utils/defectsStore';\nimport { JiraClient } from '../../utils/jiraClient';\nimport { buildDefectDescription, buildAutoCloseCommentADF } from '../../utils/adfBuilder';\nimport { jiraEncryptToken, jiraDecryptToken, getJiraClient, readArtifactBuffer, firstNLines } from '../helpers/jira-helpers';\nimport { runs } from '../helpers/state';\nimport { broadcast } from '../helpers/ws-broadcast';\nimport { requireAuthOrApiKey } from '../../auth/middleware';\n` },
  'projects':    { start: 3334, end: 3542, imports: `import express, { Request, Response } from 'express';\nimport { v4 as uuidv4 } from 'uuid';\nimport { readAll, upsert, findById, remove, LOCATORS, PROJECTS, COMPONENTS, SCRIPTS, FUNCTIONS } from '../../data/store';\nimport type { Project, Locator, ComponentDef, Subcomponent, TestScript, CommonFunction } from '../../data/types';\nimport { requireAdmin, requireEditor, sanitizeInput } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\n` },
  'functions':   { start: 3839, end: 3922, imports: `import express, { Request, Response } from 'express';\nimport { v4 as uuidv4 } from 'uuid';\nimport { readAll, upsert, findById, remove, FUNCTIONS } from '../../data/store';\nimport type { CommonFunction } from '../../data/types';\nimport { requireEditor, sanitizeInput } from '../../auth/middleware';\n` },
  'common-data': { start: 3923, end: 4001, imports: `import express, { Request, Response } from 'express';\nimport { v4 as uuidv4 } from 'uuid';\nimport { readAll, upsert, remove, findById, COMMON_DATA } from '../../data/store';\nimport type { CommonData } from '../../data/types';\nimport { requireAuth, requireEditor, sanitizeInput } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport { encryptValue, decryptValue, cdForResponse } from '../helpers/encryption';\n` },
  'scripts':     { start: 4002, end: 4181, imports: `import express, { Request, Response } from 'express';\nimport { v4 as uuidv4 } from 'uuid';\nimport { readAll, upsert, findById, remove, writeAll, LOCATORS, SCRIPTS, PROJECTS, SUITES } from '../../data/store';\nimport type { Locator, TestScript, ScriptStep, TestSuite } from '../../data/types';\nimport { requireEditor, sanitizeInput } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\n` },
  'suites':      { start: 4182, end: 4366, imports: `import express, { Request, Response } from 'express';\nimport * as fs from 'fs';\nimport * as path from 'path';\nimport { v4 as uuidv4 } from 'uuid';\nimport { config } from '../../framework/config';\nimport { logger } from '../../utils/logger';\nimport { readAll, upsert, findById, writeAll, SCRIPTS, SUITES, PROJECTS, FUNCTIONS } from '../../data/store';\nimport type { TestScript, TestSuite, CommonFunction, BrowserName } from '../../data/types';\nimport { requireEditor, requireAdmin, requireAuthOrApiKey, sanitizeInput } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport { generateCodegenSpec } from '../../utils/codegenGenerator';\nimport { runs } from '../helpers/state';\nimport { enqueueRun, spawnRunWithSpec } from '../helpers/run-spawner';\nimport { PORT } from '../helpers/run-spawner';\n` },
  'debugger':    { start: 4367, end: 4725, imports: `import express, { Request, Response } from 'express';\nimport * as fs from 'fs';\nimport * as path from 'path';\nimport * as cp from 'child_process';\nimport { v4 as uuidv4 } from 'uuid';\nimport { config } from '../../framework/config';\nimport { logger } from '../../utils/logger';\nimport { readAll, findById, upsert, LOCATORS, SCRIPTS } from '../../data/store';\nimport type { TestScript, Locator } from '../../data/types';\nimport { requireAuth } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport { generateDebugSpec } from '../../utils/codegenGenerator';\nimport { debugSessions, debugPollers } from '../helpers/state';\nimport { broadcast } from '../helpers/ws-broadcast';\nimport { sseSessionPush } from '../helpers/sse';\nimport { PORT } from '../helpers/run-spawner';\n` },
  'flaky':       { start: 4726, end: 4962, imports: `import express, { Request, Response } from 'express';\nimport * as fs from 'fs';\nimport * as path from 'path';\nimport { config } from '../../framework/config';\nimport { readAll, upsert, writeAll, SUITES, PROJECTS } from '../../data/store';\nimport type { TestSuite, Project, FlakinessConfig } from '../../data/types';\nimport { requireAuth, requireEditor, requireAuthOrApiKey } from '../../auth/middleware';\nimport { DEFAULT_FLAKINESS_CONFIG, analyzeFlakiness, CURRENT_ENGINE_VERSION, getActionHint } from '../../utils/flakinessEngine';\nimport { readQuarantine, writeQuarantine, upsertQuarantineEntry, restoreQuarantineEntry, getEffectiveFlakinessConfig, generateTestId, groupRunsByTestId } from '../helpers/quarantine';\nimport type { RunRecord } from '../helpers/types';\n` },
  'schedules':   { start: 4963, end: 5110, imports: `import express, { Request, Response } from 'express';\nimport * as fs from 'fs';\nimport * as path from 'path';\nimport { v4 as uuidv4 } from 'uuid';\nimport cron from 'node-cron';\nimport { config } from '../../framework/config';\nimport { logger } from '../../utils/logger';\nimport { readAll, upsert, findById, writeAll, SCRIPTS, SUITES, PROJECTS, FUNCTIONS, SCHEDULES } from '../../data/store';\nimport type { TestScript, CommonFunction, BrowserName, ScheduledRun } from '../../data/types';\nimport { requireAuth, requireEditor } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport { requireFeature } from '../helpers/middleware';\nimport { generateCodegenSpec } from '../../utils/codegenGenerator';\nimport { runs } from '../helpers/state';\nimport { enqueueRun, spawnRunWithSpec, PORT } from '../helpers/run-spawner';\nimport { cronJobs } from '../helpers/state';\n` },
  'license':     { start: 5175, end: 5391, imports: `import express, { Request, Response } from 'express';\nimport { validateLicenseKey, validateLicFile, storeLicense, loadStoredLicense, getLicensePayload, refreshLicenseCache, clearLicenseCache, isAutoTrial, trialDaysRemaining, getSeatsUsed, getSeatUsageRatio, getMachineId, checkMachineBinding, transferLicense } from '../../utils/licenseManager';\nimport { requireAuth, requireAdmin } from '../../auth/middleware';\nimport { logAudit } from '../../auth/audit';\nimport multer from 'multer';\n` },
};

// For each group, extract the lines and wrap in registerXxxRoutes function
for (const [name, group] of Object.entries(groups)) {
  const startIdx = group.start - 1; // Convert 1-indexed to 0-indexed
  const endIdx = group.end; // end is inclusive, slice is exclusive so we add 1
  const routeCode = LINES.slice(startIdx, endIdx).join('\n');
  
  // Remove any standalone import lines from the extracted code (they should be in the imports section)
  const funcName = `register${name.charAt(0).toUpperCase() + name.slice(1)}Routes`;
  
  let content = `// Auto-extracted from server.ts\n`;
  content += group.imports;
  content += `\nexport function ${funcName}(app: import('express').Application): void {\n`;
  content += routeCode;
  content += `\n}\n`;
  
  const outPath = path.join(ROUTES_DIR, `${name}.routes.ts`);
  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`Created ${outPath} (${content.split('\\n').length} lines)`);
}

console.log('\\nRoute files created. Manual review needed for:');
console.log('  - Import correctness in each file');
console.log('  - Shared state references (runs, debugSessions, etc.)');
console.log('  - Moving duplicate imports to helper modules');
console.log('\\nNext: Update server.ts to import and call all registrars.');