import { timingSafeEqual } from 'node:crypto';
import type { Invoice, PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, validationFailed } from '../errors.js';

const createInvoiceSchema = z
  .object({
    customerId: z.string().trim().min(1).max(100),
    amountCents: z.number().int().min(0).max(100_000_000),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('USD'),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

const invoiceIdSchema = z.uuid();

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface InvoiceResponse {
  id: string;
  customerId: string;
  amountCents: number;
  currency: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toResponse(invoice: Invoice): InvoiceResponse {
  return {
    id: invoice.id,
    customerId: invoice.customerId,
    amountCents: invoice.amountCents,
    currency: invoice.currency,
    description: invoice.description,
    status: invoice.status,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function smokeTokenGuard(token: string) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !constantTimeEqual(header, `Bearer ${token}`)) {
      throw new AppError(401, 'unauthorized', 'A valid bearer token is required');
    }
  };
}

export function registerInvoiceRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  smokeToken?: string,
): void {
  const postOptions = smokeToken === undefined ? {} : { preHandler: smokeTokenGuard(smokeToken) };

  app.post('/invoices', postOptions, async (request, reply) => {
    // demo-fault: this commit is only ever deployed by the hosted rollback
    // exercise, which expects the authenticated smoke assertion to fail.
    // A runtime guard (rather than an unconditional throw) keeps the rest of
    // the handler reachable, so the type checker still narrows `input`.
    if (process.env.DEMO_FAULT !== 'off') {
      throw new AppError(500, 'demo_fault', 'Deliberate demo fault: this release cannot create invoices');
    }

    const parsed = createInvoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }

    const input = parsed.data;
    const invoice = await prisma.invoice.create({
      data: {
        customerId: input.customerId,
        amountCents: input.amountCents,
        currency: input.currency,
        ...(input.description === undefined ? {} : { description: input.description }),
      },
    });

    return reply.status(201).send(toResponse(invoice));
  });

  app.get<{ Params: { id: string } }>('/invoices/:id', async (request) => {
    const id = request.params.id;
    if (id.length > 64 || !uuidPattern.test(id)) {
      throw new AppError(400, 'validation_error', 'Invoice id must be a UUID');
    }

    const parsed = invoiceIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new AppError(400, 'validation_error', 'Invoice id must be a UUID');
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: parsed.data } });
    if (invoice === null) {
      throw new AppError(404, 'not_found', 'Invoice not found');
    }

    return toResponse(invoice);
  });
}
