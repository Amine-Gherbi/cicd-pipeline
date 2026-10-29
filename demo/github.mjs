import { config } from './config.mjs';
import { request, stripAnsi, sleep } from './http.mjs';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.detail = detail;
  }
}

function headers() {
  if (!config.dispatchToken) {
    throw new GitHubError('GH_DISPATCH_TOKEN is not set', 0, null);
  }
  return {
    authorization: `Bearer ${config.dispatchToken}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'pipeline-demo',
  };
}

async function api(path, options = {}, timeoutMs = 15_000) {
  const response = await request(
    `${API}${path}`,
    { ...options, headers: { ...headers(), ...(options.headers ?? {}) } },
    timeoutMs,
  );
  if (response.status === 401) {
    throw new GitHubError('GitHub rejected the dispatch token', 401, null);
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const retryAfter = response.headers.get('retry-after');
    const rateLimited = remaining === '0' || response.status === 429;
    throw new GitHubError(
      rateLimited ? 'GitHub API rate limit reached' : 'GitHub refused the request',
      response.status,
      { remaining, retryAfter },
    );
  }
  return response;
}

export async function dispatch(action) {
  const response = await api(
    `/repos/${config.repo}/actions/workflows/${config.workflowFile}/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({ ref: config.dispatchRef, inputs: { action } }),
    },
    20_000,
  );
  if (response.status !== 204) {
    throw new GitHubError(
      `The workflow dispatch answered HTTP ${response.status}`,
      response.status,
      response.text.slice(0, 400),
    );
  }
}

function runMatches(run, since) {
  return (
    run.path === `.github/workflows/${config.workflowFile}` &&
    run.head_branch === config.dispatchRef &&
    Date.parse(run.created_at) >= since - 5_000
  );
}

export async function findDispatchedRun(since, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await api(
        `/repos/${config.repo}/actions/runs?event=workflow_dispatch&per_page=30`,
      );
      const runs = response.json?.workflow_runs ?? [];
      const matches = runs
        .filter((run) => runMatches(run, since))
        .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
      if (matches.length > 0) {
        return matches[0];
      }
    } catch (error) {
      lastError = error;
      if (error instanceof GitHubError && (error.status === 401 || error.status === 0)) {
        throw error;
      }
    }
    await sleep(3_000);
  }
  throw new GitHubError(
    'The dispatch was accepted but no matching run appeared',
    lastError?.status ?? 0,
    lastError?.message ?? null,
  );
}

export async function getRun(runId) {
  const response = await api(`/repos/${config.repo}/actions/runs/${runId}`);
  return response.json;
}

export async function getJobs(runId) {
  const response = await api(
    `/repos/${config.repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`,
  );
  return response.json?.jobs ?? [];
}

export async function getJobLog(jobId) {
  const url = `${API}/repos/${config.repo}/actions/jobs/${jobId}/logs`;
  const first = await request(url, { headers: headers(), redirect: 'manual' }, 25_000);
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get('location');
    if (location) {
      const second = await request(location, {}, 25_000);
      return stripAnsi(second.text);
    }
  }
  return stripAnsi(first.text);
}

export async function listRecentRuns(limit = 10) {
  const response = await api(
    `/repos/${config.repo}/actions/workflows/${config.workflowFile}/runs?event=workflow_dispatch&per_page=${limit}`,
  );
  return (response.json?.workflow_runs ?? []).map((run) => ({
    id: run.id,
    url: run.html_url,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  }));
}
