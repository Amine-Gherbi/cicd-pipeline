# cicd-pipeline

A delivery pipeline with gates that actually block: eight PR checks feed one required `ci-ok` status, a multi-stage image is scanned with Trivy in CI, and a local release lane swaps, waits for health, smokes, and records a real rollback.

**Hardest problem:** proving the gates can fail, not just run — one aggregator instead of eight unmatched names, `load: true` before Trivy, `exit-code: '1'`, and rollback only after `wait` proved health.
**Proof:** each claim maps to a command in [docs/PROOF.md](docs/PROOF.md); the two-column truth table is [docs/EVIDENCE.md](docs/EVIDENCE.md).

**Live URL:** none — **local only** at `http://127.0.0.1:8787` (Windows excludes 8001–8300 on this host; 8080 is unusable).
**Demo (≤30 s):** `./scripts/release-local.sh <sha>` deploys; `RELEASE_FAULT=invoices-500 ./scripts/release-local.sh <sha> broken` fails smoke and rolls back in ~24 s.

**Test status:** `bash scripts/verify.sh` → lint, typecheck and 9/9 integration tests, exit 0.
**CI status:** the eight-gate workflow is written and locally validated, but **no GitHub Actions run exists** — this repository has no remote. C3 (image, Trivy, cosign, GHCR) is **unverified**, not simulated.

## What is real here

| Lane | Status on this machine | Evidence |
|---|---|---|
| PR gates (`pr.yml`) | Written; YAML parses; jobs, `ci-ok`, SHA pinning and Trivy flags checked structurally. Never executed. | `docs/EVIDENCE.md`, `docs/PROOF.md` |
| `invoice-api` | Runs natively; 9 integration tests pass; `/health`, `/ready`, auth, validation and 404 shape proven | `bash scripts/verify.sh` |
| Migration gate | Replayed against local PostgreSQL 16 with `PGOPTIONS` lock timeouts and a drift probe; proven locally, not in the Actions service container | `docs/EVIDENCE.md` |
| Local release lane | Deployed, smoked 5/5, deliberately broken, rolled back, restarted, re-smoked; `deploy.log` records the order | `deploy.log`, `docs/ROLLBACK.md` |
| Image lane (C3) | `Dockerfile` and `.dockerignore` written and reviewed; **`docker build` never ran** — `docker info` → `Access is denied` | `docs/EVIDENCE.md` |
| Promotion from P2 | Path documented with `cosign verify` + `gh attestation verify`; **not executed** — no registry credentials, no P2 run here | `docs/PIPELINE.md` |
| Hub assets | 4 WebP at 2880×1800 plus `manifest.json`; accepted by the hub's `check:assets`. The hero is a labelled mock, not a screenshot. | `P:/portfolio/_shared/assets/cicd-pipeline/` |

## Quick start

```bash
npm ci
# .env: DATABASE_URL=postgresql://postgres@localhost:5433/invoice_dev?schema=public
npm run dev                 # documents 8080; use PORT=8787 on this Windows host
npm run verify              # lint + typecheck + integration tests
```

Deploy and exercise the gate:

```bash
# git-bash / Linux
PORT=8787 ./scripts/release-local.sh "$(git rev-parse HEAD)"          # healthy: wait → smoke
RELEASE_FAULT=invoices-500 PORT=8787 ./scripts/release-local.sh "$(git rev-parse HEAD)" broken
PORT=8787 ./scripts/release-local.sh status                           # current, previous, deploy.log
```

```powershell
# Windows PowerShell 5.1 — no `VAR=value cmd`, no `&&`, no `tail`
$env:PORT = '8787'
bash scripts/release-local.sh (git rev-parse HEAD)                    # healthy: wait → smoke
$env:RELEASE_FAULT = 'invoices-500'
bash scripts/release-local.sh (git rev-parse HEAD) broken             # fails smoke, rolls back
$env:RELEASE_FAULT = ''
bash scripts/release-local.sh status
Get-Content deploy.log -Tail 12                                       # deploy.start → health.ok → smoke.fail → rollback.start
```

The service is started detached, so the PowerShell call can return before the smoke output finishes
printing. The truth is `deploy.log`, not the console.


## Two lanes, never conflated

```
CI lane (GitHub Actions only)     local lane (this machine)
build → Trivy → attest → GHCR     build → swap → wait → smoke → rollback
        verified by cosign        recorded in deploy.log
```

The CI lane cannot deploy: a runner cannot reach this machine, and there is no
paid staging host (decision 2026-10-22). Neither lane stands in for the other.
`docs/PIPELINE.md` explains the gate→why table, the single required check, the
promotion path, and what the portable core is.

## Repository layout

```
.github/workflows/pr.yml   8 gates → ci-ok (the only required status check)
src/                       Fastify + Prisma invoice-api
tests/integration/         9 integration tests (real PostgreSQL)
Dockerfile                 multi-stage, non-root runtime; unverified here
scripts/release-local.sh   build → swap → wait → smoke → rollback
scripts/smoke.sh           5 named assertions
scripts/capture-assets.mjs 4 WebP + manifest for the portfolio hub
docs/                      PIPELINE, EVIDENCE, PROOF, ROLLBACK
```

## Assets

```bash
node scripts/capture-assets.mjs      # or ./scripts/capture-assets
```

Writes `P:/portfolio/_shared/assets/cicd-pipeline/` (`hero.webp`, `shot-01..03.webp`,
`manifest.json`, plus the proof transcripts). The hero is **a mock rendered from
`.github/workflows/pr.yml`**, labelled on the image and in the manifest `alt`;
there is no GitHub page to screenshot because there is no remote.

## Limits, stated plainly

- **No Actions run, no PR, no run URL.** The red-PR body is recorded as an
  unexecuted artifact in `docs/EVIDENCE.md`; a screenshot of it would be invented.
- **No image build, scan, signature, attestation or GHCR push.** Docker's daemon
  is unreachable on this host, so C3 cannot be claimed.
- **Local only.** `http://127.0.0.1:8787` is not reachable by a reviewer.
- **Rollback is one release back**, and only when migrations followed
  expand/contract. It swaps code, not schema. See `docs/ROLLBACK.md`.
