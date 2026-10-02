import process from 'node:process';

const env = process.env;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = Object.freeze({
  port: number(env.PORT, 8090),
  host: env.HOST || '0.0.0.0',
  repo: env.GH_DISPATCH_REPO || 'Amine-Gherbi/cicd-pipeline',
  dispatchToken: env.GH_DISPATCH_TOKEN || '',
  dispatchRef: env.DISPATCH_REF || 'master',
  workflowFile: 'demo.yml',
  renderKey: env.RENDER_API_KEY || '',
  renderServiceId: env.RENDER_SERVICE_ID || '',
  invoiceApiUrl: (env.INVOICE_API_URL || 'https://invoice-api-26b4.onrender.com').replace(/\/+$/, ''),
  smokeToken: env.SMOKE_TOKEN || '',
  badReleaseSha: env.BAD_RELEASE_SHA || '',
  dispatchCooldownMs: number(env.DISPATCH_COOLDOWN_MS, 60_000),
  workflowTimeoutMs: number(env.WORKFLOW_TIMEOUT_MS, 20 * 60_000),
  rollbackTimeoutMs: number(env.ROLLBACK_TIMEOUT_MS, 20 * 60_000),
  healthTimeoutMs: number(env.HEALTH_TIMEOUT_MS, 6 * 60_000),
  smokeTimeoutMs: number(env.SMOKE_TIMEOUT_MS, 3 * 60_000),
});
