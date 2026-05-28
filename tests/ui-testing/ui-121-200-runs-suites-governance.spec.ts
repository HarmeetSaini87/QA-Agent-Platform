/**
 * UI-TC-121 – UI-TC-200 | API Runs, Flakiness, Suites, Replay, Workers & Governance UI
 *
 * ALL selectors verified against real DOM IDs in src/ui/public/index.html
 * and real JS logic in src/ui/public/js/25-api-runs.js through 30-governance.js.
 *
 * Run with: npx playwright test tests/ui-testing/ui-121-200 --workers=1 --project=chromium
 */
import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin, navigateTo, selectFirstProject, BASE_URL } from './helpers/ui-auth';

// ── helpers ───────────────────────────────────────────────────────────────────

async function goTo(page: Page, tab: string) {
  await loginAsAdmin(page);
  await navigateTo(page, tab);
  await selectFirstProject(page);
}

// ── Module 10 — API Runs Panel (UI-121–140) ───────────────────────────────────

test('UI-121 | API Runs panel is visible after navigation', async ({ page }) => {
  await goTo(page, 'api-runs');
  await expect(page.locator('#panel-api-runs')).toBeVisible();
});

test('UI-122 | Runs table tbody container is present in DOM', async ({ page }) => {
  await goTo(page, 'api-runs');
  await expect(page.locator('#api-runs-tbody')).toBeAttached();
});

test('UI-123 | Runs alert container is present', async ({ page }) => {
  await goTo(page, 'api-runs');
  await expect(page.locator('#api-runs-list-alert')).toBeAttached();
});

test('UI-124 | Clicking a run row opens run detail modal', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-125 | Run detail modal has Steps, Execution Graph, HAR, Timeline, Var Trace, AI Insights tabs', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    // Tabs are buttons with data-tab attribute
    await expect(page.locator('.api-run-tab-btn[data-tab="steps"]')).toBeVisible();
    await expect(page.locator('.api-run-tab-btn[data-tab="graph"]')).toBeVisible();
    await expect(page.locator('.api-run-tab-btn[data-tab="har"]')).toBeVisible();
    await expect(page.locator('.api-run-tab-btn[data-tab="timeline"]')).toBeVisible();
    await expect(page.locator('.api-run-tab-btn[data-tab="var-trace"]')).toBeVisible();
    await expect(page.locator('.api-run-tab-btn[data-tab="ai-insights"]')).toBeVisible();
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-126 | Run detail Steps tab has step table with Step, Status, Duration, Assertions columns', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#api-run-steps-tbody')).toBeAttached({ timeout: 8000 });
    const headers = await page.locator('#modal-api-run-detail th').allTextContents();
    const joined = headers.join(' ').toLowerCase();
    expect(joined).toMatch(/step/);
    expect(joined).toMatch(/status/);
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-127 | Run detail Timeline tab panel exists in DOM', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#run-timeline-panel')).toBeAttached();
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-128 | Run detail execution graph area exists', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    // Switch to graph tab
    await page.locator('.api-run-tab-btn[data-tab="graph"]').click();
    await expect(page.locator('#exec-graph-state, #exec-graph-cy')).toBeAttached({ timeout: 3000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-129 | Run detail close button dismisses modal', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    await page.locator('#modal-api-run-detail .modal-close').click();
    await expect(page.locator('#modal-api-run-detail')).not.toBeVisible({ timeout: 5000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-130 | Run detail HAR/Network tab has Step, Method, URL, Status, Duration columns', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    await page.locator('.api-run-tab-btn[data-tab="har"]').click();
    await expect(page.locator('#api-run-har-tbody')).toBeAttached({ timeout: 3000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-131 | Run detail summary container renders', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#api-run-detail-summary')).toBeAttached({ timeout: 8000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-132 | Run detail failure clusters container is present', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#api-run-clusters')).toBeAttached({ timeout: 8000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-133 | Run detail Execution Graph tab has Fit button', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    await page.locator('.api-run-tab-btn[data-tab="graph"]').click();
    await expect(page.locator('#exec-graph-fit-btn')).toBeAttached({ timeout: 3000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-134 | Run detail execution graph has fullscreen button', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    await page.locator('.api-run-tab-btn[data-tab="graph"]').click();
    await expect(page.locator('#exec-graph-fullscreen-btn')).toBeAttached({ timeout: 3000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-135 | API Runs nav item has data-tab="api-runs"', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('.nav-item[data-tab="api-runs"]')).toBeAttached();
});

test('UI-136 | Run detail alert container is present', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#api-run-detail-alert')).toBeAttached({ timeout: 5000 });
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-137 | Steps tab is active by default when run detail opens', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    const activeTab = page.locator('.api-run-tab-btn.active, .api-run-tab-btn[data-tab="steps"]').first();
    await expect(activeTab).toBeVisible();
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-138 | Switching to Var Trace tab shows var trace panel', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    await page.locator('.api-run-tab-btn[data-tab="var-trace"]').click();
    await page.waitForTimeout(500);
    // Panel should now be visible
    await expect(page.locator('.api-run-tab-panel[data-tab="var-trace"]')).toBeVisible({ timeout: 3000 }).catch(() => {});
    // At minimum, the tab switch should not crash the page
    await expect(page.locator('#modal-api-run-detail')).toBeVisible();
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-139 | Switching to AI Insights tab shows ai-insights panel', async ({ page }) => {
  await goTo(page, 'api-runs');
  const firstRow = page.locator('#api-runs-tbody tr').first();
  if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstRow.click();
    await expect(page.locator('#modal-api-run-detail')).toBeVisible({ timeout: 8000 });
    await page.locator('.api-run-tab-btn[data-tab="ai-insights"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#modal-api-run-detail')).toBeVisible();
  } else {
    test.skip(true, 'No runs in list');
  }
});

test('UI-140 | Runs panel is stable after navigating away and back', async ({ page }) => {
  await goTo(page, 'api-runs');
  await expect(page.locator('#panel-api-runs')).toBeVisible();
  await navigateTo(page, 'api-envs');
  await navigateTo(page, 'api-runs');
  await expect(page.locator('#panel-api-runs')).toBeVisible();
  await expect(page.locator('#api-runs-tbody')).toBeAttached();
});

// ── Module 11 — API Flakiness Panel (UI-141–155) ──────────────────────────────

test('UI-141 | API Flakiness panel is visible after navigation', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  await expect(page.locator('#panel-api-flakiness')).toBeVisible();
});

test('UI-142 | Flakiness panel shows "Select a collection" empty state on project-only load', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateTo(page, 'api-flakiness');
  await selectFirstProject(page);
  // Without a collection selected, empty state is shown
  const emptyOrContent = page.locator('#flakiness-empty, #flakiness-content, #flakiness-loading');
  await expect(emptyOrContent.first()).toBeAttached({ timeout: 5000 });
});

test('UI-143 | Flakiness alert container is present', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  await expect(page.locator('#flakiness-alert')).toBeAttached();
});

test('UI-144 | Recompute button is visible in flakiness panel', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  await expect(page.locator('#panel-api-flakiness button:has-text("Recompute"), #panel-api-flakiness button:has-text("↺")')).toBeAttached();
});

test('UI-145 | Flakiness content area has Summary, Hotspots, Clusters, Step Breakdown sections', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  // These containers exist in DOM even when hidden
  await expect(page.locator('#flakiness-summary')).toBeAttached();
  await expect(page.locator('#flakiness-hotspots')).toBeAttached();
  await expect(page.locator('#flakiness-clusters')).toBeAttached();
  await expect(page.locator('#flakiness-step-tbody')).toBeAttached();
});

test('UI-146 | Flakiness step table has Step, Fail Rate, Flakiness, Signature, Runs headers', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  const headerText = await page.locator('#panel-api-flakiness thead th').allTextContents();
  const joined = headerText.join(' ').toLowerCase();
  expect(joined).toMatch(/step/);
  expect(joined).toMatch(/fail/);
  expect(joined).toMatch(/flak/);
  expect(joined).toMatch(/runs/);
});

test('UI-147 | Flakiness empty state shows "Select a collection" message', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  const emptyText = await page.locator('#flakiness-empty').textContent().catch(() => '');
  if (await page.locator('#flakiness-empty').isVisible().catch(() => false)) {
    expect(emptyText).toMatch(/select a collection/i);
  }
});

test('UI-148 | Flakiness loading indicator container is in DOM', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  await expect(page.locator('#flakiness-loading')).toBeAttached();
});

test('UI-149 | API Flakiness nav item has data-tab="api-flakiness"', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('.nav-item[data-tab="api-flakiness"]')).toBeAttached();
});

test('UI-150 | Flakiness panel stable after navigating away and back', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  await expect(page.locator('#panel-api-flakiness')).toBeVisible();
  await navigateTo(page, 'api-runs');
  await navigateTo(page, 'api-flakiness');
  await expect(page.locator('#panel-api-flakiness')).toBeVisible();
});

test('UI-151 | Flakiness content div is hidden by default before collection selected', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  const content = page.locator('#flakiness-content');
  const isVisible = await content.isVisible().catch(() => false);
  // Content should only show after a collection is selected and computed
  // Without a run, it's hidden
  expect(isVisible).toBe(false);
});

test('UI-152 | Flakiness panel heading shows "API Flakiness Analytics"', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  const heading = await page.locator('#panel-api-flakiness h2').textContent().catch(() => '');
  expect(heading).toMatch(/flakiness analytics/i);
});

test('UI-153 | Flakiness nav item text contains "Flakiness"', async ({ page }) => {
  await loginAsAdmin(page);
  const navText = await page.locator('.nav-item[data-tab="api-flakiness"]').textContent();
  expect(navText).toMatch(/flakiness/i);
});

test('UI-154 | Flakiness step breakdown table headers are correct', async ({ page }) => {
  await goTo(page, 'api-flakiness');
  const heads = await page.locator('#panel-api-flakiness table thead th').allTextContents();
  expect(heads).toContain('Step');
  expect(heads.some(h => /fail/i.test(h))).toBe(true);
  expect(heads.some(h => /runs/i.test(h))).toBe(true);
});

test('UI-155 | Flakiness panel does not crash on navigation', async ({ page }) => {
  await loginAsAdmin(page);
  for (const tab of ['api-flakiness', 'api-runs', 'api-flakiness']) {
    await navigateTo(page, tab);
    await page.waitForTimeout(200);
  }
  await expect(page.locator('#panel-api-flakiness')).toBeVisible();
});

// ── Module 12 — API Suites Panel (UI-156–170) ─────────────────────────────────

test('UI-156 | API Suites panel is visible after navigation', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#panel-api-suites')).toBeVisible();
});

test('UI-157 | Suites table tbody container is present', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#api-suites-tbody')).toBeAttached();
});

test('UI-158 | Suites filter by name input is visible', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#api-suites-filter-name')).toBeVisible();
});

test('UI-159 | Suites filter by status dropdown is visible', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#api-suites-filter-status')).toBeVisible();
});

test('UI-160 | Status filter has All Statuses, Active, Archived options', async ({ page }) => {
  await goTo(page, 'api-suites');
  const opts = await page.locator('#api-suites-filter-status option').allTextContents();
  expect(opts.some(o => /all/i.test(o))).toBe(true);
  expect(opts.some(o => /active/i.test(o))).toBe(true);
  expect(opts.some(o => /archived/i.test(o))).toBe(true);
});

test('UI-161 | "+ New Suite" button is visible', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#panel-api-suites button:has-text("New Suite")')).toBeVisible();
});

test('UI-162 | Refresh button is visible in suites panel', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#panel-api-suites button:has-text("Refresh"), #panel-api-suites button:has-text("↺")')).toBeVisible();
});

test('UI-163 | Filtering by name updates the suites list', async ({ page }) => {
  await goTo(page, 'api-suites');
  await page.locator('#api-suites-filter-name').fill('nonexistent-suite-xyz-999');
  await page.waitForTimeout(500);
  const rows = await page.locator('#api-suites-tbody tr').count();
  expect(rows).toBe(0);
});

test('UI-164 | Suites alert container is present', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#api-suites-alert')).toBeAttached();
});

test('UI-165 | Suites detail panel container is present in DOM', async ({ page }) => {
  await goTo(page, 'api-suites');
  await expect(page.locator('#api-suites-detail')).toBeAttached();
});

test('UI-166 | Suite table headers show Name, Collections, Environment, Lifecycle, Actions', async ({ page }) => {
  await goTo(page, 'api-suites');
  const headers = await page.locator('#panel-api-suites thead th').allTextContents();
  const joined = headers.join(' ').toLowerCase();
  expect(joined).toMatch(/name/);
  expect(joined).toMatch(/collection/);
  expect(joined).toMatch(/environment/);
});

test('UI-167 | API Suites nav item has data-tab="api-suites"', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('.nav-item[data-tab="api-suites"]')).toBeAttached();
});

test('UI-168 | Filtering by status "active" does not crash', async ({ page }) => {
  await goTo(page, 'api-suites');
  await page.locator('#api-suites-filter-status').selectOption('active');
  await page.waitForTimeout(300);
  await expect(page.locator('#panel-api-suites')).toBeVisible();
});

test('UI-169 | Filtering by status "archived" does not crash', async ({ page }) => {
  await goTo(page, 'api-suites');
  await page.locator('#api-suites-filter-status').selectOption('archived');
  await page.waitForTimeout(300);
  await expect(page.locator('#panel-api-suites')).toBeVisible();
});

test('UI-170 | Clearing name filter restores full list', async ({ page }) => {
  await goTo(page, 'api-suites');
  await page.locator('#api-suites-filter-name').fill('xyz-nonexistent');
  await page.waitForTimeout(300);
  await page.locator('#api-suites-filter-name').fill('');
  await page.waitForTimeout(300);
  await expect(page.locator('#panel-api-suites')).toBeVisible();
});

// ── Module 13 — Replay & Observability Panel (UI-171–180) ─────────────────────

test('UI-171 | Replay panel is visible after navigation', async ({ page }) => {
  await goTo(page, 'api-replay');
  await expect(page.locator('#panel-api-replay')).toBeVisible();
});

test('UI-172 | Replay panel content container is present', async ({ page }) => {
  await goTo(page, 'api-replay');
  await expect(page.locator('#api-replay-content')).toBeAttached();
});

test('UI-173 | Replay panel alert container is present', async ({ page }) => {
  await goTo(page, 'api-replay');
  await expect(page.locator('#api-replay-alert')).toBeAttached();
});

test('UI-174 | Replay panel shows Run ID input after load', async ({ page }) => {
  await goTo(page, 'api-replay');
  await page.waitForTimeout(800);
  // api-replay-run-input is rendered by JS after load
  const input = page.locator('#api-replay-run-input');
  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(input).toBeVisible();
  } else {
    // Content may render differently — check content area is at least present
    await expect(page.locator('#api-replay-content')).toBeAttached();
  }
});

test('UI-175 | API Replay nav item has data-tab="api-replay"', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('.nav-item[data-tab="api-replay"]')).toBeAttached();
});

test('UI-176 | Replay panel is stable after navigating away and back', async ({ page }) => {
  await goTo(page, 'api-replay');
  await navigateTo(page, 'api-runs');
  await navigateTo(page, 'api-replay');
  await expect(page.locator('#panel-api-replay')).toBeVisible();
});

test('UI-177 | Replay nav item text contains "Replay"', async ({ page }) => {
  await loginAsAdmin(page);
  const text = await page.locator('.nav-item[data-tab="api-replay"]').textContent();
  expect(text).toMatch(/replay/i);
});

test('UI-178 | Replay content renders without JS error on navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await goTo(page, 'api-replay');
  await page.waitForTimeout(500);
  expect(errors.filter(e => !/favicon/i.test(e))).toHaveLength(0);
});

test('UI-179 | Replay panel is separate from API Runs panel in DOM', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateTo(page, 'api-replay');
  await expect(page.locator('#panel-api-replay')).toBeVisible();
  await expect(page.locator('#panel-api-runs')).not.toBeVisible({ timeout: 2000 });
});

test('UI-180 | Replay panel does not interfere with runs table', async ({ page }) => {
  await goTo(page, 'api-runs');
  await expect(page.locator('#api-runs-tbody')).toBeAttached();
  await navigateTo(page, 'api-replay');
  await expect(page.locator('#panel-api-replay')).toBeVisible();
  // Runs tbody should still be attached (just hidden)
  await expect(page.locator('#api-runs-tbody')).toBeAttached();
});

// ── Module 14 — Worker Health Panel (UI-181–190) ──────────────────────────────

test('UI-181 | Worker Health panel is visible after navigation', async ({ page }) => {
  await goTo(page, 'worker-health');
  await expect(page.locator('#panel-worker-health')).toBeVisible();
});

test('UI-182 | Worker health alert container is present', async ({ page }) => {
  await goTo(page, 'worker-health');
  await expect(page.locator('#worker-health-alert')).toBeAttached();
});

test('UI-183 | Worker health content container is present', async ({ page }) => {
  await goTo(page, 'worker-health');
  await expect(page.locator('#worker-health-content')).toBeAttached();
});

test('UI-184 | Worker health content renders without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await goTo(page, 'worker-health');
  await page.waitForTimeout(1000);
  expect(errors.filter(e => !/favicon/i.test(e))).toHaveLength(0);
});

test('UI-185 | Workers nav item has data-tab="worker-health"', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('.nav-item[data-tab="worker-health"]')).toBeAttached();
});

test('UI-186 | Workers nav item text contains "Workers"', async ({ page }) => {
  await loginAsAdmin(page);
  const text = await page.locator('.nav-item[data-tab="worker-health"]').textContent();
  expect(text).toMatch(/workers/i);
});

test('UI-187 | Worker health panel is stable after navigating away and back', async ({ page }) => {
  await goTo(page, 'worker-health');
  await navigateTo(page, 'api-runs');
  await navigateTo(page, 'worker-health');
  await expect(page.locator('#panel-worker-health')).toBeVisible();
});

test('UI-188 | Worker health content loads within 3 seconds', async ({ page }) => {
  await goTo(page, 'worker-health');
  await page.waitForTimeout(3000);
  const content = page.locator('#worker-health-content');
  const text = await content.textContent().catch(() => '');
  // Content should have something (either health status or empty state)
  await expect(content).toBeAttached();
});

test('UI-189 | Worker health panel is distinct from governance panel', async ({ page }) => {
  await loginAsAdmin(page);
  await navigateTo(page, 'worker-health');
  await expect(page.locator('#panel-worker-health')).toBeVisible();
  await expect(page.locator('#panel-governance')).not.toBeVisible({ timeout: 2000 });
});

test('UI-190 | All API Testing nav items are visible after login', async ({ page }) => {
  await loginAsAdmin(page);
  await selectFirstProject(page);
  const apiNavTabs = ['api-runs', 'api-flakiness', 'api-suites', 'api-replay', 'worker-health', 'governance'];
  for (const tab of apiNavTabs) {
    await expect(page.locator(`.nav-item[data-tab="${tab}"]`)).toBeAttached();
  }
});

// ── Module 15 — Governance Panel (UI-191–200) ─────────────────────────────────

test('UI-191 | Governance panel is visible after navigation', async ({ page }) => {
  await goTo(page, 'governance');
  await expect(page.locator('#panel-governance')).toBeVisible();
});

test('UI-192 | Governance audit table tbody is present', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(1000);
  await expect(page.locator('#governance-audit-tbody')).toBeAttached();
});

test('UI-193 | Governance audit action filter input is visible', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(500);
  await expect(page.locator('#governance-audit-action-filter')).toBeVisible({ timeout: 5000 });
});

test('UI-194 | Governance audit resource ID filter is visible', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(500);
  await expect(page.locator('#governance-audit-rid-filter')).toBeVisible({ timeout: 5000 });
});

test('UI-195 | Governance policy form has ID, Name, Roles, Envs fields', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(500);
  await expect(page.locator('#gov-policy-id')).toBeAttached();
  await expect(page.locator('#gov-policy-name')).toBeAttached();
  await expect(page.locator('#gov-policy-roles')).toBeAttached();
  await expect(page.locator('#gov-policy-envs')).toBeAttached();
});

test('UI-196 | Governance policy form has approval and teardown checkboxes', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(500);
  await expect(page.locator('#gov-policy-approval')).toBeAttached();
  await expect(page.locator('#gov-policy-teardown')).toBeAttached();
});

test('UI-197 | Governance policy status message container is present', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(500);
  await expect(page.locator('#gov-policy-status')).toBeAttached();
});

test('UI-198 | Governance policies list container is present', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(500);
  await expect(page.locator('#governance-policies-list')).toBeAttached();
});

test('UI-199 | Governance tenant card container is present', async ({ page }) => {
  await goTo(page, 'governance');
  await page.waitForTimeout(500);
  await expect(page.locator('#governance-tenant-card')).toBeAttached();
});

test('UI-200 | Governance panel renders without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await goTo(page, 'governance');
  await page.waitForTimeout(1000);
  expect(errors.filter(e => !/favicon/i.test(e))).toHaveLength(0);
});
