import * as path from 'path';
import * as fs from 'fs';
import { config } from '../../framework/config';
import { JiraClient } from '../../utils/jiraClient';
import {
  loadJiraConfig, saveJiraConfig,
} from '../../utils/defectsStore';

function _jiraCryptoKey(): Buffer {
  const secret = process.env.SESSION_SECRET || 'qa-agent-platform-default-secret';
  return require('crypto').createHash('sha256').update('jira-token-key:' + secret).digest();
}

export function jiraEncryptToken(plain: string): string {
  const crypto = require('crypto');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', _jiraCryptoKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function jiraDecryptToken(envelope: string): string {
  const crypto = require('crypto');
  const [ivB64, tagB64, encB64] = envelope.split('.');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('Invalid encrypted token envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', _jiraCryptoKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}

export function getJiraClient(): JiraClient | null {
  const cfg = loadJiraConfig();
  let baseUrl = cfg?.baseUrl || config.jira.baseUrl;
  let email = cfg?.email || config.jira.email;
  let apiToken = config.jira.apiToken;
  if (cfg?.apiTokenEnc) {
    try { apiToken = jiraDecryptToken(cfg.apiTokenEnc); }
    catch (e: any) { /* fallback to .env */ }
  }
  if (!baseUrl || !email || !apiToken) return null;
  baseUrl = baseUrl.replace(/\/$/, '');
  return new JiraClient({ baseUrl, email, apiToken });
}

export function readArtifactBuffer(relPath: string, maxBytes: number): { buffer: Buffer; size: number; tooLarge: boolean } | null {
  if (!relPath) return null;
  const baseDir = path.resolve((config.paths && (config.paths as any).testResults) || 'test-results');
  const stripped = relPath.replace(/^test-results[\\/]/, '');
  const resolved = path.resolve(baseDir, stripped);
  if (!resolved.toLowerCase().startsWith((baseDir + path.sep).toLowerCase())) return null;
  let stat: import('fs').Stats;
  try { stat = fs.statSync(resolved); } catch { return null; }
  if (stat.size > maxBytes) return { buffer: Buffer.alloc(0), size: stat.size, tooLarge: true };
  return { buffer: fs.readFileSync(resolved), size: stat.size, tooLarge: false };
}

export function firstNLines(s: string, n: number): string {
  if (!s) return '';
  return s.split(/\r?\n/).slice(0, n).join('\n');
}