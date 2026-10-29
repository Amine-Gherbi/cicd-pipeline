export function renderPage() {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pipeline · invoice-api</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0b0d;
    --panel: #111316;
    --panel-2: #15181c;
    --line: #23262b;
    --text: #e8e9ea;
    --muted: #8b9098;
    --dim: #5d636c;
    --green: #4ade80;
    --red: #f87171;
    --amber: #fbbf24;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
  body { font-family: var(--sans); font-size: 15px; line-height: 1.5; }
  .shell { max-width: 1180px; margin: 0 auto; padding: 28px 28px 22px; min-height: 100vh; display: flex; flex-direction: column; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-size: 15px; letter-spacing: .02em; }
  .mark { width: 9px; height: 9px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 4px rgba(74,222,128,.12); }
  .meta { color: var(--muted); font-family: var(--mono); font-size: 12px; }
  main { display: grid; grid-template-columns: minmax(320px, 390px) minmax(0, 1fr); gap: 22px; padding: 22px 0 18px; flex: 1; }
  .actions { display: flex; flex-direction: column; gap: 12px; }
  .action { position: relative; width: 100%; text-align: left; appearance: none; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 10px; padding: 16px 16px 14px; cursor: pointer; font: inherit; transition: border-color .15s, background .15s; }
  .action:hover:not(:disabled) { border-color: #3a3f46; background: var(--panel-2); }
  .action:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
  .action:disabled { cursor: not-allowed; opacity: .55; }
  .action .top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .action .num { color: var(--dim); font-family: var(--mono); font-size: 11px; }
  .action .state { color: var(--muted); font-family: var(--mono); font-size: 11px; text-transform: lowercase; }
  .action .state.ok { color: var(--green); }
  .action .state.bad { color: var(--red); }
  .action .state.run { color: var(--amber); }
  .action .title { display: block; margin-top: 7px; font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  .action .desc { display: block; margin-top: 4px; color: var(--muted); font-size: 13px; }
  .action .ev { display: block; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--line); color: var(--dim); font-family: var(--mono); font-size: 11.5px; overflow-wrap: anywhere; }
  .action .ev a { color: var(--muted); text-decoration: none; border-bottom: 1px solid #3a3f46; }
  .action .ev b { color: var(--text); font-weight: 500; }
  .action .ev.ok b { color: var(--green); }
  .action .ev.bad b { color: var(--red); }
  .confirm { margin-top: 10px; padding: 12px; border: 1px solid #4a2a2a; background: #1a1213; border-radius: 8px; }
  .confirm p { margin: 0 0 10px; color: #e6b6b6; font-size: 12.5px; }
  .confirm .row { display: flex; gap: 8px; }
  .confirm button { font: inherit; font-size: 12px; padding: 7px 10px; border-radius: 6px; cursor: pointer; border: 1px solid #5a3434; background: #2a1718; color: #ffd7d7; }
  .confirm button.ghost { border-color: var(--line); background: transparent; color: var(--muted); }
  .releases { margin-top: 2px; padding: 11px 13px; border: 1px dashed var(--line); border-radius: 8px; color: var(--dim); font-family: var(--mono); font-size: 11.5px; }
  .releases b { color: var(--muted); font-weight: 500; }
  .live { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; min-height: 430px; display: flex; flex-direction: column; }
  .live-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .live-head .label { color: var(--muted); font-family: var(--mono); font-size: 12px; }
  .live-head a { color: var(--text); font-family: var(--mono); font-size: 12px; text-decoration: none; border-bottom: 1px solid #3a3f46; overflow-wrap: anywhere; }
  .banner { margin-top: 12px; padding: 10px 12px; border-radius: 7px; font-size: 13px; }
  .banner.bad { background: #1d1213; border: 1px solid #4a2a2a; color: #f0b4b4; }
  .banner.warn { background: #1c1810; border: 1px solid #4a3d1e; color: #ecd79b; }
  .banner a { color: inherit; }
  .jobs { margin-top: 10px; display: flex; flex-direction: column; }
  .job { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 7px 2px; border-bottom: 1px solid #191c20; }
  .job:last-child { border-bottom: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); }
  .dot.queued { background: var(--dim); }
  .dot.in_progress { background: var(--amber); animation: pulse 1.4s ease-in-out infinite; }
  .dot.success { background: var(--green); }
  .dot.failure, .dot.cancelled { background: var(--red); }
  .dot.skipped { background: #2c3036; }
  @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
  .job .name { font-family: var(--mono); font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }
  .job .name a { color: inherit; text-decoration: none; }
  .job .name a:hover { border-bottom: 1px solid #3a3f46; }
  .job .result { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .job .result.success { color: var(--green); }
  .job .result.failure { color: var(--red); }
  .finding { margin: 8px 0 0 24px; padding: 9px 11px; background: #1a1213; border: 1px solid #4a2a2a; border-radius: 7px; color: #e9b9b9; font-family: var(--mono); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .timeline { margin-top: 12px; display: flex; flex-direction: column; }
  .step { display: grid; grid-template-columns: 142px minmax(0, 1fr) auto; gap: 10px; padding: 8px 2px; border-bottom: 1px solid #191c20; align-items: baseline; }
  .step:last-child { border-bottom: 0; }
  .step .key { font-family: var(--mono); font-size: 12px; color: var(--text); }
  .step.ok .key { color: var(--green); }
  .step.fail .key { color: var(--red); }
  .step.running .key { color: var(--amber); }
  .step .detail { font-family: var(--mono); font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }
  .step .detail b { color: var(--text); font-weight: 500; }
  .step .when { font-family: var(--mono); font-size: 11px; color: var(--dim); white-space: nowrap; }
  .notes { margin-top: auto; padding-top: 14px; color: var(--dim); font-size: 11.5px; border-top: 1px solid var(--line); }
  .notes p { margin: 0 0 4px; }
  .notes code { font-family: var(--mono); color: var(--muted); }
  .evidence-block { margin-top: 12px; padding: 11px 12px; background: #0d0f12; border: 1px solid var(--line); border-radius: 7px; font-family: var(--mono); font-size: 11px; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
  .evidence-block .ok { color: var(--green); }
  .evidence-block .bad { color: var(--red); }
  .empty { color: var(--dim); font-size: 12.5px; padding: 16px 2px; }
  .recent { margin-top: 14px; }
  .recent .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 6px 2px; border-bottom: 1px solid #191c20; font-family: var(--mono); font-size: 11.5px; }
  .recent .row:last-child { border-bottom: 0; }
  .recent a { color: var(--muted); text-decoration: none; }
  .recent a:hover { color: var(--text); }
  .recent .r { color: var(--dim); }
  .recent .r.success { color: var(--green); }
  .recent .r.failure { color: var(--red); }
  footer { display: flex; justify-content: space-between; gap: 16px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--dim); font-size: 11.5px; }
  footer .mono { font-family: var(--mono); }
  @media (max-width: 860px) {
    .shell { padding: 18px 16px; }
    main { grid-template-columns: 1fr; }
    .live { min-height: 360px; }
    .step { grid-template-columns: 118px minmax(0, 1fr); }
    .step .when { grid-column: 2; }
    footer { flex-direction: column; gap: 4px; }
  }
</style>
</head>
<body>
<div class="shell">
  <header class="head">
    <div class="brand"><span class="mark"></span> pipeline</div>
    <div class="meta">invoice-api · GitHub Actions · Render</div>
  </header>

  <main>
    <section class="actions" aria-label="Actions">
      <button class="action" data-action="gates" type="button">
        <span class="top"><span class="num">01</span><span class="state" id="state-gates">idle</span></span>
        <span class="title">Run the gates</span>
        <span class="desc">Eight gates on master. A real workflow dispatch; the job list fills as it runs.</span>
        <span class="ev" id="ev-gates"></span>
      </button>

      <button class="action" data-action="bad-image" type="button">
        <span class="top"><span class="num">02</span><span class="state" id="state-bad-image">idle</span></span>
        <span class="title">Ship a bad image</span>
        <span class="desc">Build from a pinned base digest with a known HIGH finding. Trivy fails the run.</span>
        <span class="ev" id="ev-bad-image"></span>
      </button>

      <button class="action" data-action="rollback" type="button" id="rollback-button">
        <span class="top"><span class="num">03</span><span class="state" id="state-rollback">idle</span></span>
        <span class="title">Roll back</span>
        <span class="desc">Deploy the faulty release, watch smoke fail, redeploy the live deploy, re-run smoke.</span>
        <span class="ev" id="ev-rollback"></span>
      </button>
      <div class="confirm" id="confirm" hidden>
        <p>This deploys the faulty release to invoice-api on purpose, runs the five assertions, then redeploys the live deploy. It takes about three minutes.</p>
        <div class="row">
          <button type="button" id="confirm-yes">Redeploy the previous deploy</button>
          <button type="button" class="ghost" id="confirm-no">Cancel</button>
        </div>
      </div>
      <div class="releases" id="releases">reading Render deploy history…</div>
    </section>

    <section class="live" aria-live="polite" aria-label="Live run">
      <div class="live-head">
        <span class="label" id="live-label">Live</span>
        <a id="run-link" href="#" hidden></a>
      </div>
      <div class="banner" id="banner" hidden></div>
      <div id="jobs" class="jobs"><div class="empty">No action running. Choose one on the left.</div></div>
      <div id="timeline" class="timeline" hidden></div>
      <div id="evidence-block" class="evidence-block" hidden></div>
      <div id="recent" class="recent"></div>
      <div class="notes">
        <p>invoice-api builds from the repository. Render exposes a deploy id and the commit it built; the timeline shows those rather than an image digest.</p>
        <p>The browser never holds a credential. Every provider call is made by the server and bounded in time.</p>
      </div>
    </section>
  </main>

  <footer>
    <span class="mono" id="footer-state">ready</span>
    <span>run id · deploy id · smoke transcript</span>
  </footer>
</div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    busy: false,
    activeId: null,
    timer: null,
    readOnly: false,
    releases: null,
    confirmOpen: false,
    latest: { gates: null, 'bad-image': null, rollback: null },
  };

  const LABEL = { idle: 'idle', dispatching: 'dispatching', running: 'running', success: 'green', failure: 'red' };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function short(value, length = 10) {
    if (!value) return '—';
    return String(value).slice(0, length);
  }

  function stamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().slice(11, 19) + 'Z';
  }

  function fullStamp(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  function banner(kind, message, link) {
    const node = $('banner');
    node.replaceChildren();
    node.className = 'banner ' + kind;
    node.hidden = false;
    node.append(document.createTextNode(message));
    if (link) {
      node.append(document.createTextNode(' '));
      const anchor = el('a', '', 'open run');
      anchor.href = link;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      node.append(anchor);
    }
  }

  function clearBanner() {
    const node = $('banner');
    node.hidden = true;
    node.replaceChildren();
  }

  function setState(action, value) {
    const node = $('state-' + action);
    if (!node) return;
    node.textContent = LABEL[value] || value;
    node.className = 'state ' + (value === 'success' ? 'ok' : value === 'failure' ? 'bad' : value === 'running' || value === 'dispatching' ? 'run' : '');
  }

  function setEvidence(action, kind, prefix, text, href) {
    const node = $('ev-' + action);
    node.replaceChildren();
    node.className = 'ev' + (kind ? ' ' + kind : '');
    if (prefix) node.append(el('b', '', prefix));
    if (text) {
      node.append(document.createTextNode((prefix ? ' · ' : '') + text));
    }
    if (href) {
      node.append(document.createTextNode(' · '));
      const anchor = el('a', '', 'run');
      anchor.href = href;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      node.append(anchor);
    }
  }

  async function jsonFetch(url, options) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  }

  function disableActions() {
    const rollback = $('rollback-button');
    document.querySelectorAll('.action').forEach((button) => {
      const action = button.dataset.action;
      button.disabled = state.busy || state.readOnly || (action === 'rollback' && !(state.releases && state.releases.ready));
    });
    if (!rollback.disabled) rollback.title = '';
    else if (state.readOnly) rollback.title = 'read-only';
    else if (!(state.releases && state.releases.ready)) rollback.title = (state.releases && state.releases.reason) || 'needs two deploys';
  }

  function renderReleases() {
    const node = $('releases');
    node.replaceChildren();
    const releases = state.releases;
    if (!releases || !releases.ok) {
      node.textContent = (releases && releases.reason) || 'Render deploy history is not available.';
      return;
    }
    if (!releases.live) {
      node.textContent = releases.reason || 'Render reports no live deploy.';
      return;
    }
    const live = el('div', '', '');
    live.append(el('b', '', 'live '));
    live.append(document.createTextNode((releases.live.id || '—') + ' · ' + short(releases.live.commit)));
    node.append(live);
    if (releases.previous) {
      const previous = el('div', '', '');
      previous.append(el('b', '', 'previous '));
      previous.append(document.createTextNode((releases.previous.id || '—') + ' · ' + short(releases.previous.commit)));
      node.append(previous);
    }
    if (!releases.ready) node.append(el('div', '', releases.reason || 'not ready'));
    disableActions();
  }

  function renderJobs(run) {
    const container = $('jobs');
    container.replaceChildren();
    const jobs = (run.jobs || []).filter((job) => job.status !== 'skipped' && job.conclusion !== 'skipped');
    if (jobs.length === 0) {
      if (run.status === 'failure' && run.error) {
        const box = el('div', 'evidence-block');
        box.append(el('span', 'bad', run.error.message));
        if (run.error.note) box.append(document.createTextNode(' · ' + run.error.note));
        if (run.error.detail) box.append(document.createTextNode(' · ' + run.error.detail));
        container.append(box);
        return;
      }
      container.append(el('div', 'empty', run.status === 'dispatching' ? 'Dispatch accepted. Waiting for the first job.' : 'Waiting for the run to report its jobs.'));
      return;
    }
    jobs.forEach((job) => {
      const row = el('div', 'job');
      row.append(el('span', 'dot ' + (job.conclusion || job.status || 'queued')));
      const name = el('span', 'name');
      if (job.url) {
        const anchor = el('a', '', job.name);
        anchor.href = job.url;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        name.append(anchor);
      } else {
        name.textContent = job.name;
      }
      row.append(name);
      const result = job.conclusion || job.status || 'queued';
      row.append(el('span', 'result ' + result, result));
      container.append(row);
    });
    if (run.findingLines && run.findingLines.length > 0) {
      const finding = el('pre', 'finding', run.findingLines.join('\n'));
      container.append(finding);
    }
  }

  function stepDetail(step) {
    const wrap = el('span', 'detail');
    if (step.deployId) {
      wrap.append(el('b', '', step.deployId));
      if (step.commit) wrap.append(document.createTextNode(' · commit ' + short(step.commit, 12)));
      if (step.targetDeployId) wrap.append(document.createTextNode(' · target ' + step.targetDeployId));
      if (step.detail) wrap.append(document.createTextNode(' · ' + step.detail));
    } else if (step.detail) {
      wrap.textContent = step.detail;
    } else {
      wrap.textContent = step.label;
    }
    if (step.failureLine) {
      wrap.append(document.createTextNode(' · ' + step.failureLine));
    }
    return wrap;
  }

  function renderTimeline(run) {
    const timeline = $('timeline');
    timeline.replaceChildren();
    timeline.hidden = !(run.steps && run.steps.length > 0);
    if (!run.steps || run.steps.length === 0) return;
    run.steps.forEach((step) => {
      const row = el('div', 'step ' + (step.status === 'ok' ? (step.key === 'smoke.fail' ? 'fail' : 'ok') : step.status));
      row.append(el('span', 'key', step.key));
      row.append(stepDetail(step));
      const when = step.liveAt || step.at;
      const time = el('span', 'when', when ? stamp(when) : '');
      if (when) time.title = fullStamp(when);
      row.append(time);
      timeline.append(row);
    });
  }

  function renderEvidenceBlock(run) {
    const block = $('evidence-block');
    block.replaceChildren();
    const lines = [];
    if (run.error) {
      lines.push({ kind: 'bad', text: run.error.message });
      if (run.error.note) lines.push({ kind: '', text: run.error.note });
      if (run.error.detail) lines.push({ kind: '', text: run.error.detail });
    }
    if (run.action !== 'rollback' && run.evidence && run.evidence.length > 0) {
      for (const line of run.evidence) lines.push({ kind: run.status === 'failure' ? 'bad' : 'ok', text: line });
    }
    if (run.recovery) lines.push({ kind: '', text: run.recovery });
    block.hidden = lines.length === 0;
    lines.forEach((line) => {
      block.append(el('div', line.kind, line.text));
    });
  }

  function runLabel(run) {
    if (run.action === 'rollback') return 'rollback';
    return run.action === 'bad-image' ? 'bad image' : 'gates';
  }

  function finishEvidence(run) {
    if (run.action === 'rollback') {
      if (run.status === 'success') {
        const bad = run.deploys && run.deploys.bad ? run.deploys.bad.id : '—';
        const rollback = run.deploys && run.deploys.rollback ? run.deploys.rollback.id : '—';
        setEvidence('rollback', 'ok', bad + ' → ' + rollback, 'six steps · smoke 5/5');
      } else {
        setEvidence('rollback', 'bad', run.error ? run.error.message : 'rollback failed', run.runUrl ? '' : 'not started', run.runUrl);
      }
      return;
    }
    const runId = run.runId || run.id;
    if (run.status === 'success') {
      const jobs = (run.jobs || []).filter((job) => job.status !== 'skipped' && job.conclusion !== 'skipped');
      setEvidence(run.action, 'ok', 'run ' + runId, jobs.length + '/' + jobs.length + ' jobs green', run.runUrl);
    } else if (run.status === 'failure') {
      const finding = run.findingLines && run.findingLines[0] ? ' · ' + run.findingLines[0] : '';
      setEvidence(run.action, 'bad', 'run ' + runId + ' · ' + (run.failingJob || 'failed'), run.error ? run.error.message + finding : 'failed', run.runUrl);
    }
  }

  function renderRun(run) {
    state.activeId = run.id;
    $('live-label').textContent = 'Live · ' + runLabel(run);
    const link = $('run-link');
    if (run.runUrl) {
      link.hidden = false;
      link.href = run.runUrl;
      link.textContent = 'run ' + run.runId;
    } else {
      link.hidden = true;
      link.textContent = '';
    }
    setState(run.action, run.status);
    if (run.status === 'failure' && run.error) {
      banner('bad', run.error.message + (run.error.note ? ' — ' + run.error.note : ''), run.runUrl);
    } else {
      clearBanner();
    }
    if (run.action === 'rollback') {
      $('jobs').hidden = true;
      $('jobs').replaceChildren();
    } else {
      $('jobs').hidden = false;
      renderJobs(run);
    }
    renderTimeline(run);
    renderEvidenceBlock(run);
    $('recent').hidden = true;
    if (run.status === 'success' || run.status === 'failure') {
      finishEvidence(run);
      state.latest[run.action] = run;
      state.busy = false;
      state.activeId = null;
      disableActions();
      $('footer-state').textContent = run.status === 'success' ? 'last action green' : 'last action red';
      loadReleases();
    } else {
      state.busy = true;
      disableActions();
      $('footer-state').textContent = 'action in flight';
    }
  }

  function renderRecent(body) {
    const node = $('recent');
    node.replaceChildren();
    if (state.activeId || state.busy) return;
    const runs = (body && body.runs) || [];
    const head = el('div', 'live-head');
    head.append(el('span', 'label', 'Recent runs'));
    node.append(head);
    if (runs.length === 0) {
      node.append(el('div', 'empty', 'No runs on this instance yet.'));
      return;
    }
    runs.forEach((run) => {
      const row = el('div', 'row');
      const left = el('span', '');
      if (run.runUrl) {
        const anchor = el('a', '', 'run ' + run.runId + ' · ' + runLabel(run));
        anchor.href = run.runUrl;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        left.append(anchor);
      } else {
        left.textContent = 'run ' + (run.runId || run.id) + ' · ' + runLabel(run);
      }
      row.append(left);
      row.append(el('span', 'r ' + (run.conclusion || run.status || ''), run.conclusion || run.status || ''));
      node.append(row);
    });
  }

  async function loadReleases() {
    const result = await jsonFetch('/api/releases');
    state.releases = result.body;
    renderReleases();
  }

  async function loadState() {
    const [runs, releasesResult] = await Promise.all([jsonFetch('/api/runs'), jsonFetch('/api/releases')]);
    state.releases = releasesResult.body;
    renderReleases();
    if (runs.body) {
      state.readOnly = Boolean(runs.body.readOnly);
      if (state.readOnly) {
        banner('warn', runs.body.reason || 'The page is read-only.');
      } else if (runs.body.reason) {
        banner('warn', runs.body.reason);
      }
      const locals = (runs.body.runs || []).filter((run) => run.action);
      for (const run of locals) {
        if (!state.latest[run.action]) state.latest[run.action] = run;
      }
      for (const action of Object.keys(state.latest)) {
        const run = state.latest[action];
        if (run && (run.status === 'success' || run.status === 'failure')) finishEvidence(run);
      }
      renderRecent(runs.body);
    }
    disableActions();
  }

  async function follow(id, initial) {
    if (initial) renderRun(initial);
    const tick = async () => {
      const result = await jsonFetch('/api/run/' + encodeURIComponent(id));
      if (result.status !== 200 || !result.body) {
        banner('bad', 'The run could not be read; it may have been lost when the instance restarted.');
        state.busy = false;
        disableActions();
        return;
      }
      renderRun(result.body);
      if (result.body.status === 'success' || result.body.status === 'failure') {
        return;
      }
      state.timer = setTimeout(tick, 2000);
    };
    state.timer = setTimeout(tick, 1200);
  }

  async function start(action) {
    if (state.busy || state.readOnly) return;
    const body = { action };
    if (action === 'rollback') body.confirm = true;
    state.busy = true;
    setState(action, 'dispatching');
    disableActions();
    const result = await jsonFetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (result.status === 202 && result.body) {
      follow(result.body.id, result.body);
      return;
    }
    state.busy = false;
    setState(action, 'idle');
    disableActions();
    if (result.status === 409) {
      const runningId = result.body && result.body.runningId;
      banner('warn', 'Another action is running' + (runningId ? ' (' + runningId + ')' : '') + '. Following it.');
      if (runningId) follow(runningId);
      return;
    }
    if (result.status === 429) {
      const wait = result.body && result.body.retryAfter ? result.body.retryAfter : 60;
      banner('warn', 'One dispatch per address per minute. Try again in ' + wait + 's.');
      state.busy = true;
      disableActions();
      setTimeout(() => { state.busy = false; disableActions(); }, wait * 1000);
      return;
    }
    const message = result.body && result.body.message ? result.body.message : 'the action could not start';
    banner('bad', message);
  }

  document.querySelectorAll('.action').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'rollback') {
        if (!(state.releases && state.releases.ready)) {
          banner('warn', (state.releases && state.releases.reason) || 'The rollback button needs two deploys.');
          return;
        }
        state.confirmOpen = true;
        $('confirm').hidden = false;
        $('confirm-yes').focus();
        return;
      }
      start(action);
    });
  });

  $('confirm-no').addEventListener('click', () => {
    state.confirmOpen = false;
    $('confirm').hidden = true;
  });
  $('confirm-yes').addEventListener('click', () => {
    state.confirmOpen = false;
    $('confirm').hidden = true;
    start('rollback');
  });

  loadState();
})();
</script>
</body>
</html>`;
}
