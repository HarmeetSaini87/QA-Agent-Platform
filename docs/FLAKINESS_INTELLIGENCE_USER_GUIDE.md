# Flakiness Intelligence — User Guide

**Feature:** Flakiness Intelligence + Auto-Quarantine  
**Platform:** TestForge (qa-agent-platform)  
**Audience:** QA Engineers, SDET Leads, Engineering Managers  
**Version:** v1.0 — 2026-04-26

---

## What Is This Feature?

Every QA team has tests that fail sometimes and pass other times for no obvious reason. These are called **flaky tests**. They create noise in your pipeline — engineers start ignoring failures, trust in the test suite erodes, and real bugs get missed.

**Flakiness Intelligence** solves this automatically:

1. It **watches** every test across all your runs and builds a statistical picture of how reliable each test is
2. It **scores** each test on a 0–1 scale based on how often it fails and how erratically it behaves
3. It **classifies** the likely root cause — timeout, network error, locator instability, assertion drift, or environment crash
4. It **quarantines** tests that exceed your reliability threshold — they still run, but their result no longer blocks your pipeline
5. It **restores** tests automatically once they prove themselves stable again

The result: your pipeline only fails for real reasons. Flaky noise is isolated, visible, and explained — not hidden.

---

## The Core Concept: Quarantine

A quarantined test is **not skipped** and **not deleted**. It still runs on every suite execution. The difference is:

- Its result does **not count** toward the suite pass/fail decision
- It appears in a separate **"Quarantined Tests"** section in your execution report
- You can see exactly how many quarantined tests failed, so there is no hidden information

Think of it like a player on the injured reserve list: still part of the team, accounted for, but not affecting the scoreline until they're fit again.

---

## Key Concepts Explained

### Flake Score (0.0 – 1.0)

The flake score is a single number that summarises how unreliable a test is.

| Score | Colour | Meaning |
|---|---|---|
| 0.00 – 0.24 | Green | Healthy — test is consistent |
| 0.25 – 0.29 | Yellow | Watch zone — approaching threshold |
| 0.30+ | Red ↑ | Above threshold — quarantine eligible |

The score is calculated from three signals, with recent runs weighted more heavily than old ones:
- **70% — Fail rate:** How often the test fails (the primary driver)
- **20% — Alternation:** How erratically it switches between pass and fail
- **15% — Variance:** How inconsistent the failure pattern is

Recent runs matter more than old ones. If a test was flaky 3 months ago but has been stable for the last 2 weeks, the score reflects the recent behaviour.

### Threshold

The quarantine threshold is the fail rate at which a test gets quarantined. Default is **30%** — a test that fails in 3 out of every 10 runs.

You can set different thresholds per suite type:
- **Smoke suites:** 20% — stricter, any flakiness is a problem
- **Regression suites:** 30% — default
- **E2E suites:** 40% — more tolerant, environment variability is expected

### Confidence

Confidence tells you how reliable the score itself is. A test with only 5 runs has less certainty than one with 50 runs.

| Confidence | Meaning |
|---|---|
| High | 15+ runs, consistent recent data — score is reliable |
| Med | 8–14 runs or sparse recent data — score is a reasonable estimate |
| Low | Near the minimum run count — treat the score as directional only |

### Insufficient Data

If a test has fewer than 5 runs (or fewer than 3 runs within the last 7 days), it cannot be scored. It shows as **"Insufficient"** with a dimmed row. No action is taken on it — the system waits for more data before making any decision.

---

## How Auto-Quarantine Works

Auto-quarantine fires automatically at the end of every suite run. You do not need to supervise it — it is designed for unattended nightly builds and CI pipelines.

### The Trigger

After each suite run completes, the engine:

1. Groups all test results by test identity across the last 14 days of run history
2. Computes a flake score for each test
3. If a test's **fail rate** (not the composite score) crosses the threshold → it is quarantined

Fail rate is the only gate for quarantine. The alternation and variance signals add nuance to the score but do not trigger quarantine on their own.

### The Hysteresis Rule (Anti-Thrashing)

Once a test is quarantined, the threshold is lowered by 5 percentage points to decide whether to **keep** it quarantined. This prevents a test from oscillating in and out of quarantine every run.

Example: threshold = 30%. Test gets quarantined at 32%. The next run, its fail rate drops to 27%. Without hysteresis, it would be restored. With hysteresis, the "stay quarantined" threshold is 25%, so 27% > 25% — it stays quarantined until it genuinely stabilises.

### The Cooldown Rule (Anti-Spam)

After a test is quarantined, the engine waits for at least **3 runs** before re-evaluating it. This prevents a single noisy run from immediately triggering a new quarantine cycle.

---

## How Auto-Promote (Recovery) Works

You do not need to manually restore a test that has fixed itself. The engine monitors quarantined tests and promotes them automatically when all four conditions are met:

| Condition | Default Value |
|---|---|
| At least 10 runs in the evaluation window | 10 runs |
| Last 3 consecutive runs all passed | 3 runs |
| Pass rate across those 10 runs ≥ 95% | 95% |
| At least 3 recent runs within the last 7 days | 3 runs |

All four must be true simultaneously before auto-promote fires.

**Important:** Auto-promote only applies to tests that were **automatically quarantined**. If you manually quarantined a test, you must manually restore it. This is intentional — manual quarantine signals a deliberate human decision that should not be overridden by the engine.

---

## Flake Classification

Every evaluated test is classified into one of six categories based on signals extracted from its error messages and timing data:

| Category | What it means | Action hint |
|---|---|---|
| **timing** | Timeout or test ran significantly slower than baseline | Increase waitForResponse or page load timeout |
| **network** | ECONNRESET, fetch failed, or 5xx error in failure messages | Check API stability — test may need retry logic or mock |
| **locator** | "element not found", selector errors, getBy failures | Locator may be unstable — review selector or add self-healing |
| **assertion** | expect() failures, toEqual / toBe mismatches | Data dependency likely — check test isolation or seed data |
| **environment** | Browser crash, out of memory, SIGKILL | Check agent memory and resource limits |
| **unknown** | No clear signal pattern | Investigate error patterns manually |

The classification is shown in the Flaky Tests table and in the expanded detail row. The **dominant category** shows the most common cause across all recent failures, so if 6 out of 8 recent failures were network errors, you see "Dominant cause: network (6/8 recent failures)".

---

## The Quarantine Budget

To prevent the quarantine feature from silently masking a broken test environment, every suite has a **quarantine budget** (default: 5 tests per run).

- If 5 or fewer quarantined tests fail in a single run → pipeline proceeds normally
- If **more than 5** quarantined tests fail → the suite is marked **FAILED**, even though they are quarantined

This is a safety net. If everything is quarantined, the pipeline is not healthy — it just looks healthy. The budget forces a hard stop when quarantine is being overused.

You can adjust the budget per suite in the Flakiness Intelligence config panel.

---

## The Flaky Tests Tab — Walkthrough

### Controls at the Top

- **Suite filter** — narrow the view to one suite, or see all suites in the project
- **Sort** — order by Score (highest first), Confidence, Recent Failures, or Name
- **Top 10 button** — instantly focus on the worst offenders only
- **↻ Refresh** — reload data after a new run

### Filter Tabs

- **All** — every test with any flakiness data
- **Flagged** — tests that are above threshold but not yet quarantined (need attention)
- **Quarantined** — currently quarantined tests
- **Insufficient Data** — tests that haven't run enough times to be evaluated

### Summary Bar

Shows at a glance: total tests · quarantined count · flagged count

### Table Columns

| Column | What it shows |
|---|---|
| Test Name | Test display name + NEW badge (quarantined in last 24h) + ⛔ Auto/Manual badge |
| Status | Quarantined / Flagged / Active / Insufficient |
| Score | Flake score 0.00–1.00 with colour coding |
| Conf | High / Med / Low confidence in the score |
| Trend | Last 10 runs as P (pass, green) / F (fail, red) |
| Category | Primary classification (timing, network, locator, etc.) |
| Last Run | How long ago the test last ran |
| Last Failure | How long ago the test last failed |
| Action | Quarantine or Restore button |

### Expanded Detail Row

Click any row to expand it. You get four panels:

**Decision** — flake score, threshold comparison, confidence, last run/failure dates

**Signals** — specific signals detected:
- Timeout detected
- Slow test (failure duration vs baseline p95)
- Network error detected
- Locator instability detected
- Assertion failure pattern
- Consistent recent failures (all recent runs failed)
- Last error message (first 120 characters)

**History** — last 10 runs as a P/F sequence

**Classification** — primary and secondary category, confidence percentage, dominant cause across recent failures, and the action hint in yellow

If the test is quarantined, a **Quarantine Status block** appears at the bottom showing the quarantine date, reason, whether it was auto or manual, and the Restore Manually button.

---

## Taking Action: Quarantine and Restore

### Manually Quarantine a Test

Use this when you know a test is flaky and don't want to wait for the engine to accumulate enough data.

1. Find the test in the Flaky Tests tab
2. Click **Quarantine** in the Action column
3. Confirm the dialog
4. The test will be excluded from the next run's pass/fail decision

Manual quarantine sets `autoQuarantined: false`, which means the engine will **never** automatically restore it. You must restore it yourself.

### Manually Restore a Test

Use this when the underlying issue is fixed and you want to reactivate the test.

1. Find the test in the Flaky Tests tab (use the **Quarantined** filter)
2. Click **Restore** in the Action column — or expand the row and click **Restore Manually** inside the Quarantine Status block
3. Confirm the dialog
4. The test will count toward pass/fail from the next run onward

After restoring, the test's score remains elevated from its history. It will gradually decrease as clean runs accumulate — you do not need to reset anything manually.

---

## Configuring Flakiness Settings Per Suite

Every suite can override the project defaults for flakiness behaviour. Access this in the suite edit modal (Edit button on the Suites page → scroll to Flakiness Intelligence section).

### Settings Available

| Setting | Default | What it controls |
|---|---|---|
| Auto-quarantine threshold (%) | 30% | Fail rate at which a test is quarantined |
| Minimum runs before scoring | 5 | How many runs needed before any evaluation |
| Quarantine budget per run | 5 | Max quarantined failures before pipeline fails |
| Auto-promote: min pass rate (%) | 95% | Pass rate required across the promote window |

### Presets

Three built-in presets set the threshold for common suite types:
- **Smoke (20%)** — highest sensitivity, catches borderline flakiness early
- **Regression (30%)** — balanced default
- **E2E (40%)** — most tolerant, suitable for environment-sensitive end-to-end tests

Presets only change the threshold — other settings remain at their current values.

### Project Defaults vs Suite Overrides

The project-level defaults apply to all suites that don't have their own overrides. When you save a suite override, only that suite is affected. Other suites continue using the project defaults.

To remove a suite's overrides and go back to project defaults: click **Reset to Default** in the Flakiness Intelligence section of the suite edit modal.

---

## The Execution Report — Quarantined Tests Section

Every execution report now includes a **Quarantined Tests** section (collapsible, only visible when quarantined tests were present in that run).

It shows:
- The number of quarantined tests that ran
- Each test's result (PASSED or FAILED) with a clear "(quarantined)" label
- The test duration
- A summary line: "X quarantined failure(s) this run — these were NOT counted toward suite failure"

This section exists to make the system fully auditable. Nothing is hidden. If 3 tests failed but were quarantined, you see those 3 failures clearly — they just didn't change the suite result.

---

## Common Scenarios

### "The nightly build keeps failing and engineers are ignoring it"

1. Go to the Flaky Tests tab → sort by Score ▼
2. The problematic test is likely near the top with a high score and a red ↑ indicator
3. Expand the row — read the Classification and action hint
4. If it's a known intermittent issue: click **Quarantine** to protect the pipeline while the fix is investigated
5. Share the action hint and dominant cause with the developer responsible for the test

### "We have a release tomorrow and need a clean pipeline"

1. Go to the Flaky Tests tab → click the **Flagged** filter tab
2. Review each flagged test — check the classification and confidence
3. For tests with a clear intermittent pattern (high confidence, timing/network/environment cause): quarantine them
4. Run the suite — flagged tests are now excluded from the result
5. The execution report shows them in the Quarantined Tests section so the release is auditable

### "A test was quarantined but the bug is fixed"

1. Go to the Flaky Tests tab → **Quarantined** filter
2. Find the test → expand the row → read the quarantine reason
3. Click **Restore Manually**
4. Run the suite and monitor the test's sparkline over the next several runs
5. If the test stays green, the score will naturally decay toward 0 — no manual cleanup needed

### "I want stricter rules for our smoke suite"

1. Go to Suites → Edit the smoke suite
2. Scroll to Flakiness Intelligence → select preset **Smoke (20%)**
3. Click **Save Flakiness Config**
4. Any test failing more than 20% of the time in this suite will now be quarantined

---

## What the Feature Does NOT Do

- **Does not skip tests.** Quarantined tests always run. Their results are recorded — just excluded from the pass/fail gate.
- **Does not delete history.** All run data is preserved. Restoring a test does not wipe its score history.
- **Does not fix tests.** It identifies and isolates the problem. The action hints guide where to look, but a human must make the fix.
- **Does not quarantine consistently failing tests differently from flaky tests** (in v1). A test that always fails will have a high fail rate and will be quarantined. This is intentional — a consistently failing test also blocks your pipeline and should be isolated while it is fixed.
- **Does not send email or webhook notifications** in v1. Notifications are queued internally but not dispatched. This is planned for v2.

---

## Glossary

| Term | Definition |
|---|---|
| Flaky test | A test that passes and fails intermittently without code changes |
| Flake score | 0–1 composite score: 70% fail rate + 20% alternation + 10% variance |
| Fail rate | Weighted percentage of failures in the evaluation window (primary quarantine gate) |
| Threshold | The fail rate at which a test becomes quarantine-eligible (configurable per suite) |
| Quarantined | Test still runs but is excluded from suite pass/fail |
| Auto-quarantined | Quarantined by the engine automatically (can be auto-promoted) |
| Manually quarantined | Quarantined by a user (requires manual restore — engine never auto-promotes) |
| Auto-promote | Automatic restoration of a stable auto-quarantined test |
| Hysteresis | The 5% buffer that prevents rapid quarantine/restore oscillation |
| Cooldown | Minimum 3 runs between re-evaluation after a quarantine event |
| Budget | Max quarantined failures per run before the pipeline is force-failed |
| Confidence | Reliability indicator for the flake score (High/Med/Low) |
| Insufficient data | Fewer than 5 runs or fewer than 3 recent runs — test cannot be scored yet |
| Dominant category | Most common failure classification across recent failures |
| Evaluation window | The rolling 14-day window of run history used for scoring |
| Recent window | The rolling 7-day sub-window used for freshness checks and auto-promote |
