import type { FastifyInstance } from 'fastify';

export interface SecurityHeadersOptions {
  contentSecurityPolicy: string;
}

// Fastify encapsulates a plugin's hooks in the plugin's own context unless the
// plugin opts out. This plugin is registered before the routes and must apply
// to every reply, so it declares the same skip-override flag fastify-plugin sets.
const skipOverride = Symbol.for('skip-override');

async function securityHeaders(
  app: FastifyInstance,
  options: SecurityHeadersOptions,
): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('content-security-policy', options.contentSecurityPolicy);
    return payload;
  });
}

Object.assign(securityHeaders, { [skipOverride]: true });

export { securityHeaders };
