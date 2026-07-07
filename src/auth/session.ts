import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';

const COOKIE = 'sid';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function setSession(reply: FastifyReply, userId: string): void {
  reply.setCookie(COOKIE, userId, {
    signed: true,
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' });
}

export function getUserId(req: FastifyRequest): string | null {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  return un.valid && un.value ? un.value : null;
}
