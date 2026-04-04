/**
 * html.reporter.ts
 *
 * Generates a self-contained, single-file HTML report from a RunResult and
 * its originating TestPlan.  No external CSS/JS dependencies — everything is
 * inlined so the report can be archived, emailed, or opened from a file system.
 *
 * Features
 * ─────────
 * • Summary banner: pass/fail/skip counts + duration + source badge
 * • Jira traceability: per-test story link when `tc.sourceStoryId` is set
 * • Collapsible step detail per test case
 * • Heal events highlighted with diff (original → healed selector)
 * • Screenshots embedded as relative <img> paths (or absolute if absolute path)
 * • Fully responsive, no framework
 */

import * as fs   from 'fs';
import * as path from 'path';
import { RunResult, TestCaseResult, StepResult, HealEvent } from '../types/plan.types';
import { TestPlan, TestCase } from '../types/plan.types';

// ── Public API ────────────────────────────────────────────────────────────────

export interface ReportOptions {
  /** Absolute path where the .html file will be written */
  outputPath: string;
  /** The RunResult (from results/run-<id>.json) */
  runResult: RunResult;
  /** The originating TestPlan (from test-plans/<planId>-plan.json) */
  testPlan?: TestPlan;
  /** Jira base URL for deep-links  (e.g. https://company.atlassian.net) */
  jiraBaseUrl?: string;
}

export function generateHtmlReport(opts: ReportOptions): void {
  const html = buildReport(opts);
  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  fs.writeFileSync(opts.outputPath, html, 'utf-8');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function isoToLocal(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function statusIcon(status: string): string {
  if (status === 'pass') return '✔';
  if (status === 'fail') return '✗';
  return '⊘';
}

// ── Main builder ──────────────────────────────────────────────────────────────

function buildReport(opts: ReportOptions): string {
  const { runResult, testPlan, jiraBaseUrl } = opts;

  // Build lookup: testCaseId → TestCase (for extra metadata like tags, sourceStoryId)
  const tcMeta = new Map<string, TestCase>();
  for (const tc of (testPlan?.testCases ?? [])) tcMeta.set(tc.id, tc);

  const totalDurationMs = runResult.testResults.reduce((s, r) => s + r.durationMs, 0);
  const passRate = runResult.totalTests > 0
    ? Math.round((runResult.passed / runResult.totalTests) * 100)
    : 0;

  const sourceLabel: Record<string, string> = {
    excel: 'Excel Upload',
    jira: 'Jira Story',
    'prd-upload': 'PRD Upload',
    chat: 'Chat Instruction',
  };

  const src   = testPlan?.source ?? 'unknown';
  const srcLbl = sourceLabel[src] ?? src;
  const srcRef = testPlan?.sourceRef ?? runResult.planId;

  // Heal events summary
  const allHeals: Array<HealEvent & { tcId: string; stepNum: number }> = [];
  for (const tcr of runResult.testResults) {
    for (const step of tcr.steps) {
      if (step.healEvent) {
        allHeals.push({ ...step.healEvent, tcId: tcr.testCaseId, stepNum: step.stepNumber });
      }
    }
  }

  const healBanner = allHeals.length > 0
    ? `<div class="heal-banner">
        🔧 <strong>${allHeals.length} selector${allHeals.length > 1 ? 's' : ''} auto-healed</strong> during this run.
        <a href="#heals">View details ↓</a>
       </div>`
    : '';

  const testRows = runResult.testResults.map(tcr => buildTestRow(tcr, tcMeta, jiraBaseUrl)).join('\n');

  const healSection = allHeals.length > 0 ? buildHealSection(allHeals) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>QA Report — ${esc(runResult.runId)}</title>
<style>
${STYLES}
</style>
</head>
<body>

<header class="header">
  <div class="header-inner">
    <div class="header-brand">
      <span class="header-logo">QA Agent Platform</span>
      <span class="header-sub">Test Execution Report</span>
    </div>
    <div class="header-meta">
      <span class="meta-pill">Run: <code>${esc(runResult.runId)}</code></span>
      <span class="meta-pill">Plan: <code>${esc(runResult.planId)}</code></span>
      <span class="source-badge source-${esc(src)}">${esc(srcLbl)}: ${esc(srcRef)}</span>
    </div>
  </div>
</header>

<main class="content">

  ${healBanner}

  <!-- ── Summary ──────────────────────────────────────────────────────────── -->
  <section class="summary">
    <div class="stat-card total">
      <div class="stat-val">${runResult.totalTests}</div>
      <div class="stat-lbl">Total Tests</div>
    </div>
    <div class="stat-card pass">
      <div class="stat-val">${runResult.passed}</div>
      <div class="stat-lbl">Passed</div>
    </div>
    <div class="stat-card fail">
      <div class="stat-val">${runResult.failed}</div>
      <div class="stat-lbl">Failed</div>
    </div>
    <div class="stat-card skip">
      <div class="stat-val">${runResult.skipped}</div>
      <div class="stat-lbl">Skipped</div>
    </div>
    <div class="stat-card duration">
      <div class="stat-val">${formatDuration(totalDurationMs)}</div>
      <div class="stat-lbl">Total Duration</div>
    </div>
    <div class="stat-card rate ${passRate === 100 ? 'pass' : passRate >= 80 ? 'warn' : 'fail'}">
      <div class="stat-val">${passRate}%</div>
      <div class="stat-lbl">Pass Rate</div>
    </div>
  </section>

  <div class="run-dates">
    <span>Started: <strong>${isoToLocal(runResult.startedAt)}</strong></span>
    <span>Finished: <strong>${isoToLocal(runResult.finishedAt)}</strong></span>
  </div>

  <!-- ── Test results ──────────────────────────────────────────────────────── -->
  <section class="results-section">
    <h2>Test Results</h2>
    ${testRows}
  </section>

  ${healSection}

</main>

<footer class="footer">
  Generated by QA Agent Platform &nbsp;·&nbsp; ${new Date().toLocaleString()}
</footer>

<script>
${SCRIPTS}
</script>

</body>
</html>`;
}

// ── Per-test-case row (collapsible) ───────────────────────────────────────────

function buildTestRow(
  tcr: TestCaseResult,
  tcMeta: Map<string, TestCase>,
  jiraBaseUrl?: string,
): string {
  const tc      = tcMeta.get(tcr.testCaseId);
  const status  = tcr.status;
  const icon    = statusIcon(status);
  const dur     = formatDuration(tcr.durationMs);
  const healCnt = tcr.steps.filter(s => s.healEvent).length;
  const healTag = healCnt > 0
    ? `<span class="tag-heal" title="${healCnt} selector(s) healed">🔧 ${healCnt} healed</span>`
    : '';

  // Tags
  const tags = (tc?.tags ?? []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');

  // Jira deep-link
  let jiraLink = '';
  if (tc?.sourceStoryId && jiraBaseUrl) {
    jiraLink = `<a class="jira-link" href="${esc(jiraBaseUrl)}/browse/${esc(tc.sourceStoryId)}" target="_blank" rel="noopener">
      🔗 ${esc(tc.sourceStoryId)}
    </a>`;
  } else if (tc?.sourceStoryId) {
    jiraLink = `<span class="jira-id">${esc(tc.sourceStoryId)}</span>`;
  }

  // Priority badge
  const pri = tc?.priority ?? '';
  const priBadge = pri
    ? `<span class="priority priority-${esc(pri)}">${esc(pri)}</span>`
    : '';

  // Module
  const modBadge = tc?.module
    ? `<span class="module-badge">${esc(tc.module)}</span>`
    : '';

  const stepRows = tcr.steps.map(s => buildStepRow(s)).join('\n');

  const id = `tc-${esc(tcr.testCaseId)}`;

  return `
  <div class="tc-card tc-${status}" id="${id}">
    <button class="tc-header" onclick="toggleTC('${id}')" aria-expanded="false">
      <span class="tc-icon ${status}">${icon}</span>
      <span class="tc-id">${esc(tcr.testCaseId)}</span>
      <span class="tc-title">${esc(tcr.title)}</span>
      <div class="tc-badges">${priBadge}${modBadge}${jiraLink}${healTag}${tags}</div>
      <span class="tc-dur">${dur}</span>
      <span class="tc-chevron">▾</span>
    </button>
    <div class="tc-body" hidden>
      ${tc?.preconditions ? `<div class="preconditions"><strong>Preconditions:</strong> ${esc(tc.preconditions)}</div>` : ''}
      ${tc?.expectedResult ? `<div class="expected"><strong>Expected Result:</strong> ${esc(tc.expectedResult)}</div>` : ''}
      ${tc?.testData && Object.keys(tc.testData).length > 0 ? buildTestDataTable(tc.testData) : ''}
      <table class="step-table">
        <thead><tr><th>#</th><th>Action / Description</th><th>Status</th><th>Duration</th><th>Notes</th></tr></thead>
        <tbody>${stepRows}</tbody>
      </table>
    </div>
  </div>`;
}

function buildStepRow(step: StepResult): string {
  const status = step.status;
  const icon   = statusIcon(status);

  let notes = '';

  if (step.errorMessage) {
    notes += `<div class="step-error">${esc(step.errorMessage)}</div>`;
  }

  if (step.healEvent) {
    notes += buildHealInline(step.healEvent);
  }

  if (step.screenshotPath) {
    // Resolve path relative to project root so it works regardless of where
    // the report HTML file is stored.
    const absPath = path.isAbsolute(step.screenshotPath)
      ? step.screenshotPath
      : path.resolve(step.screenshotPath);

    if (fs.existsSync(absPath)) {
      // Embed as base64 data URI — makes the report fully self-contained
      const b64  = fs.readFileSync(absPath).toString('base64');
      const mime = absPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const src  = `data:${mime};base64,${b64}`;
      notes += `<div class="screenshot-wrap">
        <img src="${src}" alt="screenshot step ${step.stepNumber}" class="screenshot-thumb"
             onclick="this.classList.toggle('screenshot-full')" title="Click to expand"/>
      </div>`;
    } else {
      notes += `<div class="screenshot-missing">📷 Screenshot not found: ${esc(step.screenshotPath)}</div>`;
    }
  }

  return `<tr class="step-row step-${status}">
    <td class="step-num">${step.stepNumber}</td>
    <td class="step-desc">${esc(step.description)}</td>
    <td class="step-status ${status}">${icon}</td>
    <td class="step-dur">${formatDuration(step.durationMs)}</td>
    <td class="step-notes">${notes}</td>
  </tr>`;
}

function buildHealInline(heal: HealEvent): string {
  return `<div class="heal-inline">
    <span class="heal-badge confidence-${heal.confidence}">🔧 Healed (${esc(heal.confidence)})</span>
    <div class="heal-diff">
      <div class="heal-old"><span class="diff-label">Before:</span> <code>${esc(heal.originalSelector)}</code></div>
      <div class="heal-new"><span class="diff-label">After:</span> <code>${esc(heal.healedSelector)}</code></div>
    </div>
    ${heal.patched ? '<div class="heal-patched">✔ POM patched</div>' : '<div class="heal-not-patched">⚠ POM not patched</div>'}
  </div>`;
}

function buildTestDataTable(testData: Record<string, string>): string {
  const rows = Object.entries(testData)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
  return `<div class="testdata-wrap">
    <strong>Test Data</strong>
    <table class="testdata-table">
      <thead><tr><th>Field</th><th>Value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ── Heal summary section ───────────────────────────────────────────────────────

function buildHealSection(heals: Array<HealEvent & { tcId: string; stepNum: number }>): string {
  const rows = heals.map(h => `<tr>
    <td>${esc(h.tcId)}</td>
    <td>${h.stepNum}</td>
    <td><code>${esc(h.originalSelector)}</code></td>
    <td><code>${esc(h.healedSelector)}</code></td>
    <td><span class="heal-badge confidence-${h.confidence}">${esc(h.confidence)}</span></td>
    <td>${h.patched ? '✔ patched' : '—'}</td>
  </tr>`).join('');

  return `<section class="heals-section" id="heals">
    <h2>🔧 Auto-Healed Selectors</h2>
    <table class="heals-table">
      <thead><tr><th>TC</th><th>Step</th><th>Original Selector</th><th>Healed Selector</th><th>Confidence</th><th>POM</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

// ── Embedded styles ───────────────────────────────────────────────────────────

const STYLES = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;background:#f8fafc;color:#0f172a;line-height:1.5}

/* Header */
.header{background:#0f172a;padding:0;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.header-inner{max-width:1100px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.header-brand{display:flex;flex-direction:column;gap:2px}
.header-logo{font-size:15px;font-weight:700;color:#fff;letter-spacing:.3px}
.header-sub{font-size:11px;color:#64748b}
.header-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.meta-pill{font-size:11px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:3px 8px;color:#94a3b8}
.meta-pill code{font-family:monospace;color:#e2e8f0}

/* Content */
.content{max-width:1100px;margin:0 auto;padding:24px}

/* Heal banner */
.heal-banner{background:#fffbeb;border:1px solid #fde68a;border-left:3px solid #d97706;border-radius:6px;padding:10px 16px;font-size:13px;color:#92400e;margin-bottom:20px}
.heal-banner a{color:#b45309;font-weight:600}

/* Summary stats */
.summary{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.stat-card{flex:1;min-width:110px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.stat-val{font-size:28px;font-weight:700;line-height:1;color:#0f172a}
.stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
.stat-card.pass .stat-val{color:#16a34a}
.stat-card.fail .stat-val{color:#dc2626}
.stat-card.skip .stat-val{color:#d97706}
.stat-card.total .stat-val{color:#2563eb}
.stat-card.duration .stat-val{color:#0f172a;font-size:22px}
.stat-card.rate.pass .stat-val{color:#16a34a}
.stat-card.rate.warn .stat-val{color:#d97706}
.stat-card.rate.fail .stat-val{color:#dc2626}
.run-dates{font-size:12px;color:#64748b;margin-bottom:24px;display:flex;gap:20px}

/* Source badge */
.source-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px}
.source-excel{background:#f0fdf4;color:#15803d}
.source-jira{background:#eff6ff;color:#1d4ed8}
.source-prd-upload,.source-prd{background:#fdf4ff;color:#7e22ce}
.source-chat,.source-unknown{background:#f1f5f9;color:#475569}

/* Section headings */
h2{font-size:15px;font-weight:700;color:#334155;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}

/* Test case card */
.tc-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.tc-card.tc-fail{border-left:3px solid #dc2626}
.tc-card.tc-pass{border-left:3px solid #16a34a}
.tc-card.tc-skip{border-left:3px solid #d97706}

.tc-header{width:100%;background:transparent;border:none;padding:12px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit}
.tc-header:hover{background:#f8fafc}
.tc-icon{font-size:15px;font-weight:700;flex-shrink:0}
.tc-icon.pass{color:#16a34a}
.tc-icon.fail{color:#dc2626}
.tc-icon.skip{color:#d97706}
.tc-id{font-size:11px;font-weight:700;color:#64748b;flex-shrink:0;min-width:60px}
.tc-title{font-weight:600;color:#0f172a;flex:1}
.tc-badges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:4px}
.tc-dur{font-size:12px;color:#94a3b8;flex-shrink:0;margin-left:auto}
.tc-chevron{font-size:12px;color:#94a3b8;flex-shrink:0;transition:transform .2s}
.tc-header[aria-expanded="true"] .tc-chevron{transform:rotate(180deg)}

/* Tags */
.tag{display:inline-block;background:#f1f5f9;color:#475569;font-size:10px;font-weight:600;padding:1px 6px;border-radius:99px}
.tag-heal{display:inline-block;background:#fffbeb;color:#92400e;font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;border:1px solid #fde68a}
.jira-link,.jira-id{font-size:11px;font-weight:700;color:#2563eb;text-decoration:none;border:1px solid #bfdbfe;border-radius:4px;padding:1px 6px}
.jira-link:hover{background:#eff6ff}
.priority{display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px}
.priority-high{background:#fef2f2;color:#dc2626}
.priority-medium{background:#fffbeb;color:#d97706}
.priority-low{background:#f0fdf4;color:#16a34a}
.module-badge{display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px}

/* TC body */
.tc-body{padding:0 16px 16px}
.preconditions,.expected{font-size:12px;color:#475569;margin-bottom:8px;padding:8px 12px;background:#f8fafc;border-radius:4px}
.preconditions strong,.expected strong{color:#334155}

/* Test data */
.testdata-wrap{margin-bottom:12px;font-size:12px}
.testdata-wrap strong{display:block;margin-bottom:6px;color:#334155}
.testdata-table{border-collapse:collapse;font-size:12px}
.testdata-table td,.testdata-table th{padding:4px 12px;border:1px solid #e2e8f0;text-align:left}
.testdata-table th{background:#f8fafc;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#64748b}

/* Step table */
.step-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
.step-table th{text-align:left;padding:7px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
.step-table td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.step-row:last-child td{border-bottom:none}
.step-row.step-fail{background:#fef2f2}
.step-row.step-skip{background:#fffbeb}
.step-num{width:32px;font-weight:700;color:#94a3b8}
.step-desc{max-width:380px}
.step-status{width:36px;text-align:center;font-size:14px;font-weight:700}
.step-status.pass{color:#16a34a}
.step-status.fail{color:#dc2626}
.step-status.skip{color:#d97706}
.step-dur{width:70px;color:#94a3b8;white-space:nowrap}
.step-notes{color:#475569;font-size:12px}
.step-error{color:#dc2626;font-size:12px;margin-bottom:4px;white-space:pre-wrap;word-break:break-all}

/* Screenshot */
.screenshot-wrap{margin-top:4px}
.screenshot-thumb{max-width:320px;max-height:160px;border:1px solid #e2e8f0;border-radius:4px;display:block;cursor:zoom-in;transition:max-width .2s,max-height .2s}
.screenshot-thumb:hover{opacity:.9}
.screenshot-thumb.screenshot-full{max-width:100%;max-height:none;cursor:zoom-out}
.screenshot-missing{color:#94a3b8;font-size:11px;margin-top:4px;font-style:italic}

/* Heal inline */
.heal-inline{background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:7px 10px;margin-top:4px;font-size:11.5px}
.heal-badge{font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;display:inline-block;margin-bottom:5px}
.confidence-high{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}
.confidence-medium{background:#fffbeb;color:#b45309;border:1px solid #fde68a}
.confidence-low{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
.heal-diff{display:flex;flex-direction:column;gap:3px}
.heal-old,.heal-new{font-size:11.5px}
.heal-old{color:#b91c1c}
.heal-new{color:#15803d}
.diff-label{font-weight:700;min-width:46px;display:inline-block}
.heal-patched{color:#15803d;font-size:11px;margin-top:4px;font-weight:600}
.heal-not-patched{color:#b45309;font-size:11px;margin-top:4px}

/* Heals section */
.heals-section{margin-top:32px}
.heals-table{width:100%;border-collapse:collapse;font-size:12.5px}
.heals-table th{text-align:left;padding:7px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
.heals-table td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
.heals-table code{font-family:monospace;font-size:11.5px;background:#f1f5f9;padding:1px 5px;border-radius:3px}

/* Footer */
.footer{text-align:center;padding:24px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;margin-top:24px}

/* Responsive */
@media(max-width:700px){
  .summary{flex-direction:column}
  .tc-header{flex-wrap:wrap}
  .step-table{font-size:11.5px}
}
`;

// ── Embedded scripts ──────────────────────────────────────────────────────────

const SCRIPTS = `
function toggleTC(id) {
  var card   = document.getElementById(id);
  var btn    = card.querySelector('.tc-header');
  var body   = card.querySelector('.tc-body');
  var expanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!expanded));
  body.hidden = expanded;
}

// Auto-expand first failed test case
(function() {
  var first = document.querySelector('.tc-card.tc-fail');
  if (first) toggleTC(first.id);
})();
`;
