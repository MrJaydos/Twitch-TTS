/**
 * Deterministically maps a chatter to one voice from a pool, so the same
 * person always sounds the same without persisting any per-user state.
 */

/** FNV-1a 32-bit hash — small, stable, and dependency-free. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick a voice for `login` from `pool`. Returns `fallback` when the pool is
 * empty. The mapping is stable for a given login + pool.
 */
export function pickVoice(login: string, pool: string[], fallback: string): string {
  if (pool.length === 0) return fallback;
  return pool[hash(login.toLowerCase()) % pool.length];
}
