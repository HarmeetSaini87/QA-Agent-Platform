# QA Agent Platform — CI/CD & Docker Deployment Guide
# Created: 2026-04-17

---

## Overview

The platform uses machine fingerprint binding to prevent a license from running on unauthorized
machines. CI/CD pipelines (Jenkins, GitHub Actions, Azure DevOps) and Docker containers present
a challenge because their MAC addresses and hostnames change per run.

This guide covers how to deploy the platform in headless / containerized environments.

---

## CI/CD Mode — Bypassing Machine Check

Set the environment variable **before** starting the server:

```bash
export QA_SKIP_MACHINE_CHECK=1
node dist/ui/server.js
```

Or in Docker:

```dockerfile
ENV QA_SKIP_MACHINE_CHECK=1
```

**What this does:**
- Skips the machine fingerprint comparison at startup
- The server will log: `[license] Machine check bypassed (QA_SKIP_MACHINE_CHECK=1) — CI/Docker mode`
- Everything else (expiry, seat limits, feature gates) still applies

**Security note:** `QA_SKIP_MACHINE_CHECK=1` is intentionally documented — it is not a secret backdoor.
Machine binding is a convenience control, not a cryptographic guarantee. The RSA `.lic` file signature
and AES-256-GCM license storage still protect against key forgery and payload tampering.

---

## Recommended CI/CD Licensing Strategy

Use a **dedicated license key** for CI:

| Environment | License Tier | Machine Binding |
|-------------|-------------|-----------------|
| Production server | Team / Enterprise `.lic` | Yes — bound to prod machine |
| CI/CD pipeline | Starter HMAC key | `QA_SKIP_MACHINE_CHECK=1` |
| Docker QA environment | Starter HMAC key | `QA_SKIP_MACHINE_CHECK=1` |

Never use your production Enterprise `.lic` file in CI/CD — it is bound to a specific machine.
Request a separate Starter key for pipeline use from your vendor.

---

## Docker Deployment

### Minimal Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY src/data/ ./src/data/
RUN mkdir -p data

# CI/CD: skip machine binding (MAC changes per container)
ENV QA_SKIP_MACHINE_CHECK=1

# Encryption key for license.json — use a real secret in production
ENV QA_SECRET_KEY=change-me-to-a-real-secret-32chars

EXPOSE 3003
CMD ["node", "dist/ui/server.js"]
```

### Docker Compose (with persistent data)

```yaml
version: '3.8'
services:
  qa-agent:
    image: qa-agent-platform:latest
    ports:
      - "3003:3003"
    environment:
      - QA_SKIP_MACHINE_CHECK=1
      - QA_SECRET_KEY=${QA_SECRET_KEY}
      - QA_VENDOR_SECRET=${QA_VENDOR_SECRET}
    volumes:
      - qa-data:/app/data       # persist license.json + user data
      - qa-results:/app/results # persist test results

volumes:
  qa-data:
  qa-results:
```

**Critical:** Mount `data/` as a volume so `license.json` and `license.lic` survive container restarts.

---

## GitHub Actions Example

```yaml
name: QA Tests
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      QA_SKIP_MACHINE_CHECK: "1"
      QA_SECRET_KEY: ${{ secrets.QA_SECRET_KEY }}
      QA_VENDOR_SECRET: ${{ secrets.QA_VENDOR_SECRET }}

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build
      - run: npm run ui &         # start server in background
      - run: sleep 3              # wait for server ready
      - run: npx playwright test  # run your test suites
```

---

## Azure DevOps Pipeline

```yaml
pool:
  vmImage: 'ubuntu-latest'

variables:
  QA_SKIP_MACHINE_CHECK: '1'
  QA_SECRET_KEY: $(QA_SECRET_KEY)         # add as pipeline secret variable

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm ci && npm run build
    displayName: 'Build'

  - script: |
      nohup npm run ui &
      sleep 3
      npx playwright test
    displayName: 'Start server and run tests'
    env:
      QA_SKIP_MACHINE_CHECK: '1'
      QA_SECRET_KEY: $(QA_SECRET_KEY)
```

---

## Environment Variables Reference

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `QA_SKIP_MACHINE_CHECK` | Bypass machine fingerprint check | `0` | CI/Docker only |
| `QA_SECRET_KEY` | AES-256-GCM key for license.json encryption | `qa-agent-default-enc-key-32chars!` | **Yes in prod** |
| `QA_VENDOR_SECRET` | HMAC secret for Starter HMAC key validation | `qa-agent-platform-vendor-secret-v1` | **Yes in prod** |
| `QA_LICENSE_PUBLIC_KEY_B64` | Base64 RSA public key override (embedded at build for prod) | PLACEHOLDER | Phase 3 |
| `PORT` | HTTP port | `3003` | No |

**Security:** Always set `QA_SECRET_KEY` and `QA_VENDOR_SECRET` to strong, unique values in production.
Never use the defaults outside of local development.

---

## Multi-Instance / HA Cluster

For high-availability clusters (Enterprise, `maxInstances > 1`):

1. Vendor issues one `.lic` file per physical/virtual machine (each with its own `machineId`)
2. Each instance runs independently with its own `data/license.json`
3. No shared license state between instances — each instance validates locally
4. Seat counts are per-instance — for a 10-seat license on a 3-server cluster, each server
   enforces 10 seats independently (total potential = 30, but your `.lic` states intent)
5. Session sharing across instances requires an external session store (Phase 2 task)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `LICENSE ERROR: Machine fingerprint mismatch` | MAC/hostname changed | Set `QA_SKIP_MACHINE_CHECK=1` or use Admin → License → Transfer |
| `LICENSE ERROR: .lic file not found` | Volume not mounted or path changed | Ensure `data/` volume is mounted and persistent |
| `LICENSE ERROR: .lic file failed RSA verification` | File tampered or wrong machine | Re-upload `.lic` from vendor |
| Server starts but features 402 | License not activated | Admin → License → activate |
| `Decryption failed` in logs | `QA_SECRET_KEY` changed after activation | Re-activate license with new key |

---

## Triggering Suite Runs from Azure DevOps

### Overview

After a build deploys to QA/Staging, an ADO pipeline task calls the QA Agent Platform API to trigger a suite run and waits for it to complete. Exit code 0 = all tests passed; non-zero = failures (blocks the pipeline).

### Step 1 — Generate an API Key

1. Log in to QA Agent Platform as admin.
2. Go to **Admin → API Keys** → click **Generate Key**.
3. Name it (e.g. `ADO Pipeline — QA`), set Project Scope and expiry as needed.
4. Copy the raw key immediately (shown once).
5. Store it in ADO as a secret pipeline variable: `QA_API_KEY`.

### Step 2 — Find Your Suite ID

Run this once locally or via curl:

```bash
curl -s http://your-qa-platform/api/suites \
  -H "Authorization: Bearer <your-api-key>" | python -m json.tool
```

Note the `id` of the suite you want to trigger.

### Step 3 — ADO Pipeline YAML

Add this task after your deploy step. Replace `<SUITE_ID>` with your suite's ID and `<ENV_ID>` with the environment ID.

```yaml
- task: PowerShell@2
  displayName: 'Run QA Suite — wait for result'
  env:
    QA_API_KEY: $(QA_API_KEY)
  inputs:
    targetType: inline
    script: |
      $ErrorActionPreference = 'Stop'

      $platform  = 'http://your-qa-platform'   # ← your platform base URL
      $suiteId   = '<SUITE_ID>'                 # ← suite ID from Admin → Suites
      $envId     = '<ENV_ID>'                   # ← environment ID (from project environments)
      $headers   = @{ Authorization = "Bearer $env:QA_API_KEY"; 'Content-Type' = 'application/json' }
      $body      = @{ environmentId = $envId } | ConvertTo-Json

      # Trigger the run
      Write-Host "Triggering suite run..."
      $trigger = Invoke-RestMethod -Uri "$platform/api/suites/$suiteId/run" `
                   -Method POST -Headers $headers -Body $body
      $runId = $trigger.runId
      if (-not $runId) { Write-Error "No runId returned."; exit 1 }
      Write-Host "Run started: $runId"

      # Poll until done (max 30 min)
      $deadline = (Get-Date).AddMinutes(30)
      do {
        Start-Sleep -Seconds 5
        $run = Invoke-RestMethod -Uri "$platform/api/run/$runId" -Headers $headers
        Write-Host "[$($run.status)] passed=$($run.passed) failed=$($run.failed) total=$($run.total)"
        if ((Get-Date) -gt $deadline) { Write-Error "Timed out after 30 minutes."; exit 1 }
      } while ($run.status -eq 'running')

      # Evaluate result
      Write-Host "Run complete: $($run.status) — passed=$($run.passed) failed=$($run.failed)"
      if ($run.status -eq 'failed' -or $run.failed -gt 0) {
        Write-Error "QA suite FAILED ($($run.failed) test(s) failed)."
        exit 1
      }
      Write-Host "All tests passed."
      exit 0
```

### Notes

- The `Authorization: Bearer <key>` header bypasses browser session auth — safe for CI.
- Both `POST /api/suites/:id/run` and `GET /api/run/:runId` accept Bearer tokens.
- The pipeline task polls every 5 seconds. Adjust `Start-Sleep` for longer suites.
- If the platform is on a private network, ensure the ADO agent can reach it (same VNET or self-hosted agent).
- API keys can be scoped to a specific project or granted access to all projects.
- Revoke keys at any time via Admin → API Keys → Revoke.

---

## CI/CD Best Practices

### 1 — Use a Variable Group (not per-pipeline variables)

Store all QA platform config in an ADO **Library → Variable Group** (e.g. `qa-platform-config`).
Every pipeline links the group — no copy-pasting secrets across YAML files.

```yaml
variables:
  - group: qa-platform-config   # contains: QA_API_KEY, QA_PLATFORM_URL, QA_SUITE_ID_SMOKE, QA_SUITE_ID_REGRESSION, QA_ENV_ID
```

Recommended variable group keys:

| Variable | Example Value | Secret? |
|----------|--------------|---------|
| `QA_PLATFORM_URL` | `http://qa-agent.internal:3003` | No |
| `QA_API_KEY` | `a1b2c3d4...` | **Yes** |
| `QA_SUITE_ID_SMOKE` | `uuid-of-smoke-suite` | No |
| `QA_SUITE_ID_REGRESSION` | `uuid-of-full-suite` | No |
| `QA_ENV_ID_STAGING` | `uuid-of-staging-env` | No |
| `QA_ENV_ID_QA` | `uuid-of-qa-env` | No |

---

### 2 — Smoke-Gate Pattern (fast fail before full regression)

Run a small smoke suite (2–5 critical tests) first. Only proceed to full regression if smoke passes.
Avoids burning 20–30 minutes on a broken deploy.

```yaml
stages:
  - stage: Deploy
    jobs:
      - job: DeployToStaging
        steps:
          - script: echo "deploy steps here"

  - stage: SmokeTest
    dependsOn: Deploy
    jobs:
      - job: Smoke
        steps:
          - task: PowerShell@2
            displayName: 'Smoke Suite'
            env:
              QA_API_KEY: $(QA_API_KEY)
            inputs:
              targetType: inline
              script: |
                # (same poll script as above, but use QA_SUITE_ID_SMOKE + shorter timeout)
                $platform = '$(QA_PLATFORM_URL)'
                $suiteId  = '$(QA_SUITE_ID_SMOKE)'
                $envId    = '$(QA_ENV_ID_STAGING)'
                $headers  = @{ Authorization = "Bearer $env:QA_API_KEY"; 'Content-Type' = 'application/json' }
                $trigger  = Invoke-RestMethod -Uri "$platform/api/suites/$suiteId/run" `
                              -Method POST -Headers $headers `
                              -Body (@{ environmentId = $envId } | ConvertTo-Json)
                $runId = $trigger.runId
                $deadline = (Get-Date).AddMinutes(10)
                do {
                  Start-Sleep -Seconds 5
                  $run = Invoke-RestMethod -Uri "$platform/api/run/$runId" -Headers $headers
                } while ($run.status -eq 'running' -and (Get-Date) -lt $deadline)
                if ($run.failed -gt 0) { Write-Error "Smoke FAILED."; exit 1 }

  - stage: RegressionTest
    dependsOn: SmokeTest          # only runs if smoke passes
    jobs:
      - job: Regression
        timeoutInMinutes: 60
        steps:
          - task: PowerShell@2
            displayName: 'Full Regression Suite'
            env:
              QA_API_KEY: $(QA_API_KEY)
            inputs:
              targetType: inline
              script: |
                # (same poll script, use QA_SUITE_ID_REGRESSION + 30 min timeout)
```

---

### 3 — API Key Rotation (zero-downtime)

Rotate keys on a schedule (monthly recommended) without breaking pipelines:

1. **Admin → API Keys → Generate Key** — create a new key with the same name + scope.
2. Update the `QA_API_KEY` secret in the ADO Variable Group to the new key value.
3. Verify the next pipeline run succeeds with the new key.
4. **Admin → API Keys → Revoke** the old key.

> Never delete the old key before confirming the new one works — both can coexist.

**Expiry strategy:**
- Set a 90-day expiry when generating keys.
- ADO will fail loudly when an expired key is used — treat that as a rotation reminder.
- For automated rotation, script steps 1–4 using the admin API (requires an admin session — not suitable for Bearer-only auth; use a service account login for this purpose).

---

### 4 — Publish Report URL to ADO Pipeline Summary

After a run completes, write the report link to the ADO build summary so it's one-click from the pipeline result page.

Add this block after the poll loop in your PowerShell task:

```powershell
# Write report URL to ADO summary (visible in pipeline "Extensions" tab)
$reportUrl = "$platform/execution-report?runId=$runId"
Write-Host "##vso[task.addattachment type=Distributedtask.Core.Summary;name=QA Report]$reportUrl"

# Also echo as a plain link for the log
Write-Host "Report: $reportUrl"
```

For a clickable summary card, use an ADO Markdown summary file:

```powershell
$md = @"
## QA Suite Results

| Metric | Value |
|--------|-------|
| Status | $($run.status) |
| Passed | $($run.passed) |
| Failed | $($run.failed) |
| Total  | $($run.total) |

[Open Full Report]($reportUrl)
"@
$md | Out-File -FilePath "$(Agent.TempDirectory)/qa-summary.md" -Encoding utf8
Write-Host "##vso[task.uploadsummary]$(Agent.TempDirectory)/qa-summary.md"
```

---

### 5 — Environment-Gated Deployments (ADO Environments + Approvals)

Use ADO **Environments** with approval gates to enforce human sign-off before Prod:

```
Deploy → Staging
   ↓
QA Suite runs automatically (pipeline gate)
   ↓
Manual approval required (ADO Environment: Production)
   ↓
Deploy → Production
```

Setup:
1. In ADO, go to **Pipelines → Environments → New environment** → name it `Production`.
2. Add an **Approvals and Checks → Approvals** gate — assign your QA lead or release manager.
3. In your pipeline YAML, reference the environment on the Prod deploy job:

```yaml
- stage: DeployProd
  dependsOn: RegressionTest
  jobs:
    - deployment: DeployToProd
      environment: Production        # ← triggers approval gate
      strategy:
        runOnce:
          deploy:
            steps:
              - script: echo "prod deploy steps"
```

The QA suite result gates progression to the approval step — approvers see the QA report link in the summary before clicking approve.

---

### 6 — Playwright Retries vs Pipeline Retries

These are different mechanisms — use them for different failure modes:

| Setting | Where | Purpose | When to use |
|---------|-------|---------|-------------|
| `TestSuite.retries` (0/1/2) | QA Platform Suite config | Retry a **test** on DOM flakiness / timing issues | Intermittent UI race conditions |
| `continueOnError: false` | ADO pipeline task | Abort pipeline on any task failure | Default — always leave off |
| ADO job `retryCountOnTaskFailure` | Pipeline YAML | Retry the **entire pipeline job** on infra failure | Network blip, agent crash |

**Recommended:**
- Set `retries: 1` on suites running against staging (some UI timing variance expected).
- Set `retries: 0` on smoke suites — a flaky smoke means something is genuinely wrong.
- Do **not** set `retryCountOnTaskFailure` on the QA gate task — a retry would re-trigger a suite run, doubling execution time. Let it fail and investigate.

```yaml
- task: PowerShell@2
  displayName: 'Run QA Suite'
  retryCountOnTaskFailure: 0      # ← intentional: QA failures should not auto-retry
  env:
    QA_API_KEY: $(QA_API_KEY)
  inputs:
    targetType: inline
    script: |
      # ... poll script
```

