import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { config } from '../config';
import { logger } from '../logger';
import type { ChatMessage } from '../core/types';
import { parseLine } from './message';

const TWITCH_WS = 'wss://irc-ws.chat.twitch.tv:443';

/**
 * Twitch chat client that joins many channels on a single connection, emits
 * `message` for each PRIVMSG, and reconnects with backoff (re-joining channels
 * automatically).
 *
 * Connects anonymously as `justinfan<random>` (read-only) unless a bot account
 * is configured, in which case it authenticates so it can also send replies via
 * `say()` (used for chat commands like `!voice`).
 */
export class ChatManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private channels = new Set<string>();
  private connected = false;
  private reconnectDelay = 1000;
  private closing = false;

  connect(): void {
    this.closing = false;
    this.open();
  }

  private open(): void {
    const nick = `justinfan${Math.floor(Math.random() * 90000) + 10000}`;
    const ws = new WebSocket(TWITCH_WS);
    this.ws = ws;

    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (config.botConfigured) {
        logger.info(`[chat] connected to Twitch IRC as ${config.botLogin}`);
        ws.send(`PASS oauth:${config.botToken}`);
        ws.send(`NICK ${config.botLogin}`);
      } else {
        logger.info('[chat] connected to Twitch IRC (anonymous, read-only)');
        ws.send(`NICK ${nick}`);
      }
      this.connected = true;
      this.reconnectDelay = 1000;
      for (const ch of this.channels) ws.send(`JOIN #${ch}`);
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      for (const line of raw.split('\r\n')) {
        if (!line) continue;
        this.handleLine(line);
      }
    });

    ws.on('close', () => {
      this.connected = false;
      this.ws = null;
      if (this.closing) return;
      logger.warn(`[chat] disconnected; reconnecting in ${this.reconnectDelay}ms`);
      setTimeout(() => this.open(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    });

    ws.on('error', (err) => {
      logger.error('[chat] socket error:', (err as Error).message);
      // 'close' will follow and trigger reconnect.
    });
  }

  private handleLine(line: string): void {
    const parsed = parseLine(line);
    if (parsed.kind === 'ping') {
      this.ws?.send(`PONG :${parsed.token}`);
      return;
    }
    if (parsed.kind === 'privmsg') {
      this.emit('message', parsed.message as ChatMessage);
      return;
    }
    // Surface a bad bot token clearly instead of silently looping reconnects.
    if (line.includes('Login authentication failed')) {
      logger.error(
        '[chat] bot login failed — check TWITCH_BOT_USERNAME/TWITCH_BOT_TOKEN (needs chat:read + chat:edit)',
      );
    }
  }

  /** Whether the client can send messages (a bot account is configured). */
  get canSpeak(): boolean {
    return this.connected && config.botConfigured;
  }

  /** Send a chat message to `channel`. No-op when running anonymously. */
  say(channel: string, text: string): void {
    if (!this.canSpeak) return;
    const ch = channel.toLowerCase().replace(/^#/, '').trim();
    if (!ch) return;
    // Twitch drops messages with raw newlines; keep it to one safe line.
    const line = text.replace(/[\r\n]+/g, ' ').slice(0, 450);
    this.ws?.send(`PRIVMSG #${ch} :${line}`);
  }

  join(channel: string): void {
    const ch = channel.toLowerCase().replace(/^#/, '').trim();
    if (!ch || this.channels.has(ch)) return;
    this.channels.add(ch);
    if (this.connected) this.ws?.send(`JOIN #${ch}`);
    logger.info(`[chat] join #${ch}`);
  }

  part(channel: string): void {
    const ch = channel.toLowerCase().replace(/^#/, '').trim();
    if (!this.channels.has(ch)) return;
    this.channels.delete(ch);
    if (this.connected) this.ws?.send(`PART #${ch}`);
    logger.info(`[chat] part #${ch}`);
  }

  close(): void {
    this.closing = true;
    this.ws?.close();
  }
}

// Typed event signature.
export interface ChatManager {
  on(event: 'message', listener: (msg: ChatMessage) => void): this;
  emit(event: 'message', msg: ChatMessage): boolean;
}
