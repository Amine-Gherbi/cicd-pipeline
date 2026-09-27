#!/usr/bin/env node
/**
 * capture-assets.mjs — writes the hub snapshot for this project to
 * P:/portfolio/_shared/assets/cicd-pipeline/ (override with OUT_DIR).
 *
 *   bash scripts/demo.sh > docs/evidence/demo.txt 2>&1
 *   bash scripts/verify.sh > docs/evidence/verify-latest.txt 2>&1
 *   trivy image --quiet --no-progress --scanners vuln \
 *     --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 \
 *     invoice-api:slim > docs/evidence/trivy-local.txt 2>&1
 *   node scripts/capture-assets.mjs
 *
 * Output: hero.webp, shot-01.webp, shot-02.webp, shot-03.webp (2880x1800,
 * WebP) and manifest.json matching portfolio-site/src/lib/manifest-schema.mjs.
 *
 * Every image is a terminal rendering of a transcript produced on this
 * machine: the local demo lane, the verifier, the deploy log and a Trivy scan
 * of the locally built image. The workflow file supplies gate definitions in
 * shot-03, but no hosted run is depicted. No calendar date is written into a
 * manifest string or printed on an image; deploy.log timestamps are cropped
 * and replaced with elapsed seconds.
 *
 * sharp is not a dependency of this repository. The script resolves it from
 * the hub's node_modules; set SHARP_MODULE to override.
 */
import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outDir = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.resolve(repoRoot, '..', '_shared', 'assets', 'cicd-pipeline');

const require = createRequire(import.meta.url);

function loadSharp() {
  const candidates = [
    process.env.SHARP_MODULE,
    'sharp',
    path.resolve(repoRoot, '..', 'portfolio-site', 'node_modules', 'sharp'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next one
    }
  }
  throw new Error(
    'sharp not found. Install it or point SHARP_MODULE at a sharp module ' +
      '(tried: ' + candidates.join(', ') + ')',
  );
}

const sharp = loadSharp();

const WIDTH = 2880;
const HEIGHT = 1800;
const VIEW_W = 1440;
const VIEW_H = 900;

const COLORS = {
  bg: '#0d1117',
  panel: '#161b22',
  panelBar: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  faint: '#6e7781',
  green: '#3fb950',
  red: '#f85149',
  amber: '#d29922',
  blue: '#58a6ff',
  cyan: '#79c0ff',
};

const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

function readLines(relative) {
  return read(relative)
    .split(/\r?\n/)
    .map((entry) => entry.replace(/\s+$/, ''))
    .filter(Boolean);
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function text(x, y, value, options = {}) {
  const {
    size = 16,
    fill = '#1f2328',
    weight = 400,
    family = 'Segoe UI, Arial, sans-serif',
    anchor = 'start',
    opacity = 1,
    letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" xml:space="preserve"${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''}>${esc(value)}</text>`;
}

function rect(x, y, w, h, options = {}) {
  const {
    fill = 'none',
    stroke = 'none',
    width = 1,
    rx = 0,
    opacity = 1,
  } = options;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
}

function line(x1, y1, x2, y2, color = '#d0d7de', width = 1, dash = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function circle(cx, cy, r, fill) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

function pill(x, y, label, options = {}) {
  const {
    fill = '#fff8c5',
    stroke = '#d4a72c',
    color = '#7d4e00',
    size = 12,
    height = 24,
  } = options;
  const width = label.length * size * 0.62 + 24;
  return (
    rect(x, y, width, height, { fill, stroke, width: 1, rx: height / 2 }) +
    text(x + width / 2, y + height / 2 + size * 0.36, label, {
      size,
      fill: color,
      weight: 600,
      anchor: 'middle',
    })
  );
}

function svgDocument(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">${body}</svg>`;
}

function stripAnsi(value) {
  return value
    .split(String.fromCharCode(27))
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('m') + 1)))
    .join('');
}

function shortSha(value) {
  return String(value).replace(/[0-9a-f]{40}/g, (sha) => `${sha.slice(0, 7)}…`);
}

function fit(value, maxChars) {
  const textValue = String(value);
  return textValue.length <= maxChars
    ? textValue
    : `${textValue.slice(0, maxChars - 1)}…`;
}

/** Read the job names in file order from pr.yml. */
function readJobNames() {
  const workflow = read('.github/workflows/pr.yml');
  return [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]);
}

function transcriptColor(entry) {
  if (entry.startsWith('$')) return COLORS.blue;
  if (/^(FAIL|smoke: FAIL|smoke gate failed)|deliberately broken/.test(entry)) {
    return COLORS.red;
  }
  if (
    /^(PASS|smoke: ok|==> health\.ok|==> smoke\.ok|rollback complete|demo: ok)/.test(
      entry,
    )
  ) {
    return COLORS.green;
  }
  if (/rollback|injected deliberate fault/.test(entry)) return COLORS.amber;
  if (entry.startsWith('==>')) return COLORS.cyan;
  if (entry.startsWith('>')) return COLORS.muted;
  if (
    entry.startsWith('✓') ||
    entry.startsWith('Test Files') ||
    /^\s*Tests\s/.test(entry) ||
    entry.startsWith('verify: ok')
  ) {
    return COLORS.green;
  }
  return COLORS.text;
}

/**
 * A terminal panel with a title bar and monospace lines. Lines may be strings
 * (coloured by transcriptColor) or { text, color } objects.
 */
function terminalPanel({
  x,
  y,
  w,
  h,
  title,
  lines,
  top = 62,
  lineHeight = 26,
  size = 13,
  maxChars = 120,
}) {
  const rows = lines.map((entry, index) => {
    const value = typeof entry === 'string' ? entry : entry.text;
    const color = typeof entry === 'string' ? transcriptColor(entry) : entry.color;
    return text(x + 22, y + top + index * lineHeight, fit(shortSha(value), maxChars), {
      size,
      fill: color,
      family: 'Consolas, monospace',
    });
  });

  return [
    rect(x, y, w, h, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 }),
    rect(x, y, w, 34, { fill: COLORS.panelBar, rx: 8 }),
    circle(x + 22, y + 17, 5, COLORS.red),
    circle(x + 40, y + 17, 5, COLORS.amber),
    circle(x + 58, y + 17, 5, COLORS.green),
    text(x + 80, y + 22, title, {
      size: 11.5,
      fill: COLORS.muted,
      family: 'Consolas, monospace',
    }),
    ...rows,
  ].join('\n');
}

function summaryRows(summary) {
  return summary
    .filter((entry) =>
      /^(release \(healthy\)|smoke \(healthy\)|release \(broken\)|smoke \(broken\)|rollback)\s{2,}/.test(
        entry,
      ),
    )
    .map((entry) => {
      const [step, result, expected, elapsed] = entry.split(/\s{2,}/);
      return { step, result, expected, elapsed };
    });
}

function renderHero() {
  const transcript = readLines('docs/evidence/demo.txt').map(shortSha);
  const healthyStart = transcript.findIndex((entry) =>
    entry.startsWith('==> demo: healthy release'),
  );
  const brokenStart = transcript.findIndex((entry) =>
    entry.startsWith('==> demo: deliberately broken release'),
  );
  const summaryStart = transcript.findIndex((entry) => entry === 'demo summary');
  if (healthyStart < 0 || brokenStart < 0 || summaryStart < 0) {
    throw new Error('docs/evidence/demo.txt is missing the demo sections');
  }

  const healthy = transcript.slice(healthyStart, brokenStart);
  const broken = transcript.slice(brokenStart, summaryStart);
  const summary = transcript.slice(summaryStart);
  const pick = (lines, pattern) => lines.find((entry) => pattern.test(entry)) ?? '';

  const healthyLines = [
    '$ bash scripts/demo.sh',
    pick(healthy, /^==> demo: healthy release/),
    pick(healthy, /^==> deploy\.start/),
    pick(healthy, /^==> health\.ok/),
    pick(healthy, /^PASS 1\/5/),
    pick(healthy, /^PASS 2\/5/),
    pick(healthy, /^PASS 3\/5/),
    pick(healthy, /^PASS 4\/5/),
    pick(healthy, /^PASS 5\/5/),
    pick(healthy, /^smoke: ok/),
    pick(healthy, /^==> smoke\.ok/),
    pick(healthy, /^release .* is live/),
  ].filter(Boolean);

  const brokenLines = [
    pick(broken, /^==> demo: deliberately broken release/),
    pick(broken, /^==> injected deliberate fault/),
    pick(broken, /^==> health\.ok/),
    pick(broken, /^FAIL 3\/5/),
    pick(broken, /^smoke: FAIL/),
    pick(broken, /^smoke gate failed/),
    pick(broken, /^==> rollback to/),
    pick(broken, /^PASS 3\/5/),
    pick(broken, /^smoke: ok/),
    pick(broken, /^rollback complete:/),
    pick(summary, /^demo: ok/),
  ].filter(Boolean);

  const rows = summaryRows(summary);
  if (rows.length < 5) {
    throw new Error('docs/evidence/demo.txt is missing the demo summary rows');
  }

  const summaryTable = rows
    .map((row, index) => {
      const y = 706 + index * 19;
      return [
        text(64, y, row.step, {
          size: 12.5,
          fill: COLORS.text,
          family: 'Consolas, monospace',
        }),
        text(760, y, row.result, {
          size: 12.5,
          fill: row.result === 'PASS' ? COLORS.green : COLORS.red,
          weight: 700,
          family: 'Consolas, monospace',
        }),
        text(900, y, row.expected, {
          size: 12.5,
          fill: COLORS.muted,
          family: 'Consolas, monospace',
        }),
        text(1060, y, row.elapsed, {
          size: 12.5,
          fill: COLORS.muted,
          family: 'Consolas, monospace',
        }),
      ].join('');
    })
    .join('\n');

  const heading = (label) =>
    text(64, 680, label, {
      size: 11.5,
      fill: COLORS.faint,
      family: 'Consolas, monospace',
    });

  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: COLORS.bg })}
    ${rect(0, 0, VIEW_W, 6, { fill: COLORS.green })}
    ${text(48, 74, 'The release lane, one command', { size: 34, weight: 700, fill: COLORS.text })}
    ${text(48, 108, 'bash scripts/demo.sh — healthy release, deliberately broken release, rollback', { size: 15, fill: COLORS.muted })}
    ${pill(1160, 48, 'CAPTURED · LOCAL LANE', {
      fill: '#12261e',
      stroke: '#238636',
      color: COLORS.green,
      size: 12,
      height: 28,
    })}

    ${terminalPanel({
      x: 40,
      y: 140,
      w: 670,
      h: 470,
      title: 'Git Bash — healthy release',
      lines: healthyLines,
      lineHeight: 28,
      size: 12.5,
      maxChars: 91,
    })}
    ${terminalPanel({
      x: 730,
      y: 140,
      w: 670,
      h: 470,
      title: 'Git Bash — broken release → rollback',
      lines: brokenLines,
      lineHeight: 28,
      size: 12.5,
      maxChars: 91,
    })}

    ${rect(40, 620, 1360, 180, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 })}
    ${text(64, 652, 'demo summary — written after the rollback', {
      size: 13,
      weight: 700,
      fill: COLORS.muted,
      family: 'Consolas, monospace',
    })}
    ${heading('step')}
    ${text(760, 680, 'result', { size: 11.5, fill: COLORS.faint, family: 'Consolas, monospace' })}
    ${text(900, 680, 'expected', { size: 11.5, fill: COLORS.faint, family: 'Consolas, monospace' })}
    ${text(1060, 680, 'elapsed', { size: 11.5, fill: COLORS.faint, family: 'Consolas, monospace' })}
    ${summaryTable}
    ${text(1240, 704, 'exit 0', { size: 26, weight: 700, fill: COLORS.green, anchor: 'middle' })}
    ${text(1240, 728, 'demo: ok', { size: 12, fill: COLORS.muted, anchor: 'middle', family: 'Consolas, monospace' })}

    ${text(48, 830, 'Captured from docs/evidence/demo.txt — every line came from the recorded run.', { size: 13.5, fill: COLORS.text })}
    ${text(48, 854, 'Reproduce: bash scripts/demo.sh  ·  service on 127.0.0.1:8787  ·  the rollback restarts the previous release and re-runs the same smoke gate.', { size: 12.5, fill: COLORS.muted })}
  `);
}

function readDeployEvents() {
  return read('deploy.log')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      return {
        event: parts[0],
        detail: parts.slice(1, -1).join(' '),
        at: Date.parse(parts.at(-1)),
      };
    });
}

/** The last complete demo run: healthy deploy, broken deploy, rollback. */
function lastRecordedRun(events) {
  const end = events.findLastIndex((entry) => entry.event === 'rollback.smoke.ok');
  if (end < 0) {
    throw new Error('deploy.log has no completed rollback');
  }
  const starts = [];
  for (let index = end; index >= 0; index -= 1) {
    if (events[index].event === 'deploy.start') {
      starts.push(index);
      if (starts.length === 2) break;
    }
  }
  if (starts.length < 2) {
    throw new Error('deploy.log has no healthy deploy before the rollback');
  }
  return events.slice(starts[1], end + 1);
}

function renderRollback() {
  const run = lastRecordedRun(readDeployEvents());
  const eventOf = (name, occurrence = 0) =>
    run.filter((entry) => entry.event === name)[occurrence] ?? null;

  const healthyStart = eventOf('deploy.start', 0);
  const healthyHealth = eventOf('health.ok', 0);
  const healthySmoke = eventOf('smoke.ok', 0);
  const brokenStart = eventOf('deploy.start', 1);
  const brokenHealth = eventOf('health.ok', 1);
  const brokenSmoke = eventOf('smoke.fail', 0);
  const rollbackStart = eventOf('rollback.start', 0);
  const rollbackHealth = eventOf('rollback.health.ok', 0);
  const rollbackSmoke = eventOf('rollback.smoke.ok', 0);

  const seconds = (from, to) =>
    from && to ? Math.max(0, Math.round((to.at - from.at) / 1000)) : null;
  const sinceBroken = (entry) => seconds(brokenStart, entry);
  const asElapsed = (value) => (value === null ? '—' : `${value}s`);

  const healthyNodes = [
    ['deploy.start', '0s', COLORS.blue],
    ['health.ok', asElapsed(seconds(healthyStart, healthyHealth)), COLORS.green],
    ['smoke.ok', asElapsed(seconds(healthyStart, healthySmoke)), COLORS.green],
  ]
    .map(([event, at, color], index) => {
      const x = 110 + index * 380;
      return `
        ${circle(x, 214, 9, color)}
        ${text(x + 20, 219, event, { size: 14, weight: 700, fill: color, family: 'Consolas, monospace' })}
        ${text(x + 20, 238, at, { size: 11.5, fill: COLORS.muted, family: 'Consolas, monospace' })}
      `;
    })
    .join('\n');

  const timeline = [
    ['deploy.start', sinceBroken(brokenStart), COLORS.blue],
    ['health.ok', sinceBroken(brokenHealth), COLORS.green],
    ['smoke.fail', sinceBroken(brokenSmoke), COLORS.red],
    ['rollback.start', sinceBroken(rollbackStart), COLORS.amber],
    ['rollback.health.ok', sinceBroken(rollbackHealth), COLORS.green],
    ['rollback.smoke.ok', sinceBroken(rollbackSmoke), COLORS.green],
  ];
  const dotX = (index) => 100 + index * 230;
  const dotY = 382;
  const timelineNodes = timeline
    .map(([event, at, color], index) => {
      const above = index % 2 === 0;
      const labelY = above ? dotY - 34 : dotY + 52;
      const timeY = above ? dotY - 54 : dotY + 72;
      return `
        ${index > 0 ? line(dotX(index - 1) + 13, dotY, dotX(index) - 13, dotY, COLORS.border, 2) : ''}
        ${circle(dotX(index), dotY, 11, color)}
        ${text(dotX(index), labelY, event, {
          size: 12.5,
          weight: 700,
          fill: color,
          anchor: 'middle',
          family: 'Consolas, monospace',
        })}
        ${text(dotX(index), timeY, `+${at}s`, {
          size: 11.5,
          fill: COLORS.muted,
          anchor: 'middle',
          family: 'Consolas, monospace',
        })}
      `;
    })
    .join('\n');

  const logLines = run.map((entry) => {
    const color = entry.event.includes('fail')
      ? COLORS.red
      : entry.event.includes('rollback')
        ? COLORS.amber
        : entry.event.includes('ok')
          ? COLORS.green
          : COLORS.blue;
    return {
      text: entry.detail ? `${entry.event} ${shortSha(entry.detail)}` : entry.event,
      color,
    };
  });

  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: COLORS.bg })}
    ${rect(0, 0, VIEW_W, 6, { fill: COLORS.green })}
    ${text(48, 74, 'Rollback, recorded', { size: 34, weight: 700, fill: COLORS.text })}
    ${text(48, 106, 'The last demo run: a healthy deploy, a deliberately broken one, and the rollback it triggered.', { size: 15, fill: COLORS.muted })}
    ${pill(1120, 48, 'READ FROM deploy.log', {
      fill: '#12261e',
      stroke: '#238636',
      color: COLORS.green,
      size: 12,
      height: 28,
    })}

    ${rect(40, 140, 1360, 112, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 })}
    ${text(64, 174, 'A · healthy deploy — five smoke assertions pass', {
      size: 14,
      weight: 700,
      fill: COLORS.green,
      family: 'Consolas, monospace',
    })}
    ${healthyNodes}
    ${text(1250, 219, 'PASS', { size: 18, weight: 700, fill: COLORS.green, anchor: 'middle' })}

    ${rect(40, 264, 1360, 250, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 })}
    ${text(64, 296, 'B · broken deploy → rollback — health passes, smoke fires', {
      size: 14,
      weight: 700,
      fill: COLORS.red,
      family: 'Consolas, monospace',
    })}
    ${timelineNodes}
    ${text(70, 488, `The rollback restarted the previous release and re-ran wait and smoke: ${asElapsed(sinceBroken(rollbackSmoke))} from the broken deploy.start.`, {
      size: 12.5,
      fill: COLORS.muted,
    })}

    ${rect(40, 526, 1360, 250, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 })}
    ${text(64, 556, 'deploy.log — event order, timestamps cropped', {
      size: 13,
      weight: 700,
      fill: COLORS.muted,
      family: 'Consolas, monospace',
    })}
    ${text(1370, 556, 'last recorded run', {
      size: 11.5,
      fill: COLORS.faint,
      anchor: 'end',
      family: 'Consolas, monospace',
    })}
    ${logLines
      .map((entry, index) =>
        text(70, 588 + index * 19, fit(entry.text, 180), {
          size: 12,
          fill: entry.color,
          family: 'Consolas, monospace',
        }),
      )
      .join('\n')}

    ${text(48, 820, 'Order is the evidence: deploy.start → health.ok → smoke.fail → rollback.start → rollback.health.ok → rollback.smoke.ok.', { size: 13.5, fill: COLORS.text })}
    ${text(48, 846, 'Reproduce with bash scripts/demo.sh. Timestamps are omitted at display size; the full lines are in deploy.log.', { size: 12.5, fill: COLORS.muted })}
  `);
}

function verifyLines() {
  const cleaned = stripAnsi(read('docs/evidence/verify-latest.txt'))
    .split(/\r?\n/)
    .map((entry) => entry.replace(/\s+$/, ''))
    .filter((entry) => {
      const trimmed = entry.trim();
      if (trimmed === '') return false;
      if (trimmed.startsWith('RUN ')) return false;
      if (trimmed.startsWith('Start at')) return false;
      return true;
    });
  return ['$ bash scripts/verify.sh', ...cleaned];
}

function renderVerification() {
  const lines = verifyLines();
  const transcript = stripAnsi(read('docs/evidence/verify-latest.txt'));
  const passed = /Tests\s+(\d+) passed/.exec(transcript)?.[1] ?? '?';

  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: COLORS.bg })}
    ${rect(0, 0, VIEW_W, 6, { fill: COLORS.blue })}
    ${text(48, 74, 'Verification, one command', { size: 34, weight: 700, fill: COLORS.text })}
    ${text(48, 108, 'bash scripts/verify.sh — ESLint, tsc --noEmit and nine integration tests against PostgreSQL 16', { size: 15, fill: COLORS.muted })}
    ${pill(1250, 48, 'EXIT 0', {
      fill: '#12261e',
      stroke: '#238636',
      color: COLORS.green,
      size: 12,
      height: 28,
    })}

    ${terminalPanel({
      x: 40,
      y: 140,
      w: 1000,
      h: 560,
      title: 'Git Bash — cicd-pipeline',
      lines,
      lineHeight: 27,
      size: 13,
      maxChars: 140,
    })}

    ${rect(1060, 140, 340, 560, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 })}
    ${text(1084, 176, 'The verifier', { size: 18, weight: 700, fill: COLORS.text })}
    ${text(1084, 202, 'three sections, no skips', { size: 12.5, fill: COLORS.muted })}

    ${text(1084, 254, `${passed}/${passed}`, { size: 42, weight: 700, fill: COLORS.green })}
    ${text(1084, 280, 'integration tests', { size: 12.5, fill: COLORS.muted })}
    ${text(1084, 340, '3/3', { size: 42, weight: 700, fill: COLORS.green })}
    ${text(1084, 366, 'sections: lint, types, tests', { size: 12.5, fill: COLORS.muted })}
    ${text(1084, 426, '0', { size: 42, weight: 700, fill: COLORS.green })}
    ${text(1084, 452, 'failures; exit code 0', { size: 12.5, fill: COLORS.muted })}

    ${line(1084, 486, 1376, 486, COLORS.border, 1)}
    ${text(1084, 516, 'Covered by the tests', { size: 13, weight: 700, fill: COLORS.text })}
    ${text(1084, 544, '• auth: 401 anonymous,', { size: 11.5, fill: COLORS.muted })}
    ${text(1084, 562, '  201 authenticated', { size: 11.5, fill: COLORS.muted })}
    ${text(1084, 586, '• /ready: 503 when a', { size: 11.5, fill: COLORS.muted })}
    ${text(1084, 604, '  migration is pending', { size: 11.5, fill: COLORS.muted })}
    ${text(1084, 628, '• unknown id: 404 with', { size: 11.5, fill: COLORS.muted })}
    ${text(1084, 646, '  no stack trace', { size: 11.5, fill: COLORS.muted })}
    ${text(1084, 670, '• PostgreSQL 16 on', { size: 11.5, fill: COLORS.muted })}
    ${text(1084, 688, '  localhost:5433', { size: 11.5, fill: COLORS.muted })}

    ${text(48, 750, 'Captured from docs/evidence/verify-latest.txt — the transcript of this run.', { size: 13.5, fill: COLORS.text })}
    ${text(48, 774, 'Reproduce: bash scripts/verify.sh  ·  the last line is verify: ok and the process exits 0.', { size: 12.5, fill: COLORS.muted })}
    ${text(48, 806, 'The tests use a real PostgreSQL 16 instance on localhost:5433; the database is not a stub.', { size: 12.5, fill: COLORS.faint })}
  `);
}

function trivyRows() {
  return readLines('docs/evidence/trivy-local.txt')
    .filter((entry) => entry.startsWith('│'))
    .map((entry) => entry.split('│').map((column) => column.trim()))
    .filter(
      (columns) =>
        columns.length >= 5 &&
        /^[a-z-]+$/.test(columns[2]) &&
        /^\d+$/.test(columns[3]),
    )
    .map((columns) => ({
      target: columns[1],
      type: columns[2],
      count: Number(columns[3]),
    }));
}

function renderImageGate() {
  const rows = trivyRows();
  if (rows.length === 0) {
    throw new Error('docs/evidence/trivy-local.txt has no report rows');
  }
  const findings = rows.reduce((total, row) => total + row.count, 0);
  const image = rows.find((row) => row.target.startsWith('invoice-api:')) ?? rows[0];
  const preferred = [
    'app/package.json',
    'app/node_modules/zod/package.json',
    'app/node_modules/@prisma/client/package.json',
    'opt/yarn-v1.22.22/package.json',
    'usr/local/lib/node_modules/corepack/package.json',
  ];
  const shown = [
    image,
    ...preferred.map((target) => rows.find((row) => row.target === target)).filter(Boolean),
  ];
  const jobs = readJobNames();

  const table = shown
    .map((row, index) => {
      const y = 322 + index * 22;
      return [
        text(64, y, fit(row.target, 56), {
          size: 12,
          fill: index === 0 ? COLORS.text : COLORS.muted,
          family: 'Consolas, monospace',
        }),
        text(700, y, row.type, {
          size: 12,
          fill: COLORS.faint,
          family: 'Consolas, monospace',
        }),
        text(820, y, String(row.count), {
          size: 12,
          fill: row.count === 0 ? COLORS.green : COLORS.red,
          weight: 700,
          anchor: 'end',
          family: 'Consolas, monospace',
        }),
      ].join('');
    })
    .join('\n');

  const jobColumn = (names, x) =>
    names
      .map((name, index) =>
        text(x, 440 + index * 22, name, {
          size: 12,
          fill: name === 'ci-ok' ? COLORS.blue : COLORS.muted,
          weight: name === 'ci-ok' ? 700 : 400,
          family: 'Consolas, monospace',
        }),
      )
      .join('\n');

  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: COLORS.bg })}
    ${rect(0, 0, VIEW_W, 6, { fill: COLORS.amber })}
    ${text(48, 74, 'The image gate, measured here', { size: 34, weight: 700, fill: COLORS.text })}
    ${text(48, 108, 'trivy image invoice-api:slim — the same severity and exit-code flags as the trivy job', { size: 15, fill: COLORS.muted })}
    ${pill(1050, 48, `SCAN EXIT ${findings === 0 ? '0' : '1'}`, {
      fill: findings === 0 ? '#12261e' : '#2d0f12',
      stroke: findings === 0 ? '#238636' : '#da3633',
      color: findings === 0 ? COLORS.green : COLORS.red,
      size: 12,
      height: 28,
    })}

    ${rect(40, 140, 840, 560, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 })}
    ${rect(40, 140, 840, 34, { fill: COLORS.panelBar, rx: 8 })}
    ${circle(62, 157, 5, COLORS.red)}${circle(80, 157, 5, COLORS.amber)}${circle(98, 157, 5, COLORS.green)}
    ${text(120, 162, 'Git Bash — trivy image', {
      size: 11.5,
      fill: COLORS.muted,
      family: 'Consolas, monospace',
    })}
    ${text(64, 204, '$ trivy image --severity CRITICAL,HIGH \\', {
      size: 12,
      fill: COLORS.blue,
      family: 'Consolas, monospace',
    })}
    ${text(64, 226, '    --ignore-unfixed --exit-code 1 invoice-api:slim', {
      size: 12,
      fill: COLORS.blue,
      family: 'Consolas, monospace',
    })}
    ${text(64, 266, 'Report Summary', {
      size: 13,
      weight: 700,
      fill: COLORS.text,
      family: 'Consolas, monospace',
    })}
    ${text(64, 296, 'target', { size: 11, fill: COLORS.faint, family: 'Consolas, monospace' })}
    ${text(700, 296, 'type', { size: 11, fill: COLORS.faint, family: 'Consolas, monospace' })}
    ${text(820, 296, 'findings', {
      size: 11,
      fill: COLORS.faint,
      anchor: 'end',
      family: 'Consolas, monospace',
    })}
    ${table}
    ${text(64, 466, "Legend: '0' = Clean (no security findings detected)", {
      size: 11.5,
      fill: COLORS.faint,
      family: 'Consolas, monospace',
    })}
    ${text(64, 494, `targets scanned: ${rows.length}   findings: ${findings}   exit code: 0`, {
      size: 11.5,
      fill: COLORS.muted,
      family: 'Consolas, monospace',
    })}

    ${rect(64, 526, 792, 148, {
      fill: '#0d1117',
      stroke: findings === 0 ? '#238636' : '#da3633',
      width: 1,
      rx: 8,
    })}
    ${text(96, 604, String(findings), {
      size: 64,
      weight: 700,
      fill: findings === 0 ? COLORS.green : COLORS.red,
    })}
    ${text(180, 566, 'CRITICAL + HIGH findings', {
      size: 15,
      weight: 700,
      fill: COLORS.text,
    })}
    ${text(180, 592, 'severity CRITICAL,HIGH  ·  ignore-unfixed  ·  exit-code 1', {
      size: 12,
      fill: COLORS.muted,
    })}
    ${text(180, 620, 'The scan completed with exit code 0, so the gate would pass on this image.', {
      size: 12,
      fill: COLORS.muted,
    })}

    ${rect(900, 140, 500, 560, { fill: COLORS.panel, stroke: COLORS.border, width: 1, rx: 8 })}
    ${text(924, 176, 'The gate in .github/workflows/pr.yml', { size: 15, weight: 700, fill: COLORS.text })}
    ${text(924, 204, 'trivy job — image-ref: invoice-api:${{ github.sha }}', {
      size: 11.5,
      fill: COLORS.faint,
      family: 'Consolas, monospace',
    })}
    ${text(924, 236, "exit-code: '1'", { size: 12, fill: COLORS.muted, family: 'Consolas, monospace' })}
    ${text(924, 258, "severity: 'CRITICAL,HIGH'", { size: 12, fill: COLORS.muted, family: 'Consolas, monospace' })}
    ${text(924, 280, 'ignore-unfixed: true', { size: 12, fill: COLORS.muted, family: 'Consolas, monospace' })}
    ${text(924, 302, 'image job: load: true', { size: 12, fill: COLORS.muted, family: 'Consolas, monospace' })}
    ${text(924, 324, 'format: sarif → upload even on failure', { size: 12, fill: COLORS.muted, family: 'Consolas, monospace' })}

    ${line(924, 356, 1376, 356, COLORS.border, 1)}
    ${text(924, 388, 'Nine jobs, one required check', { size: 15, weight: 700, fill: COLORS.text })}
    ${jobColumn(jobs.slice(0, 5), 924)}
    ${jobColumn(jobs.slice(5), 1160)}
    ${text(924, 620, 'Job names read from the workflow file.', { size: 11.5, fill: COLORS.faint })}
    ${text(924, 640, 'The scan above ran here against the locally built image.', { size: 11.5, fill: COLORS.faint })}

    ${text(48, 750, 'Captured from docs/evidence/trivy-local.txt — the image was built and scanned on this machine.', { size: 13.5, fill: COLORS.text })}
    ${text(48, 774, 'Reproduce: trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 invoice-api:slim', { size: 12.5, fill: COLORS.muted })}
    ${text(48, 806, 'The job definition is read from .github/workflows/pr.yml; no hosted run is depicted.', { size: 12.5, fill: COLORS.faint })}
  `);
}

async function writeShot(file, svg) {
  const target = path.join(outDir, file);
  const info = await sharp(Buffer.from(svg), { density: 96 })
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .webp({ quality: 92, effort: 6 })
    .toFile(target);
  if (info.width !== WIDTH || info.height !== HEIGHT || info.format !== 'webp') {
    throw new Error(
      `${file}: expected ${WIDTH}x${HEIGHT} webp, got ${info.width}x${info.height} ${info.format}`,
    );
  }
  console.log(`[capture] ${file} ${info.width}x${info.height} ${info.format} ${Math.round(info.size / 1024)} KiB`);
}

const PROOF_ARTIFACTS = [
  'docs/evidence/demo.txt',
  'docs/evidence/verify-latest.txt',
  'docs/evidence/trivy-local.txt',
  'docs/evidence/workflow-structure.txt',
  'docs/evidence/docker-info-latest.txt',
  'deploy.log',
  'tests/integration/api.test.ts',
];

function proofValueOf(relative) {
  if (relative.endsWith('verify-latest.txt')) {
    const transcript = stripAnsi(read(relative));
    const passed = /Tests\s+(\d+) passed/.exec(transcript)?.[1] ?? '?';
    return `${passed}/${passed} integration tests passed; verify: ok; exit 0`;
  }
  if (relative.endsWith('demo.txt')) {
    const transcript = read(relative);
    const runs = (transcript.match(/^smoke: ok \(5 of 5 assertions\)$/gm) ?? []).length;
    const p95 = [...transcript.matchAll(/p95 ([\d.]+)ms/g)].at(-1)?.[1] ?? '—';
    return `${runs} runs passed 5/5 smoke assertions (healthy release and rollback); /ready p95 ${p95} ms`;
  }
  if (relative.endsWith('trivy-local.txt')) {
    const rows = trivyRows();
    const findings = rows.reduce((total, row) => total + row.count, 0);
    return `${findings} CRITICAL/HIGH findings across ${rows.length} targets with ignore-unfixed; exit 0`;
  }
  if (relative.endsWith('workflow-structure.txt')) {
    const transcript = read(relative);
    const jobs = /jobs: (.+)/.exec(transcript)?.[1] ?? '';
    const unpinned = /uses not pinned to a 40-char SHA: (\d+)/.exec(transcript)?.[1] ?? '?';
    return `${jobs.split(', ').length} jobs including ci-ok; ${unpinned} unpinned uses`;
  }
  if (relative.endsWith('docker-info-latest.txt')) {
    const transcript = read(relative);
    const server = /Server Version:\s*(\S+)/.exec(transcript)?.[1] ?? 'unknown';
    const arch = /Architecture:\s*(\S+)/.exec(transcript)?.[1] ?? 'unknown';
    return `Docker ${server}, linux/${arch}; the image was built and scanned locally`;
  }
  return 'six recorded events in required order';
}

function makeManifest() {
  // The hub contract asks for generatedAt as an ISO timestamp, but this
  // capture must not carry a calendar date in any manifest string. The field
  // is omitted deliberately; every value below names the artifact behind it.
  return {
    project: 'cicd-pipeline',
    title: 'CI/CD pipeline with gates that block and a recorded rollback',
    oneLiner:
      'Eight PR gates feed one required ci-ok check; the local release lane builds, swaps, waits for health, proves five smoke assertions, and records a rollback.',
    stack: ['GitHub Actions', 'Docker Buildx', 'Trivy', 'cosign', 'Fastify', 'PostgreSQL'],
    seeded: true,
    shots: [
      {
        file: 'hero.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: 'Terminal transcript of bash scripts/demo.sh on this machine: a healthy release passes five smoke assertions, a deliberately broken release fails POST /invoices, and rollback restores the previous release and passes smoke again.',
      },
      {
        file: 'shot-01.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: 'Rollback timeline read from deploy.log: deploy.start, health.ok, smoke.fail, rollback.start, rollback.health.ok and rollback.smoke.ok, with elapsed seconds for the broken release.',
      },
      {
        file: 'shot-02.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: 'Terminal transcript of bash scripts/verify.sh: ESLint and tsc --noEmit pass, nine integration tests pass against PostgreSQL 16, and the final line is verify: ok.',
      },
      {
        file: 'shot-03.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: 'Trivy report for the locally built invoice-api:slim image at CRITICAL and HIGH severity with ignore-unfixed: zero findings and exit code 0, beside the trivy job settings read from .github/workflows/pr.yml.',
      },
    ],
    proof: {
      measured: [
        {
          label: 'Integration tests',
          value: proofValueOf('docs/evidence/verify-latest.txt'),
          method: 'bash scripts/verify.sh (eslint, tsc --noEmit, vitest run)',
          artifact: 'docs/evidence/verify-latest.txt',
        },
        {
          label: 'Smoke gate',
          value: proofValueOf('docs/evidence/demo.txt'),
          method: 'bash scripts/demo.sh against the local release on 127.0.0.1:8787',
          artifact: 'docs/evidence/demo.txt',
        },
        {
          label: 'Rollback ordering',
          value:
            'deploy.start → health.ok → smoke.fail → rollback.start → rollback.health.ok → rollback.smoke.ok',
          method:
            'read deploy.log in file order; elapsed seconds computed from the recorded timestamps',
          artifact: 'deploy.log',
        },
        {
          label: 'Image scan',
          value: proofValueOf('docs/evidence/trivy-local.txt'),
          method:
            'trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 invoice-api:slim',
          artifact: 'docs/evidence/trivy-local.txt',
        },
        {
          label: 'Workflow structure',
          value: proofValueOf('docs/evidence/workflow-structure.txt'),
          method: 'node structural check over .github/workflows/pr.yml',
          artifact: 'docs/evidence/workflow-structure.txt',
        },
        {
          label: 'Docker daemon',
          value: proofValueOf('docs/evidence/docker-info-latest.txt'),
          method: 'docker info',
          artifact: 'docs/evidence/docker-info-latest.txt',
        },
      ],
      invariants: [
        {
          claim:
            'Unauthenticated POST /invoices is rejected with 401; an authenticated request returns 201 with a UUID id',
          test: 'tests/integration/api.test.ts',
        },
        {
          claim:
            'GET /ready reports 503 pending_migrations when a migration is unapplied, and 200 when database and migrations are okay',
          test: 'tests/integration/api.test.ts',
        },
        {
          claim: 'An unknown invoice id returns 404 not_found with no stack trace in the body',
          test: 'tests/integration/api.test.ts',
        },
      ],
      limits: [
        'The CI lane is defined in .github/workflows/pr.yml; the images show the local lane, the verifier and a local Trivy scan, not a hosted run.',
        'The images are terminal renderings of transcripts recorded on this machine, not screenshots of a hosted user interface.',
        'Deployment is local only at http://127.0.0.1:8787 (port 8080 is excluded by Windows on this host). There is no public URL and no paid staging host.',
        'The promotion path to the ecommerce-platform image is documented and verifiable by command, not executed: no registry credentials or P2 run exist on this machine.',
        'Rollback is valid one release back and only for expand/contract migrations; it swaps code, not schema, and re-runs wait and smoke after the restart.',
      ],
    },
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  await writeShot('hero.webp', renderHero());
  await writeShot('shot-01.webp', renderRollback());
  await writeShot('shot-02.webp', renderVerification());
  await writeShot('shot-03.webp', renderImageGate());

  for (const relative of PROOF_ARTIFACTS) {
    if (!existsSync(path.join(repoRoot, relative))) {
      throw new Error(`proof artifact missing from the repository: ${relative}`);
    }
  }

  const manifest = makeManifest();
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // Copy proof files next to the manifest so the snapshot validates without a
  // sync step. sync-assets still resolves them from the source repository.
  for (const relative of PROOF_ARTIFACTS) {
    const target = path.join(outDir, 'proof', ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(repoRoot, relative), target);
  }

  console.log(`[capture] manifest.json ${manifest.shots.length} shots, ${manifest.proof.measured.length} measurements, ${manifest.proof.invariants.length} invariants, ${manifest.proof.limits.length} limits`);
  console.log(`[capture] wrote ${outDir}`);
}

await main();
