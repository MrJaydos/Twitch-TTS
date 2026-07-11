import path from 'path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';

import { config } from './config';
import { logger } from './logger';
import { ChatManager } from './twitch/chat-manager';
import { Hub } from './core/hub';
import { registerAuth } from './auth/twitch-oauth';
import { registerSettingsRoutes } from './settings/routes';
import { registerOverlayWs } from './overlay/ws';
import { registerDashboardWs } from './dashboard/ws';
import { ensureDir, startGc } from './tts/audio-store';
import { piperHealthy } from './tts/piper-client';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const APP_DIR = path.join(PUBLIC_DIR, 'app');

async function main(): Promise<void> {
  await ensureDir();
  startGc();

  const chat = new ChatManager();
  const hub = new Hub(chat);

  const app = Fastify({ logger: false, trustProxy: true });

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(websocket);

  // ── Auth (Twitch OAuth) ──
  await registerAuth(app);

  // ── API + dashboard ──
  registerSettingsRoutes(app, hub);
  registerOverlayWs(app, hub);
  registerDashboardWs(app, hub);

  app.get('/healthz', async (_req, reply) => {
    // Return 503 when Piper (the TTS engine) is unreachable so container health
    // checks / uptime monitors actually flag a broken deploy, not just a dead
    // web server.
    const piper = await piperHealthy();
    reply.code(piper ? 200 : 503).send({ ok: piper, piper });
  });

  // ── Static: overlay page (decorates reply.sendFile) ──
  // prefix has no trailing slash so @fastify/static registers a 301 redirect
  // from the bare /overlay (preserving ?token=...) to /overlay/ — the overlay
  // URL handed out by /api/me has no trailing slash.
  await app.register(fastifyStatic, {
    root: path.join(PUBLIC_DIR, 'overlay'),
    prefix: '/overlay',
    redirect: true,
    decorateReply: true,
  });

  // ── Static: generated audio ──
  await app.register(fastifyStatic, {
    root: config.AUDIO_CACHE_DIR,
    prefix: '/audio/',
    decorateReply: false,
    cacheControl: true,
    maxAge: 300000,
  });

  // ── Static: dashboard (dependency-free static page) ──
  await app.register(fastifyStatic, {
    root: APP_DIR,
    prefix: '/',
    decorateReply: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === 'GET' &&
      !req.url.startsWith('/api') &&
      !req.url.startsWith('/auth') &&
      !req.url.startsWith('/ws') &&
      !req.url.startsWith('/overlay') &&
      !req.url.startsWith('/audio')
    ) {
      reply.sendFile('index.html', APP_DIR);
      return;
    }
    reply.code(404).send({ error: 'not_found' });
  });

  // ── Start ──
  chat.connect();
  await app.listen({ host: '0.0.0.0', port: config.PORT });
  logger.info(`[server] listening on ${config.PUBLIC_URL} (port ${config.PORT})`);

  const shutdown = async () => {
    logger.info('[server] shutting down...');
    await hub.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('[server] fatal:', err);
  process.exit(1);
});
