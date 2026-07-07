import type { ChatMessage, Settings } from '../core/types';

export interface FilterResult {
  ok: boolean;
  /** Text to speak (may include the "X says:" prefix). */
  spoken: string;
  /** Text to show as a caption (no username prefix). */
  caption: string;
}

const FAIL: FilterResult = { ok: false, spoken: '', caption: '' };

/** Split a newline/comma separated list into trimmed lowercase entries. */
export function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function roleAllowed(gate: string, m: ChatMessage): boolean {
  switch (gate) {
    case 'mods':
      return m.isBroadcaster || m.isMod;
    case 'vips':
      return m.isBroadcaster || m.isMod || m.isVip;
    case 'subs':
      return m.isBroadcaster || m.isMod || m.isVip || m.isSub;
    case 'everyone':
    default:
      return true;
  }
}

/** Remove emote substrings using the tag-provided code-point ranges. */
function removeEmotes(text: string, ranges: Array<[number, number]>): string {
  if (!ranges.length) return text;
  const chars = Array.from(text); // code-point aware, matches Twitch indexing
  const remove = new Set<number>();
  for (const [start, end] of ranges) {
    for (let i = start; i <= end && i < chars.length; i++) remove.add(i);
  }
  return chars.filter((_, i) => !remove.has(i)).join('');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply a user's settings to a chat message. Returns whether it should be
 * spoken and the shaped text.
 */
export function filterMessage(s: Settings, m: ChatMessage): FilterResult {
  if (!roleAllowed(s.roleGate, m)) return FAIL;
  if (parseList(s.ignoreList).includes(m.login)) return FAIL;

  let text = m.text;

  if (s.stripEmotes) text = removeEmotes(text, m.emoteRanges);

  if (s.triggerMode === 'prefix') {
    const p = s.prefix.trim();
    if (p && text.toLowerCase().startsWith(p.toLowerCase())) {
      text = text.slice(p.length).trim();
    } else {
      return FAIL;
    }
  }

  if (s.stripUrls) {
    text = text.replace(/\bhttps?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ');
  }

  const blocked = parseList(s.blocklist);
  if (blocked.length) {
    const lower = text.toLowerCase();
    const hit = blocked.some((w) => lower.includes(w));
    if (hit) {
      if (s.blocklistMode === 'censor') {
        for (const w of blocked) {
          text = text.replace(new RegExp(escapeRegExp(w), 'gi'), '***');
        }
      } else {
        return FAIL;
      }
    }
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return FAIL;

  if (s.maxLength > 0 && text.length > s.maxLength) {
    text = text.slice(0, s.maxLength).trim();
  }

  const caption = text;
  const spoken = s.readUsername ? `${m.displayName} says: ${text}` : text;
  return { ok: true, spoken, caption };
}
