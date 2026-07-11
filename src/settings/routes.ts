import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { prisma, getOrCreateSettings } from '../db';
import type { Hub } from '../core/hub';
import type { Settings } from '../core/types';
import { requireAuth } from '../auth/middleware';

const settingsSchema = z
  .object({
    channel: z.string().max(50),
    enabled: z.boolean(),
    triggerMode: z.enum(['all', 'prefix']),
    prefix: z.string().max(20),
    roleGate: z.enum(['everyone', 'subs', 'vips', 'mods']),
    voice: z.string().max(80),
    uniqueVoices: z.boolean(),
    rate: z.number().min(0.3).max(2.0),
    volume: z.number().min(0).max(1),
    maxLength: z.number().int().min(0).max(2000),
    readUsername: z.boolean(),
    stripUrls: z.boolean(),
    stripEmotes: z.boolean(),
    cooldownSeconds: z.number().int().min(0).max(3600),
    ignoreList: z.string().max(4000),
    blocklist: z.string().max(4000),
    blocklistMode: z.enum(['skip', 'censor']),
    captionsEnabled: z.boolean(),
  })
  .partial();

function overlayUrl(token: string): string {
  return `${config.PUBLIC_URL}/overlay?token=${token}`;
}

export function registerSettingsRoutes(app: FastifyInstance, hub: Hub): void {
  // Encapsulated scope so requireAuth applies only to these routes.
  app.register(async (scope) => {
    scope.addHook('preHandler', requireAuth);

    scope.get('/api/settings', async (req, reply) => {
      const s = await getOrCreateSettings(req.userId!);
      reply.send(s);
    });

    scope.put('/api/settings', async (req, reply) => {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ error: 'invalid settings', issues: parsed.error.issues });
        return;
      }
      // Normalize channel to a bare lowercase login.
      const data = { ...parsed.data };
      if (typeof data.channel === 'string') {
        data.channel = data.channel.trim().toLowerCase().replace(/^#/, '');
      }
      await getOrCreateSettings(req.userId!); // ensure row exists
      const updated = (await prisma.settings.update({
        where: { userId: req.userId! },
        data,
      })) as Settings;
      hub.updateSettings(req.userId!, updated);
      reply.send(updated);
    });

    scope.get('/api/voices', async (_req, reply) => {
      reply.send({ voices: config.voiceList, default: config.DEFAULT_VOICE });
    });

    scope.post('/api/token/regenerate', async (req, reply) => {
      const token = randomUUID().replace(/-/g, '');
      const user = await prisma.user.update({
        where: { id: req.userId! },
        data: { overlayToken: token },
      });
      reply.send({ overlayUrl: overlayUrl(user.overlayToken) });
    });

    scope.post('/api/actions/test', async (req, reply) => {
      const body = z.object({ text: z.string().min(1).max(500) }).safeParse(req.body);
      if (!body.success) {
        reply.code(400).send({ error: 'text required' });
        return;
      }
      if (!hub.isEnabledConnected(req.userId!)) {
        reply.code(409).send({ error: 'overlay_not_connected' });
        return;
      }
      await hub.testMessage(req.userId!, body.data.text);
      reply.send({ ok: true });
    });

    scope.post('/api/actions/skip', async (req, reply) => {
      hub.skip(req.userId!);
      reply.send({ ok: true });
    });

    scope.post('/api/actions/clear', async (req, reply) => {
      hub.clear(req.userId!);
      reply.send({ ok: true });
    });
  });
}
