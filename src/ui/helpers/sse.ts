import type { ServerResponse } from 'http';
import type { RecorderSession, DebugSession } from './types';
import { logger } from '../../utils/logger';

export const debugSseClients = new Map<string, Set<ServerResponse>>();

export function sseSessionPush(sessionId: string, event: string, payload: object): void {
  const clients = debugSseClients.get(sessionId);
  if (!clients?.size) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach(res => { try { res.write(data); } catch { /* client disconnected */ } });
}

export const recorderSessions = new Map<string, RecorderSession>();

export function recorderSsePush(token: string, event: string, payload: object): void {
  const session = recorderSessions.get(token);
  if (!session?.sseClients.size) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  session.sseClients.forEach(res => { try { res.write(data); } catch { } });
}

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of recorderSessions) {
    const inactive = now - s.lastActivity > 30 * 60 * 1000;
    const hardCap = now - s.createdAt > 2 * 60 * 60 * 1000;
    if (inactive || hardCap) {
      s.sseClients.forEach(res => { try { res.end(); } catch { } });
      recorderSessions.delete(token);
      logger.info(`[recorder] Session expired (${inactive ? 'inactivity' : 'hard cap'}): ${token.slice(0, 8)}`);
    }
  }
}, 60_000);