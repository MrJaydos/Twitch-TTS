import type WebSocket from 'ws';

const PING_INTERVAL_MS = 30000;

/**
 * Keeps a WebSocket alive through proxies/load balancers that drop idle
 * connections (observed ~120s timeout in front of this app). Pings on an
 * interval and terminates the socket if a pong isn't seen before the next
 * tick, so dead connections are cleaned up instead of silently hanging.
 */
export function startHeartbeat(socket: WebSocket): void {
  let alive = true;
  socket.on('pong', () => {
    alive = true;
  });

  const timer = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    try {
      socket.ping();
    } catch {
      /* ignore */
    }
  }, PING_INTERVAL_MS);

  socket.on('close', () => clearInterval(timer));
}
