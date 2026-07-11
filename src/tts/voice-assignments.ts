import { prisma } from '../db';
import { logger } from '../logger';
import { pickVoice } from './voice-picker';

/**
 * Resolves and persists per-chatter voice assignments for each streamer.
 *
 * The DB (`ChatterVoice`) is the source of truth so assignments survive
 * restarts and a future `!voice` command can override them. An in-memory cache
 * keeps the chat hot path off the database after a chatter's first message.
 */
export class VoiceAssignments {
  // ownerId -> (chatter login -> voice)
  private cache = new Map<string, Map<string, string>>();
  private loaded = new Set<string>();

  /** Warm the cache for a streamer from the DB (idempotent). */
  private async ensureLoaded(ownerId: string): Promise<Map<string, string>> {
    let byLogin = this.cache.get(ownerId);
    if (byLogin && this.loaded.has(ownerId)) return byLogin;
    if (!byLogin) {
      byLogin = new Map();
      this.cache.set(ownerId, byLogin);
    }
    try {
      const rows = await prisma.chatterVoice.findMany({
        where: { ownerId },
        select: { login: true, voice: true },
      });
      for (const r of rows) byLogin.set(r.login, r.voice);
      this.loaded.add(ownerId);
    } catch (err) {
      logger.error('[voices] failed to load assignments:', (err as Error).message);
    }
    return byLogin;
  }

  /**
   * Return the voice for `login` in `ownerId`'s channel, assigning (and
   * persisting) one from `pool` on first sight. Falls back to `fallback` when
   * the pool is empty.
   */
  async resolve(
    ownerId: string,
    login: string,
    pool: string[],
    fallback: string,
  ): Promise<string> {
    login = login.toLowerCase();
    const byLogin = await this.ensureLoaded(ownerId);
    const existing = byLogin.get(login);
    if (existing) return existing;
    if (pool.length === 0) return fallback;

    const voice = pickVoice(login, pool, fallback);
    byLogin.set(login, voice); // cache immediately; persist best-effort
    try {
      // Don't clobber a locked (chatter-chosen) assignment if one races in.
      await prisma.chatterVoice.upsert({
        where: { ownerId_login: { ownerId, login } },
        create: { ownerId, login, voice },
        update: {},
      });
    } catch (err) {
      logger.error('[voices] failed to persist assignment:', (err as Error).message);
    }
    return voice;
  }

  /**
   * Explicitly set a chatter's voice (e.g. a future `!voice` command) and mark
   * it locked so auto-assignment won't overwrite it.
   */
  async setVoice(ownerId: string, login: string, voice: string): Promise<void> {
    login = login.toLowerCase();
    const byLogin = await this.ensureLoaded(ownerId);
    byLogin.set(login, voice);
    await prisma.chatterVoice.upsert({
      where: { ownerId_login: { ownerId, login } },
      create: { ownerId, login, voice, locked: true },
      update: { voice, locked: true },
    });
  }
}
