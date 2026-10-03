import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { createPrismaClient } from './db.js';
import { registerErrorHandlers } from './errors.js';
import { type LoggerConfig } from './logger.js';
import { securityHeaders } from './plugins/security-headers.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInvoiceRoutes } from './routes/invoices.js';

// invoice-api serves JSON only: nothing may load, embed or submit anywhere.
const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface BuildAppOptions {
  databaseUrl: string;
  migrationsDir?: string;
  logger?: LoggerConfig;
  prisma?: PrismaClient;
  smokeToken?: string;
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

  // Registered before the routes so the skip-override hook covers every reply.
  app.register(securityHeaders, { contentSecurityPolicy: API_CONTENT_SECURITY_POLICY });

  registerErrorHandlers(app);
  registerHealthRoutes(app, prisma, migrationsDir);
  registerInvoiceRoutes(app, prisma, options.smokeToken);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}
