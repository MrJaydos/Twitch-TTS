import type { FastifyReply, FastifyRequest } from 'fastify';
import { getUserId } from './session';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/** preHandler that rejects unauthenticated requests and attaches req.userId. */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const uid = getUserId(req);
  if (!uid) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  req.userId = uid;
}
