-- Production-shaped state as of the last release, loaded by the migration-gate
-- job into an empty database *before* `prisma migrate deploy`.
--
-- Two things matter here:
--   1. the gate must migrate a database that already has tables and rows, not
--      an empty one -- an empty database proves nothing about lock timeouts or
--      about migrations that recreate existing objects;
--   2. _prisma_migrations must record the init migration as applied, with the
--      real checksum, or `migrate deploy` would try to CREATE tables that the
--      fixture just created.
--
-- The checksum is sha256 of prisma/migrations/20261022234607_init/migration.sql
-- with LF line endings. If you change that baseline migration, update it here:
--   node -e "const c=require('crypto'),f=require('fs');\
--     console.log(c.createHash('sha256').update(f.readFileSync('prisma/migrations/20261022234607_init/migration.sql')).digest('hex'))"

BEGIN;

-- Schema from the previous release (init migration).
CREATE TYPE "InvoiceStatus" AS ENUM ('open', 'paid', 'void');

CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "customer_id" VARCHAR(100) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "description" VARCHAR(500),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoices_customer_id_created_at_idx" ON "invoices"("customer_id", "created_at");

-- Rows a real release would have. Fixed ids keep the fixture reproducible.
INSERT INTO "invoices" ("id", "customer_id", "amount_cents", "currency", "description", "status", "created_at", "updated_at")
VALUES
    ('11111111-1111-4111-8111-111111111111', 'cus_acme',    2599, 'EUR', 'October retainer', 'paid', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z'),
    ('22222222-2222-4222-8222-222222222222', 'cus_acme',    1050, 'EUR', 'Extra seats',      'open', '2026-10-02T10:30:00.000Z', '2026-10-02T10:30:00.000Z'),
    ('33333333-3333-4333-8333-333333333333', 'cus_globex', 49900, 'USD', 'Annual plan',      'paid', '2026-10-03T14:15:00.000Z', '2026-10-03T14:15:00.000Z'),
    ('44444444-4444-4444-8444-444444444444', 'cus_initech', 7500, 'USD', NULL,               'void', '2026-10-04T08:45:00.000Z', '2026-10-04T08:45:00.000Z');

-- Prisma's own bookkeeping table, exactly as `migrate deploy` creates it.
CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
VALUES (
    '5f0f2f9e-0c4a-4c8e-9a6b-3d2e1c0b9a87',
    '4cf10dc91556de8843b26c1e8bdcdd13e7033f61f81795d2658de0d691e5dd74',
    '2026-10-22T23:46:07.000Z',
    '20261022234607_init',
    '2026-10-22T23:46:07.000Z',
    1
);

COMMIT;
