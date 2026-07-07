import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { logger } from '../logger';
import type { ChatMessage } from '../core/types';
import { parseLine } from './message';

const TWITCH_WS = 'wss://irc-ws.chat.twitch.tv:443';

/**
 * Anonymous, read-only Twitch chat client.
 *
 * Connects as `justinfan<random>` (no token required) and joins many channels
 * on a single connection. Emits `message` for each PRIVMSG and reconnects with
 * backoff, re-joining channels automatically.
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
      logger.info('[chat] connected to Twitch IRC');
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`NICK ${nick}`);
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
    }
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
