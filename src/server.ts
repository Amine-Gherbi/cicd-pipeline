import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { buildLoggerOptions } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({
    databaseUrl: config.DATABASE_URL,
    logger: buildLoggerOptions(config.LOG_LEVEL),
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 'fatal', message: 'failed to start', error: message }));
  process.exitCode = 1;
});
