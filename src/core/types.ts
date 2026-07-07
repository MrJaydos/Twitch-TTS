import type { Settings } from '@prisma/client';

export type { Settings };

/** A parsed Twitch chat message. */
export interface ChatMessage {
  channel: string; // lowercase login, no leading '#'
  login: string; // chatter login (lowercase)
  displayName: string;
  text: string;
  isBroadcaster: boolean;
  isMod: boolean;
  isVip: boolean;
  isSub: boolean;
  /** [start, end] code-point ranges of emotes within `text` (inclusive end). */
  emoteRanges: Array<[number, number]>;
}

export interface Caption {
  name: string;
  text: string;
}

/** Messages the server pushes down the overlay WebSocket. */
export type OverlayServerMessage =
  | { type: 'hello'; captionsEnabled: boolean; volume: number }
  | { type: 'config'; captionsEnabled: boolean; volume: number }
  | { type: 'play'; id: string; url: string; caption: Caption | null }
  | { type: 'skip' }
  | { type: 'clear' };

/** Item queued for a single overlay owner. */
export interface QueueItem {
  text: string;
  voice: string;
  rate: number;
  caption: Caption | null;
}
