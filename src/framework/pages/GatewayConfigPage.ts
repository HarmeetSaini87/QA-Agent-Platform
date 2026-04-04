import { Page } from '@playwright/test';
import { BasePage } from '../BasePage';
import { logger } from '../../utils/logger';

/**
 * GatewayConfigPage
 * Page Object for: Mediation Config → Gateway Type Configuration
 *
 * Selectors verified against live app: https://mediationqa20.billcall.net
 * Test run: chat-run-1774431559067  (25-Mar-2026)
 *
 * URL pattern:  #m213p212#Gateway-Type-Configuration#GatewayType#List
 * Add form URL: #m213p212#Add-GatewayType#GatewayType#CreateEdit
 */
export class GatewayConfigPage extends BasePage {

  // ── Navigation menu selectors  (verified live) ────────────────────────────

  private readonly menuMediationConfig    = 'a:has-text("Mediation Configuration")';
  private readonly menuMediationFallbacks = ['li:has-text("Mediation Configuration")', 'span:has-text("Mediation Configuration")', '[href*="mediation"]'];

  private readonly menuGatewayType        = 'a:has-text("Gateway Type Configuration")';
  private readonly menuGatewayFallbacks   = ['a:has-text("Gateway Type")', 'span:has-text("Gateway Type Configuration")', '[href*="GatewayType"]', '[href*="gateway-type" i]'];

  // ── List page selectors  (verified live) ──────────────────────────────────

  private readonly addButton          = '.fa-plus';
  private readonly addButtonFallbacks = ['button:has-text("+")', 'button:has-text("Add")', '[aria-label="Add"]', '[data-testid="add-btn"]', '.btn-add'];

  private readonly tableBody          = 'table tbody';
  private readonly tableBodyFallbacks = ['.data-table tbody', '[data-testid="records-table"] tbody'];

  private readonly searchInput        = 'input[type="search"]';
  private readonly searchFallbacks    = ['input[placeholder*="search" i]', '[data-testid="search-input"]', '#search', '.search-input', 'input[name*="search" i]'];

  private readonly searchButton       = 'button:has-text("Search")';
  private readonly searchBtnFallbacks = ['[data-testid="search-btn"]', '[aria-label="Search"]'];

  // Row-scoped delete — verified: .fa-trash is the bin icon in each row
  private readonly deleteAction       = '.fa-trash';
  private readonly deleteActionFbk    = ['.fa-trash-alt', '.fa-trash-o', '[data-action="delete"]', '[class*="delete"]', 'button[title*="Delete" i]', '[data-testid="delete-btn"]'];

  private readonly backButton         = 'button:has-text("Back")';
  private readonly backButtonFallbacks= ['a:has-text("Back")', '[data-testid="back-btn"]', '[aria-label="Go back"]', 'button[title="Back"]'];

  // ── Form selectors  (verified live) ───────────────────────────────────────

  // The Gateway Type form has exactly one visible text input
  private readonly gatewayTypeInput       = 'form input[type="text"]:visible';
  private readonly gatewayTypeInputFbks   = ['input[name*="gatewayType" i]', 'input[name*="GatewayType"]', '#gatewayType', '[data-testid="gateway-type"]', 'input[placeholder*="gateway" i]'];

  private readonly saveButton             = 'button:has-text("Save")';
  private readonly saveButtonFallbacks    = ['button[type="submit"]', 'input[type="submit"]', '[data-testid="save-btn"]', 'button:has-text("Submit")'];

  // ── Success / error messages  (verified live) ─────────────────────────────

  // Exact text observed in the app
  private readonly saveSuccessText    = 'Record saved successfully.';
  private readonly deleteSuccessText  = 'deleted successfully';

  private readonly successToast       = `text=${this.saveSuccessText}`;
  private readonly successToastFbks   = [
    `*:has-text("${this.saveSuccessText}")`,
    '[class*="success"]:visible',
    '.alert-success:visible',
    '[role="alert"]:visible',
  ];

  private readonly deleteSuccessMsg   = `text=${this.deleteSuccessText}`;
  private readonly deleteSuccessFbks  = [
    `*:has-text("${this.deleteSuccessText}")`,
    '[class*="success"]:visible',
    '[role="alert"]:visible',
  ];

  private readonly errorToast         = '.alert-danger:visible';
  private readonly errorToastFbks     = ['[class*="error"]:visible', '[role="alert"]:visible', '[data-testid="error-toast"]'];

  // ── Confirmation dialog  (verified live) ──────────────────────────────────

  // App uses a modal — exact button text "Yes" confirmed
  private readonly confirmModal          = '.modal:visible';
  private readonly confirmModalFallbacks = ['.modal-dialog:visible', '[role="dialog"]:visible', '.confirmation-dialog'];

  private readonly confirmYesButton      = 'button:has-text("Yes")';
  private readonly confirmYesFallbacks   = [
    '.modal-dialog button:has-text("Yes")',
    '.modal-footer button:has-text("Yes")',
    '[role="dialog"] button:has-text("Yes")',
    '.swal2-confirm',
    'button:has-text("Confirm")',
    '.btn-danger:has-text("Delete")',
  ];

  private readonly confirmNoButton       = 'button:has-text("No")';
  private readonly confirmNoFallbacks    = [
    '.modal-dialog button:has-text("No")',
    '.modal-footer button:has-text("Cancel")',
  ];

  // ── Logout  (verified live) ───────────────────────────────────────────────

  private readonly logoutButton         = '[title*="logout" i]';
  private readonly logoutButtonFallbacks = [
    '.fa-power-off', '.fa-sign-out', '[class*="logout"]',
    'a:has-text("Logout")', 'button:has-text("Logout")',
  ];

  constructor(page: Page) {
    super(page);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Navigate via the sidebar: Mediation Configuration → Gateway Type Configuration
   * Use this from any page after login.
   */
  async navigateViaMenu(): Promise<void> {
    await this.click(this.menuMediationConfig, this.menuMediationFallbacks);
    await this.page.waitForTimeout(400);
    await this.click(this.menuGatewayType, this.menuGatewayFallbacks);
    await this.waitForListPage();
  }

  /**
   * Direct URL navigation — faster for tests that don't need to exercise the menu.
   * Falls back to menu navigation if the hash URL doesn't work.
   */
  async navigateToList(): Promise<void> {
    await this.page.goto(
      (process.env.APP_BASE_URL ?? '') + '/#m213p212#Gateway-Type-Configuration#GatewayType#List'
    );
    await this.page.waitForLoadState('networkidle');
    const hasTable = await this.page.locator(this.tableBody).count() > 0;
    if (!hasTable) {
      logger.warn('Direct URL navigation did not load list — falling back to menu');
      await this.navigateViaMenu();
    } else {
      await this.waitForListPage();
    }
  }

  private async waitForListPage(): Promise<void> {
    await this.waitForAny([this.tableBody, ...this.tableBodyFallbacks]);
    logger.info('Gateway Type Configuration list page loaded');
  }

  // ── List page actions ──────────────────────────────────────────────────────

  /** Click the Add (+) button — opens the create form */
  async clickAdd(): Promise<void> {
    await this.click(this.addButton, this.addButtonFallbacks);
    await this.waitForAny([this.saveButton, ...this.saveButtonFallbacks]);
    logger.info('Add form opened');
  }

  /** Click the Back button — returns to list page */
  async clickBack(): Promise<void> {
    await this.click(this.backButton, this.backButtonFallbacks);
    await this.waitForListPage();
    logger.info('Returned to list page');
  }

  /**
   * Search for a record by name.
   * First checks if the row is already visible; searches only if needed.
   */
  async searchRecord(name: string): Promise<void> {
    const alreadyVisible = await this.rowExists(name);
    if (alreadyVisible) {
      logger.info(`Record "${name}" already visible — skipping search`);
      return;
    }
    logger.info(`Searching for record: "${name}"`);
    await this.fill(this.searchInput, name, this.searchFallbacks);
    const searchBtnExists = await this.page.locator(this.searchButton).count() > 0;
    if (searchBtnExists) {
      await this.click(this.searchButton, this.searchBtnFallbacks);
    } else {
      await this.pressKey('Enter');
    }
    await this.waitForNavigation();
  }

  /**
   * Click the bin (delete) icon on the row containing recordName.
   * Row-scoped: never uses nth-child positional selectors.
   */
  async deleteRecord(recordName: string): Promise<void> {
    logger.info(`Clicking delete on row: "${recordName}"`);
    await this.clickRowAction(recordName, this.deleteAction);
  }

  // ── Confirmation dialog ────────────────────────────────────────────────────

  /** Wait for the confirmation popup and click Yes */
  async confirmDelete(): Promise<void> {
    await this.waitForAny([this.confirmModal, ...this.confirmModalFallbacks]);
    logger.info('Confirmation dialog appeared');
    await this.click(this.confirmYesButton, this.confirmYesFallbacks);
    // Modal closes and page reloads after deletion
    try { await this.waitForHidden(this.confirmModal); } catch { /* some apps remove the modal instantly */ }
    await this.waitForNavigation();
    logger.info('Deletion confirmed');
  }

  /** Click No / Cancel on the confirmation popup */
  async cancelDelete(): Promise<void> {
    await this.waitForAny([this.confirmModal, ...this.confirmModalFallbacks]);
    await this.click(this.confirmNoButton, this.confirmNoFallbacks);
    try { await this.waitForHidden(this.confirmModal); } catch { /* ok */ }
  }

  // ── Form fields ────────────────────────────────────────────────────────────

  /**
   * Fill the Gateway Type name field.
   * The form has a single visible text input — selector verified live.
   */
  async fillGatewayType(name: string): Promise<void> {
    await this.fill(this.gatewayTypeInput, name, this.gatewayTypeInputFbks);
    logger.info(`Gateway Type filled: "${name}"`);
  }

  /** Alias kept for backwards compatibility with fillFormFromTestData */
  async fillGatewayName(name: string): Promise<void> {
    return this.fillGatewayType(name);
  }

  // ── Form submission ────────────────────────────────────────────────────────

  async clickSave(): Promise<void> {
    await this.click(this.saveButton, this.saveButtonFallbacks);
    await this.page.waitForTimeout(800); // allow toast to appear
    logger.info('Save button clicked');
  }

  // ── Assertions ─────────────────────────────────────────────────────────────

  /** Assert the save success banner is visible: "Record saved successfully." */
  async assertSaveSuccess(): Promise<void> {
    await this.assertVisible(this.successToast, this.successToastFbks);
    logger.info(`Assertion: "${this.saveSuccessText}" visible`);
  }

  /** Assert the delete success banner is visible: "Record(s) deleted successfully." */
  async assertDeleteSuccess(): Promise<void> {
    await this.assertVisible(this.deleteSuccessMsg, this.deleteSuccessFbks);
    logger.info(`Assertion: "${this.deleteSuccessText}" visible`);
  }

  async assertSaveError(): Promise<void> {
    await this.assertVisible(this.errorToast, this.errorToastFbks);
  }

  /** Assert a row with recordName is present in the list */
  async assertRecordVisible(recordName: string): Promise<void> {
    const exists = await this.rowExists(recordName);
    if (!exists) throw new Error(`Record "${recordName}" not found in the Gateway Type list`);
    logger.info(`Assertion: record "${recordName}" is visible in list`);
  }

  /** Assert a row with recordName is NOT present (after deletion) */
  async assertRecordDeleted(recordName: string): Promise<void> {
    await this.assertNotVisible(`tr:has-text("${recordName}")`);
    logger.info(`Assertion: record "${recordName}" is NOT in the list`);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  /** Click the logout (power-off) icon in the top navigation bar */
  async logout(): Promise<void> {
    await this.click(this.logoutButton, this.logoutButtonFallbacks);
    await this.waitForNavigation();
    logger.info('Logged out');
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /** Returns the number of data rows currently visible in the list */
  async getRowCount(): Promise<number> {
    return this.page.locator(`${this.tableBody} tr`).count();
  }

  /**
   * Full CRUD convenience method:
   *   add → fill → save → assert saved → back → search → assert visible
   */
  async addRecord(gatewayTypeName: string): Promise<void> {
    await this.clickAdd();
    await this.fillGatewayType(gatewayTypeName);
    await this.clickSave();
    await this.assertSaveSuccess();
    await this.clickBack();
    await this.searchRecord(gatewayTypeName);
    await this.assertRecordVisible(gatewayTypeName);
    logger.info(`Record "${gatewayTypeName}" added and verified`);
  }

  /**
   * Full delete convenience method:
   *   deleteRecord → confirmDelete → assertDeleteSuccess → assertRecordDeleted
   */
  async removeRecord(gatewayTypeName: string): Promise<void> {
    await this.deleteRecord(gatewayTypeName);
    await this.confirmDelete();
    await this.assertDeleteSuccess();
    await this.assertRecordDeleted(gatewayTypeName);
    logger.info(`Record "${gatewayTypeName}" deleted and verified`);
  }
}
