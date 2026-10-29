# cicd-pipeline

**Case study:** https://gherbi.pages.dev/projects/cicd-pipeline/ — the release lane runs locally; the GitHub Actions lane has not run (see *Status*).

**Demo page:** <https://pipeline-demo-57mh.onrender.com> — one screen, three
real actions: dispatch the gates, ship a bad image that Trivy must reject, and
roll a faulty deploy back with the same five smoke assertions.

`invoice-api` is a Fastify + Prisma + PostgreSQL service, and this repository is
the delivery pipeline that gates it. The PR workflow defines eight gate jobs and
one aggregator status, `ci-ok`. The local lane builds a release, swaps
`current`, waits for `/health` and `/ready`, runs five smoke assertions, and
rolls back to the previous release when a gate fails.

## What it proves

- The workflow defines one aggregator, `ci-ok`, for the eight gate jobs, not
  eight unmatched names; the YAML parses and its jobs, SHA pinning and Trivy
  flags are checked structurally.
- A release is recorded live only after `wait` returned 200 from `/health` and
  `/ready` and all five smoke assertions passed: `deploy.log` shows `health.ok`
  then `smoke.ok`.
- A failed smoke gate triggers a rollback that restarts, re-waits and re-smokes
  the previous release before `rollback.smoke.ok` is written.

## Run it

```bash
bash scripts/verify.sh    # lint, types, 9 integration tests
bash scripts/demo.sh      # release, smoke pass, broken release, smoke fail, rollback
```

Evidence: [docs/OUTPUT.md](docs/OUTPUT.md) has each command, its exit code and
the output captured on this machine. `docs/EVIDENCE.md` separates
`verified locally` from `unverified`.

**Local only.** There is no git remote, so no GitHub Actions run exists. The CI
lane is written and structurally checked, not executed.

## Commands

| Command | What it prints |
|---|---|
| `bash scripts/verify.sh` | `==> lint`, `==> types`, `==> tests`, `==> result`, then `verify: ok` or `verify: FAILED` |
| `bash scripts/demo.sh` | healthy and broken release transcripts, then a PASS/FAIL summary with elapsed time |
| `bash scripts/release-local.sh <sha> [label]` | `deploy.start` through `health.ok` and smoke lines; `rollback.*` on failure |
| `bash scripts/release-local.sh status` | current, previous, pid, and the last 20 `deploy.log` lines |
| `bash scripts/smoke.sh` | five `PASS`/`FAIL` lines and one `smoke: ok` or `smoke: FAIL` line |
| `bash scripts/service.sh start\|stop\|restart\|status` | one line per action, or current/pid/port/log |
| `bash scripts/check-destructive.sh <migrations-dir>` | `N migration file(s) checked`, or each unlabelled `DROP`/`RENAME` |
| `./scripts/capture-assets` | four WebP files, `manifest.json`, and proof transcripts in the asset directory |
| `PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy` | `No pending migrations to apply.` or Prisma's apply error |
| `npm run test` | Vitest file/test counts and `9 passed` |
| `npm run build` | `tsc` errors, if any; writes `dist/` |

Run `bash scripts/verify.sh` from the repository root with PostgreSQL 16 on
`localhost:5433` and `.env` pointing at it. `invoice-api` documents port 8080;
this Windows host excludes TCP 8001–8300, so the local lane uses 8787.

## What runs here

| Lane | Status on this machine | Evidence |
|---|---|---|
| PR gates (`pr.yml`) | Runs on GitHub Actions. Run 40905865091 is green on `master`; the required check is the literal `ci-ok`. | `docs/EVIDENCE.md`, `docs/PIPELINE.md` |
| Hosted service | `invoice-api` is live at <https://invoice-api-26b4.onrender.com> (Render, free, Frankfurt), backed by Neon database `invoice`; public smoke is 5/5 | `docs/OUTPUT.md`, `docs/EVIDENCE.md` |
| `invoice-api` | Runs natively; 9 integration tests pass; `/health`, `/ready`, auth, validation and 404 shape proven | `bash scripts/verify.sh` |
| Migration gate | Replayed against local PostgreSQL 16 with `PGOPTIONS` lock timeouts and a drift probe; proven locally, not in the Actions service container | `docs/EVIDENCE.md` |
| Local release lane | Deployed, smoked 5/5, deliberately broken, rolled back, restarted, re-smoked; `deploy.log` records the order | `deploy.log`, `docs/ROLLBACK.md` |
| Image lane (C3) | Re-measured 2026-10-23: image builds (`v22.23.4`, id `b9d3fbc0fddc`), **284 MB**, `/health` and `/ready` 200 against PostgreSQL 16.13 on host 5433 (published on host 18080), Trivy **0 findings** counted from JSON. The earlier same-day history is **535 MB → 284 MB** and **11 HIGH → 0** (measured 2026-10-23, kept as historical). Run 40905865091 pushed and keyless-signed digest `sha256:e45898df…b31da`. | `docs/EVIDENCE.md`, `docs/evidence/` |
| Hub assets | 4 WebP at 2880×1800 plus `manifest.json`, captured from the local release lane, `verify.sh` and a local Trivy scan. The hero is a terminal transcript of `bash scripts/demo.sh`. | `P:/portfolio/_shared/assets/cicd-pipeline/` |

## Manual release

```bash
npm ci
# .env: DATABASE_URL=postgresql://postgres@localhost:5433/invoice_dev?schema=public
npm run dev                 # documents 8080; use PORT=8787 on this Windows host
npm run verify              # lint, types and integration tests
```

Deploy and exercise the gate:

```bash
# git-bash / Linux
PORT=8787 ./scripts/release-local.sh "$(git rev-parse HEAD)"          # healthy: wait -> smoke
RELEASE_FAULT=invoices-500 PORT=8787 ./scripts/release-local.sh "$(git rev-parse HEAD)" broken
PORT=8787 ./scripts/release-local.sh status                           # current, previous, deploy.log
```

`release-local.sh` rebuilds `.releases/<sha>`. On this host a release directory
that is the running process's working directory cannot be moved, so stop the
service first if that release is current. `demo.sh` does this for its own
rebuild.

```powershell
# Windows PowerShell 5.1 — no `VAR=value cmd`, no `&&`, no `tail`,
# and `bash` here resolves to WSL (no node), so call Git bash explicitly.
$gitBash = 'C:/Program Files/Git/bin/bash.exe'
$env:PORT = '8787'
& $gitBash scripts/release-local.sh (git rev-parse HEAD)              # healthy: wait -> smoke
$env:RELEASE_FAULT = 'invoices-500'
& $gitBash scripts/release-local.sh (git rev-parse HEAD) broken       # fails smoke, rolls back
Remove-Item Env:RELEASE_FAULT
& $gitBash scripts/release-local.sh status
Get-Content deploy.log -Tail 12                                       # deploy.start -> health.ok -> smoke.fail -> rollback.start
```

The service is started detached, so the PowerShell call can return before the smoke output finishes
printing. The truth is `deploy.log`, not the console.


## Two lanes, never conflated

```
CI lane (GitHub Actions)                    local lane (this machine)
gates → publish → deploy (master only)      build → swap → wait → smoke → rollback
GHCR + cosign → Render public URL           recorded in deploy.log
```

The CI lane no longer stops at the gate: on `master`, `publish` pushes and
keyless-signs the image, and `deploy` asks Render for the same commit, waits for
`/health`, and runs the five smoke assertions against the public URL. The
runner still cannot reach this machine, so the local lane remains the proof of
the swap/wait/smoke/rollback state machine. Neither lane stands in for the
other. `docs/PIPELINE.md` explains the gate→why table, the single required
check, the hosted deploy lane, and what the repository does and does not ship.

## Repository layout

```
.github/workflows/pr.yml   8 gates → ci-ok; publish → deploy on master
.github/workflows/demo.yml workflow_dispatch: gates | bad-image, for the demo page
demo/                      plain-ESM Fastify page (no build step): dispatch, run jobs, rollback
Dockerfile.demo            image for the demo page (Render service pipeline-demo)
src/                       Fastify + Prisma invoice-api
tests/integration/         9 integration tests (real PostgreSQL)
Dockerfile                 multi-stage, non-root runtime; alpine, 284 MB (measured 2026-10-23)
scripts/demo.sh            release → broken release → rollback, one command
scripts/release-local.sh   build → swap → wait → smoke → rollback
scripts/smoke.sh           5 named assertions
scripts/capture-assets.mjs 4 WebP + manifest for the portfolio hub
docs/                      PIPELINE, EVIDENCE, OUTPUT, PROOF, ROLLBACK
```

## Assets

```bash
node scripts/capture-assets.mjs      # or ./scripts/capture-assets
```

Writes `P:/portfolio/_shared/assets/cicd-pipeline/` (`hero.webp`, `shot-01..03.webp`,
`manifest.json`, plus the proof transcripts). The hero is a terminal transcript of
`bash scripts/demo.sh` run on this machine: a healthy release, a deliberately broken
release, and the rollback. `shot-01` is the rollback timeline read from `deploy.log`;
`shot-02` is `bash scripts/verify.sh`; `shot-03` is a local `trivy image` scan of
`invoice-api:slim`. The workflow file supplies the gate definitions; no hosted run
is depicted.

## Limits, stated plainly

- **No red PR yet.** The red-PR body is recorded as an unexecuted artifact in
  `docs/EVIDENCE.md`; a screenshot of it would be invented. The green master
  run and its digest are real (run 40905865091).
- **The hosted `deploy` job is not yet observed in Actions.** It exists in
  `pr.yml`, is `master`-only and bounded, and its target, database, deploy id
  and public smoke are verified from this machine. Its first master run after
  merge is the remaining confirmation.
- **The image is 284 MB, not the 120 MB target.** It builds and runs locally
  (2026-10-23, `node:22-alpine`, `/health` and `/ready` 200 against a real PostgreSQL 16).
  Dropping the Prisma CLI, `effect`, `typescript`, `fast-check`, npm and the shipped
  lockfile took it from **535 MB to 284 MB** and from **11 HIGH Trivy findings to 0**; the
  remaining gap to 120 MB is the 168 MB alpine base image, documented in `docs/EVIDENCE.md`.
  Run 40905865091 pushed and keyless-signed the digest; no attestation artifact
  is produced.
- **The public URL is real; the local lane is still local.**
  <https://invoice-api-26b4.onrender.com> is reachable by a reviewer. The local
  release lane on `127.0.0.1:8787` stays the rollback proof.
- **Rollback is one release back**, and only when migrations followed
  expand/contract. It swaps code, not schema. See `docs/ROLLBACK.md`.
