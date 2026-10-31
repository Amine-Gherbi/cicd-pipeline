import Fastify from 'fastify';
import process from 'node:process';
import { config } from './config.mjs';
import { renderPage } from './page.mjs';
import {
  BusyError,
  ConfigError,
  RateError,
  beginRun,
  dispatchState,
  getRun,
  isAction,
  listLocalRuns,
  recentRuns,
  releases,
} from './runs.mjs';
import { securityHeaders } from './security-headers.mjs';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'warn' },
  trustProxy: true,
  bodyLimit: 8_192,
});

// Registered before the routes so the skip-override hook covers every reply.
app.register(securityHeaders);

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof value === 'string' && value.trim()) {
    return value.split(',')[0].trim();
  }
  return request.ip;
}

app.get('/health', async () => ({ status: 'ok' }));

app.get('/', async (_request, reply) => {
  reply.header('cache-control', 'no-store');
  return reply.type('text/html; charset=utf-8').send(renderPage());
});

app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());

app.post('/api/run', async (request, reply) => {
  const body = request.body ?? {};
  const action = body.action;
  if (!isAction(action)) {
    return reply.code(400).send({
      error: 'invalid_action',
      message: 'action must be gates, bad-image or rollback',
    });
  }
  if (action === 'rollback' && body.confirm !== true) {
    return reply.code(400).send({
      error: 'confirm_required',
      message: 'rollback needs a confirm click',
    });
  }
  try {
    const run = beginRun({ action, ip: clientIp(request) });
    return reply.code(202).send(run);
  } catch (error) {
    if (error instanceof BusyError) {
      return reply.code(409).send({
        error: 'busy',
        runningId: error.id,
        message: 'another action is running',
      });
    }
    if (error instanceof RateError) {
      reply.header('retry-after', String(error.retryAfter));
      return reply.code(429).send({
        error: 'rate_limited',
        retryAfter: error.retryAfter,
        message: `one dispatch per address per ${Math.round(config.dispatchCooldownMs / 1000)}s`,
      });
    }
    if (error instanceof ConfigError) {
      return reply.code(400).send({ error: 'invalid_action', message: error.message });
    }
    request.log.error({ err: { message: error?.message } }, 'run could not start');
    return reply.code(500).send({ error: 'internal', message: 'the action could not start' });
  }
});

app.get('/api/run/:id', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  const run = getRun(request.params.id);
  if (!run) {
    return reply.code(404).send({ error: 'not_found', message: 'no such run' });
  }
  return run;
});

app.get('/api/runs', async (_request, reply) => {
  reply.header('cache-control', 'no-store');
  try {
    return await recentRuns();
  } catch {
    return {
      runs: listLocalRuns(10),
      readOnly: true,
      reason: 'the recent runs could not be read; showing what this instance remembers',
    };
  }
});

app.get('/api/releases', async (_request, reply) => {
  reply.header('cache-control', 'no-store');
  return releases();
});

app.get('/api/state', async () => dispatchState());

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.warn(`pipeline-demo listening on ${config.host}:${config.port}`);
} catch (error) {
  app.log.error({ err: { message: error?.message } }, 'listen failed');
  process.exit(1);
}
