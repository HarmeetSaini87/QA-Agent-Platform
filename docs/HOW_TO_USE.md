# QA Agent Platform — How to Use

## What this tool does

This platform lets SDETs build, organise, and run automated UI tests without writing code. You define test steps using keywords, group them into suites, and the platform generates and executes Playwright tests against your web app — then shows results in the Execution History page with a full detailed report.

---

## Access

Open your browser: **http://qa-launchpad.local** (or `http://localhost:3000` on the server itself)

Log in with your credentials. The platform runs on the server — Playwright opens a browser on the server machine regardless of which machine you use to access the UI.

---

## Step 1 — Select a Project

Select your project from the **top-right dropdown**. All modules are project-scoped — nothing loads until a project is selected.

---

## Step 2 — Add Locators

**Locator Repository → Add Locator**

Enter a name (e.g. `Username Field`), the CSS/XPath selector, and the component. These are reused across all scripts in your project.

---

## Step 3 — (Optional) Create Common Functions

**Common Functions → Add Function**

Define reusable sequences of steps (e.g. a login flow). Steps have Keyword + Locator + Description only — no values. Values are provided when the function is called from a test script.

---

## Step 4 — Build Test Scripts

**Test Script Builder → Add Script**

Fill in: Component, Title, Tag, Priority, Created By.

Click **Add Step**:

| Field | What to fill |
|---|---|
| Keyword | The action — hover `?` for details (What / Example / Tip) |
| Locator | Pick from the Locator Repository |
| Description | Plain-English note |
| Value Source | How to supply the value (see below) |

### Value Source options

| Tab | When to use |
|---|---|
| Static | Fixed text (e.g. `Test Gateway`) |
| Dynamic | Read from an environment variable |
| Common Data | Reference a Common Data key shared across scripts |
| Test Data | Provide multiple rows — generates one test run per row |

### Using CALL FUNCTION
1. Add a step with keyword `CALL FUNCTION`
2. Pick the function from the dropdown
3. Each child step that needs a value shows its own value source panel — fill those in here
4. The function definition stays clean; values are stored on the script

---

## Step 5 — Create a Test Suite

**Test Suite → Add Suite**

Name the suite, select a default Environment, then add scripts. Drag to reorder.

---

## Step 6 — Run the Suite

1. Open a suite → click **Run Suite** (top right of the suite detail view)
2. Confirm or change the Environment in the dropdown
3. Click **▶ Run Suite**
4. Output streams in the panel below in real time

### What happens on a run
- The environment URL is automatically navigated to at the start of every test (SSO redirects are handled)
- If a script has Test Data rows, N separate test cases run (one per row)
- Screenshots are captured on failure

---

## Step 7 — View Execution History

**Execution History** (left nav)

Shows all runs for the selected project with:
- Status (In Progress / Completed / Failed)
- Pass/Fail/Total counts
- Start time, end time, duration
- Environment used, executed by

### Filters
- Date / Search (Run ID, Suite name, User) / Status / Environment
- Click any column header to sort (▲/▼)

### View Report
Click **📄 View Report** on any completed run to open the full Execution Report in a new tab.

---

## Execution Report

The report page shows:

**Execution Summary** — ID, Project, Suite, Environment, Executed By, Status, Start/End/Duration

**Test Execution Summary** — Total / Passed / Failed / Skipped / Pass Rate + progress bar

**Test Case Results** — Table with TC ID, Title, Status, Duration, and for failed tests:
- Error message
- Full failure detail / call log
- Screenshot (if captured)

### Export
- **Export HTML** — downloads a self-contained light-mode HTML file (no server needed)
- **Export PDF** — opens browser print dialog (save as PDF)

---

## Keyword Reference

Hover the `?` icon next to any keyword in the step editor to see:
- **What it does**
- **Example**
- **Tip**

---

## Need help?

Contact your SDET team.
