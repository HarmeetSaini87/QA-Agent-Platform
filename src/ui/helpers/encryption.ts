import * as crypto from 'crypto';
import type { CommonData } from '../../data/types';

const _secretKey = (() => {
  const raw = process.env.QA_SECRET_KEY || require('os').hostname() + '_qa_agent_v1';
  return crypto.createHash('sha256').update(raw).digest();
})();

export function encryptValue(plain: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', _secretKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:${iv.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptValue(stored: string): string {
  if (!stored.startsWith('enc:')) return stored;
  const parts = stored.split(':');
  if (parts.length < 3) return stored;
  try {
    const iv = Buffer.from(parts[1], 'hex');
    const enc = Buffer.from(parts.slice(2).join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', _secretKey, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch { return '***'; }
}

export function maskValue(stored: string): string {
  return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
}

export function cdForResponse(d: CommonData): object {
  return { ...d, value: d.sensitive ? maskValue(d.value) : d.value };
}