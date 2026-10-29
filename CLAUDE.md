# cicd-pipeline (P3) — agent context

Purpose: a delivery pipeline with real gates — a PR that cannot merge while red, reproducible builds, a local release swap that waits for health, a rollback that was actually recorded, and a hosted deploy that smokes the public URL. Ships its own service (`invoice-api`) so the repo stands alone. The PR lane and the master-only `publish` (GHCR + cosign) and `deploy` (Render) jobs are implemented in `pr.yml`.

## Architecture
- `invoice-api`: Fastify + TypeScript + Prisma + PostgreSQL 16, ~600 LOC, port 8080; live on Render at https://invoice-api-26b4.onrender.com with Neon database `invoice`.
- Two lanes, never conflated: a **CI lane** (gates → `publish` → `deploy` on master, implemented in `pr.yml`) and a **local lane** (`release-local.sh`: build → swap → wait → smoke → rollback).
- `.github/workflows/pr.yml`: eight jobs (lint, typecheck, test, image, trivy, gitleaks, migration-gate, bundle-size) feeding one `ci-ok` aggregator — that exact string is the only required status check — then `publish` and `deploy` on master.
- `.github/workflows/` contains only `pr.yml`. There is no `release.yml`; the registry push and keyless cosign live in `publish`.
- Hosted target: Render service `srv-dbhni75g1s2s73ahheig` (Docker, free, frankfurt, health `/health`, `autoDeploy: no`) and Neon database `invoice` (project `ep-autumn-glitter-b9vtz0q5`). Migrations are applied to Neon from this machine; the runtime image omits the Prisma CLI and the free plan has no pre-deploy command.

## Commands
- `npm run verify` → `tsc --noEmit && eslint && vitest run`
- `npm run dev` → 8080 · `./scripts/release-local.sh <sha>` · `./scripts/smoke.sh`
- `PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy` (the migration gate's lever)

## Invariants
1. `ci-ok` is the single required check; basic-branch-protection uses the exact string, never a matrix suffix.
2. Trivy runs with `exit-code: '1'`, `severity: 'CRITICAL,HIGH'`, `ignore-unfixed: true`, and the image must be built with `load: true` or the scan sees nothing.
3. Actions pinned to full commit SHAs; `permissions:` written explicitly on every workflow and job.
4. Rollback only after `wait` proved health: `deploy.start → health.ok → smoke.* → rollback.start` order in `deploy.log` is the evidence.
5. `PREVIOUS_REF` is captured before the swap, or the rollback has nowhere to go.
6. P3 builds and scans its own service (`invoice-api`); it does not verify or ship P2's storefront image.
7. No `continue-on-error`, no `|| true`, no `@master` on a scanner.

## Pitfalls
- Docker Desktop 28.1.1 is available on this machine (re-checked 2026-10-23). The local image build, Trivy scan and container run are measured; Actions build/scan/publish executed green in run 40905865091.
- `docker/build-push-action` without `load: true` leaves Trivy nothing to scan — the gate silently passes.
- `prisma migrate deploy` opens its own session, so a prior `SET lock_timeout` does not apply: use `PGOPTIONS`.
- Rollback must restart the service and re-run `wait` + `smoke`, otherwise "rolled back" means "swapped a symlink".
- LF endings for `*.sh`, `Dockerfile`, `*.yml` (`core.autocrlf` will otherwise break the scripts).
- The red PR stays a **draft** with a run link, not a screenshot.

## Decisions
ADRs: `docs/adr/NNNN-*.md`. Evidence table: `docs/EVIDENCE.md`. Pipeline truth: `docs/PIPELINE.md`. Rollback limits: `docs/ROLLBACK.md`.
