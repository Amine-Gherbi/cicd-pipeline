# Proof — every claim mapped to a command

One rule: a claim appears here only if **(a)** its command ran on this machine
and the output is recorded, or **(b)** it is labelled `unverified` with the
command that would prove it. There is no third state, and a screenshot is never
the evidence.

Environment: Windows 11, Git Bash, Node v22.23.4, PostgreSQL 16.13 on
`localhost:5433`, service on `127.0.0.1:8787`. `git remote -v` shows `origin` →
`https://github.com/Amine-Gherbi/cicd-pipeline.git` (since 2026-10-29), so
Actions runs exist. `docker info` reports server 28.1.1 (2026-10-23); the local
image build and Trivy run are recorded in `docs/EVIDENCE.md`
(`docs/evidence/image-size.txt`, `docs/evidence/trivy-after.txt`). The hosted
target is Render service `invoice-api`
(<https://invoice-api-26b4.onrender.com>), backed by Neon database `invoice`.

Full commands and observations: [`docs/EVIDENCE.md`](EVIDENCE.md). This page is
the index; `docs/PIPELINE.md` explains why each gate exists. Captured local
command transcripts are in [`docs/OUTPUT.md`](OUTPUT.md).

## Ran here — reproducible now

Rows marked **re-run 2026-10-23** were re-executed in the P3-D2 truth pass.
Every other number in this table was measured earlier on 2026-10-23 and is
**historical**; the listed command reproduces it.

| Claim | Command | Observed | Recorded in |
|---|---|---|---|
| The service passes lint, typecheck and 9/9 integration tests | `bash scripts/verify.sh` | re-run 2026-10-23: `verify: ok`; 9 tests passed; exit 0 | `docs/evidence/verify-2026-10-23.txt` |
| The smoke gate names five behaviours and passes all five | `bash scripts/smoke.sh` | `PASS 1/5` … `PASS 5/5`; `/ready` p95 7.7 ms; exit 0 | `docs/evidence/smoke.txt` |
| A release is deployed and the process is alive | `bash scripts/release-local.sh status` | `current: .releases/3b8fe59…`; `pid: 2547 (alive)` | `docs/evidence/release-status.txt` |
| The rollback order is real, not asserted | `grep -nE '^(deploy\.start\|health\.ok\|smoke\.(ok\|fail)\|rollback\.)' deploy.log` | `deploy.start → health.ok → smoke.fail → rollback.start → rollback.health.ok → rollback.smoke.ok` | `deploy.log` |
| Eight gates exist and `ci-ok` needs all eight | `node -e '…'` (below) | `lint … bundle-size, ci-ok`; `ci-ok needs:` the eight names | `docs/evidence/workflow-structure.txt` |
| Every action is pinned to a 40-character SHA | same structural check | 20 `uses:`; 0 unpinned | `docs/evidence/workflow-structure.txt` |
| No `continue-on-error`, `\|\| true` or `@master` | same structural check | 0, 0, 0 | `docs/evidence/workflow-structure.txt` |
| Trivy would fail the gate and the image is loaded | same structural check | `exit-code: '1'`; `severity: 'CRITICAL,HIGH'`; `ignore-unfixed: true`; `load: true` | `docs/evidence/workflow-structure.txt` |
| The workflow parses as YAML | `npx --yes js-yaml .github/workflows/pr.yml` | exit 0 | `docs/evidence/yaml-parse.txt` |
| The destructive-migration gate passes the real migration | `bash scripts/check-destructive.sh prisma/migrations` | `1 migration file(s) checked, no unlabelled destructive statements`; exit 0 | `docs/evidence/destructive-gate.txt` |
| The destructive gate rejects an unlabelled `DROP` | see `EVIDENCE.md` “Destructive gate replay” | exit 1 with `has no '-- destructive:' label` | `docs/EVIDENCE.md` |
| `dist/` is inside its budget | `npm run build && du -sk dist` | `64 KiB` against `512 KiB` | `docs/evidence/bundle-size.txt` |
| The Dockerfile is multi-stage, non-root, and has a healthcheck | `grep -nE '^(FROM\|USER\|HEALTHCHECK\|EXPOSE)' Dockerfile` | 2 `FROM`; `USER node`; `HEALTHCHECK`; `EXPOSE 8080` | `docs/evidence/dockerfile-structure.txt` |
| The hub accepts the asset snapshot | `node scripts/capture-assets.mjs`, then the `check:assets` command below | `manifest valid, 4 shots present, 6 measurements and 3 invariants`; exit 0 | `docs/evidence/check-assets.txt` |
| The image builds from this Dockerfile | `docker build -t invoice-api:slim .` | re-run 2026-10-23: exit 0 (all layers cached); `sha256:b9d3fbc0fddc…`; 284 MB | `docs/EVIDENCE.md` |
| Trivy reports 0 CRITICAL/HIGH findings, counted from JSON | `docker run --rm -v //var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --format json invoice-api:slim` | 2026-10-23: exit 0; 2 targets, 0 vulnerabilities in JSON | `docs/evidence/trivy-slim-2026-10-23.json` |
| The image serves `/health` and `/ready` 200 against PostgreSQL 16.13 on port 5433 | `docker run … -p 18080:8080 invoice-api:slim`; `curl http://127.0.0.1:18080/health`, `…/ready` | 2026-10-23: 200 `{"status":"ok"}`; 200 `{"status":"ok","checks":{"database":"ok","migrations":"ok"}}` | `docs/EVIDENCE.md` |
| A missing invoice returns the documented 404 body shape | `curl http://127.0.0.1:18080/invoices/123e4567-e89b-12d3-a456-426614174000` | 2026-10-23: 404 `{"error":{"code":"not_found","message":"Invoice not found"}}` | `docs/EVIDENCE.md` |

### The two commands that are not one-liners

Workflow structure:

```bash
node -e '
const fs=require("node:fs");
const s=fs.readFileSync(".github/workflows/pr.yml","utf8");
const jobs=[...s.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m)=>m[1]);
const uses=[...s.matchAll(/uses: (\S+)/g)].map((m)=>m[1]);
console.log("jobs:", jobs.join(", "));
console.log("needs:", /needs: \[([^\]]+)\]/.exec(s)[1]);
console.log("uses:", uses.length, "unpinned:", uses.filter((u)=>!/@[0-9a-f]{40}$/.test(u)).length);
console.log("forbidden:", (s.match(/continue-on-error/g)||[]).length, (s.match(/\|\| true/g)||[]).length, (s.match(/@master/g)||[]).length);
'
```

Hub asset contract (the override flags are the hub's own test hooks, so nothing
outside `_shared/assets` is modified):

```bash
node scripts/capture-assets.mjs
# The hub validates per project MDX. This temp file stands in for the case-study
# page without touching portfolio-site; ASSET_ROOT points at the written snapshot.
mkdir -p .deploy/asset-check
printf -- '---\ntitle: cicd-pipeline\n---\n' > .deploy/asset-check/cicd-pipeline.mdx
ASSET_ROOT="P:/portfolio/_shared/assets" \
ASSET_PROJECTS_DIR="P:/portfolio/cicd-pipeline/.deploy/asset-check" \
node P:/portfolio/portfolio-site/scripts/check-assets.mjs
```

## Replayed earlier on this machine — the migration gate

The exact commands are in [`EVIDENCE.md`](EVIDENCE.md#migration-gate-local-replay):
create an empty database, load `fixtures/pre-release.sql`, run
`PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy`,
run `prisma migrate diff --exit-code`, then the destructive check.

Observed: fixture loaded; `No pending migrations to apply.`; diff exit 0;
adding `drift_probe` made diff exit 2; the scratch database was dropped. This
proves the fixture and the commands on PostgreSQL 16, **not** that the Actions
service container behaves identically.

## Verified in Actions or against the hosted target

Runs 40902199280 and 40905865091 executed after the remote was added. The second
is fully green on `master`; its `publish` job pushed and keyless-signed digest
`sha256:e45898df9f0f2aab5982069f696ee26a465ea34ef0c3897bc7dae690049b31da`. The
hosted target is Render service `invoice-api`
(`srv-dbhni75g1s2s73ahheig`) at
<https://invoice-api-26b4.onrender.com>, backed by Neon database `invoice`;
public smoke passes 5/5 from this machine. Commands and output:
`docs/EVIDENCE.md`, `docs/OUTPUT.md`.

| Claim | Command that proves it | Status |
|---|---|---|
| Actions executes the workflow | `gh run list --workflow=pr.yml` | `verified` — run 40902199280 |
| All eight gates go green | `gh run view 40905865091 --log` | `verified` on `master`; a clean PR run is unobserved |
| The ruleset requires exactly `ci-ok` | `gh api repos/<owner>/<repo>/branches/master/protection` | `unverified` — settings live on GitHub |
| A red PR cannot merge | `gh pr checks <n>`; `gh pr view <n> --json mergeStateStatus` | `unverified` — no PR opened |
| The red PR fails in `trivy`, not elsewhere | `gh run view <run-id> --log --job=trivy` | `unverified` — no PR opened |
| The registry digest exists | `docker buildx imagetools inspect ghcr.io/amine-gherbi/invoice-api:sha-<sha>` | `verified` by the `publish` job in run 40905865091 |
| The signature verifies | `cosign verify ghcr.io/amine-gherbi/invoice-api@sha256:…` | `verified in the publish job`; no separate transcript here |
| Provenance verifies | `gh attestation verify oci://ghcr.io/…` | `unverified` — no attestation artifact |
| The hosted deploy job goes green | `gh run view <run-id> --log --job=deploy` | `unverified` — first runs after this branch merges |
| Public smoke passes | `bash scripts/smoke.sh https://invoice-api-26b4.onrender.com` | `verified` — 5/5 on 2026-10-29 |

## What no command on this machine can prove

- That the hosted `deploy` job passes inside Actions. The job exists and parses;
  its first master run is the remaining observation.
- That the local lane deploys the registry digest. It builds from source. The
  hosted lane asks Render to build the same commit, and `commitId` binds the
  deploy to that commit; it does not pull the GHCR digest either.
- That the Actions PostgreSQL service container behaves like the local
  PostgreSQL 16. The migration replay narrows the gap; it does not close it.
- That a red PR blocks a merge. No red PR has been opened yet.

## The single check to run first

```bash
bash scripts/verify.sh    # lint → typecheck → 9/9 integration tests; exit 0
```
