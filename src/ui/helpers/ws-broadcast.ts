import { WebSocket } from 'ws';
import type { WsOut } from './types';

export const subscribers = new Map<string, Set<WebSocket>>();

export function broadcast(runId: string, msg: WsOut): void {
  const subs = subscribers.get(runId);
  if (!subs?.size) return;
  const json = JSON.stringify(msg);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

export function subscribe(runId: string, ws: WebSocket): void {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId)!.add(ws);
}

export function unsubscribe(runId: string, ws: WebSocket): void {
  subscribers.get(runId)?.delete(ws);
}