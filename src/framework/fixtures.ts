/**
 * fixtures.ts
 * Custom Playwright test fixtures.
 *
 * Import `test` and `expect` from HERE — not from @playwright/test directly.
 * This gives every spec file typed page objects with zero boilerplate.
 *
 * Usage in spec files:
 *   import { test, expect } from '../src/framework/fixtures';
 */

import { test as base, expect } from '@playwright/test';
import { LoginPage }          from './pages/LoginPage';
import { GatewayConfigPage }  from './pages/GatewayConfigPage';
import { config }             from './config';
import { logger }             from '../utils/logger';

// ── Fixture type declarations ─────────────────────────────────────────────────

type Pages = {
  loginPage:          LoginPage;
  gatewayConfigPage:  GatewayConfigPage;
};

type Options = {
  /** When true, the fixture navigates to the login page and authenticates
   *  using APP_USERNAME / APP_PASSWORD before the test body runs.
   *  Default: false — tests that need login should use the `loggedInPage` fixture
   *  or call loginPage.login() explicitly. */
  autoLogin: boolean;
};

type AllFixtures = Pages & Options & {
  /** Pre-authenticated page — use in tests that require a logged-in session. */
  loggedIn: LoginPage;
};

// ── Fixture definitions ───────────────────────────────────────────────────────

export const test = base.extend<AllFixtures>({

  // ── Option defaults ──────────────────────────────────────────────────────
  autoLogin: [false, { option: true }],

  // ── Page object fixtures ─────────────────────────────────────────────────

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  gatewayConfigPage: async ({ page }, use) => {
    await use(new GatewayConfigPage(page));
  },

  // ── Pre-authenticated fixture ────────────────────────────────────────────
  // Navigates to the app, logs in, then hands the page to the test.
  // After the test completes, logs out automatically.

  loggedIn: async ({ page }, use) => {
    const loginPage = new LoginPage(page);

    const username = process.env.APP_USERNAME;
    const password = process.env.APP_PASSWORD;

    if (!username || !password) {
      throw new Error(
        'APP_USERNAME and APP_PASSWORD must be set in .env to use the loggedIn fixture.'
      );
    }

    logger.info('Fixture: logging in...');
    await loginPage.navigate();
    await loginPage.login(username, password);
    await loginPage.assertLoggedIn();
    logger.info('Fixture: logged in successfully');

    await use(loginPage);

    // Teardown — attempt logout regardless of test outcome
    try {
      await loginPage.logout();
      logger.info('Fixture: logged out');
    } catch {
      logger.warn('Fixture: logout step failed (test may have already logged out)');
    }
  },

  // ── autoLogin option ─────────────────────────────────────────────────────
  // Alternative to loggedIn fixture — use when you want all fixtures
  // available AND a pre-authenticated session.

  page: async ({ page, autoLogin }, use) => {
    if (autoLogin) {
      const lp = new LoginPage(page);
      const username = process.env.APP_USERNAME ?? '';
      const password = process.env.APP_PASSWORD ?? '';
      if (username && password) {
        await lp.navigate();
        await lp.login(username, password);
        await lp.assertLoggedIn();
      }
    }
    await use(page);
  },
});

export { expect };

// ── Re-export page classes for spec files that need direct instantiation ──────
export { LoginPage }          from './pages/LoginPage';
export { GatewayConfigPage }  from './pages/GatewayConfigPage';
