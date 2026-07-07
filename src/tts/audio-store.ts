import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';

const dir = config.AUDIO_CACHE_DIR;

/** Stable id for a (voice, rate, text) triple so identical messages reuse audio. */
export function audioKey(parts: { text: string; voice: string; rate: number }): string {
  return createHash('sha1')
    .update(`${parts.voice}|${parts.rate}|${parts.text}`)
    .digest('hex');
}

export function audioPath(id: string): string {
  return path.join(dir, `${id}.wav`);
}

export async function ensureDir(): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function has(id: string): Promise<boolean> {
  try {
    await fs.access(audioPath(id));
    // Touch mtime so active audio isn't GC'd mid-use.
    const now = new Date();
    await fs.utimes(audioPath(id), now, now).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function write(id: string, buf: Buffer): Promise<void> {
  await fs.writeFile(audioPath(id), buf);
}

/** Remove cached WAVs older than the configured TTL. */
export async function gcOnce(): Promise<void> {
  const ttlMs = config.AUDIO_TTL_SECONDS * 1000;
  const now = Date.now();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    files.map(async (f) => {
      if (!f.endsWith('.wav')) return;
      const p = path.join(dir, f);
      try {
        const st = await fs.stat(p);
        if (now - st.mtimeMs > ttlMs) await fs.unlink(p);
      } catch {
        /* ignore races */
      }
    }),
  );
}

/** Background GC loop. Returns the timer so callers can clear it if needed. */
export function startGc(): NodeJS.Timeout {
  const t = setInterval(() => {
    gcOnce().catch(() => {});
  }, 60_000);
  t.unref();
  return t;
}
