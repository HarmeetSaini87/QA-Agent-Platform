# QA Agent Platform — Selector Healing Reference

> **Note:** The automatic self-healing agent pipeline is not active in the current platform. Selectors are managed manually through the **Locator Repository** UI. This file is retained as a reference for future implementation.

---

## Current Selector Management (Active Approach)

When a test fails due to a broken selector:

1. Go to **Locator Repository** in the UI
2. Find the locator by name or component
3. Update the **Selector** field with the correct CSS/XPath
4. Save — the updated locator is used on the next suite run

The locator is stored centrally and referenced by name in test scripts. Updating it in one place fixes all scripts that use it.

---

## Selector Strategy

Priority order when adding/fixing locators:

1. `id` attribute — `#elementId` (most stable)
2. `name` attribute — `input[name="Username"]`
3. ARIA role + accessible name — `button:has-text("Save")`
4. CSS class + type — `.btn-primary[type="submit"]`
5. XPath — last resort

Avoid:
- `nth-child` or positional selectors
- Long CSS chains (fragile on DOM changes)
- Generated class names (e.g. `css-abc123`)

For row-scoped actions: `tr:has-text("record name") .btn-delete`

---

## Failure Analysis

When a test fails with a selector error:

1. Open the **Execution Report** for the run (Execution History → View Report)
2. The failed test row shows the **Error Message** and **Call Log**
3. The call log shows exactly which `locator.waitFor()` timed out
4. Use the call log to identify the correct selector via browser DevTools
5. Update the locator in the **Locator Repository**

---

## Future: Automated Healing

A self-healing agent could be implemented to:
1. Detect `TimeoutError: locator.waitFor` failures
2. Take a DOM snapshot of the failed page
3. Use AI to suggest an updated selector based on surrounding DOM context
4. Propose the fix in the Locator Repository for SDET review

This would integrate as a post-run step in `spawnRunWithSpec()`.
