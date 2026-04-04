import { Page, Locator, expect } from '@playwright/test';
import { logger } from '../utils/logger';
import { healSelector, applyPatch, HealResponse } from '../agents/healer.agent';
import {
  scrapePageForModule,
  correlateInstruction,
  FormFieldMap,
  ModuleScrapeResult,
  CorrelationResult,
  DomCorrelationEvent,
} from '../agents/dom-scraper.agent';

/**
 * BasePage — all generated POM classes extend this.
 * Provides smart wrappers around Playwright actions with:
 * - Fallback selector strategy
 * - Built-in logging
 * - Consistent error messages for the healer agent
 */
export class BasePage {
  /** Accumulated heal events for the current test — read by the executor/results writer */
  readonly healEvents: Array<HealResponse & { stepDescription: string }> = [];

  /** Accumulated DOM correlation events — records proactive label/value corrections */
  readonly correlationEvents: DomCorrelationEvent[] = [];

  /**
   * Cached field map for the currently open form/module page.
   * Populated by scrapeCurrentForm() — reused across multiple correlateField() calls.
   */
  private _cachedFieldMap: FormFieldMap[] | null = null;
  private _cachedScrapeResult: ModuleScrapeResult | null = null;

  constructor(protected page: Page) {}

  // ── Navigation ────────────────────────────────────────────

  async navigate(path: string): Promise<void> {
    logger.info(`Navigating to: ${path}`);
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }

  // ── Smart locator with fallbacks ─────────────────────────

  async findElement(primary: string, fallbacks: string[] = []): Promise<Locator> {
    const selectors = [primary, ...fallbacks];
    for (const sel of selectors) {
      const el = this.page.locator(sel);
      if (await el.count() > 0) {
        if (sel !== primary) {
          logger.warn(`Primary selector "${primary}" not found — using fallback: "${sel}"`);
        }
        return el.first();
      }
    }
    throw new Error(
      `Element not found. Tried selectors: ${selectors.map(s => `"${s}"`).join(', ')}`
    );
  }

  /**
   * Like findElement, but invokes the self-healer when all selectors fail.
   *
   * @param primary         - Primary CSS selector
   * @param fallbacks       - Tried in order if primary fails
   * @param stepDescription - Human-readable step description (for healer context)
   * @param stepAction      - Playwright action type (for healer context)
   * @param pomFile         - Optional: path to the POM file owning this selector
   * @param rowScopeText    - Optional: row record name for table row scoping
   */
  async findElementWithHeal(
    primary:         string,
    fallbacks:       string[] = [],
    stepDescription: string   = '',
    stepAction:      string   = 'click',
    pomFile?:        string,
    rowScopeText?:   string,
  ): Promise<Locator> {
    // 1. Try primary + fallbacks first (fast path)
    const selectors = [primary, ...fallbacks];
    for (const sel of selectors) {
      const el = this.page.locator(sel);
      if (await el.count() > 0) {
        if (sel !== primary) {
          logger.warn(`Fallback used: "${primary}" → "${sel}"`);
        }
        return el.first();
      }
    }

    // 2. All selectors failed — invoke healer
    logger.warn(`Healer triggered for "${primary}" (${stepDescription})`);
    const domSnapshot = await this.getDOM();
    const healResult  = await healSelector({
      failedSelector:  primary,
      stepDescription,
      stepAction,
      errorMessage:    `All selectors failed: ${selectors.join(', ')}`,
      domSnapshot,
      pomFile,
      rowScopeText,
    });

    // Record the heal event for results reporting
    this.healEvents.push({ ...healResult, stepDescription });

    if (healResult.status === 'failed') {
      throw new Error(
        `Self-healer could not find element for "${primary}". Reason: ${healResult.reasoning}`
      );
    }

    // 3. Try healed selector
    const healedEl = this.page.locator(healResult.healedSelector);
    if (await healedEl.count() > 0) {
      logger.info(`Healer success: using "${healResult.healedSelector}" (${healResult.confidence})`);

      // Auto-apply patch if high confidence
      if (healResult.shouldPatch && healResult.patchInstruction) {
        applyPatch(healResult.patchInstruction);
      }

      return healedEl.first();
    }

    // 4. Try healer fallbacks
    for (const sel of healResult.fallbackSelectors) {
      const el = this.page.locator(sel);
      if (await el.count() > 0) {
        logger.info(`Healer fallback used: "${sel}"`);
        return el.first();
      }
    }

    throw new Error(
      `Self-healer found candidate "${healResult.healedSelector}" but it is not in the DOM. ` +
      `Reasoning: ${healResult.reasoning}`
    );
  }

  // ── Actions ───────────────────────────────────────────────

  async click(selector: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await el.waitFor({ state: 'visible' });
    await el.click();
  }

  async fill(selector: string, value: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await el.waitFor({ state: 'visible' });
    await el.fill(value);
  }

  async selectOption(selector: string, value: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await el.selectOption(value);
  }

  async check(selector: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await el.check();
  }

  async setInputFiles(selector: string, filePath: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await el.setInputFiles(filePath);
  }

  async hover(selector: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await el.hover();
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  // ── Waits ─────────────────────────────────────────────────

  async waitForVisible(selector: string, timeout?: number): Promise<void> {
    await this.page.locator(selector).waitFor({ state: 'visible', timeout });
  }

  async waitForHidden(selector: string, timeout?: number): Promise<void> {
    await this.page.locator(selector).waitFor({ state: 'hidden', timeout });
  }

  /** Try each selector in order and wait for the first one that becomes visible. */
  async waitForAny(selectors: string[], timeout = 10000): Promise<void> {
    const combined = selectors.join(', ');
    await this.page.locator(combined).first().waitFor({ state: 'visible', timeout });
  }

  async waitForNavigation(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  // ── Assertions ────────────────────────────────────────────

  async assertText(selector: string, expected: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await expect(el).toContainText(expected);
  }

  async assertVisible(selector: string, fallbacks: string[] = []): Promise<void> {
    const el = await this.findElement(selector, fallbacks);
    await expect(el).toBeVisible();
  }

  async assertNotVisible(selector: string): Promise<void> {
    await expect(this.page.locator(selector)).not.toBeVisible();
  }

  async assertURL(expected: string): Promise<void> {
    await expect(this.page).toHaveURL(expected);
  }

  // ── Utilities ─────────────────────────────────────────────

  async screenshot(name: string): Promise<string> {
    const path = `results/screenshots/${name}-${Date.now()}.png`;
    await this.page.screenshot({ path, fullPage: true });
    return path;
  }

  async getDOM(scopeSelector?: string): Promise<string> {
    if (scopeSelector) {
      const el = this.page.locator(scopeSelector);
      return await el.innerHTML();
    }
    return await this.page.content();
  }

  async getCurrentURL(): Promise<string> {
    return this.page.url();
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }

  // ── Row-scoped actions (for list/table pages) ─────────────

  /**
   * Find a row that contains the given text, then click an action within that row.
   * This is the correct pattern — never use nth-child positional selectors.
   * Example: clickRowAction('GW-Config-01', '[data-action="delete"]')
   */
  async clickRowAction(rowText: string, actionSelector: string): Promise<void> {
    const row = this.page.locator(`tr:has-text("${rowText}")`).first();
    await expect(row).toBeVisible();
    await row.locator(actionSelector).click();
  }

  async rowExists(rowText: string): Promise<boolean> {
    const row = this.page.locator(`tr:has-text("${rowText}")`);
    return (await row.count()) > 0;
  }

  // ── DOM Scraper integration ───────────────────────────────

  /**
   * Scrape the current page (or a scoped section) and cache the FieldMap.
   * Call this once after a form opens — before filling any fields.
   *
   * @param scopeSelector  CSS selector to scope the DOM snapshot (e.g. 'form', 'table')
   *                       Defaults to the full page.
   */
  async scrapeCurrentForm(scopeSelector?: string): Promise<ModuleScrapeResult> {
    logger.info(`DOM Scraper: scraping form${scopeSelector ? ` scoped to "${scopeSelector}"` : ''}`);
    const dom    = await this.getDOM(scopeSelector);
    const result = scrapePageForModule(dom);
    this._cachedFieldMap    = result.fields;
    this._cachedScrapeResult = result;
    logger.info(`DOM Scraper: found ${result.fields.length} fields, ${result.buttonLabels.length} buttons, ${result.columnHeaders.length} column headers`);
    return result;
  }

  /**
   * Correlate a user-supplied (fieldName, value) pair against the cached FieldMap.
   * If no cached map exists, scrapes the current page first.
   *
   * Returns a CorrelationResult with the correct selector and resolved value.
   * Records a DomCorrelationEvent on this.correlationEvents for results reporting.
   *
   * @example
   * const c = await page.correlateField('Gateway type', '39tlY9w85W');
   * // c.selector       → '#GateWayTypeID'
   * // c.resolvedValue  → 'STRING'  (autoTransform applied)
   * // c.resolvedOptionValue → '170'
   */
  async correlateField(
    userField:       string,
    userValue:       string,
    scopeSelector?:  string,
  ): Promise<CorrelationResult> {
    // Lazy-scrape if no cached map
    if (!this._cachedFieldMap) {
      await this.scrapeCurrentForm(scopeSelector);
    }
    const result = correlateInstruction(userField, userValue, this._cachedFieldMap!);

    // Log warnings for low/no confidence
    if (result.confidenceTier === 'none') {
      logger.warn(`DOM Scraper: no match for field "${userField}" — will use raw selector`);
    } else if (result.confidenceTier === 'low') {
      logger.warn(`DOM Scraper: low confidence match for "${userField}" → "${result.matchedField?.label}" (${result.confidence.toFixed(2)})`);
    } else {
      logger.info(`DOM Scraper: "${userField}" → "${result.selector}" (${result.confidenceTier})`);
    }
    result.notes.forEach(n => logger.info(`  ↳ ${n}`));

    // Record the event
    this.correlationEvents.push({
      userField,
      userValue,
      resolvedSelector:   result.selector,
      resolvedValue:      result.resolvedValue,
      confidence:         result.confidence,
      confidenceTier:     result.confidenceTier,
      labelMatchMethod:   result.labelMatchMethod,
      valueMatchMethod:   result.valueMatchMethod,
      notes:              result.notes,
    });

    return result;
  }

  /**
   * Correlate AND execute a fill/selectOption/check action in one call.
   * Intelligently chooses the right Playwright action from the CorrelationResult.
   *
   * Falls back to the raw userField/userValue if correlation confidence is 'none'.
   *
   * @example
   * // User said "Gateway type: 39tlY9w85W" — scraper corrects both field and value
   * await page.correlateAndAct('Gateway type', '39tlY9w85W');
   *
   * // User said "Column Data Type: String" — scraper resolves to select value "1"
   * await page.correlateAndAct('Column Data Type', 'String');
   */
  async correlateAndAct(
    userField:       string,
    userValue:       string,
    scopeSelector?:  string,
  ): Promise<CorrelationResult> {
    const corr = await this.correlateField(userField, userValue, scopeSelector);

    if (!corr.matched || !corr.selector) {
      logger.warn(`DOM Scraper: falling back to raw text selector for "${userField}"`);
      // Best-effort fallback using visible text / placeholder
      const fallbackSel = `[placeholder*="${userField}" i], label:has-text("${userField}") + input, label:has-text("${userField}") + select`;
      await this.fill(fallbackSel, userValue);
      return corr;
    }

    switch (corr.actionType) {
      case 'selectOption': {
        // Prefer option value= attribute; fall back to option text
        const val = corr.resolvedOptionValue ?? corr.resolvedValue ?? userValue;
        await this.selectOption(corr.selector, val, corr.fallbackSelectors);
        break;
      }
      case 'check':
        await this.check(corr.selector, corr.fallbackSelectors);
        break;
      case 'click':
        // For radio groups: scope to the specific option label
        if (corr.resolvedValue && corr.matchedField) {
          const opt = corr.matchedField.options.find(o => o.text === corr.resolvedValue || o.value === corr.resolvedOptionValue);
          if (opt) {
            await this.click(`label:has-text("${opt.text}")`, [`input[value="${opt.value}"]`]);
            break;
          }
        }
        await this.click(corr.selector, corr.fallbackSelectors);
        break;
      case 'fill':
      default:
        await this.fill(corr.selector, corr.resolvedValue ?? userValue, corr.fallbackSelectors);
        break;
    }

    return corr;
  }

  /** Clear the cached field map — call when navigating to a new form page */
  clearFormCache(): void {
    this._cachedFieldMap     = null;
    this._cachedScrapeResult = null;
    logger.info('DOM Scraper: cache cleared');
  }

  /** Return the cached ModuleScrapeResult (null if scrapeCurrentForm not yet called) */
  get scrapeResult(): ModuleScrapeResult | null {
    return this._cachedScrapeResult;
  }
}
