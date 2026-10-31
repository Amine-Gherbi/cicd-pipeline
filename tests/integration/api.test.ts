import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5433/invoice_dev?schema=public';
const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, 'prisma', 'migrations');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type App = Awaited<ReturnType<typeof buildApp>>;

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const smokeToken = 'smoke-test-token-0123456789';

let app: App;
let authedApp: App;
let pendingApp: App;
let pendingMigrationsDir: string;

beforeAll(async () => {
  execSync('npx prisma migrate deploy', {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  app = await buildApp({ databaseUrl, migrationsDir });
  authedApp = await buildApp({ databaseUrl, migrationsDir, smokeToken });

  pendingMigrationsDir = mkdtempSync(join(tmpdir(), 'invoice-migrations-'));
  cpSync(migrationsDir, pendingMigrationsDir, { recursive: true });
  const unapplied = join(pendingMigrationsDir, '99999999999999_pending');
  mkdirSync(unapplied);
  writeFileSync(join(unapplied, 'migration.sql'), '-- pending migration fixture\n');
  pendingApp = await buildApp({ databaseUrl, migrationsDir: pendingMigrationsDir });
});

beforeEach(async () => {
  await prisma.invoice.deleteMany();
});

afterAll(async () => {
  await app.close();
  await authedApp.close();
  await pendingApp.close();
  await prisma.$disconnect();
  rmSync(pendingMigrationsDir, { recursive: true, force: true });
});

describe('invoice-api integration', () => {
  it('GET /health returns 200 {status:"ok"} with a request id header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('GET /ready returns 200 when the database answers and no migration is pending', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'ok', migrations: 'ok' },
    });
  });

  it('GET /ready returns 503 with a reason when a migration is pending', async () => {
    const response = await pendingApp.inject({ method: 'GET', url: '/ready' });
    const body = response.json<{ status: string; reason: string; pending: string[] }>();

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('unavailable');
    expect(body.reason).toBe('pending_migrations');
    expect(body.pending).toContain('99999999999999_pending');
  });

  it('POST /invoices validates the body and stores integer cents', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: { customerId: 'cus_001', amountCents: 2599, currency: 'EUR', description: 'October' },
    });
    const body = response.json<{ id: string; amountCents: number; currency: string }>();

    expect(response.statusCode).toBe(201);
    expect(body.id).toMatch(uuidPattern);
    expect(body.amountCents).toBe(2599);
    expect(body.currency).toBe('EUR');

    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored.amountCents).toBe(2599);
    expect(Number.isInteger(stored.amountCents)).toBe(true);
  });

  it('the bearer token guards both POST and GET when SMOKE_TOKEN is configured', async () => {
    const body = { customerId: 'cus_auth', amountCents: 100 };

    const anonymous = await authedApp.inject({ method: 'POST', url: '/invoices', payload: body });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({
      error: { code: 'unauthorized', message: 'A valid bearer token is required' },
    });

    const authorized = await authedApp.inject({
      method: 'POST',
      url: '/invoices',
      payload: body,
      headers: { authorization: `Bearer ${smokeToken}` },
    });
    expect(authorized.statusCode).toBe(201);
    const invoiceId = authorized.json<{ id: string }>().id;
    expect(invoiceId).toMatch(uuidPattern);

    const anonymousRead = await authedApp.inject({ method: 'GET', url: `/invoices/${invoiceId}` });
    expect(anonymousRead.statusCode).toBe(401);
    expect(anonymousRead.body).not.toContain('cus_auth');

    const authorizedRead = await authedApp.inject({
      method: 'GET',
      url: `/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${smokeToken}` },
    });
    expect(authorizedRead.statusCode).toBe(200);
    expect(authorizedRead.json<{ customerId: string }>().customerId).toBe('cus_auth');
  });

  it('POST /invoices rejects a non-integer amount with a structured error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: { customerId: 'cus_001', amountCents: 10.5 },
    });
    const body = response.json<{
      error: { code: string; details?: { path: string }[] };
    }>();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details?.map((issue) => issue.path)).toContain('amountCents');
    expect(response.body.toLowerCase()).not.toContain('stack');
  });

  it('GET /invoices/:id returns the stored invoice with UTC ISO timestamps', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: { customerId: 'cus_002', amountCents: 500 },
    });
    const createdBody = created.json<{ id: string }>();

    const response = await authedApp.inject({
      method: 'GET',
      url: `/invoices/${createdBody.id}`,
      headers: { authorization: `Bearer ${smokeToken}` },
    });
    const body = response.json<{
      id: string;
      customerId: string;
      amountCents: number;
      currency: string;
      createdAt: string;
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.id).toBe(createdBody.id);
    expect(body.customerId).toBe('cus_002');
    expect(body.amountCents).toBe(500);
    expect(body.currency).toBe('USD');
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });

  it('GET /invoices/:uuid answers 401 without the token and 404 not_found with it', async () => {
    const id = randomUUID();

    const anonymous = await authedApp.inject({ method: 'GET', url: `/invoices/${id}` });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({
      error: { code: 'unauthorized', message: 'A valid bearer token is required' },
    });

    const authorized = await authedApp.inject({
      method: 'GET',
      url: `/invoices/${id}`,
      headers: { authorization: `Bearer ${smokeToken}` },
    });
    expect(authorized.statusCode).toBe(404);
    expect(authorized.json()).toEqual({
      error: { code: 'not_found', message: 'Invoice not found' },
    });
    expect(authorized.body.toLowerCase()).not.toContain('stack');
    expect(authorized.body.toLowerCase()).not.toContain('.ts:');
  });

  it('GET /invoices/:id rejects a malformed uuid with 400 validation_error', async () => {
    const anonymous = await authedApp.inject({ method: 'GET', url: '/invoices/not-a-uuid' });
    expect(anonymous.statusCode).toBe(401);

    const response = await authedApp.inject({
      method: 'GET',
      url: '/invoices/not-a-uuid',
      headers: { authorization: `Bearer ${smokeToken}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'validation_error', message: 'Invoice id must be a UUID' },
    });
  });
});
