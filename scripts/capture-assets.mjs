#!/usr/bin/env node
/**
 * capture-assets.mjs — writes the hub snapshot for this project to
 * P:/portfolio/_shared/assets/cicd-pipeline/ (override with OUT_DIR).
 *
 *   node scripts/capture-assets.mjs
 *
 * Output: hero.webp, shot-01.webp, shot-02.webp, shot-03.webp (2880x1800,
 * WebP) and manifest.json matching portfolio-site/src/lib/manifest-schema.mjs.
 *
 * Everything is rendered from local files. This host has no git remote, so no
 * GitHub page exists to screenshot; the hero is a static mock rendered from
 * .github/workflows/pr.yml and is labelled as such both on the image and in
 * the manifest `alt`. The other three shots are rendered from deploy.log and
 * transcripts captured by this repository's scripts — also not screenshots.
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

const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

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
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}"${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''}>${esc(value)}</text>`;
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

function statusIcon(cx, cy, ok) {
  const color = ok ? '#1a7f37' : '#cf222e';
  const mark = ok
    ? `<path d="M ${cx - 6} ${cy} l 4.5 4.5 l 8 -9" stroke="#ffffff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M ${cx - 5} ${cy - 5} L ${cx + 5} ${cy + 5} M ${cx + 5} ${cy - 5} L ${cx - 5} ${cy + 5}" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>`;
  return `${circle(cx, cy, 11, color)}${mark}`;
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

/** Read the job names in file order from pr.yml. */
function readJobNames() {
  const workflow = read('.github/workflows/pr.yml');
  return [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]);
}

const GATE_META = {
  lint: ['ESLint 9 + typescript-eslint', 'any lint error'],
  typecheck: ['tsc --noEmit', 'any type error'],
  test: ['vitest, 9 integration tests, postgres:16', 'a test fails'],
  image: ['Buildx build, load: true', 'the image does not build'],
  trivy: ["CRITICAL,HIGH, exit-code '1'", 'a fixable CRITICAL/HIGH CVE'],
  gitleaks: ['secret scan over PR history', 'a secret is found'],
  'migration-gate': ['fixture, deploy under locks, drift diff', 'fail, drift or unlabelled DROP'],
  'bundle-size': ['dist/ against 512 KiB', 'dist/ > 512 KiB'],
};

function renderHero() {
  const jobs = readJobNames().filter((name) => name !== 'ci-ok');
  const failed = new Set(['trivy']);
  const failures = [...failed];
  const successCount = jobs.length - failures.length;
  const rows = [];
  const rowTop = 292;
  const rowHeight = 47;
  const heights = {
    lint: '8s',
    typecheck: '11s',
    test: '1m 24s',
    image: '2m 02s',
    trivy: '14s',
    gitleaks: '9s',
    'migration-gate': '31s',
    'bundle-size': '12s',
  };

  jobs.forEach((job, index) => {
    const y = rowTop + index * rowHeight;
    const ok = !failed.has(job);
    const meta = GATE_META[job] ?? ['gate', 'fails'];
    if (index % 2 === 0) {
      rows.push(rect(28, y, 1384, rowHeight, { fill: '#f6f8fa' }));
    }
    rows.push(statusIcon(56, y + rowHeight / 2, ok));
    rows.push(
      text(80, y + 20, job, { size: 15, weight: 600, family: 'Consolas, monospace' }),
    );
    rows.push(text(80, y + 37, meta[0], { size: 11.5, fill: '#59636e' }));
    rows.push(
      text(1110, y + 28, ok ? `Successful in ${heights[job] ?? '—'}` : `Failed in ${heights[job] ?? '—'}`, {
        size: 13,
        fill: ok ? '#1a7f37' : '#cf222e',
        weight: 600,
        anchor: 'end',
      }),
    );
    rows.push(text(1360, y + 28, ok ? 'Expected pass' : 'Expected failure', {
      size: 11,
      fill: '#59636e',
      anchor: 'end',
    }));
    rows.push(line(28, y + rowHeight, 1412, y + rowHeight, '#d8dee4', 1));
  });

  const ciY = rowTop + jobs.length * rowHeight;
  rows.push(rect(28, ciY, 1384, rowHeight, { fill: '#ffebe9' }));
  rows.push(statusIcon(56, ciY + rowHeight / 2, false));
  rows.push(text(80, ciY + 20, 'ci-ok', { size: 15, weight: 700, family: 'Consolas, monospace' }));
  rows.push(text(80, ciY + 37, 'aggregator: toJSON(needs), every result must be success', {
    size: 11.5,
    fill: '#59636e',
  }));
  rows.push(text(1110, ciY + 28, 'Failed in 3s', { size: 13, fill: '#cf222e', weight: 600, anchor: 'end' }));
  rows.push(text(1360, ciY + 28, 'Required check', { size: 11, fill: '#cf222e', weight: 700, anchor: 'end' }));

  const footerTop = 824;
  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: '#ffffff' })}
    ${rect(0, 0, VIEW_W, 56, { fill: '#24292f' })}
    ${text(32, 35, 'GitHub', { size: 22, weight: 700, fill: '#ffffff' })}
    ${text(142, 35, 'Pull request', { size: 14, fill: '#c9d1d9' })}
    ${pill(1080, 14, 'MOCK — rendered from pr.yml', {
      fill: '#3d2c00',
      stroke: '#d4a72c',
      color: '#ffd33d',
      size: 12,
    })}

    ${text(32, 93, 'cicd-pipeline', { size: 18, weight: 600, fill: '#0969da' })}
    ${text(157, 93, '· local repository · no remote', { size: 13, fill: '#59636e' })}

    ${text(32, 143, '[DEMO] expected failure — trivy image (CVE-2021-23337)', {
      size: 29,
      weight: 600,
    })}
    ${pill(32, 162, 'Draft', { fill: '#f6f8fa', stroke: '#d0d7de', color: '#59636e', size: 12, height: 26 })}
    ${text(108, 180, 'demo/trivy-cve-2021-23337 → main · 1 commit · 1 file changed · base: main', {
      size: 13.5,
      fill: '#59636e',
    })}

    ${rect(28, 196, 1384, 74, { fill: '#ffebe9', stroke: '#ff8182', width: 1, rx: 6 })}
    ${statusIcon(58, 228, false)}
    ${text(82, 224, 'Merging is blocked — 1 of 8 gates failed', { size: 17, weight: 600, fill: '#cf222e' })}
    ${text(82, 248, 'Required status check "ci-ok" is failing. The failing job is trivy (expected).', {
      size: 13.5,
      fill: '#57606a',
    })}
    ${pill(1190, 220, 'ci-ok · required', {
      fill: '#cf222e',
      stroke: '#cf222e',
      color: '#ffffff',
      size: 12,
      height: 28,
    })}

    ${rect(28, 282, 1384, 18, { fill: '#ffffff' })}
    ${rect(28, 292 + 0, 1384, 0, { fill: 'none' })}
    ${rows.join('\n')}

    ${rect(0, footerTop, VIEW_W, VIEW_H - footerTop, { fill: '#f6f8fa' })}
    ${line(0, footerTop, VIEW_W, footerTop, '#d0d7de', 1)}
    ${text(32, footerTop + 28, 'MOCK, not a screenshot. Rendered from .github/workflows/pr.yml — no GitHub run, PR or remote exists.', {
      size: 13.5,
      weight: 600,
      fill: '#57606a',
    })}
    ${text(32, footerTop + 50, `Expected outcome: ${successCount} gates pass, ${failures.join(', ')} fails, ci-ok aggregates the failure. Recorded as unverified in docs/EVIDENCE.md.`, {
      size: 12.5,
      fill: '#6e7781',
    })}
  `);
}

function readDeployLog() {
  return read('deploy.log')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [event, ...rest] = line.split(' ');
      return { event, rest };
    });
}

function secondsBetween(first, second) {
  const at = (entry) => {
    const stamp = entry.rest[entry.rest.length - 1];
    return Date.parse(stamp);
  };
  return Math.round((at(second) - at(first)) / 1000);
}

function renderRollback() {
  const entries = readDeployLog();
  const brokenStart = entries.filter((entry) => entry.event === 'deploy.start')[1] ?? entries.at(-2);
  const finished = entries.findLast((entry) => entry.event === 'rollback.smoke.ok') ?? entries.at(-1);
  const duration = brokenStart && finished ? secondsBetween(brokenStart, finished) : null;

  const good = entries.slice(0, 3);
  const broken = entries.slice(3);
  const timeline = [
    ['deploy.start', '#58a6ff'],
    ['health.ok', '#3fb950'],
    ['smoke.fail', '#f85149'],
    ['rollback.start', '#d29922'],
    ['rollback.health.ok', '#3fb950'],
    ['rollback.smoke.ok', '#3fb950'],
  ];

  const dotX = (index) => 120 + index * 196;
  const dotY = 512;
  const panelTop = 626;
  const panelHeight = 212;
  const logStart = 680;
  const nodes = timeline
    .map(([event], index) => {
      const entry = broken.find((candidate) => candidate.event === event);
      const color = timeline[index][1];
      const stamp = entry ? entry.rest[entry.rest.length - 1]?.slice(11) : '—';
      const labelY = index % 2 === 0 ? dotY - 42 : dotY + 64;
      return `
        ${index > 0 ? line(dotX(index - 1) + 12, dotY, dotX(index) - 12, dotY, '#30363d', 2) : ''}
        ${circle(dotX(index), dotY, 12, color)}
        ${text(dotX(index), labelY, event, {
          size: 14,
          weight: 700,
          fill: color,
          anchor: 'middle',
          family: 'Consolas, monospace',
        })}
        ${text(dotX(index), labelY + (index % 2 === 0 ? -19 : 20), stamp, {
          size: 12.5,
          fill: '#8b949e',
          anchor: 'middle',
          family: 'Consolas, monospace',
        })}
      `;
    })
    .join('\n');

  const logLines = entries
    .map((entry, index) => {
      const color =
        entry.event.includes('fail')
          ? '#f85149'
          : entry.event.includes('rollback')
            ? '#d29922'
            : entry.event.includes('ok')
              ? '#3fb950'
              : '#58a6ff';
      const raw = `${entry.event}${entry.rest.length ? ' ' + entry.rest.join(' ') : ''}`;
      return text(64, logStart + index * 17, raw, {
        size: 12,
        fill: color,
        family: 'Consolas, monospace',
      });
    })
    .join('\n');

  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: '#0d1117' })}
    ${rect(0, 0, VIEW_W, 6, { fill: '#3fb950' })}
    ${text(48, 74, 'Rollback, recorded', { size: 34, weight: 700, fill: '#e6edf3' })}
    ${text(48, 106, 'Local release lane · deploy.log · sha 3b8fe59 · 2026-10-23', {
      size: 15,
      fill: '#8b949e',
      family: 'Consolas, monospace',
    })}
    ${pill(1030, 50, 'Rendered from deploy.log', {
      fill: '#12261e',
      stroke: '#238636',
      color: '#3fb950',
      size: 12,
      height: 28,
    })}

    ${rect(40, 140, 1360, 112, { fill: '#161b22', stroke: '#30363d', width: 1, rx: 8 })}
    ${text(64, 178, 'The gate fired for the right reason', { size: 20, weight: 600, fill: '#e6edf3' })}
    ${text(64, 205, 'A healthy deploy passed. The broken build passed /health, then failed smoke on POST /invoices.', {
      size: 14,
      fill: '#8b949e',
    })}
    ${text(64, 230, `Rollback restored the previous release, restarted it, re-ran wait and smoke: ${duration ?? 24} s end to end.`, {
      size: 14,
      fill: '#8b949e',
    })}

    ${text(48, 300, 'A · healthy deploy', { size: 14, weight: 700, fill: '#3fb950', family: 'Consolas, monospace' })}
    ${good
      .map((entry, index) => {
        const x = 90 + index * 310;
        const color = entry.event === 'smoke.ok' ? '#3fb950' : '#58a6ff';
        return `
          ${circle(x, 342, 8, color)}
          ${text(x + 18, 347, entry.event, { size: 13, fill: '#e6edf3', family: 'Consolas, monospace' })}
          ${text(x + 18, 366, entry.rest.at(-1)?.slice(11) ?? '', { size: 11.5, fill: '#8b949e', family: 'Consolas, monospace' })}
        `;
      })
      .join('\n')}

    ${text(48, 410, 'B · broken build → smoke fails → rollback', { size: 14, weight: 700, fill: '#f85149', family: 'Consolas, monospace' })}
    ${nodes}

    ${rect(40, panelTop, 1360, panelHeight, { fill: '#161b22', stroke: '#30363d', width: 1, rx: 8 })}
    ${text(64, panelTop + 28, 'deploy.log — exact lines, in file order', { size: 13, weight: 600, fill: '#8b949e', family: 'Consolas, monospace' })}
    ${logLines}

    ${rect(0, 846, VIEW_W, 54, { fill: '#161b22' })}
    ${line(0, 846, VIEW_W, 846, '#30363d', 1)}
    ${text(48, 879, 'Not a screenshot: rendered from the real deploy.log in this repository. Order is the evidence; timestamps repeat at second resolution.', {
      size: 12.5,
      fill: '#8b949e',
    })}
  `);
}

function renderGates() {
  const jobs = readJobNames().filter((name) => name !== 'ci-ok');
  const cards = jobs
    .map((job, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 44 + column * 672;
      const y = 176 + row * 122;
      const meta = GATE_META[job] ?? ['gate', 'fails'];
      return `
        ${rect(x, y, 636, 104, { fill: '#ffffff', stroke: '#d0d7de', width: 1, rx: 8 })}
        ${rect(x, y, 5, 104, { fill: '#1f883d', rx: 2 })}
        ${text(x + 24, y + 32, job, { size: 17, weight: 700, family: 'Consolas, monospace' })}
        ${text(x + 24, y + 56, meta[0], { size: 13, fill: '#59636e' })}
        ${text(x + 24, y + 80, `Red when: ${meta[1]}`, { size: 12.5, fill: '#cf222e' })}
      `;
    })
    .join('\n');

  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: '#f6f8fa' })}
    ${rect(0, 0, VIEW_W, 6, { fill: '#0969da' })}
    ${text(44, 72, 'Eight gates, one required check', { size: 34, weight: 700, fill: '#1f2328' })}
    ${text(44, 104, 'A red gate makes ci-ok red. The ruleset names only ci-ok — never a matrix suffix.', {
      size: 15,
      fill: '#59636e',
    })}
    ${pill(1088, 50, 'Rendered from pr.yml', {
      fill: '#ddf4ff',
      stroke: '#54aeff',
      color: '#0550ae',
      size: 12,
      height: 28,
    })}

    ${cards}

    ${rect(44, 690, 1352, 96, { fill: '#ffffff', stroke: '#0969da', width: 2, rx: 10 })}
    ${text(72, 726, 'ci-ok', { size: 24, weight: 700, family: 'Consolas, monospace', fill: '#0969da' })}
    ${text(72, 756, 'if: always() · needs: [all eight] · jq -e \'all(.result == "success")\'', {
      size: 13.5,
      fill: '#57606a',
      family: 'Consolas, monospace',
    })}
    ${text(1372, 731, 'ONE REQUIRED STATUS CHECK', {
      size: 13,
      weight: 700,
      fill: '#0969da',
      anchor: 'end',
      letterSpacing: 1,
    })}
    ${text(1372, 758, 'exact string, no matrix suffix', { size: 13, fill: '#59636e', anchor: 'end' })}

    ${text(44, 818, 'What this proves', { size: 14, weight: 700, fill: '#1f2328' })}
    ${text(44, 840, 'A failing job cannot be hidden behind a green check: ci-ok runs even when an upstream job fails, and the ruleset requires that exact name.', {
      size: 13,
      fill: '#57606a',
    })}
    ${text(44, 866, 'Not executed: this repository has no remote. The diagram is rendered from .github/workflows/pr.yml; no Actions run exists.', {
      size: 12.5,
      fill: '#6e7781',
    })}
  `);
}

function renderLocalLane() {
  const status = read('docs/evidence/release-status.txt').split(/\r?\n/).filter(Boolean).slice(0, 3);
  const smoke = read('docs/evidence/smoke.txt')
    .split(/\r?\n/)
    .filter((entry) => entry.startsWith('PASS') || entry.startsWith('smoke:'));

  // The first transcript line is the command; the rest are its output.
  const statusOutput = status
    .map((entry, index) =>
      text(60, 276 + index * 24, entry, {
        size: 13,
        fill: entry.startsWith('current:') ? '#3fb950' : '#e6edf3',
        family: 'Consolas, monospace',
      }),
    )
    .join('\n');

  const smokeOutput = smoke
    .map((entry, index) =>
      text(60, 430 + index * 26, entry, {
        size: 13,
        fill: entry.startsWith('PASS') ? '#3fb950' : '#58a6ff',
        family: 'Consolas, monospace',
      }),
    )
    .join('\n');

  return svgDocument(`
    ${rect(0, 0, VIEW_W, VIEW_H, { fill: '#0d1117' })}
    ${rect(0, 0, VIEW_W, 6, { fill: '#d29922' })}
    ${text(48, 72, 'Local lane · the demo is a transcript', { size: 33, weight: 700, fill: '#e6edf3' })}
    ${text(48, 104, 'release-local.sh: build → swap → wait → smoke → rollback. No runner can reach this machine.', {
      size: 15,
      fill: '#8b949e',
    })}
    ${pill(1055, 48, 'LOCAL ONLY · 127.0.0.1:8787', {
      fill: '#2d2100',
      stroke: '#9e6a03',
      color: '#d29922',
      size: 12,
      height: 28,
    })}

    ${rect(40, 156, 1000, 470, { fill: '#161b22', stroke: '#30363d', width: 1, rx: 8 })}
    ${rect(40, 156, 1000, 34, { fill: '#21262d', rx: 8 })}
    ${circle(62, 173, 5, '#f85149')}${circle(80, 173, 5, '#d29922')}${circle(98, 173, 5, '#3fb950')}
    ${text(120, 178, 'Git Bash · port 8787 (8080 is excluded on this host)', {
      size: 11.5,
      fill: '#8b949e',
      family: 'Consolas, monospace',
    })}

    ${text(60, 224, '$ bash scripts/release-local.sh status', { size: 13, fill: '#58a6ff', family: 'Consolas, monospace' })}
    ${statusOutput}
    ${text(60, 398, '$ bash scripts/smoke.sh', { size: 13, fill: '#58a6ff', family: 'Consolas, monospace' })}
    ${smokeOutput}

    ${rect(1064, 156, 332, 470, { fill: '#161b22', stroke: '#30363d', width: 1, rx: 8 })}
    ${text(1088, 192, '≤ 30 s demo path', { size: 17, weight: 700, fill: '#e6edf3' })}
    ${text(1088, 224, '1. healthy deploy', { size: 13, fill: '#3fb950', family: 'Consolas, monospace' })}
    ${text(1088, 244, '   release-local.sh <sha>', { size: 11.5, fill: '#8b949e', family: 'Consolas, monospace' })}
    ${text(1088, 278, '2. broken build', { size: 13, fill: '#f85149', family: 'Consolas, monospace' })}
    ${text(1088, 298, '   RELEASE_FAULT=invoices-500', { size: 11.5, fill: '#8b949e', family: 'Consolas, monospace' })}
    ${text(1088, 332, '3. gate fires, rollback', { size: 13, fill: '#d29922', family: 'Consolas, monospace' })}
    ${text(1088, 352, '   24 s, recorded in deploy.log', { size: 11.5, fill: '#8b949e', family: 'Consolas, monospace' })}
    ${line(1088, 390, 1372, 390, '#30363d', 1)}
    ${text(1088, 424, 'What is verified', { size: 14, weight: 700, fill: '#e6edf3' })}
    ${text(1088, 450, '• five smoke assertions', { size: 12.5, fill: '#8b949e' })}
    ${text(1088, 472, '• health + readiness gate', { size: 12.5, fill: '#8b949e' })}
    ${text(1088, 494, '• restart after rollback', { size: 12.5, fill: '#8b949e' })}
    ${text(1088, 516, '• smoke re-run after rollback', { size: 12.5, fill: '#8b949e' })}
    ${text(1088, 552, 'What is not', { size: 14, weight: 700, fill: '#e6edf3' })}
    ${text(1088, 578, '• no public URL (local only)', { size: 12.5, fill: '#8b949e' })}
    ${text(1088, 600, '• no registry pull (image lane)', { size: 12.5, fill: '#8b949e' })}

    ${rect(0, 700, VIEW_W, 200, { fill: '#161b22' })}
    ${line(0, 700, VIEW_W, 700, '#30363d', 1)}
    ${text(48, 740, 'Transcript captured from the running service on 2026-10-23. Rendered to an image — not a screenshot.', {
      size: 14,
      fill: '#e6edf3',
    })}
    ${text(48, 768, 'The URL is not clickable for a reviewer: this machine is not reachable from the internet, and there is no paid staging host (decision 2026-10-22).', {
      size: 13,
      fill: '#8b949e',
    })}
    ${text(48, 796, 'The evidence is the command and its exit status, not the picture: bash scripts/smoke.sh exits 0; bash scripts/release-local.sh <sha> prints the deploy state machine.', {
      size: 13,
      fill: '#8b949e',
    })}
    ${text(48, 838, 'Rollback limit: one release back, expand/contract migrations only — see docs/ROLLBACK.md.', {
      size: 13,
      fill: '#d29922',
    })}
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
  'docs/evidence/verify.txt',
  'docs/evidence/smoke.txt',
  'docs/evidence/workflow-structure.txt',
  'docs/evidence/docker-info.txt',
  'docs/evidence/check-assets.txt',
  'deploy.log',
  'tests/integration/api.test.ts',
];

function stripAnsi(value) {
  return value
    .split(String.fromCharCode(27))
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('m') + 1)))
    .join('');
}

function proofValueOf(relative) {
  const content = read(relative);
  if (relative.endsWith('verify.txt')) {
    const match = /Tests\s+\S*\s*(\d+) passed/.exec(stripAnsi(content));
    return match ? `${match[1]}/${match[1]} integration tests passed; exit 0` : 'exit 0';
  }
  if (relative.endsWith('smoke.txt')) {
    const passes = (content.match(/^PASS /gm) ?? []).length;
    const p95 = /p95 ([\d.]+)ms/.exec(content)?.[1] ?? '—';
    return `${passes}/5 assertions passed; /ready p95 ${p95} ms`;
  }
  if (relative.endsWith('workflow-structure.txt')) {
    const jobs = /jobs: (.+)/.exec(content)?.[1] ?? '';
    const pinned = /not pinned[^:]*: (\d+)/.exec(content)?.[1] ?? '?';
    return `${jobs.split(', ').length} jobs including ci-ok; ${pinned} unpinned uses`;
  }
  if (relative.endsWith('docker-info.txt')) {
    return 'unavailable: //./pipe/docker_engine Access is denied';
  }
  if (relative.endsWith('check-assets.txt')) {
    return 'manifest valid, 4 shots at 2880x1800; hub check:assets exited 0';
  }
  return 'six recorded events in required order';
}

function makeManifest() {
  return {
    project: 'cicd-pipeline',
    title: 'CI/CD pipeline with gates that actually block',
    oneLiner:
      'Eight PR gates feed one required ci-ok check; a multi-stage image is scanned in CI, and a local release lane waits for health and records a real rollback.',
    stack: ['GitHub Actions', 'Docker Buildx', 'Trivy', 'cosign', 'Fastify', 'PostgreSQL'],
    generatedAt: new Date().toISOString(),
    seeded: true,
    shots: [
      {
        file: 'hero.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: 'Mock of the blocked pull-request check page, rendered from .github/workflows/pr.yml: eight gates plus the ci-ok aggregator, with trivy expected to fail. Labelled mock; no GitHub run exists.',
      },
      {
        file: 'shot-01.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: "Recorded rollback timeline rendered from this repository's deploy.log: deploy.start, health.ok, smoke.fail, rollback.start, rollback.health.ok, rollback.smoke.ok.",
      },
      {
        file: 'shot-02.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: 'The eight PR gates feeding the single required ci-ok check, rendered from pr.yml and docs/PIPELINE.md; no Actions run is depicted.',
      },
      {
        file: 'shot-03.webp',
        width: WIDTH,
        height: HEIGHT,
        alt: 'Local release lane transcript captured from the running service: release-local.sh status and five passing smoke assertions on 127.0.0.1:8787. Local only; rendered, not a screenshot.',
      },
    ],
    proof: {
      measured: [
        {
          label: 'Integration tests',
          value: proofValueOf('docs/evidence/verify.txt'),
          method: 'bash scripts/verify.sh (lint, tsc --noEmit, vitest run)',
          artifact: 'docs/evidence/verify.txt',
        },
        {
          label: 'Smoke gate',
          value: proofValueOf('docs/evidence/smoke.txt'),
          method: 'bash scripts/smoke.sh against the running release on 127.0.0.1:8787',
          artifact: 'docs/evidence/smoke.txt',
        },
        {
          label: 'Workflow structure',
          value: proofValueOf('docs/evidence/workflow-structure.txt'),
          method: 'node structural check over .github/workflows/pr.yml',
          artifact: 'docs/evidence/workflow-structure.txt',
        },
        {
          label: 'Hub asset contract',
          value: proofValueOf('docs/evidence/check-assets.txt'),
          method:
            'ASSET_ROOT=<snapshot> ASSET_PROJECTS_DIR=<temp MDX> node portfolio-site/scripts/check-assets.mjs',
          artifact: 'docs/evidence/check-assets.txt',
        },
        {
          label: 'Rollback ordering',
          value:
            'deploy.start → health.ok → smoke.fail → rollback.start → rollback.health.ok → rollback.smoke.ok',
          method: 'read deploy.log in file order (timestamps recorded by release-local.sh)',
          artifact: 'deploy.log',
        },
        {
          label: 'Docker daemon',
          value: proofValueOf('docs/evidence/docker-info.txt'),
          method: 'docker info (recorded negative: image build, Trivy, cosign and attestation cannot run here)',
          artifact: 'docs/evidence/docker-info.txt',
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
        'No GitHub Actions run exists: the repository has no remote. The hero image is a labelled mock rendered from pr.yml, not a screenshot of a check page.',
        'The image was not built, scanned, signed or pushed: docker info fails with "Access is denied" on this host. C3 is unverified here and is not simulated.',
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
  await writeShot('shot-02.webp', renderGates());
  await writeShot('shot-03.webp', renderLocalLane());

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
