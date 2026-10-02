import { randomUUID } from 'node:crypto';
import { config } from './config.mjs';
import { sleep, truncate } from './http.mjs';
import * as github from './github.mjs';
import * as render from './render.mjs';
import { runSmoke } from './smoke.mjs';

const ACTIONS = new Set(['gates', 'bad-image', 'rollback']);
const runs = new Map();
const lastDispatchByIp = new Map();
let activeRunId = null;
let recentCache = { at: 0, runs: [], reason: null };

export class BusyError extends Error {
  constructor(id) {
    super('another action is running');
    this.name = 'BusyError';
    this.id = id;
  }
}

export class RateError extends Error {
  constructor(retryAfter) {
    super('one dispatch per address per minute');
    this.name = 'RateError';
    this.retryAfter = retryAfter;
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function isAction(value) {
  return typeof value === 'string' && ACTIONS.has(value);
}

function touch(run) {
  run.updatedAt = new Date().toISOString();
}

function tail(lines, count) {
  return lines.slice(Math.max(0, lines.length - count));
}

function publicRun(run) {
  return {
    id: run.id,
    action: run.action,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    runId: run.runId,
    runUrl: run.runUrl,
    runStatus: run.runStatus,
    conclusion: run.conclusion,
    failingJob: run.failingJob,
    findingLines: run.findingLines ?? [],
    jobs: run.jobs,
    steps: run.steps,
    evidence: run.evidence,
    error: run.error,
    deploys: run.deploys,
    recovery: run.recovery ?? null,
  };
}

export function getRun(runId) {
  const run = runs.get(runId);
  return run ? publicRun(run) : null;
}

export function listLocalRuns(limit = 10) {
  return [...runs.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit)
    .map(publicRun);
}

function humanize(error, context = '') {
  if (error instanceof github.GitHubError) {
    if (error.status === 404 && context === 'dispatch') {
      return `GitHub returned 404 for ${config.workflowFile} on ${config.dispatchRef}. The workflow is not on the default branch yet; merge the branch and redeploy.`;
    }
    if (error.status === 401) return 'GitHub rejected GH_DISPATCH_TOKEN.';
    if (error.status === 403 || error.status === 429) return error.message;
    return error.message;
  }
  if (error instanceof render.RenderError) {
    if (error.status === 401 || error.status === 403) return 'Render rejected RENDER_API_KEY.';
    return error.message;
  }
  if (error instanceof ConfigError) return error.message;
  return error?.message ?? 'the action failed';
}

function fail(run, error, note, context = '') {
  run.status = 'failure';
  run.error = {
    message: humanize(error, context),
    note,
    status: error?.status || null,
    detail: error?.detail ? truncate(error.detail, 300) : null,
  };
  for (const entry of run.steps) {
    if (entry.status === 'running') entry.status = 'fail';
  }
  run.finishedAt = new Date().toISOString();
  touch(run);
}

export function beginRun({ action, ip }) {
  if (!isAction(action)) {
    throw new ConfigError('action must be gates, bad-image or rollback');
  }
  if (activeRunId) {
    throw new BusyError(activeRunId);
  }
  const now = Date.now();
  const last = lastDispatchByIp.get(ip) ?? 0;
  if (now - last < config.dispatchCooldownMs) {
    throw new RateError(Math.ceil((config.dispatchCooldownMs - (now - last)) / 1000));
  }
  lastDispatchByIp.set(ip, now);
  if (lastDispatchByIp.size > 500) {
    for (const [key, at] of lastDispatchByIp) {
      if (now - at > config.dispatchCooldownMs * 2) lastDispatchByIp.delete(key);
    }
  }

  const id = `run_${now.toString(36)}_${randomUUID().slice(0, 8)}`;
  const run = {
    id,
    action,
    status: 'queued',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    finishedAt: null,
    runId: null,
    runUrl: null,
    runStatus: null,
    conclusion: null,
    failingJob: null,
    findingLines: [],
    jobs: [],
    steps: [],
    evidence: [],
    error: null,
    deploys: null,
    recovery: null,
  };
  runs.set(id, run);
  activeRunId = id;

  const execute = action === 'rollback' ? executeRollback : executeWorkflow;
  void execute(run)
    .catch((error) => {
      fail(run, error, 'The action stopped unexpectedly.');
    })
    .finally(() => {
      run.finishedAt ??= new Date().toISOString();
      if (activeRunId === id) activeRunId = null;
      touch(run);
    });

  return publicRun(run);
}

function mapJobs(jobs) {
  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    url: job.html_url,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  }));
}

function visibleJobs(run) {
  return run.jobs.filter((job) => job.status !== 'skipped' && job.conclusion !== 'skipped');
}

async function findingLinesFor(job) {
  try {
    const log = await github.getJobLog(job.id);
    const lines = log
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /CVE-\d{4}-\d+/.test(line));
    return [...new Set(lines)].slice(0, 3).map((line) => truncate(line, 320));
  } catch {
    return ['the scanner log could not be read; open the run to see the finding'];
  }
}

async function executeWorkflow(run) {
  run.status = 'dispatching';
  touch(run);
  const since = Date.now();
  try {
    await github.dispatch(run.action);
  } catch (error) {
    fail(run, error, 'The workflow could not be dispatched. Nothing ran.', 'dispatch');
    return;
  }

  run.status = 'running';
  touch(run);
  try {
    const dispatched = await github.findDispatchedRun(since);
    run.runId = dispatched.id;
    run.runUrl = dispatched.html_url;
    touch(run);
  } catch (error) {
    fail(run, error, 'The dispatch was accepted but its run was not found.');
    return;
  }

  const deadline = Date.now() + config.workflowTimeoutMs;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    try {
      const info = await github.getRun(run.runId);
      const jobs = await github.getJobs(run.runId);
      run.runStatus = info.status;
      run.conclusion = info.conclusion;
      run.jobs = mapJobs(jobs);
      consecutiveFailures = 0;
      touch(run);

      if (info.status === 'completed') {
        const failed = run.jobs.find((job) => job.conclusion === 'failure') ?? null;
        run.failingJob = failed?.name ?? null;
        run.status = info.conclusion === 'success' ? 'success' : 'failure';
        if (run.action === 'bad-image' && failed) {
          run.findingLines = await findingLinesFor(failed);
        }
        const kept = visibleJobs(run);
        if (run.status === 'success') {
          run.evidence = [
            `run ${run.runId}: ${kept.length}/${kept.length} jobs green`,
            `run ${run.runUrl}`,
          ];
        } else {
          run.evidence = [
            `run ${run.runId}: ${run.failingJob ?? 'a job'} failed`,
            ...run.findingLines,
            `run ${run.runUrl}`,
          ];
          run.error = {
            message: `${run.failingJob ?? 'A job'} failed`,
            note: 'The run finished red.',
            status: null,
            detail: run.findingLines[0] ?? null,
          };
        }
        run.finishedAt = new Date().toISOString();
        touch(run);
        return;
      }
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) {
        fail(
          run,
          error,
          'The run started, but its status could not be refreshed. Open the run URL for the truth.',
        );
        return;
      }
    }
    await sleep(4_000);
  }

  fail(
    run,
    new Error('the workflow did not finish within the time limit'),
    'Open the run URL for the truth.',
  );
}

function step(run, key, label, detail = null) {
  const entry = {
    key,
    label,
    status: 'running',
    at: new Date().toISOString(),
    deployId: null,
    commit: null,
    targetDeployId: null,
    liveAt: null,
    exitCode: null,
    lines: [],
    failureLine: null,
    detail,
  };
  run.steps.push(entry);
  touch(run);
  return entry;
}

function recordSmoke(entry, smoke) {
  entry.exitCode = smoke.code;
  entry.lines = tail(smoke.lines, 14);
  entry.failureLine = smoke.failureLine;
  entry.status = smoke.ok ? 'ok' : entry.expected === 'fail' ? 'ok' : 'fail';
}

async function executeRollback(run) {
  run.status = 'running';
  touch(run);

  let live = null;
  let badIsLive = false;
  let restored = false;
  let rollbackDeploy = null;

  try {
    if (!config.badReleaseSha) {
      throw new ConfigError('BAD_RELEASE_SHA is not set; there is no faulty release to deploy.');
    }
    const deploys = await render.listDeploys();
    const { live: liveDeploy, previous } = render.splitLiveAndPrevious(deploys);
    if (!liveDeploy) {
      throw new ConfigError('Render reports no live deploy for invoice-api.');
    }
    if (!previous) {
      throw new ConfigError('The rollback button needs two deploys; Render reports only one.');
    }
    live = liveDeploy;
    run.deploys = {
      live: render.pickDeploy(liveDeploy),
      previous: render.pickDeploy(previous),
      bad: null,
      rollback: null,
    };

    const start = step(run, 'deploy.start', 'deploy the faulty release', 'Render accepted the deploy');
    const created = await render.createDeploy({ commitId: config.badReleaseSha });
    if (!created?.id) throw new render.RenderError('Render returned no deploy id', 0, null);
    start.deployId = created.id;
    start.commit = created.commit?.id ?? config.badReleaseSha;
    start.detail = `deploy ${created.id}`;
    run.deploys.bad = render.pickDeploy(created);
    touch(run);

    const badDeploy = await render.waitForDeploy(created.id, Date.now() + config.rollbackTimeoutMs);
    badIsLive = true;
    start.status = 'ok';
    start.liveAt = badDeploy.finishedAt ?? new Date().toISOString();
    start.detail = `live as ${badDeploy.id}`;
    run.deploys.bad = render.pickDeploy(badDeploy);
    touch(run);

    const health = step(run, 'health.ok', 'public /health answers 200');
    const healthy = await render.waitForHealth(Date.now() + config.healthTimeoutMs);
    health.status = 'ok';
    health.at = healthy.at;
    health.liveAt = healthy.at;
    touch(run);

    const badSmoke = step(run, 'smoke.fail', 'five assertions against the faulty release');
    badSmoke.expected = 'fail';
    const firstSmoke = await runSmoke();
    recordSmoke(badSmoke, firstSmoke);
    touch(run);

    const rollbackStart = step(run, 'rollback.start', `redeploy deploy ${live.id}`);
    rollbackDeploy = await render.rollbackTo(live.id);
    if (!rollbackDeploy?.id) {
      throw new render.RenderError('Render returned no deploy id for the rollback', 0, null);
    }
    rollbackStart.deployId = rollbackDeploy.id;
    rollbackStart.commit = rollbackDeploy.commit?.id ?? live.commit?.id ?? null;
    rollbackStart.targetDeployId = live.id;
    rollbackStart.detail = `rollback deploy ${rollbackDeploy.id}`;
    run.deploys.rollback = render.pickDeploy(rollbackDeploy);
    touch(run);

    rollbackDeploy = await render.waitForDeploy(
      rollbackDeploy.id,
      Date.now() + config.rollbackTimeoutMs,
    );
    rollbackStart.status = 'ok';
    rollbackStart.liveAt = rollbackDeploy.finishedAt ?? new Date().toISOString();
    rollbackStart.detail = `live as ${rollbackDeploy.id}`;
    run.deploys.rollback = render.pickDeploy(rollbackDeploy);
    restored = true;
    touch(run);

    const rollbackHealth = step(run, 'rollback.health.ok', 'public /health answers 200');
    const healthyAgain = await render.waitForHealth(Date.now() + config.healthTimeoutMs);
    rollbackHealth.status = 'ok';
    rollbackHealth.at = healthyAgain.at;
    rollbackHealth.liveAt = healthyAgain.at;
    touch(run);

    const goodSmoke = step(run, 'rollback.smoke.ok', 'five assertions against the restored deploy');
    goodSmoke.expected = 'pass';
    const secondSmoke = await runSmoke();
    recordSmoke(goodSmoke, secondSmoke);
    touch(run);
    if (!secondSmoke.ok) {
      throw new Error(
        `the restored deploy failed smoke: ${secondSmoke.failureLine ?? 'see transcript'}`,
      );
    }

    run.status = 'success';
    run.evidence = run.steps.map((entry) => {
      const parts = [entry.key];
      if (entry.deployId) parts.push(entry.deployId);
      if (entry.commit) parts.push(entry.commit.slice(0, 12));
      if (entry.at) parts.push(entry.at);
      return parts.join('  ');
    });
    run.finishedAt = new Date().toISOString();
    touch(run);
  } catch (error) {
    if (badIsLive && !restored) {
      try {
        let recovered = null;
        if (rollbackDeploy?.id) {
          recovered = await render.waitForDeploy(
            rollbackDeploy.id,
            Date.now() + config.rollbackTimeoutMs,
          );
        } else if (live) {
          const created = await render.rollbackTo(live.id);
          recovered = await render.waitForDeploy(
            created.id,
            Date.now() + config.rollbackTimeoutMs,
          );
        }
        if (recovered) {
          restored = true;
          run.recovery = `restored ${render.pickDeploy(recovered).id}`;
        }
      } catch (recoveryError) {
        run.recovery = `recovery failed: ${humanize(recoveryError)}`;
      }
    }
    fail(run, error, 'The rollback exercise did not complete.');
  }
}

export async function recentRuns() {
  const local = listLocalRuns(10);
  if (!config.dispatchToken) {
    return {
      runs: local,
      readOnly: true,
      reason: 'GH_DISPATCH_TOKEN is not set; the page is read-only.',
    };
  }
  if (Date.now() - recentCache.at > 15_000) {
    try {
      const remote = await github.listRecentRuns(10);
      recentCache = { at: Date.now(), runs: remote, reason: null };
    } catch (error) {
      const reason =
        error?.status === 404
          ? `${config.workflowFile} is not on ${config.dispatchRef} yet; runs appear after the merge.`
          : error?.status === 403 || error?.status === 429
            ? 'GitHub API rate limit reached; showing cached runs.'
            : humanize(error);
      recentCache = { at: Date.now(), runs: recentCache.runs, reason };
    }
  }
  const seen = new Set(local.map((run) => run.id));
  const remote = recentCache.runs.filter((run) => !seen.has(String(run.id)));
  return { runs: [...local, ...remote].slice(0, 10), readOnly: false, reason: recentCache.reason };
}

export async function releases() {
  try {
    const deploys = await render.listDeploys();
    const { live, previous } = render.splitLiveAndPrevious(deploys);
    let reason = null;
    if (!live) reason = 'Render reports no live deploy.';
    else if (!previous) reason = 'The rollback button needs two deploys.';
    else if (!config.badReleaseSha) reason = 'BAD_RELEASE_SHA is not configured.';
    return {
      ok: true,
      deploys: deploys.map(render.pickDeploy),
      live: render.pickDeploy(live),
      previous: render.pickDeploy(previous),
      ready: Boolean(live && previous && config.badReleaseSha),
      reason,
    };
  } catch (error) {
    return {
      ok: false,
      deploys: [],
      live: null,
      previous: null,
      ready: false,
      reason: humanize(error),
    };
  }
}

export function dispatchState() {
  return {
    readOnly: !config.dispatchToken,
    reason: config.dispatchToken ? null : 'GH_DISPATCH_TOKEN is not set; the page is read-only.',
  };
}
