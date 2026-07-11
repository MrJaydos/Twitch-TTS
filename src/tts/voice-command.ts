/**
 * Parsing for the chat `!voice` command that lets chatters pick their own TTS
 * voice. Pure functions so the behavior is easy to test in isolation; the Hub
 * wires these to the DB (persisting the choice) and the chat reply.
 */

const TRIGGER = '!voice';

export type VoiceCommand =
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'random' }
  | { kind: 'set'; voice: string | null; raw: string };

/** True when a message is a `!voice` command (with or without arguments). */
export function isVoiceCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === TRIGGER || t.startsWith(TRIGGER + ' ');
}

/**
 * Match user input to a voice in `pool`. Accepts the full model name
 * (`en_US-amy-medium`) or any of its segments (`amy`, `us`, `medium`), so
 * chatters can type the friendly speaker name. Case-insensitive.
 */
export function matchVoice(input: string, pool: string[]): string | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  for (const v of pool) if (v.toLowerCase() === q) return v;
  for (const v of pool) if (v.toLowerCase().split(/[-_]/).includes(q)) return v;
  return null;
}

/** Friendly label for a voice model name, e.g. `en_US-amy-medium` -> `amy`. */
export function voiceLabel(voice: string): string {
  const parts = voice.split('-');
  return parts.length >= 2 ? parts[1] : voice;
}

/** Parse the command text into an intent, resolving `set` against `pool`. */
export function parseVoiceCommand(text: string, pool: string[]): VoiceCommand {
  const rest = text.trim().slice(TRIGGER.length).trim();
  const lower = rest.toLowerCase();
  if (!rest || lower === 'help') return { kind: 'help' };
  if (lower === 'list') return { kind: 'list' };
  if (lower === 'random') return { kind: 'random' };
  return { kind: 'set', voice: matchVoice(rest, pool), raw: rest };
}
