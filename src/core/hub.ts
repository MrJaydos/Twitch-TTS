import { EventEmitter } from 'events';
import type WebSocket from 'ws';
import { logger } from '../logger';
import { prisma, getOrCreateSettings } from '../db';
import { ChatManager } from '../twitch/chat-manager';
import { filterMessage } from '../settings/filters';
import { generateAudio, audioUrl } from '../tts/generate';
import type {
  ChatMessage,
  OverlayServerMessage,
  QueueItem,
  Settings,
} from './types';

export interface ActivityEntry {
  time: number;
  type: 'spoken' | 'test' | 'skip' | 'clear';
  name: string;
  text: string;
}

interface QueueState {
  items: QueueItem[];
  running: boolean;
}

/**
 * Central orchestrator. Tracks overlay sockets per user, the channel each user
 * listens to, per-user settings, TTS queues, and routes chat → speech.
 */
export class Hub extends EventEmitter {
  private sockets = new Map<string, Set<WebSocket>>();
  private settings = new Map<string, Settings>();
  private channelUsers = new Map<string, Set<string>>();
  private queues = new Map<string, QueueState>();
  private lastSpoke = new Map<string, number>(); // `${userId}:${chatterLogin}` -> ts
  private chat: ChatManager;

  constructor(chat: ChatManager) {
    super();
    // Each dashboard connection subscribes to 'activity'; avoid the default
    // 10-listener warning when many dashboards are open.
    this.setMaxListeners(0);
    this.chat = chat;
    this.chat.on('message', (m) => this.onChat(m));
  }

  // ── overlay socket lifecycle ──────────────────────────────────────
  async addOverlay(userId: string, ws: WebSocket): Promise<void> {
    const s = await this.loadSettings(userId);
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(ws);
    this.reconcileChannel(userId);
    this.send(ws, {
      type: 'hello',
      captionsEnabled: s.captionsEnabled,
      volume: s.volume,
    });
    logger.info(`[hub] overlay connected user=${userId} (${set.size} socket(s))`);
  }

  removeOverlay(userId: string, ws: WebSocket): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.sockets.delete(userId);
      this.reconcileChannel(userId);
    }
    logger.info(`[hub] overlay disconnected user=${userId}`);
  }

  // ── settings ──────────────────────────────────────────────────────
  private async loadSettings(userId: string): Promise<Settings> {
    const s = (await getOrCreateSettings(userId)) as Settings;
    this.settings.set(userId, s);
    return s;
  }

  /** Called by the settings API after a DB update. */
  updateSettings(userId: string, s: Settings): void {
    this.settings.set(userId, s);
    this.reconcileChannel(userId);
    this.broadcast(userId, {
      type: 'config',
      captionsEnabled: s.captionsEnabled,
      volume: s.volume,
    });
  }

  // ── channel indexing ──────────────────────────────────────────────
  private normalizedChannel(userId: string): string | null {
    const s = this.settings.get(userId);
    const connected = (this.sockets.get(userId)?.size ?? 0) > 0;
    if (!s || !s.enabled || !connected) return null;
    const ch = s.channel.trim().toLowerCase().replace(/^#/, '');
    return ch || null;
  }

  private currentChannelOf(userId: string): string | null {
    for (const [ch, users] of this.channelUsers) {
      if (users.has(userId)) return ch;
    }
    return null;
  }

  /** Reconcile which channel this user listens to with chat join/part. */
  private reconcileChannel(userId: string): void {
    const desired = this.normalizedChannel(userId);
    const current = this.currentChannelOf(userId);
    if (desired === current) return;

    if (current) {
      const users = this.channelUsers.get(current);
      users?.delete(userId);
      if (users && users.size === 0) {
        this.channelUsers.delete(current);
        this.chat.part(current);
      }
    }
    if (desired) {
      let users = this.channelUsers.get(desired);
      if (!users) {
        users = new Set();
        this.channelUsers.set(desired, users);
        this.chat.join(desired);
      }
      users.add(userId);
    }
  }

  // ── chat → speech ─────────────────────────────────────────────────
  private onChat(m: ChatMessage): void {
    const users = this.channelUsers.get(m.channel);
    if (!users || users.size === 0) return;
    for (const userId of users) {
      const s = this.settings.get(userId);
      if (!s || !s.enabled) continue;

      const result = filterMessage(s, m);
      if (!result.ok) continue;

      if (s.cooldownSeconds > 0) {
        const key = `${userId}:${m.login}`;
        const last = this.lastSpoke.get(key) ?? 0;
        if (Date.now() - last < s.cooldownSeconds * 1000) continue;
        this.lastSpoke.set(key, Date.now());
      }

      this.enqueue(userId, {
        text: result.spoken,
        voice: s.voice,
        rate: s.rate,
        caption: s.captionsEnabled ? { name: m.displayName, text: result.caption } : null,
      });
      this.emitActivity(userId, {
        time: Date.now(),
        type: 'spoken',
        name: m.displayName,
        text: result.caption,
      });
    }
  }

  // ── queue ─────────────────────────────────────────────────────────
  private enqueue(userId: string, item: QueueItem): void {
    let q = this.queues.get(userId);
    if (!q) {
      q = { items: [], running: false };
      this.queues.set(userId, q);
    }
    q.items.push(item);
    void this.drain(userId);
  }

  private async drain(userId: string): Promise<void> {
    const q = this.queues.get(userId);
    if (!q || q.running) return;
    q.running = true;
    try {
      while (q.items.length) {
        const item = q.items.shift() as QueueItem;
        if (!this.sockets.has(userId)) {
          q.items.length = 0; // nobody listening
          break;
        }
        try {
          const id = await generateAudio({
            text: item.text,
            voice: item.voice,
            rate: item.rate,
          });
          this.broadcast(userId, {
            type: 'play',
            id,
            url: audioUrl(id),
            caption: item.caption,
          });
        } catch (err) {
          logger.error('[hub] tts generation failed:', (err as Error).message);
        }
      }
    } finally {
      q.running = false;
    }
  }

  // ── dashboard-triggered controls ──────────────────────────────────
  async testMessage(userId: string, text: string): Promise<void> {
    const s = this.settings.get(userId) ?? (await this.loadSettings(userId));
    this.enqueue(userId, {
      text,
      voice: s.voice,
      rate: s.rate,
      caption: s.captionsEnabled ? { name: 'Test', text } : null,
    });
    this.emitActivity(userId, { time: Date.now(), type: 'test', name: 'Test', text });
  }

  skip(userId: string): void {
    this.broadcast(userId, { type: 'skip' });
    this.emitActivity(userId, { time: Date.now(), type: 'skip', name: '', text: '' });
  }

  clear(userId: string): void {
    const q = this.queues.get(userId);
    if (q) q.items.length = 0;
    this.broadcast(userId, { type: 'clear' });
    this.emitActivity(userId, { time: Date.now(), type: 'clear', name: '', text: '' });
  }

  // ── plumbing ──────────────────────────────────────────────────────
  private send(ws: WebSocket, msg: OverlayServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private broadcast(userId: string, msg: OverlayServerMessage): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const ws of set) {
      try {
        ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }

  private emitActivity(userId: string, entry: ActivityEntry): void {
    this.emit('activity', userId, entry);
  }

  isEnabledConnected(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  async shutdown(): Promise<void> {
    this.chat.close();
    await prisma.$disconnect().catch(() => {});
  }
}
