import { Page } from '@playwright/test';
import { BasePage } from '../BasePage';
import { logger } from '../../utils/logger';

/**
 * LoginPage
 * Handles authentication for all test suites.
 *
 * SSO flow (verified live — 25-Mar-2026):
 *   1. Navigate to APP_BASE_URL (e.g. https://mediationqa20.billcall.net)
 *   2. App issues OIDC redirect → lands on ssoqa10.billcall.net/Account/Login
 *   3. Fill Username / Password on SSO page and submit
 *   4. OIDC redirect chain returns to app dashboard
 *      URL pattern: https://mediationqa20.billcall.net/#HomeMenu#Home#Home#Dashboard
 */
export class LoginPage extends BasePage {

  // ── Selectors (verified against ssoqa10.billcall.net — 25-Mar-2026) ──────

  // Capital U/P — the SSO login form uses name="Username" and name="Password"
  private readonly usernameInput      = 'input[name="Username"]';
  private readonly usernameFallbacks  = ['input[name="username"]', '#username', '#Username', 'input[type="text"]', 'input[placeholder*="username" i]'];

  private readonly passwordInput      = 'input[name="Password"]';
  private readonly passwordFallbacks  = ['input[name="password"]', '#password', '#Password', 'input[type="password"]'];

  private readonly loginButton        = 'button[type="submit"]';
  private readonly loginFallbacks     = ['button:has-text("Login")', 'button:has-text("Sign in")', 'input[type="submit"]', '[data-testid="login-btn"]'];

  // Post-login dashboard landmark — app uses hash-based routing
  private readonly dashboardLandmark  = 'nav, .sidebar, [class*="dashboard"], [class*="menu"]';
  private readonly dashboardFallbacks = ['[class*="nav"]', 'header', '#content', '[class*="main"]'];

  // Logout — verified: top-nav power-off icon with title containing "logout"
  private readonly logoutButton       = '[title*="logout" i]';
  private readonly logoutFallbacks    = ['.fa-power-off', '.fa-sign-out', '[class*="logout"]', 'a:has-text("Logout")', 'button:has-text("Logout")'];

  // Login error — visible on SSO page after failed attempt
  private readonly errorMessage       = '.validation-summary-errors';
  private readonly errorFallbacks     = ['.text-danger:visible', '.alert-danger:visible', '[class*="error-msg"]:visible', '[role="alert"]:visible'];

  constructor(page: Page) {
    super(page);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Navigate to the app base URL.
   * The app will issue an OIDC redirect to the SSO login page automatically.
   */
  async navigate(): Promise<void> {
    const baseUrl = process.env.APP_BASE_URL ?? '';
    await this.page.goto(baseUrl);
    await this.page.waitForLoadState('networkidle');
    // After OIDC redirect we should be on the SSO login page
    await this.waitForAny([this.usernameInput, ...this.usernameFallbacks]);
    logger.info('Login page loaded (SSO)');
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Fills credentials and submits the SSO login form.
   * Waits for the full OIDC redirect chain to complete before returning.
   */
  async login(username: string, password: string): Promise<void> {
    logger.info(`Logging in as: ${username}`);
    await this.fill(this.usernameInput, username, this.usernameFallbacks);
    await this.fill(this.passwordInput, password, this.passwordFallbacks);
    await this.click(this.loginButton, this.loginFallbacks);

    // Wait for OIDC multi-hop redirect to complete — URL must leave the SSO domain.
    // Passed as a string so TypeScript's DOM-less lib doesn't complain about `window`.
    await this.page.waitForFunction(
      '!location.href.includes("ssoqa") && !location.pathname.includes("/Account/Login")',
      { timeout: 25000 }
    ).catch(() => {
      // Will be caught by assertLoggedIn() — carry on
    });
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * One-call login + assertion.
   * Use this in test setup when you want to fail fast if auth is broken.
   */
  async loginAndAssert(username: string, password: string): Promise<void> {
    await this.login(username, password);
    await this.assertLoggedIn();
  }

  async logout(): Promise<void> {
    logger.info('Logging out...');
    await this.click(this.logoutButton, this.logoutFallbacks);
    await this.waitForNavigation();
    logger.info('Logged out');
  }

  // ── Assertions ─────────────────────────────────────────────────────────────

  async assertLoggedIn(): Promise<void> {
    const currentUrl = this.page.url();
    const onSso = currentUrl.includes('ssoqa') || currentUrl.includes('/Account/Login');
    if (onSso) {
      // Check for visible error message with non-empty text
      const errorEls = this.page.locator(
        '.validation-summary-errors, .text-danger:visible, .alert-danger:visible'
      );
      const count = await errorEls.count();
      for (let i = 0; i < count; i++) {
        const txt = (await errorEls.nth(i).textContent() ?? '').trim();
        if (txt.length > 2) {
          throw new Error(`Login failed — error message: "${txt}"`);
        }
      }
      throw new Error(`Login failed — still on SSO page: ${currentUrl}`);
    }
    await this.assertVisible(this.dashboardLandmark, this.dashboardFallbacks);
    logger.info('Assertion: user is logged in');
  }

  async assertLoggedOut(): Promise<void> {
    const currentUrl = this.page.url();
    const onLoginPage = currentUrl.includes('ssoqa') ||
                        currentUrl.includes('/Account/Login') ||
                        currentUrl.includes('/login');
    if (!onLoginPage) {
      throw new Error(`Expected redirect to SSO login page after logout, but URL is: ${currentUrl}`);
    }
    logger.info('Assertion: user is logged out');
  }

  async assertLoginError(expectedText?: string): Promise<void> {
    await this.assertVisible(this.errorMessage, this.errorFallbacks);
    if (expectedText) {
      await this.assertText(this.errorMessage, expectedText, this.errorFallbacks);
    }
    logger.info('Assertion: login error visible');
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  async isLoggedIn(): Promise<boolean> {
    const url = this.page.url();
    return !url.includes('ssoqa') && !url.includes('/Account/Login') && !url.includes('/login');
  }
}
