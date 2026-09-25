# cicd-pipeline (P3) — agent context

Purpose: a delivery pipeline with real gates — a PR that cannot merge while red, reproducible builds, attested images in GHCR, a local release swap that waits for health, and a rollback that was actually recorded. Ships its own service (`invoice-api`) so the repo stands alone.

## Architecture
- `invoice-api`: Fastify + TypeScript + Prisma + PostgreSQL 16, ~600 LOC, port 8080.
- Two lanes, never conflated: a **CI lane** (build → Trivy → attest → push to GHCR) and a **local lane** (`release-local.sh`: build → swap → wait → smoke → rollback).
- `.github/workflows/pr.yml`: eight jobs (lint, typecheck, test, image, trivy, gitleaks, migration-gate, bundle-size) feeding one `ci-ok` aggregator — that exact string is the only required status check.
- `.github/workflows/release.yml`: tag → image → attest → push in ONE workflow (tags created with `GITHUB_TOKEN` do not retrigger workflows).
- Deployment is local by decision (no paid staging host): the runner cannot reach this machine.

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
6. Promotion is artifact-only: P3 verifies P2's published image (`cosign verify`, `gh attestation verify`); it never imports P2 code.
7. No `continue-on-error`, no `|| true`, no `@master` on a scanner.

## Pitfalls
- Docker daemon is unavailable on this machine (`docker info` → pipe access denied). Image work happens in Actions only; local builds are documented as unverified here.
- `docker/build-push-action` without `load: true` leaves Trivy nothing to scan — the gate silently passes.
- `prisma migrate deploy` opens its own session, so a prior `SET lock_timeout` does not apply: use `PGOPTIONS`.
- Rollback must restart the service and re-run `wait` + `smoke`, otherwise "rolled back" means "swapped a symlink".
- LF endings for `*.sh`, `Dockerfile`, `*.yml` (`core.autocrlf` will otherwise break the scripts).
- The red PR stays a **draft** with a run link, not a screenshot.

## Decisions
ADRs: `docs/adr/NNNN-*.md`. Evidence table: `docs/EVIDENCE.md`. Pipeline truth: `docs/PIPELINE.md`. Rollback limits: `docs/ROLLBACK.md`.
