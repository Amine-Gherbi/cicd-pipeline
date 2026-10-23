import { readdir } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';

export type NotReadyReason =
  | 'database_unreachable'
  | 'migration_failed'
  | 'pending_migrations'
  | 'migrations_unreadable';

export interface ReadinessResult {
  ready: boolean;
  reason?: NotReadyReason;
  pending?: string[];
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

async function listMigrationNames(migrationsDir: string): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Ready means: the database answers SELECT 1 and every migration directory on
 * disk has been applied. A missing _prisma_migrations table means nothing has
 * been applied yet, so every file is pending.
 */
export async function checkReadiness(
  prisma: PrismaClient,
  migrationsDir: string,
): Promise<ReadinessResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return { ready: false, reason: 'database_unreachable' };
  }

  let files: string[];
  try {
    files = await listMigrationNames(migrationsDir);
  } catch {
    return { ready: false, reason: 'migrations_unreadable' };
  }

  let rows: MigrationRow[];
  try {
    rows = await prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
    `;
  } catch {
    // Database is reachable but the bookkeeping table does not exist yet.
    rows = [];
  }

  const failed = rows.some((row) => row.finished_at === null && row.rolled_back_at === null);
  if (failed) {
    return { ready: false, reason: 'migration_failed' };
  }

  const applied = new Set(
    rows
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name),
  );
  const pending = files.filter((name) => !applied.has(name));

  if (pending.length > 0) {
    return { ready: false, reason: 'pending_migrations', pending };
  }

  return { ready: true };
}
