import type { FastifyServerOptions } from 'fastify';

export type LoggerConfig = NonNullable<FastifyServerOptions['logger']>;

/**
 * Structured JSON logging. Request bodies are never logged, and the fields
 * that would carry client identity or credentials are redacted.
 */
export function buildLoggerOptions(level: string): LoggerConfig {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.remoteAddress',
        'req.remotePort',
      ],
      censor: '[redacted]',
    },
  };
}
