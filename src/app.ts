import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { createPrismaClient } from './db.js';
import { registerErrorHandlers } from './errors.js';
import { type LoggerConfig } from './logger.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInvoiceRoutes } from './routes/invoices.js';

export interface BuildAppOptions {
  databaseUrl: string;
  migrationsDir?: string;
  logger?: LoggerConfig;
  prisma?: PrismaClient;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const prisma = options.prisma ?? createPrismaClient(options.databaseUrl);
  const migrationsDir = options.migrationsDir ?? join(process.cwd(), 'prisma', 'migrations');

  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      if (typeof header === 'string' && header.length > 0 && header.length <= 128) {
        return header;
      }
      return randomUUID();
    },
    requestIdHeader: 'x-request-id',
    logController: new Fastify.LogController({ requestIdLogLabel: 'requestId' }),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandlers(app);
  registerHealthRoutes(app, prisma, migrationsDir);
  registerInvoiceRoutes(app, prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}
