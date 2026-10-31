// Security headers for every demo reply. The page is a single document with
// inline style and script, so the CSP keeps 'unsafe-inline' for those two
// directives while forbidding everything else.
export const DEMO_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// Fastify encapsulates a plugin's hooks in the plugin's own context unless the
// plugin opts out. Register this before the routes and let it cover every reply.
const skipOverride = Symbol.for('skip-override');

export async function securityHeaders(app) {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('content-security-policy', DEMO_CONTENT_SECURITY_POLICY);
    return payload;
  });
}

securityHeaders[skipOverride] = true;
