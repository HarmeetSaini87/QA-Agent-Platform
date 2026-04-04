import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  // Jira
  jira: {
    baseUrl: optional('JIRA_BASE_URL', ''),
    email: optional('JIRA_EMAIL', ''),
    apiToken: optional('JIRA_API_TOKEN', ''),
    get isConfigured(): boolean {
      return !!(this.baseUrl && this.email && this.apiToken);
    },
  },

  // Application under test
  app: {
    baseURL: optional('APP_BASE_URL', 'http://localhost'),
    env: optional('APP_ENV', 'local') as 'local' | 'staging' | 'production',
  },

  // Playwright
  playwright: {
    headless: optional('HEADLESS', 'false') === 'true' || !!process.env.CI,
    defaultTimeout: parseInt(optional('DEFAULT_TIMEOUT', '30000')),
    screenshotMode: optional('SCREENSHOT_MODE', 'only-on-failure'),
  },

  // UI server
  ui: {
    port: parseInt(optional('UI_PORT', '3000')),
  },

  // Paths
  paths: {
    requirements: path.resolve(optional('REQUIREMENTS_DIR', './requirements')),
    testPlans: path.resolve(optional('TEST_PLANS_DIR', './test-plans')),
    results: path.resolve(optional('RESULTS_DIR', './results')),
    reports: path.resolve(optional('REPORTS_DIR', './reports')),
    prompts: path.resolve('./prompts'),
  },

  // Logging
  logLevel: optional('LOG_LEVEL', 'info'),
};
