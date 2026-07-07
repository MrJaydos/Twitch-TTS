import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** Settings row shape with sane defaults applied for a user that has none yet. */
export async function getOrCreateSettings(userId: string) {
  const existing = await prisma.settings.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.settings.create({ data: { userId } });
}
