import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { checkReadiness } from '../ready.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  migrationsDir: string,
): void {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    const result = await checkReadiness(prisma, migrationsDir);

    if (result.ready) {
      return reply.status(200).send({
        status: 'ok',
        checks: { database: 'ok', migrations: 'ok' },
      });
    }

    const reason = result.reason ?? 'unknown';
    const body =
      result.pending === undefined
        ? { status: 'unavailable', reason }
        : { status: 'unavailable', reason, pending: result.pending };

    return reply.status(503).send(body);
  });
}
