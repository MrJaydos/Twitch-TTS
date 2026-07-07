import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import type { Hub, ActivityEntry } from '../core/hub';
import { getUserId } from '../auth/session';

/**
 * Authenticated dashboard WebSocket. Streams this user's activity log
 * (spoken / test / skip / clear events) for the live view.
 */
export function registerDashboardWs(app: FastifyInstance, hub: Hub): void {
  app.get('/ws/dashboard', { websocket: true }, (socket: WebSocket, req) => {
    const uid = getUserId(req);
    if (!uid) {
      socket.close(1008, 'unauthorized');
      return;
    }

    const listener = (userId: string, entry: ActivityEntry) => {
      if (userId !== uid) return;
      try {
        socket.send(JSON.stringify({ type: 'activity', entry }));
      } catch {
        /* ignore */
      }
    };

    hub.on('activity', listener);
    socket.on('close', () => hub.off('activity', listener));
    socket.on('error', () => hub.off('activity', listener));
  });
}
