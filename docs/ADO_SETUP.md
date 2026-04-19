# Azure DevOps Setup Guide

Step-by-step instructions for connecting the QA Agent Platform pipeline to Azure DevOps, configuring secrets, and running Playwright tests in CI/CD.

---

## 1. Create the ADO project and import the repo

1. Go to **dev.azure.com → your organisation → New Project**
2. Import or push this repo:
   ```bash
   git remote add origin https://dev.azure.com/<org>/<project>/_git/qa-agent-platform
   git push -u origin main
   ```

---

## 2. Create the Variable Group `qa-agent-secrets`

All secrets are stored in a **Variable Group** — never hardcoded in YAML.

**Path:** Pipelines → Library → + Variable group

| Variable name     | Example value                      | Secret? |
|-------------------|------------------------------------|---------|
| `SESSION_SECRET`  | `your-strong-random-secret`        | Yes ✓   |
| `APP_BASE_URL`    | `https://your-app.example.com`     | No      |
| `APP_USERNAME`    | `automation@yourcompany.com`       | Yes ✓   |
| `APP_PASSWORD`    | `••••••••`                         | Yes ✓   |

> **Mark passwords and secrets as Secret** (padlock icon). Secret variables are masked in logs.

**Name the group exactly:** `qa-agent-secrets`

---

## 3. Create the pipeline

1. **Pipelines → New pipeline → Azure Repos Git → select this repo**
2. Select **Existing Azure Pipelines YAML file**
3. Branch: `main`, Path: `/azure-pipelines.yml`
4. Click **Continue → Save**
5. **Edit → Variables → Variable groups → Link variable group → qa-agent-secrets**

---

## 4. Grant pipeline permission to the variable group

When you first run, ADO may ask:
> *"This pipeline needs permission to access a resource before this run can continue."*

Click **Permit** on the `qa-agent-secrets` group.

To pre-approve: **Library → qa-agent-secrets → Pipeline permissions → + Add pipeline**

---

## 5. Set up a branch policy (PR gate)

To require green tests before merging to `main`:

1. **Repos → Branches → main → … → Branch policies**
2. **Build validation → + Add build policy**
   - Build pipeline: select this pipeline
   - Trigger: Automatic
   - Policy requirement: Required
   - Display name: `QA Agent Tests`
3. Save

---

## 6. Running the pipeline manually

**Pipelines → select pipeline → Run pipeline**

- Branch/tag: choose a feature branch to test it
- Variables can be overridden at runtime (non-secret only)

---

## 7. Viewing results

### Tests tab
JUnit results are published automatically:
**Pipelines → run → Tests**

Shows pass/fail counts, duration, failure messages.

### Artifacts

| Artifact | Contents |
|---|---|
| `playwright-html-report` | Playwright's interactive HTML report |
| `failure-screenshots` | PNG screenshots from failed steps |
| `playwright-traces` | `.zip` trace files — open with `npx playwright show-trace` |
| `run-results-json` | Raw JSON run records |

### Opening a trace
```bash
npx playwright show-trace trace.zip
```

---

## 8. Nightly schedule

Edit the `cron` line in `azure-pipelines.yml` to change the schedule:
```yaml
schedules:
  - cron: '0 2 * * *'   # 02:00 UTC every night
    displayName: Nightly regression
    branches:
      include:
        - main
    always: true
```

---

## 9. Environment-specific runs

**Override at runtime:**
Run pipeline → Variables → Add `APP_BASE_URL = https://staging.example.com`

**Separate pipeline per environment:**
Duplicate `azure-pipelines.yml` as `azure-pipelines-staging.yml`, change the `APP_BASE_URL` default.

---

## 10. Parallel test execution

Edit `playwright.config.ts`:
```ts
workers: isCI ? 4 : 1,
fullyParallel: true,   // only if tests are independent
```

Keep workers ≤ 4 on the free `ubuntu-latest` hosted agent (2 vCPUs). For larger suites, use a self-hosted agent.

---

## 11. Self-hosted agent setup (Windows Server)

For running against internal apps on the local network:

```powershell
# On the server machine
mkdir C:\agent && cd C:\agent
# Download the Windows agent from: dev.azure.com → Project Settings → Agent pools → New agent
.\config.cmd --url https://dev.azure.com/<org> --auth pat --token <PAT>
.\run.cmd
```

In `azure-pipelines.yml`:
```yaml
pool:
  name: 'My Self-Hosted Pool'
```

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Variable group not found` | Group name mismatch | Name must be exactly `qa-agent-secrets` |
| `APP_BASE_URL is undefined` | Variable not in group | Add it to the variable group |
| `tsc: error TS...` | TypeScript compile error | Run `npm run build` locally first |
| `Permission to access resource` | Variable group not linked | See step 4 — Permit or pre-approve |
| Tests fail on CI but pass locally | Headless mode differences | Check `HEADLESS=true` in CI env; add `--headed` flag for debugging |
| Nightly run not triggering | Branch filter wrong | Confirm `main` is in `schedules.branches.include` |

---

## 13. Secrets rotation

When rotating credentials:

1. Generate new value (e.g. new session secret or app password)
2. **Pipelines → Library → qa-agent-secrets**
3. Click the variable → update value → Save
4. No pipeline YAML changes required — secrets are resolved at runtime
