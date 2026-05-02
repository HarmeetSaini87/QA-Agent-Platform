// This script extracts route handlers from server.ts into separate route files.
// Run with: npx ts-node scripts/extract-routes.ts
// NOTE: This script is for reference - the actual extraction has been done manually.

import * as fs from 'fs';
import * as path from 'path';

const serverPath = path.resolve(__dirname, '../src/ui/server.ts.routes-backup');
const routesDir = path.resolve(__dirname, '../src/ui/routes');

// Mapping of route group -> line ranges (approximate)
const routeGroups: Record<string, [number, number]> = {
  'files': [2376, 2718],     // health, env, execution report, recorder loader, screenshots, test files, test artifacts, debug screenshot
  'trace': [2555, 2705],     // trace viewer SPA + secure trace stream
  'tc': [2719, 2842],       // keywords, TC builder, field maps
  'admin': [2844, 3003],     // users, API keys, audit, settings
  'jira': [3022, 3333],      // jira config + defect lifecycle (overlaps with files above, actual start at jira config section)
  'projects': [3334, 3542], // projects, locators, components
  'recorder': [3543, 3838], // recorder endpoints
  'functions': [3839, 3922], // common functions + change password + keyword registry
  'common-data': [3923, 4001], // common data CRUD
  'scripts': [4002, 4181],  // scripts CRUD + dedup + bulk
  'suites': [4182, 4366],   // suites CRUD + execution
  'debugger': [4367, 4725], // debugger API
  'flaky': [4726, 4962],    // flakiness intelligence
  'schedules': [4963, 5110], // scheduled runs
  'license': [5175, 5391],  // license API endpoints
};

console.log('Route extraction reference. Files created manually.');