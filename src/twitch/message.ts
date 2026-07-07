import type { ChatMessage } from '../core/types';

/** Parse IRCv3 tag string `@a=b;c=d` into a plain object. */
function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.slice(1).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      tags[part] = '';
    } else {
      tags[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  return tags;
}

/** Parse the `emotes` tag (`id:0-4,6-10/id2:12-13`) into text ranges. */
function parseEmoteRanges(raw: string | undefined): Array<[number, number]> {
  if (!raw) return [];
  const ranges: Array<[number, number]> = [];
  for (const group of raw.split('/')) {
    const colon = group.indexOf(':');
    if (colon === -1) continue;
    for (const span of group.slice(colon + 1).split(',')) {
      const [a, b] = span.split('-');
      const start = Number(a);
      const end = Number(b);
      if (Number.isInteger(start) && Number.isInteger(end)) ranges.push([start, end]);
    }
  }
  return ranges;
}

export type ParsedLine =
  | { kind: 'ping'; token: string }
  | { kind: 'privmsg'; message: ChatMessage }
  | { kind: 'other' };

/**
 * Parse a single raw IRC line from Twitch.
 * Handles PING and tagged PRIVMSG; everything else is 'other'.
 */
export function parseLine(line: string): ParsedLine {
  if (line.startsWith('PING')) {
    return { kind: 'ping', token: line.slice(line.indexOf(':') + 1) };
  }

  let rest = line;
  let tags: Record<string, string> = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    tags = parseTags(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }

  // prefix
  let prefix = '';
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }

  const spaceIdx = rest.indexOf(' ');
  const command = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const params = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1);

  if (command !== 'PRIVMSG') return { kind: 'other' };

  // params: "#channel :message text"
  const colon = params.indexOf(' :');
  if (colon === -1) return { kind: 'other' };
  const channel = params.slice(0, colon).replace(/^#/, '').toLowerCase();
  const text = params.slice(colon + 2);

  const login = (prefix.split('!')[0] || tags['login'] || '').toLowerCase();
  const badges = tags['badges'] || '';
  const badgeSet = new Set(
    badges.split(',').map((b) => b.split('/')[0]).filter(Boolean),
  );

  const message: ChatMessage = {
    channel,
    login,
    displayName: tags['display-name'] || login,
    text,
    isBroadcaster: badgeSet.has('broadcaster'),
    isMod: tags['mod'] === '1' || badgeSet.has('moderator'),
    isVip: tags['vip'] === '1' || badgeSet.has('vip'),
    isSub:
      tags['subscriber'] === '1' ||
      badgeSet.has('subscriber') ||
      badgeSet.has('founder'),
    emoteRanges: parseEmoteRanges(tags['emotes']),
  };
  return { kind: 'privmsg', message };
}
