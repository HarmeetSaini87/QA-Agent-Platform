# QA Agent Platform — Planning Reference

> **Note:** This file is retained for reference only. The active platform no longer uses an AI planner pipeline. Test cases are built directly in the Test Script Builder UI using keywords and locators.

---

## How Test Scripts Are Built (Current Approach)

1. SDET opens **Test Script Builder** in the UI
2. Selects a project and clicks **Add Script**
3. Adds steps using the keyword dropdown (FILL, CLICK, ASSERT_TEXT, etc.)
4. Assigns locators from the **Locator Repository**
5. Configures value sources (Static / Dynamic / Common Data / Test Data)
6. Saves the script and adds it to a **Test Suite**
7. Runs the suite — spec is auto-generated and executed by Playwright

No JSON test-plan files, no AI-generated steps, no Excel uploads.

---

## Keyword Reference

Available keywords are defined in `src/data/keywords.json`. Each has:
- `key` — used in step definition
- `label` — displayed in UI dropdown
- `group` — category (Navigation, Form Interaction, Flow Control, Session)
- `needsLocator` — whether a locator must be selected
- `needsValue` — whether a value source must be configured
- `tooltip.what` / `tooltip.example` / `tooltip.tip` — shown in UI on hover

---

## Test Data Strategy

For parameterised tests, use the **Test Data** value source on any step:
- Add rows in the step editor (one row = one test run)
- All testdata steps in a script are aligned by row index
- The generator creates N `test()` blocks automatically

---

## Common Functions

Reusable step sequences (e.g. login flow) are defined in **Common Functions**.
They are called from scripts using the `CALL FUNCTION` keyword.
Values for each function step are provided at the script level, not in the function definition.
