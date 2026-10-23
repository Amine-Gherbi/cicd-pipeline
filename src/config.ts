import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const DEV_DATABASE_URL = 'postgresql://postgres@localhost:5433/invoice_dev?schema=public';

const databaseUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'must be a postgresql:// connection string',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: databaseUrlSchema.optional(),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  // When set, POST /invoices requires `Authorization: Bearer <token>`. The
  // local release lane seeds it in .env.local and smoke.sh proves it is enforced.
  SMOKE_TOKEN: z.string().min(16).optional(),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, 'DATABASE_URL'> & {
  DATABASE_URL: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }

  const databaseUrl =
    parsed.data.DATABASE_URL ??
    (parsed.data.NODE_ENV === 'production' ? undefined : DEV_DATABASE_URL);

  if (databaseUrl === undefined) {
    throw new Error('Invalid environment: DATABASE_URL is required when NODE_ENV=production');
  }

  return { ...parsed.data, DATABASE_URL: databaseUrl };
}
