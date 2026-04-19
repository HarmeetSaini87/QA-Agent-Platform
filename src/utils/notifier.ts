/**
 * notifier.ts — Send suite run notifications via Email, Slack, Teams
 *
 * Called from server.ts after a suite run completes.
 * All channels are independently enabled/disabled in Admin → Settings → Notifications.
 *
 * Email:  SMTP via nodemailer
 * Slack:  Incoming Webhook (POST JSON)
 * Teams:  Power Automate / Office 365 Connector (POST JSON)
 */

import * as nodemailer from 'nodemailer';
import * as https     from 'https';
import * as http      from 'http';
import * as url       from 'url';
import { NotificationSettings } from '../data/types';

export interface RunSummary {
  runId:       string;
  suiteName:   string;
  projectName: string;
  status:      'done' | 'failed';
  passed:      number;
  failed:      number;
  total:       number;
  duration:    string;   // human-readable e.g. "1m 23s"
  startedAt:   string;
  executedBy:  string;
  environmentName: string;
  platformUrl: string;   // base URL of this platform instance e.g. http://qa-platform.local
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function passRate(s: RunSummary): string {
  if (!s.total) return '0%';
  return `${Math.round((s.passed / s.total) * 100)}%`;
}

function statusEmoji(s: RunSummary): string {
  return s.failed > 0 ? '🔴' : '🟢';
}

function reportUrl(s: RunSummary): string {
  return `${s.platformUrl}/execution-report?runId=${s.runId}`;
}

function postJson(webhookUrl: string, body: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload  = JSON.stringify(body);
    const parsed   = url.parse(webhookUrl);
    const isHttps  = parsed.protocol === 'https:';
    const options  = {
      hostname: parsed.hostname,
      path:     parsed.path,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = (isHttps ? https : http).request(options, res => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`Webhook responded ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Trigger check ─────────────────────────────────────────────────────────────

function shouldNotify(cfg: NotificationSettings, s: RunSummary): boolean {
  if (cfg.notifyOnAlways)  return true;
  if (cfg.notifyOnFailure && s.failed > 0) return true;
  if (cfg.notifyOnSuccess && s.failed === 0) return true;
  return false;
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendEmail(cfg: NotificationSettings, s: RunSummary): Promise<void> {
  if (!cfg.emailEnabled || !cfg.smtpHost || !cfg.emailTo) return;

  const transport = nodemailer.createTransport({
    host:   cfg.smtpHost,
    port:   cfg.smtpPort || 587,
    secure: cfg.smtpSecure,
    auth:   (cfg.smtpUser && cfg.smtpPass) ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined,
    tls:    { rejectUnauthorized: false },
  });

  const subject = `${statusEmoji(s)} [QA Platform] ${s.suiteName} — ${s.failed > 0 ? `${s.failed} FAILED` : 'ALL PASSED'} (${passRate(s)})`;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:${s.failed > 0 ? '#dc2626' : '#16a34a'};padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">${statusEmoji(s)} Suite Run ${s.failed > 0 ? 'Failed' : 'Passed'}</h2>
  </div>
  <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#6b7280;width:140px">Suite</td><td style="padding:6px 0;font-weight:600">${s.suiteName}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Project</td><td style="padding:6px 0">${s.projectName}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Environment</td><td style="padding:6px 0">${s.environmentName}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Executed By</td><td style="padding:6px 0">${s.executedBy}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Started</td><td style="padding:6px 0">${new Date(s.startedAt).toLocaleString()}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Duration</td><td style="padding:6px 0">${s.duration}</td></tr>
    </table>
    <div style="margin:16px 0;padding:12px 16px;background:#fff;border-radius:6px;border:1px solid #e5e7eb;display:flex;gap:24px;text-align:center">
      <div style="flex:1"><div style="font-size:28px;font-weight:700;color:#16a34a">${s.passed}</div><div style="font-size:12px;color:#6b7280">Passed</div></div>
      <div style="flex:1"><div style="font-size:28px;font-weight:700;color:${s.failed > 0 ? '#dc2626' : '#6b7280'}">${s.failed}</div><div style="font-size:12px;color:#6b7280">Failed</div></div>
      <div style="flex:1"><div style="font-size:28px;font-weight:700;color:#374151">${s.total}</div><div style="font-size:12px;color:#6b7280">Total</div></div>
      <div style="flex:1"><div style="font-size:28px;font-weight:700;color:#374151">${passRate(s)}</div><div style="font-size:12px;color:#6b7280">Pass Rate</div></div>
    </div>
    <a href="${reportUrl(s)}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">View Full Report →</a>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin-top:12px;text-align:center">QA Agent Platform · ${s.platformUrl}</p>
</div>`;

  await transport.sendMail({
    from:    cfg.emailFrom || cfg.smtpUser,
    to:      cfg.emailTo,
    subject,
    html,
  });
}

// ── Slack ─────────────────────────────────────────────────────────────────────

async function sendSlack(cfg: NotificationSettings, s: RunSummary): Promise<void> {
  if (!cfg.slackEnabled || !cfg.slackWebhook) return;

  const color = s.failed > 0 ? '#dc2626' : '#16a34a';
  const body = {
    attachments: [{
      color,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `${statusEmoji(s)} *${s.suiteName}* — ${s.failed > 0 ? `*${s.failed} test(s) FAILED*` : '*All tests passed*'} (${passRate(s)})` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Project*\n${s.projectName}` },
            { type: 'mrkdwn', text: `*Environment*\n${s.environmentName}` },
            { type: 'mrkdwn', text: `*Passed / Failed / Total*\n${s.passed} / ${s.failed} / ${s.total}` },
            { type: 'mrkdwn', text: `*Duration*\n${s.duration}` },
            { type: 'mrkdwn', text: `*Executed By*\n${s.executedBy}` },
            { type: 'mrkdwn', text: `*Started*\n${new Date(s.startedAt).toLocaleString()}` },
          ],
        },
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Report' }, url: reportUrl(s), style: 'primary' }],
        },
      ],
    }],
  };

  await postJson(cfg.slackWebhook, body);
}

// ── Microsoft Teams ───────────────────────────────────────────────────────────

async function sendTeams(cfg: NotificationSettings, s: RunSummary): Promise<void> {
  if (!cfg.teamsEnabled || !cfg.teamsWebhook) return;

  const color = s.failed > 0 ? 'attention' : 'good';
  const body = {
    type:        'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type:    'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: `${statusEmoji(s)} ${s.suiteName} — ${s.failed > 0 ? `${s.failed} FAILED` : 'ALL PASSED'} (${passRate(s)})`,
            weight: 'Bolder',
            size:   'Medium',
            color,
          },
          {
            type:    'FactSet',
            facts: [
              { title: 'Project',     value: s.projectName },
              { title: 'Environment', value: s.environmentName },
              { title: 'Passed',      value: String(s.passed) },
              { title: 'Failed',      value: String(s.failed) },
              { title: 'Total',       value: String(s.total) },
              { title: 'Duration',    value: s.duration },
              { title: 'Executed By', value: s.executedBy },
              { title: 'Started',     value: new Date(s.startedAt).toLocaleString() },
            ],
          },
        ],
        actions: [{ type: 'Action.OpenUrl', title: 'View Report', url: reportUrl(s) }],
      },
    }],
  };

  await postJson(cfg.teamsWebhook, body);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendRunNotification(cfg: NotificationSettings, s: RunSummary): Promise<{ email?: string; slack?: string; teams?: string }> {
  if (!shouldNotify(cfg, s)) return {};

  const errors: { email?: string; slack?: string; teams?: string } = {};

  await sendEmail(cfg, s).catch(e => { errors.email = e.message; });
  await sendSlack(cfg, s).catch(e => { errors.slack = e.message; });
  await sendTeams(cfg, s).catch(e => { errors.teams = e.message; });

  return errors;
}

/** Send a test notification to verify settings — sends to all enabled channels */
export async function sendTestNotification(cfg: NotificationSettings, platformUrl: string): Promise<{ email?: string; slack?: string; teams?: string }> {
  const dummy: RunSummary = {
    runId:           'test-notification',
    suiteName:       'Smoke Test Suite',
    projectName:     'Demo Project',
    status:          'done',
    passed:          8,
    failed:          2,
    total:           10,
    duration:        '45s',
    startedAt:       new Date().toISOString(),
    executedBy:      'admin',
    environmentName: 'UAT',
    platformUrl,
  };
  return sendRunNotification(cfg, dummy);
}

/** Format milliseconds into human-readable duration string */
export function formatDuration(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
