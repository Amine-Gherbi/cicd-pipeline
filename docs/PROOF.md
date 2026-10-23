# Proof — every claim mapped to a command

One rule: a claim appears here only if **(a)** its command ran on this machine
and the output is recorded, or **(b)** it is labelled `unverified` with the
command that would prove it. There is no third state, and a screenshot is never
the evidence.

Environment: Windows 11, Git Bash, Node v22.23.4, PostgreSQL 16.13 on
`localhost:5433`, service on `127.0.0.1:8787`. `git remote -v` is empty.
`docker info` reports server 28.1.1 (2026-10-23); the local image build and
Trivy run are recorded in `docs/EVIDENCE.md` (`docs/evidence/image-size.txt`,
`docs/evidence/trivy-after.txt`).

Full commands and observations: [`docs/EVIDENCE.md`](EVIDENCE.md). This page is
the index; `docs/PIPELINE.md` explains why each gate exists. Captured local
command transcripts are in [`docs/OUTPUT.md`](OUTPUT.md).

## Ran here — reproducible now

| Claim | Command | Observed | Recorded in |
|---|---|---|---|
| The service passes lint, typecheck and 9/9 integration tests | `bash scripts/verify.sh` | `verify: ok`; 9 tests passed; exit 0 | `docs/evidence/verify.txt` |
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

## Cannot run here — `unverified`

No row below has output because no remote, registry credential or Docker daemon
exists on this machine. Running a mock and calling it evidence is the failure
this project is about.

| Claim | Command that would prove it | Missing prerequisite |
|---|---|---|
| Actions executes the workflow | `gh run list --workflow=pr.yml` | no git remote |
| All eight gates go green on a clean PR | `gh run view <run-id> --log` | no run |
| The ruleset requires exactly `ci-ok` | `gh api repos/<owner>/<repo>/branches/main/protection` (or the ruleset page) | settings live on GitHub |
| A red PR cannot merge | `gh pr checks <n>`; `gh pr view <n> --json mergeStateStatus` → `BLOCKED` | no PR |
| The red PR fails in `trivy`, not elsewhere | `gh run view <run-id> --log --job=trivy` | no run |
| `docker build` produces the image | `docker build -t invoice-api:local .` | `docker info` → `Access is denied` |
| Trivy scans the loaded image and exits 1 on a fixable HIGH/CRITICAL | `trivy image --exit-code 1 --severity CRITICAL,HIGH --ignore-unfixed invoice-api:<sha>` | no image, no Trivy run |
| The image meets the size target | `docker buildx imagetools inspect ghcr.io/<owner>/invoice-api@sha256:<digest>` | no registry artifact |
| BuildKit cache helps | `grep -c CACHED build.log`; `gh api …/actions/caches` | no build log |
| The signature verifies | `cosign verify ghcr.io/<owner>/invoice-api@sha256:<digest> …` | no signature, no GHCR |
| Provenance verifies | `gh attestation verify oci://ghcr.io/<owner>/invoice-api@sha256:<digest> --repo <owner>/invoice-api` | no attestation |
| P2's image is promotable | `cosign verify` + `gh attestation verify` (both in `PIPELINE.md`) | no P2 run, no credentials |
| The attested P2 commit deploys locally | `./scripts/release-local.sh <sha>` in the P2 repository | no P2 checkout under test here |

The release lane is not present in this repository yet: there is no
`release.yml`, no registry push, and no OIDC token outside Actions. The
`Dockerfile` is written for that runner and reviewed; it is **unverified here**.

## What no command on this machine can prove

- That the CI lane deploys. It does not, by design: a GitHub runner cannot
  reach this host, and there is no paid staging host (decision 2026-10-22).
- That the local lane deploys the registry digest. It builds from source. The
  digest and the commit are bound by the attestation, not by the local script.
- That the Actions PostgreSQL service container behaves like the local
  PostgreSQL 16. The migration replay narrows the gap; it does not close it.
- That `http://127.0.0.1:8787` is clickable by a reviewer. It is local only.

## The single check to run first

```bash
bash scripts/verify.sh    # lint → typecheck → 9/9 integration tests; exit 0
```
