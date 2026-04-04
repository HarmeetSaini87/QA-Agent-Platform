# QA Agent Platform — Generator Reference

> **Note:** This file is retained for reference only. The active spec generator is `src/utils/codegenGenerator.ts` — a deterministic TypeScript module. It does not use AI prompting at runtime.

---

## How Specs Are Generated (Current Approach)

`generateCodegenSpec(input: CodegenInput)` is called by `POST /api/suites/:id/run`.

### Input
```typescript
{
  suiteName:    string;
  suiteId:      string;
  scripts:      TestScript[];
  project:      Project;
  environment:  ProjectEnvironment | null;
  allFunctions: CommonFunction[];
}
```

### Output
A `.spec.ts` file written to `tests/codegen/<SuiteName>.spec.ts`

### Structure
```typescript
test.describe('Suite Name', () => {

  test('Script Title', async ({ page }) => {
    // Auto-navigate — URL from "QA" environment
    await page.goto('https://app.example.com', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    // Step 1
    await page.locator('#selector').waitFor({ state: 'visible' });
    await page.locator('#selector').fill('value');

    // ... more steps
  });

});
```

---

## Keyword → Playwright Mapping

| Keyword | Playwright output |
|---|---|
| `FILL` | `locator.waitFor({ state:'visible' }); locator.fill(value)` |
| `CLICK` | `locator.waitFor({ state:'visible' }); locator.click()` |
| `SELECT` | `locator.waitFor({ state:'visible' }); locator.selectOption(value)` |
| `CHECK` | `locator.waitFor({ state:'visible' }); locator.check()` |
| `UNCHECK` | `locator.waitFor({ state:'visible' }); locator.uncheck()` |
| `ASSERT_TEXT` | `expect(locator).toContainText(value)` |
| `ASSERT_VISIBLE` | `expect(locator).toBeVisible()` |
| `WAIT_FOR` | `locator.waitFor({ state:'visible' })` |
| `RELOAD` | `page.reload()` |
| `SCREENSHOT` | `page.screenshot({ path: 'screenshots/...' })` |
| `LOGOUT` | `page.goto('/logout')` |
| `CALL FUNCTION` | Inline expansion of function child steps |
| `GOTO` | _(silently skipped — URL injected at test start)_ |

---

## Value Mode → Code

| valueMode | Generated expression |
|---|---|
| `static` | `'literal string'` |
| `dynamic` | `process.env.VAR_NAME` |
| `commondata` | `commonData['key']` |
| `testdata` | `testDataRows[runIdx].value` |

---

## Extending the Generator

To add a new keyword:
1. Add entry to `src/data/keywords.json`
2. Add `case 'NEW_KEYWORD':` in the `generateStepCode()` switch in `codegenGenerator.ts`
3. Run `npm run build`
