import type { FastifyInstance } from 'fastify';
import oauthPlugin from '@fastify/oauth2';
import { config } from '../config';
import { prisma } from '../db';
import { logger } from '../logger';
import { setSession, clearSession, getUserId } from './session';

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}

/** Registers Twitch OAuth login, callback, logout, and /api/me identity route. */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(oauthPlugin, {
    name: 'twitchOAuth2',
    scope: ['user:read:email'],
    credentials: {
      client: {
        id: config.TWITCH_CLIENT_ID,
        secret: config.TWITCH_CLIENT_SECRET,
      },
      auth: {
        authorizeHost: 'https://id.twitch.tv',
        authorizePath: '/oauth2/authorize',
        tokenHost: 'https://id.twitch.tv',
        tokenPath: '/oauth2/token',
      },
      // Twitch's token endpoint requires client_id/secret as POST body params;
      // it doesn't accept the HTTP Basic Auth header simple-oauth2 sends by default.
      options: {
        authorizationMethod: 'body',
      },
    },
    startRedirectPath: '/auth/twitch',
    callbackUri: config.oauthRedirectUrl,
  });

  app.get(config.oauthRedirectPath, async (req, reply) => {
    let stage = 'token_exchange';
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { token } = await (
        app as any
      ).twitchOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

      stage = 'helix_lookup';
      const res = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Client-Id': config.TWITCH_CLIENT_ID,
        },
      });
      if (!res.ok) {
        throw new Error(`helix /users failed: ${res.status}`);
      }
      const body = (await res.json()) as { data: TwitchUser[] };
      const tu = body.data?.[0];
      if (!tu) throw new Error('no user returned from Twitch');

      stage = 'db_upsert';
      const user = await prisma.user.upsert({
        where: { twitchId: tu.id },
        update: { login: tu.login, displayName: tu.display_name },
        create: {
          twitchId: tu.id,
          login: tu.login,
          displayName: tu.display_name,
          // Default their channel to their own login.
          settings: { create: { channel: tu.login } },
        },
      });

      setSession(reply, user.id);
      reply.redirect('/');
    } catch (err) {
      // simple-oauth2 (via @hapi/wreck) buries Twitch's actual error body here;
      // err.message alone is just "Response Error: 400 Bad Request".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload = (err as any)?.data?.payload;
      if (Buffer.isBuffer(payload)) payload = payload.toString('utf8');
      logger.error(
        `[auth] callback failed at ${stage}:`,
        (err as Error).message,
        payload ? JSON.stringify(payload) : ''
      );
      reply.redirect(`/?error=login_failed&stage=${stage}`);
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    clearSession(reply);
    reply.send({ ok: true });
  });

  app.get('/api/me', async (req, reply) => {
    const uid = getUserId(req);
    if (!uid) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      clearSession(reply);
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    reply.send({
      login: user.login,
      displayName: user.displayName,
      overlayUrl: `${config.PUBLIC_URL}/overlay?token=${user.overlayToken}`,
    });
  });
}
