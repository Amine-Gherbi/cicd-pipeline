import type { FastifyError, FastifyInstance } from 'fastify';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: ValidationIssue[];
  };
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ValidationIssue[];

  constructor(statusCode: number, code: string, message: string, details?: ValidationIssue[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function validationFailed(details: ValidationIssue[]): AppError {
  return new AppError(400, 'validation_error', 'Request validation failed', details);
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      const body: ErrorBody =
        error.details === undefined
          ? { error: { code: error.code, message: error.message } }
          : { error: { code: error.code, message: error.message, details: error.details } };
      void reply.status(error.statusCode).send(body);
      return;
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      const code = statusCode === 400 ? 'validation_error' : 'bad_request';
      const message =
        statusCode === 400 ? 'Request body or parameters are invalid' : 'Request rejected';
      request.log.warn({ err: error }, 'client error');
      void reply.status(statusCode).send({ error: { code, message } });
      return;
    }

    request.log.error({ err: error }, 'unhandled error');
    void reply.status(500).send({ error: { code: 'internal_error', message: 'Internal server error' } });
  });
}
