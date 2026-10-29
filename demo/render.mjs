import { config } from './config.mjs';
import { request, sleep, truncate } from './http.mjs';

const API = 'https://api.render.com/v1';
const TERMINAL_FAILURES = new Set([
  'build_failed',
  'update_failed',
  'pre_deploy_failed',
  'canceled',
  'deactivated',
]);

export class RenderError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'RenderError';
    this.status = status;
    this.detail = detail;
  }
}

function headers() {
  if (!config.renderKey) {
    throw new RenderError('RENDER_API_KEY is not set', 0, null);
  }
  return {
    authorization: `Bearer ${config.renderKey}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

async function api(path, options = {}, timeoutMs = 20_000) {
  const response = await request(
    `${API}${path}`,
    { ...options, headers: { ...headers(), ...(options.headers ?? {}) } },
    timeoutMs,
  );
  if (response.status === 401 || response.status === 403) {
    throw new RenderError('Render rejected RENDER_API_KEY', response.status, null);
  }
  if (response.status === 404) {
    throw new RenderError('Render could not find the service or deploy', 404, null);
  }
  if (response.status === 429) {
    throw new RenderError('Render rate limit reached', 429, null);
  }
  if (!response.ok) {
    throw new RenderError(
      `Render answered HTTP ${response.status}`,
      response.status,
      truncate(response.text),
    );
  }
  return response;
}

export function pickDeploy(deploy) {
  if (!deploy) return null;
  return {
    id: deploy.id,
    status: deploy.status,
    commit: deploy.commit?.id ?? null,
    commitMessage: deploy.commit?.message?.split('\n')[0] ?? null,
    createdAt: deploy.createdAt ?? null,
    finishedAt: deploy.finishedAt ?? null,
    trigger: deploy.trigger ?? null,
  };
}

export async function listDeploys() {
  const response = await api(`/services/${config.renderServiceId}/deploys?limit=20`);
  const rows = Array.isArray(response.json) ? response.json : [];
  return rows.map((row) => row.deploy ?? row).filter(Boolean);
}

export async function getDeploy(deployId) {
  const response = await api(`/services/${config.renderServiceId}/deploys/${deployId}`);
  return response.json?.deploy ?? response.json;
}

export async function createDeploy({ commitId }) {
  const response = await api(`/services/${config.renderServiceId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ commitId }),
  });
  return response.json?.deploy ?? response.json;
}

export async function rollbackTo(deployId) {
  const response = await api(`/services/${config.renderServiceId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ deployId }),
  });
  return response.json?.deploy ?? response.json;
}

export async function waitForDeploy(deployId, deadline) {
  let last = null;
  while (Date.now() < deadline) {
    last = await getDeploy(deployId);
    if (last?.status === 'live') return last;
    if (last?.status && TERMINAL_FAILURES.has(last.status)) {
      throw new RenderError(`Deploy ${deployId} ended in ${last.status}`, 0, last.status);
    }
    await sleep(8_000);
  }
  throw new RenderError(`Deploy ${deployId} did not reach live in time`, 0, last?.status ?? null);
}

export async function waitForHealth(deadline) {
  let last = '000';
  while (Date.now() < deadline) {
    try {
      const response = await request(`${config.invoiceApiUrl}/health`, {}, 10_000);
      last = String(response.status);
      if (response.status === 200 && response.json?.status === 'ok') {
        return { status: 200, at: new Date().toISOString() };
      }
    } catch {
      last = '000';
    }
    await sleep(5_000);
  }
  throw new RenderError(`${config.invoiceApiUrl}/health did not answer 200 in time`, 0, last);
}

export function splitLiveAndPrevious(deploys) {
  const ordered = [...deploys].sort(
    (left, right) => Date.parse(right.createdAt ?? 0) - Date.parse(left.createdAt ?? 0),
  );
  const live = ordered.find((deploy) => deploy.status === 'live') ?? null;
  const index = live ? ordered.findIndex((deploy) => deploy.id === live.id) : -1;
  const previous = index >= 0 ? ordered[index + 1] ?? null : ordered[1] ?? null;
  return { ordered, live, previous };
}
