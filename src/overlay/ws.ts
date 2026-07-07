import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import type { Hub } from '../core/hub';
import { prisma } from '../db';
import { logger } from '../logger';

/** Registers the overlay WebSocket route: /ws/overlay?token=... */
export function registerOverlayWs(app: FastifyInstance, hub: Hub): void {
  app.get<{ Querystring: { token?: string } }>(
    '/ws/overlay',
    { websocket: true },
    async (socket: WebSocket, req) => {
      const token = req.query?.token;
      if (!token) {
        socket.close(1008, 'missing token');
        return;
      }
      const user = await prisma.user.findUnique({ where: { overlayToken: token } });
      if (!user) {
        socket.close(1008, 'invalid token');
        return;
      }

      try {
        await hub.addOverlay(user.id, socket);
      } catch (err) {
        logger.error('[overlay] addOverlay failed:', (err as Error).message);
        socket.close(1011, 'server error');
        return;
      }

      socket.on('close', () => hub.removeOverlay(user.id, socket));
      socket.on('error', () => hub.removeOverlay(user.id, socket));
      // Overlay is receive-only; ignore any inbound frames.
    },
  );
}
