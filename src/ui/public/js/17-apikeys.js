// ══════════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

let _apikeyRawKey = null;
let _akAllSuites = [];
let _akAllProjects = [];
let _akGeneratedId = null;  // id returned after generation (for YAML suite/env fallback)

async function apikeyLoad() {
  const res = await fetch('/api/admin/apikeys');
  const keys = await res.json();
  const tbody = document.getElementById('apikey-tbody');
  if (!tbody) return;
  const projects = await _getProjects();
  tbody.innerHTML = keys.length === 0
    ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No API keys yet.</td></tr>'
    : keys.map(k => {
      const proj = projects.find(p => p.id === k.projectId);
      return `<tr>
          <td><strong>${escHtml(k.name)}</strong></td>
          <td><code>${escHtml(k.prefix)}…</code></td>
          <td>${proj ? escHtml(proj.name) : 'All projects'}</td>
          <td>${k.expiresAt ? formatDate(k.expiresAt) : 'Never'}</td>
          <td>${k.lastUsedAt ? formatDate(k.lastUsedAt) : '—'}</td>
          <td><button class="btn btn-danger btn-sm" onclick="apikeyDelete('${k.id}')">Revoke</button></td>
        </tr>`;
    }).join('');
}

async function _getProjects() {
  try { const r = await fetch('/api/projects'); return await r.json(); } catch { return []; }
}

async function _getSuites(projectId) {
  if (!projectId) return [];
  try {
    const r = await fetch(`/api/suites?projectId=${projectId}`);
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

async function apikeyOpenModal() {
  _apikeyRawKey = null;
  _akGeneratedId = null;

  // Reset form
  document.getElementById('ak-name').value = '';
  document.getElementById('ak-expires').value = '';
  document.getElementById('ak-suite').innerHTML = '<option value="">— select suite —</option>';
  document.getElementById('ak-env').innerHTML = '<option value="">— select environment —</option>';
  document.getElementById('ak-timeout').value = '30';
  document.getElementById('ak-poll').value = '5';
  document.getElementById('apikey-modal-alert').innerHTML = '';
  document.getElementById('apikey-result-block').style.display = 'none';
  document.getElementById('apikey-form-block').style.display = '';
  document.getElementById('ak-save-btn').style.display = '';
  document.getElementById('ak-modal-title').textContent = 'Generate API Key';
  document.getElementById('ak-copy-yaml-btn').disabled = true;
  document.getElementById('ak-dl-yaml-btn').disabled = true;
  document.getElementById('ak-yaml-preview').textContent = 'Configure the fields on the left to preview the generated YAML.';

  // Load projects first, then suites
  _akAllProjects = await _getProjects();
  _akAllSuites = [];

  const projSel = document.getElementById('ak-project');
  projSel.innerHTML = '<option value="">— select project —</option>' +
    _akAllProjects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  document.getElementById('modal-apikey').style.display = 'flex';
  _akYamlUpdate();
}

function _akPopulateSuites(projectId) {
  const list = projectId ? _akAllSuites.filter(s => s.projectId === projectId) : _akAllSuites;
  const sel = document.getElementById('ak-suite');
  sel.innerHTML = '<option value="">— select suite —</option>' +
    list.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  document.getElementById('ak-env').innerHTML = '<option value="">— select environment —</option>';
}

async function _akProjectChange() {
  const projectId = document.getElementById('ak-project').value;

  // Reset downstream selects
  document.getElementById('ak-suite').innerHTML = '<option value="">— loading… —</option>';
  document.getElementById('ak-env').innerHTML = '<option value="">— select environment —</option>';

  if (!projectId) {
    document.getElementById('ak-suite').innerHTML = '<option value="">— select suite —</option>';
    _akAllSuites = [];
    _akYamlUpdate();
    return;
  }

  // Fetch suites for this project directly
  _akAllSuites = await _getSuites(projectId);
  _akPopulateSuites(projectId);
  _akYamlUpdate();
}

function _akSuiteChange() {
  const suiteId = document.getElementById('ak-suite').value;
  const suite = _akAllSuites.find(s => s.id === suiteId);
  const envSel = document.getElementById('ak-env');
  envSel.innerHTML = '<option value="">— select environment —</option>';

  if (suite) {
    // Load environments from the suite's project
    const proj = _akAllProjects.find(p => p.id === suite.projectId);
    if (proj && proj.environments && proj.environments.length) {
      proj.environments.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${e.name} — ${e.url}`;
        // Pre-select if suite has a saved environmentId
        if (suite.environmentId && suite.environmentId === e.id) opt.selected = true;
        envSel.appendChild(opt);
      });
    }
  }
  _akYamlUpdate();
}

function _akYamlUpdate() {
  const platform = window.location.origin;
  const keyName = document.getElementById('ak-name').value.trim() || 'ADO Pipeline — QA';
  const suiteId = document.getElementById('ak-suite').value;
  const suiteName = suiteId ? ((_akAllSuites.find(s => s.id === suiteId) || {}).name || suiteId) : '<SUITE_ID>';
  const envId = document.getElementById('ak-env').value || '<ENV_ID>';
  const timeout = document.getElementById('ak-timeout').value || '30';
  const poll = document.getElementById('ak-poll').value || '5';
  const rawKey = _apikeyRawKey || '$(QA_API_KEY)';
  const suiteIdVal = suiteId || '<SUITE_ID>';

  // bash + curl - Linux ADO agents (ubuntu-latest)
  // Fixed: jq JSON, QA_PLATFORM_URL from var group, curl --retry
  const sh = [
    '      set -euo pipefail',
    "      trap 'echo \"ERROR: Script failed at line $LINENO\"' ERR",
    '      PLATFORM="${QA_PLATFORM_URL}"',
    "      SUITE_ID='" + suiteIdVal + "'",
    "      SUITE_NAME='" + suiteName.replace(/'/g, '') + "'",
    "      ENV_ID='" + envId + "'",
    '      TIMEOUT_SECS=$(( ' + timeout + ' * 60 ))',
    '      POLL_SECS=' + poll,
    '',
    '      if ! command -v jq >/dev/null 2>&1; then',
    '        echo "ERROR: jq is required but not installed on this agent"',
    '        exit 1',
    '      fi',
    '',
    '      AUTH_HEADER="Authorization: Bearer ${QA_API_KEY}"',
    '',
    '      echo "Triggering suite: ${SUITE_NAME}"',
    '      RESPONSE=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 -X POST "${PLATFORM}/api/suites/${SUITE_ID}/run" \\',
    '        -H "$AUTH_HEADER" \\',
    "        -H 'Content-Type: application/json' \\",
    '        -d \'{"environmentId":"\'${ENV_ID}\'"}\')',
    '',
    "      RUN_ID=$(echo \"$RESPONSE\" | jq -r '.runId // empty')",
    '      [ -z "$RUN_ID" ] && { echo "ERROR: No runId. Response: $RESPONSE"; exit 1; }',
    '      echo "Run ID: $RUN_ID"',
    '',
    '      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))',
    '      while true; do',
    '        if [ "$(date +%s)" -gt "$DEADLINE" ]; then',
    "          echo 'ERROR: Timed out after " + timeout + " min.'",
    '          exit 1',
    '        fi',
    '        sleep "$POLL_SECS"',
    '        [ "$POLL_SECS" -lt 30 ] && POLL_SECS=$(( POLL_SECS + 5 ))',
    '        [ "$POLL_SECS" -gt 30 ] && POLL_SECS=30',
    '        echo "Polling run status for RUN_ID=${RUN_ID} ..."',
    '        RUN=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 "${PLATFORM}/api/run/${RUN_ID}" \\',
    '          -H "$AUTH_HEADER")',
    "        STATUS=$(echo \"$RUN\" | jq -r '.status // \"unknown\"')",
    "        PASSED=$(echo \"$RUN\" | jq -r '.passed // 0')",
    "        FAILED=$(echo \"$RUN\" | jq -r '.failed // 0')",
    "        TOTAL=$( echo \"$RUN\" | jq -r '.total  // 0')",
    '        echo "[$STATUS] passed=${PASSED} | failed=${FAILED} | total=${TOTAL}"',
    '        case "$STATUS" in',
    "          running)   ;;",
    "          passed)    break ;;",
    "          failed)    break ;;",
    "          cancelled) echo 'Run was cancelled in TestForge.'; exit 1 ;;",
    '          *)         echo "ERROR: Unexpected status: $STATUS"; exit 1 ;;',
    '        esac',
    '      done',
    '      echo "Final Status: ${STATUS}"',
    '',
    '      REPORT_URL="${PLATFORM}/execution-report?runId=${RUN_ID}"',
    '      echo "Report: ${REPORT_URL}"',
    '',
    '      SUMMARY="${AGENT_TEMPDIRECTORY}/qa-summary.md"',
    '      printf \'## TestForge Results\\\\n**Suite:** %s\\\\n\\\\n\' "${SUITE_NAME}" > "$SUMMARY"',
    "      printf '| | |\\\\n|---|---|\\\\n' >> \"$SUMMARY\"",
    '      printf \'| Status | %s |\\\\n\' "$STATUS"  >> "$SUMMARY"',
    '      printf \'| Passed | %s |\\\\n\' "$PASSED"  >> "$SUMMARY"',
    '      printf \'| Failed | %s |\\\\n\' "$FAILED"  >> "$SUMMARY"',
    '      printf \'| Total  | %s |\\\\n\' "$TOTAL"   >> "$SUMMARY"',
    '      printf \'\\\\n[Open Report](%s)\\\\n\' "$REPORT_URL" >> "$SUMMARY"',
    '      echo "##vso[task.uploadsummary]${SUMMARY}"',
    '',
    "      if [ \"$STATUS\" = 'failed' ] || [ \"${FAILED}\" -gt 0 ]; then",
    '        echo "ERROR: Suite FAILED (${FAILED} test(s) failed)."',
    '        exit 1',
    '      fi',
    "      echo 'All tests passed.'",
  ].join('\n');

  // Reusable ADO template content (second download button)
  const templateYaml =
    "# testforge-run-template.yml\n"
  "# Drop in your repo root. Reference from any pipeline via:\n"
  "#   - template: testforge-run-template.yml\n"
  "#     parameters:\n"
  "#       suiteName: My Suite\n"
  "#       suiteId: <id>\n"
  "#       envId: <env>\n"
  "# Variable Group 'qa-platform-config' must have:\n"
  "#   QA_API_KEY      - secret, from TestForge Admin > API Keys\n"
  "#   QA_PLATFORM_URL - TestForge server base URL\n"
  "\n"
  "parameters:\n"
  "  - name: suiteName\n"
  "    type: string\n"
  "  - name: suiteId\n"
  "    type: string\n"
  "  - name: envId\n"
  "    type: string\n"
  "  - name: timeoutMinutes\n"
  "    type: number\n"
  "    default: 30\n"
  "  - name: pollSeconds\n"
  "    type: number\n"
  "    default: 5\n"
  "\n"
  "steps:\n"
  "- task: Bash@3\n"
  "  displayName: 'TestForge \u2014 ${{ parameters.suiteName }}'\n"
  "  env:\n"
  "    QA_API_KEY:      $(QA_API_KEY)\n"
  "    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\n"
  "  inputs:\n"
  "    targetType: inline\n"
  "    script: |\n"
  "      set -euo pipefail\n"
  "      trap 'echo \"ERROR: Script failed at line $LINENO\"' ERR\n"
  "      PLATFORM=\"${QA_PLATFORM_URL}\"\n"
  "      SUITE_ID='${{ parameters.suiteId }}'\n"
  "      ENV_ID='${{ parameters.envId }}'\n"
  "      TIMEOUT_SECS=$(( ${{ parameters.timeoutMinutes }} * 60 ))\n"
  "      POLL_SECS=${{ parameters.pollSeconds }}\n"
  "      if ! command -v jq >/dev/null 2>&1; then\n"
  "        echo \"ERROR: jq is required but not installed on this agent\"\n"
  "        exit 1\n"
  "      fi\n"
  "      AUTH_HEADER=\"Authorization: Bearer ${QA_API_KEY}\"\n"
  "      echo 'Triggering: ${{ parameters.suiteName }}'\n"
  "      RESPONSE=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 -X POST \"${PLATFORM}/api/suites/${SUITE_ID}/run\" \\\n"
  "        -H \"$AUTH_HEADER\" \\\n"
  "        -H 'Content-Type: application/json' \\\n"
  "        -d '{\"environmentId\":\"${{ parameters.envId }}\"}')\n"
  "      RUN_ID=$(echo \"$RESPONSE\" | jq -r '.runId // empty')\n"
  "      [ -z \"$RUN_ID\" ] && { echo \"ERROR: No runId. Response: $RESPONSE\"; exit 1; }\n"
  "      echo \"Run ID: $RUN_ID\"\n"
  "      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))\n"
  "      while true; do\n"
  "        if [ \"$(date +%s)\" -gt \"$DEADLINE\" ]; then\n"
  "          echo 'ERROR: Timed out.'; exit 1\n"
  "        fi\n"
  "        sleep \"$POLL_SECS\"\n"
  "        [ \"$POLL_SECS\" -lt 30 ] && POLL_SECS=$(( POLL_SECS + 5 ))\n"
  "        [ \"$POLL_SECS\" -gt 30 ] && POLL_SECS=30\n"
  "        echo \"Polling run status for RUN_ID=${RUN_ID} ...\"\n"
  "        RUN=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 \"${PLATFORM}/api/run/${RUN_ID}\" \\\n"
  "          -H \"$AUTH_HEADER\")\n"
  "        STATUS=$(echo \"$RUN\" | jq -r '.status // \"unknown\"')\n"
  "        PASSED=$(echo \"$RUN\" | jq -r '.passed // 0')\n"
  "        FAILED=$(echo \"$RUN\" | jq -r '.failed // 0')\n"
  "        TOTAL=$( echo \"$RUN\" | jq -r '.total  // 0')\n"
  "        echo \"[$STATUS] passed=${PASSED} | failed=${FAILED} | total=${TOTAL}\"\n"
  "        case \"$STATUS\" in\n"
  "          running)   ;;\n"
  "          passed)    break ;;\n"
  "          failed)    break ;;\n"
  "          cancelled) echo 'Run was cancelled in TestForge.'; exit 1 ;;\n"
  "          *)         echo \"ERROR: Unexpected status: $STATUS\"; exit 1 ;;\n"
  "        esac\n"
  "      done\n"
  "      echo \"Final Status: ${STATUS}\"\n"
  "      if [ \"$STATUS\" = 'failed' ] || [ \"${FAILED}\" -gt 0 ]; then\n"
  "        echo \"ERROR: Suite FAILED (${FAILED} test(s) failed).\"; exit 1\n"
  "      fi\n"
  "      echo 'All tests passed.'\n";

  const yaml =
    "# Generated by TestForge \u2014 " + new Date().toISOString().slice(0, 10) + "\n" +
    "# Inline pipeline step. For reuse across suites, download testforge-run-template.yml.\n" +
    "# Variable Group 'qa-platform-config' must contain:\n" +
    "#   QA_API_KEY:      (secret) API key from TestForge Admin > API Keys\n" +
    "#   QA_PLATFORM_URL: " + platform + "\n" +
    (_apikeyRawKey ? "# QA_API_KEY value: " + rawKey + "\n" : "") +
    "\n" +
    "variables:\n" +
    "  - group: qa-platform-config\n" +
    "\n" +
    "- task: Bash@3\n" +
    "  displayName: 'TestForge Suite \u2014 " + suiteName.replace(/'/g, "''") + "'\n" +
    "  env:\n" +
    "    QA_API_KEY:      $(QA_API_KEY)\n" +
    "    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\n" +
    "  inputs:\n" +
    "    targetType: inline\n" +
    "    script: |\n" +
    sh;


  document.getElementById('ak-yaml-preview').textContent = yaml;

  // Enable copy/download if suite is selected
  const canExport = !!suiteId;
  document.getElementById('ak-copy-yaml-btn').disabled = !canExport;
  document.getElementById('ak-dl-yaml-btn').disabled = !canExport;
}

function apikeyCloseModal() {
  document.getElementById('modal-apikey').style.display = 'none';
  if (_apikeyRawKey) apikeyLoad();
}

function apikeyCopyKey() {
  if (!_apikeyRawKey) return;
  const btn = document.querySelector('#apikey-result-block .btn');
  const orig = btn ? btn.textContent : 'Copy';
  const succeed = () => { if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = orig; }, 1800); } };
  const fail = () => { if (btn) { btn.textContent = 'Select + Ctrl+C'; setTimeout(() => { btn.textContent = orig; }, 2500); } };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(_apikeyRawKey).then(succeed).catch(() => _akCopyFallback(_apikeyRawKey, succeed, fail));
  } else {
    _akCopyFallback(_apikeyRawKey, succeed, fail);
  }
}

function _akCopyYaml() {
  const yaml = document.getElementById('ak-yaml-preview').textContent;
  const btn = document.getElementById('ak-copy-yaml-btn');
  const orig = btn.textContent;

  const succeed = () => { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = orig; }, 1800); };
  const fail = () => { btn.textContent = 'Select + Ctrl+C'; setTimeout(() => { btn.textContent = orig; }, 2500); };

  // Modern clipboard API (HTTPS / localhost)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(yaml).then(succeed).catch(() => _akCopyFallback(yaml, succeed, fail));
  } else {
    _akCopyFallback(yaml, succeed, fail);
  }
}

function _akCopyFallback(text, succeed, fail) {
  // execCommand fallback — works over HTTP on internal networks
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand('copy');
    ok ? succeed() : fail();
  } catch { fail(); }
  document.body.removeChild(ta);
}

function _akDownloadYaml() {
  const yaml = document.getElementById('ak-yaml-preview').textContent;
  const suiteSel = document.getElementById('ak-suite');
  const suiteName = suiteSel.options[suiteSel.selectedIndex]?.text || 'qa-suite';
  const safeName = suiteName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `testforge-pipeline-${safeName}.yml`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function _akDownloadTemplate() {
  const suiteIdVal = (document.getElementById('ak-suite') || {}).value || '';
  const envId = (document.getElementById('ak-env') || {}).value || '';
  const timeout = (document.getElementById('ak-timeout') || {}).value || '30';
  const poll = (document.getElementById('ak-poll') || {}).value || '5';
  const suiteSel = document.getElementById('ak-suite');
  const suiteName = suiteSel?.options[suiteSel.selectedIndex]?.text || 'My Suite';

  // Build template — uses ADO ${{ parameters.x }} syntax, not runtime values
  const content = _akBuildTemplateYaml();
  const blob = new Blob([content], { type: 'text/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'testforge-run-template.yml';
  a.click();
  URL.revokeObjectURL(a.href);
}

function _akBuildTemplateYaml() {
  const suiteIdVal = (document.getElementById('ak-suite') || {}).value || '<suite-id>';
  const envId = (document.getElementById('ak-env') || {}).value || '<env-id>';
  const suiteSel = document.getElementById('ak-suite');
  const suiteName = suiteSel?.options[suiteSel.selectedIndex]?.text || 'My Suite';

  // templateYaml is defined in _akYamlUpdate scope — rebuild inline
  return (
    "# testforge-run-template.yml\n" +
    "# Drop in your repo root. Reference from any pipeline via:\n" +
    "#   - template: testforge-run-template.yml\n" +
    "#     parameters:\n" +
    "#       suiteName: " + suiteName + "\n" +
    "#       suiteId: " + suiteIdVal + "\n" +
    "#       envId: " + envId + "\n" +
    "# Variable Group 'qa-platform-config' must have:\n" +
    "#   QA_API_KEY      - secret, from TestForge Admin > API Keys\n" +
    "#   QA_PLATFORM_URL - " + window.location.origin + "\n" +
    "\n" +
    "parameters:\n" +
    "  - name: suiteName\n" +
    "    type: string\n" +
    "  - name: suiteId\n" +
    "    type: string\n" +
    "  - name: envId\n" +
    "    type: string\n" +
    "  - name: timeoutMinutes\n" +
    "    type: number\n" +
    "    default: 30\n" +
    "  - name: pollSeconds\n" +
    "    type: number\n" +
    "    default: 5\n" +
    "\n" +
    "steps:\n" +
    "- task: Bash@3\n" +
    "  displayName: 'TestForge — ${{ parameters.suiteName }}'\n" +
    "  env:\n" +
    "    QA_API_KEY:      $(QA_API_KEY)\n" +
    "    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\n" +
    "  inputs:\n" +
    "    targetType: inline\n" +
    "    script: |\n" +
    "      set -euo pipefail\n" +
    "      trap 'echo \"ERROR: Script failed at line $LINENO\"' ERR\n" +
    "      PLATFORM=\"${QA_PLATFORM_URL}\"\n" +
    "      SUITE_ID='${{ parameters.suiteId }}'\n" +
    "      ENV_ID='${{ parameters.envId }}'\n" +
    "      TIMEOUT_SECS=$(( ${{ parameters.timeoutMinutes }} * 60 ))\n" +
    "      POLL_SECS=${{ parameters.pollSeconds }}\n" +
    "      if ! command -v jq >/dev/null 2>&1; then\n" +
    "        echo \"ERROR: jq is required but not installed on this agent\"\n" +
    "        exit 1\n" +
    "      fi\n" +
    "      AUTH_HEADER=\"Authorization: Bearer ${QA_API_KEY}\"\n" +
    "      echo 'Triggering: ${{ parameters.suiteName }}'\n" +
    "      RESPONSE=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 -X POST \"${PLATFORM}/api/suites/${SUITE_ID}/run\" \\\n" +
    "        -H \"$AUTH_HEADER\" \\\n" +
    "        -H 'Content-Type: application/json' \\\n" +
    "        -d '{\"environmentId\":\"${{ parameters.envId }}\"}')\n" +
    "      RUN_ID=$(echo \"$RESPONSE\" | jq -r '.runId // empty')\n" +
    "      [ -z \"$RUN_ID\" ] && { echo \"ERROR: No runId. Response: $RESPONSE\"; exit 1; }\n" +
    "      echo \"Run ID: $RUN_ID\"\n" +
    "      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))\n" +
    "      while true; do\n" +
    "        if [ \"$(date +%s)\" -gt \"$DEADLINE\" ]; then\n" +
    "          echo 'ERROR: Timed out.'; exit 1\n" +
    "        fi\n" +
    "        sleep \"$POLL_SECS\"\n" +
    "        [ \"$POLL_SECS\" -lt 30 ] && POLL_SECS=$(( POLL_SECS + 5 ))\n" +
    "        [ \"$POLL_SECS\" -gt 30 ] && POLL_SECS=30\n" +
    "        echo \"Polling run status for RUN_ID=${RUN_ID} ...\"\n" +
    "        RUN=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 \"${PLATFORM}/api/run/${RUN_ID}\" \\\n" +
    "          -H \"$AUTH_HEADER\")\n" +
    "        STATUS=$(echo \"$RUN\" | jq -r '.status // \"unknown\"')\n" +
    "        PASSED=$(echo \"$RUN\" | jq -r '.passed // 0')\n" +
    "        FAILED=$(echo \"$RUN\" | jq -r '.failed // 0')\n" +
    "        TOTAL=$( echo \"$RUN\" | jq -r '.total  // 0')\n" +
    "        echo \"[$STATUS] passed=${PASSED} | failed=${FAILED} | total=${TOTAL}\"\n" +
    "        case \"$STATUS\" in\n" +
    "          running)   ;;\n" +
    "          passed)    break ;;\n" +
    "          failed)    break ;;\n" +
    "          cancelled) echo 'Run was cancelled in TestForge.'; exit 1 ;;\n" +
    "          *)         echo \"ERROR: Unexpected status: $STATUS\"; exit 1 ;;\n" +
    "        esac\n" +
    "      done\n" +
    "      echo \"Final Status: ${STATUS}\"\n" +
    "      if [ \"$STATUS\" = 'failed' ] || [ \"${FAILED}\" -gt 0 ]; then\n" +
    "        echo \"ERROR: Suite FAILED (${FAILED} test(s) failed).\"; exit 1\n" +
    "      fi\n" +
    "      echo 'All tests passed.'\n"
  );
}

async function apikeySave() {
  const name = document.getElementById('ak-name').value.trim();
  const projectId = document.getElementById('ak-project').value || null;
  const expiresIn = document.getElementById('ak-expires').value;
  const alertEl = document.getElementById('apikey-modal-alert');

  if (!name) { alertEl.innerHTML = '<div class="alert alert-error">Key name is required.</div>'; return; }
  if (!projectId) { alertEl.innerHTML = '<div class="alert alert-error">Project scope is required.</div>'; return; }

  let expiresAt = null;
  if (expiresIn) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiresIn));
    expiresAt = d.toISOString();
  }

  const res = await fetch('/api/admin/apikeys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, projectId, expiresAt })
  });
  const data = await res.json();
  if (!res.ok) { alertEl.innerHTML = `<div class="alert alert-error">${escHtml(data.error || 'Error')}</div>`; return; }

  _apikeyRawKey = data.key;
  _akGeneratedId = data.id;

  document.getElementById('apikey-raw-display').textContent = data.key;
  document.getElementById('apikey-result-block').style.display = '';
  document.getElementById('ak-save-btn').style.display = 'none';
  document.getElementById('ak-modal-title').textContent = 'Key Generated — Save YAML';

  // Refresh YAML with real key value embedded
  _akYamlUpdate();
}

async function apikeyDelete(id) {
  if (!confirm('Revoke this API key? Any pipelines using it will stop working.')) return;
  await fetch(`/api/admin/apikeys/${id}`, { method: 'DELETE' });
  apikeyLoad();
}

