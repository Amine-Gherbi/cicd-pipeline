# Evidence

Two status values are used, and they are not interchangeable:

- **verified locally** — the command ran on this machine and the stated output
  is real. It says nothing about GitHub Actions.
- **unverified** — the command has never run here, because it needs a remote
  and/or the Docker daemon. No output is claimed.

Environment facts behind the unverified column: `git remote -v` is empty (no
remote, no Actions, no PRs). The Docker engine was **down** when this file was
first written (`docker info` → pipe access denied); on 2026-10-23 it came up
(server 28.1.1, linux/amd64) and the local image build below was run for real.
Local PostgreSQL 16.13 (`select version()`) listens on port 5433 and was
reachable for the migration test below.


Fresh runs from 2026-10-23 are saved under `docs/evidence/`. `docs/PROOF.md`
indexes every claim to its command; this file is the full observation log.

## Verified locally

Rows marked **re-run 2026-10-23** were re-executed in the P3-D2 truth pass.
Every other number in this table was measured earlier on 2026-10-23 and is
**historical**; the listed command reproduces it.

| Claim | Command | Observed |
|---|---|---|
| `pr.yml` parses as YAML | `npx --yes js-yaml .github/workflows/pr.yml` | exit 0; validator was the `js-yaml` CLI fetched by npx (YAML 1.2 parser), not the Python `yaml` module |
| `dependabot.yml` parses as YAML | `npx --yes js-yaml .github/dependabot.yml` | exit 0 |
| all eight jobs exist | `npx --yes js-yaml .github/workflows/pr.yml \| node -e "…Object.keys(JSON.parse(…).jobs)…"` | `lint, typecheck, test, image, trivy, gitleaks, migration-gate, bundle-size, ci-ok` |
| `ci-ok` needs all eight and runs `if: always()` | same structural check | `needs` is exactly the eight names in order; `if` is `always()` |
| workflow-level permissions deny by default, every job declares its own | same structural check | workflow `permissions: {}`; “jobs without permissions: []” |
| no action is pinned to a mutable tag | `grep -c "uses: .*@v[0-9]" .github/workflows/pr.yml` | `0` |
| every `uses:` is a full 40-character commit SHA | `grep -oE "uses: [^ ]+" .github/workflows/pr.yml \| grep -Evc "@[0-9a-f]{40}$"` | `0` (20 `uses`; `grep -c` exits 1 when the count is zero) |
| no `continue-on-error`, `\|\| true` or `@master` | `node -e "…readFileSync('.github/workflows/pr.yml')…"` | 0 occurrences of each |
| trivy fails the gate | structural check of the trivy step | `exit-code: '1'`, `severity: 'CRITICAL,HIGH'`, `ignore-unfixed: true`, `cache-dir: ~/.cache/trivy` |
| the image job loads the image | structural check of the build step | `load: true`; cache-to is `type=gha,scope=invoice-api,mode=${{ github.ref == 'refs/heads/main' && 'max' \|\| 'min' }}` |
| the destructive gate rejects an unlabelled DROP | `bash scripts/check-destructive.sh .deploy/tmp-check-2/bad` (fixture prepared locally) | exit 1: `drops or renames state but has no '-- destructive:' label` |
| the destructive gate accepts a labelled DROP | `bash scripts/check-destructive.sh .deploy/tmp-check-2/good` | exit 0: `no unlabelled destructive statements` |
| a comment that merely says “DROP” does not trip the gate | `bash scripts/check-destructive.sh .deploy/tmp-check-2/comment` | exit 0 |
| the real migration directory passes | `bash scripts/check-destructive.sh prisma/migrations` | exit 0; 1 file checked |
| the fixture loads into an empty database | see “Migration gate, local replay” below | loaded without error |
| the migration applies cleanly on top of the fixture | `DATABASE_URL=… PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy` | `No pending migrations to apply.` |
| the migrated database matches the schema | `npx prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` | `No difference detected.` exit 0 |
| drift is reported as exit 2 and fails the gate | same diff after adding a stray table | exit 2; `Removed tables - drift_probe` |
| the service still passes its own checks | `bash scripts/verify.sh` | re-run 2026-10-23 17:22: `verify: ok`; `Tests 9 passed (9)`; exit 0 |
| the smoke gate passes on the live local release | `bash scripts/smoke.sh` | `PASS 1/5` … `PASS 5/5`; `/ready` p95 7.7 ms; exit 0 |
| the local release is live | `bash scripts/release-local.sh status` | `current: .releases/3b8fe59…`; `previous:` same; `pid: 2547 (alive)` |
| the bundle budget has headroom | `npm run build && du -sk dist` | `64 dist` (64 KiB) against a 512 KiB budget |
| the Dockerfile is multi-stage, non-root and has a healthcheck | `grep -nE '^(FROM\|USER\|HEALTHCHECK\|EXPOSE)' Dockerfile` | 2 `FROM` stages (build, runtime); `USER node`; `HEALTHCHECK`; `EXPOSE 8080`; `npm ci --omit=dev` in runtime. This is a structural check, not a build. |
| `capture-assets` writes four WebP at the contract size | `node scripts/capture-assets.mjs` | `hero.webp`, `shot-01..03.webp`: all 2880x1800 WebP; manifest with 6 measurements, 3 invariants, 5 limits |
| the previous snapshot passed the hub contract | `ASSET_ROOT=… ASSET_PROJECTS_DIR=… node portfolio-site/scripts/check-assets.mjs` | `manifest valid, 4 shots present, 6 measurements and 3 invariants backed by files`; exit 0. The re-captured manifest omits `generatedAt` to keep calendar dates out, so the current schema reports that field as required. |
| the hero is a transcript of the demo run | `node -e "console.log(require('../_shared/assets/cicd-pipeline/manifest.json').shots[0].alt)"` | `alt` begins “Terminal transcript of bash scripts/demo.sh on this machine”; the image shows the healthy release, the deliberately broken release and the rollback |

### Destructive gate replay

The three script checks used throwaway migration directories. To reproduce
them from the repository root:

```bash
root=.deploy/tmp-check-2
mkdir -p "$root/bad/001_drop" "$root/good/001_drop" "$root/comment/001_ok"
printf '%s\n' 'ALTER TABLE "invoices" DROP COLUMN "description";' \
  > "$root/bad/001_drop/migration.sql"
printf '%s\n' \
  '-- destructive: removes description; expand-contract keeps it for one release' \
  '-- expand-contract: release N still selects the column, release N+1 drops it' \
  'ALTER TABLE "invoices" DROP COLUMN "description";' \
  > "$root/good/001_drop/migration.sql"
printf '%s\n' '-- We do not DROP anything in this migration.' \
  'CREATE INDEX one_more_idx ON "invoices"("currency");' \
  > "$root/comment/001_ok/migration.sql"

bash scripts/check-destructive.sh "$root/bad"      # exit 1
bash scripts/check-destructive.sh "$root/good"     # exit 0
bash scripts/check-destructive.sh "$root/comment"  # exit 0
```

Output for the failing case:

```text
check-destructive: .deploy/tmp-check-2/bad/001_drop/migration.sql drops or renames state but has no '-- destructive:' label
check-destructive: 1 violation(s) across 1 migration file(s)
```

### Migration gate, local replay

The workflow step is `psql "$PSQL_URL" -f fixtures/pre-release.sql`. `psql` is
not available to this session (the client command was denied), and
`prisma db execute` wraps a multi-statement script in an implicit transaction,
which `CREATE DATABASE` cannot run inside. So the empty database was created
through the Prisma client, then the same fixture file was loaded and the same
commands were run:

```bash
# create the empty database (one statement; local harness only)
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasources:{db:{url:'postgresql://postgres@localhost:5433/postgres'}}});p.$executeRawUnsafe('CREATE DATABASE invoice_gate_p3c2_b').then(()=>p.$disconnect())"

# the step under test
npx prisma db execute \
  --url 'postgresql://postgres@localhost:5433/invoice_gate_p3c2_b?schema=public' \
  --file fixtures/pre-release.sql
DATABASE_URL='postgresql://postgres@localhost:5433/invoice_gate_p3c2_b?schema=public' \
PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy
npx prisma migrate diff \
  --from-url 'postgresql://postgres@localhost:5433/invoice_gate_p3c2_b?schema=public' \
  --to-schema-datamodel prisma/schema.prisma --exit-code
bash scripts/check-destructive.sh prisma/migrations
```

Observed: fixture loaded; `deploy` reported no pending migrations (the
`_prisma_migrations` checksum in the fixture was accepted); diff exit 0; the
destructive check passed. Adding `drift_probe` made diff exit 2. The scratch
database was dropped afterwards. This proves the fixture and the commands on a
real PostgreSQL 16; it does **not** prove the Actions service container behaves
identically.

### Local image build — 535 MB → 284 MB, measured 2026-10-23

The Docker engine came up on this machine (server 28.1.1, linux/amd64), so the
Dockerfile was built for real rather than left as a claim. The first build was
535 MB and failed its own Trivy gate; the runtime was then slimmed and measured
again.

| Claim | before (`invoice-api:local`) | after (`invoice-api:slim`) |
|---|---|---|
| the image builds from this Dockerfile | built, id `881604849cd3` | built, id `b9d3fbc0fddc` |
| the container starts and Node is present | `container ok v22.23.4` | `v22.23.4` |
| image size | **535 MB** | **284 MB** (120 MB target not reachable, see below) |
| where the size goes | `npm ci --omit=dev` 206 MB, `@prisma/client` 77 MB, `.prisma` 24 MB, base `node:22-bookworm-slim` | `npm ci --omit=dev --omit=optional --omit=peer` 95.4 MB (72.9 MB of it `@prisma/client/runtime`), `.prisma` 20 MB, base `node:22-alpine` 168 MB |
| Trivy, CRITICAL/HIGH, fix available only | **11 HIGH, 0 CRITICAL — the gate would FAIL** | **0 findings** |
| where the findings were | `brace-expansion` ×5, `picomatch`, `deepmerge-ts`, `sigstore`, `pacote` ×2, `ip-address` | none |

What changed, and why it is not a widened gate:

- `--omit=optional` is the lever. `@prisma/client` declares `prisma` and
  `typescript` as **optional** peerDependencies; `npm ci --omit=dev` (and
  `--omit=peer`) still installs them, pulling in `effect` and `fast-check`.
  With `--omit=optional --omit=peer` all four are absent from the image
  (verified inside it: `prisma`, `typescript`, `effect`, `fast-check`).
- The install layer no longer copies `@prisma/client` a second time from the
  build stage; only the generated `.prisma` client and its engine are copied.
- `package-lock.json` is deleted after install. It is a build input, not
  runtime data; the shipped `node_modules` is what Trivy should judge.
- npm is deleted from the runtime image (`/usr/local/lib/node_modules/npm` and
  its bin links). The entry point is `node dist/server.js`; npm's bundled
  dependency tree was the source of every remaining HIGH finding, and none of
  it is executable runtime code in this container.
- `prisma/migrations` is now copied into the image. `/ready` compares applied
  migrations against that directory; without it readiness is 503
  `migrations_unreadable` (the old image had this defect, visible only once a
  database was attached).

The runtime was exercised against a real PostgreSQL 16 container:

```
docker run -d --network invoice-net -e DATABASE_URL=... -p 18080:8080 invoice-api:slim
curl http://127.0.0.1:18080/health  → 200 {"status":"ok"}
curl http://127.0.0.1:18080/ready   → 200 {"status":"ok","checks":{"database":"ok","migrations":"ok"}}
```

Why 284 MB and not ≤ 120 MB: `node:22-alpine` is 168 MB before any application
code (node binary 130 MB). Prisma is **not** the blocker — the generated engine
is `libquery_engine-linux-musl-openssl-3.0.x.so.node` and it runs, with `/ready`
proving database access. 120 MB sits below the floor of the base image; the
largest remaining app layer is 72.9 MB of `@prisma/client/runtime` (source maps
and wasm builds for every database provider), which the app needs as shipped.
The measured 284 MB satisfies the ≤ 300 MB fallback; the 120 MB target remains
missed and the reason is recorded here rather than hidden behind a base-image
change. Numbers: `docs/evidence/image-size.txt`. Trivy table:
`docs/evidence/trivy-after.txt` (0 findings; no `.trivyignore` exists).

### Re-measured 2026-10-23 — P3-D2 truth pass

The earlier wording claimed this pipeline shipped P2's store image. That claim
was not true after the store rebuild and is removed, not reworded. This section
re-runs the claims this machine can support. The 535 MB first image and its
11 HIGH findings are **historical**, measured earlier on 2026-10-23; every
number below was measured again on 2026-10-23 at the times shown.

Environment at measurement: Docker server 28.1.1 (`docker info`), Linux
containers; PostgreSQL 16.13 on the host at `localhost:5433`
(`listen_addresses=localhost`); database `invoice_dev` with migration
`20261022234607_init` applied.

Build and size:

```bash
$ docker build -t invoice-api:slim .
# exit 0; every layer CACHED; writing image
# sha256:b9d3fbc0fddc854ada74f5bce7a419b13682dbd4eea99bda94881a1241e927b8

$ docker images invoice-api --format '{{.Repository}}:{{.Tag}} {{.Size}} {{.ID}}'
invoice-api:slim 284MB b9d3fbc0fddc
invoice-api:local 535MB 881604849cd3

$ docker image inspect invoice-api:slim --format '{{.Id}} {{.Size}} {{.Created}}'
sha256:b9d3fbc0fddc854ada74f5bce7a419b13682dbd4eea99bda94881a1241e927b8 283795861 2026-10-23T08:39:59.162748565Z
```

The build reused the Docker cache and produced the same image ID as the earlier
2026-10-23 build. 284 MB is `docker images`' decimal display; 283,795,861 bytes
is the exact size from `docker image inspect`.

Trivy, with the gate flags unchanged (`--severity CRITICAL,HIGH`,
`--ignore-unfixed`, `--exit-code 1`), run through the official container
against the local daemon: Trivy 0.76.1,
`aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c`.

```bash
$ docker run --rm -v //var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy:latest image --severity CRITICAL,HIGH \
    --ignore-unfixed --exit-code 1 --format json invoice-api:slim \
    > docs/evidence/trivy-slim-2026-10-23.json
# exit 0

$ node -e "const j=require('./docs/evidence/trivy-slim-2026-10-23.json'); ..."
{ "schema": 2, "artifact": "invoice-api:slim", "results": 2, "vulns": 0,
  "bySeverity": {} }
```

Counted from the JSON, not from the table: 2 targets (alpine 3.24.3 and Node
packages), **0 CRITICAL/HIGH findings with a fix available**. Report timestamp
`2026-10-23T16:14:37Z`; no `.trivyignore` was used.

Runtime against the real PostgreSQL 16.13 on port 5433, published on host 18080:

```bash
$ docker run -d --name invoice-api-evidence \
    -e NODE_OPTIONS=--dns-result-order=ipv4first \
    -e DATABASE_URL='postgresql://postgres@host.docker.internal:5433/invoice_dev?schema=public' \
    -p 18080:8080 invoice-api:slim

$ curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:18080/health
{"status":"ok"}
HTTP 200

$ curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:18080/ready
{"status":"ok","checks":{"database":"ok","migrations":"ok"}}
HTTP 200

$ curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:18080/invoices/123e4567-e89b-12d3-a456-426614174000
{"error":{"code":"not_found","message":"Invoice not found"}}
HTTP 404

$ curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:18080/no-such-route
{"error":{"code":"not_found","message":"Route not found"}}
HTTP 404
```

`NODE_OPTIONS=--dns-result-order=ipv4first` is part of the observed command:
`host.docker.internal` resolved to an IPv6 address first on this Docker Desktop
host, and `/ready` returned 503 `database_unreachable` after about 5 s. With
IPv4 first, the same URL reached PostgreSQL and `/ready` returned 200. The
database check is real: `/ready` compares applied migrations with the
`prisma/migrations` directory copied into the image.

The container was removed after these responses were recorded; the image and
the JSON report remain.

Tests, re-run the same day:

```bash
$ bash scripts/verify.sh
 Test Files  1 passed (1)
      Tests  9 passed (9)
==> result
verify: ok
# exit 0
```

### Command output card — 2026-10-23

Rows appended for the documentation/output card. The tables above are unchanged.

| Claim | Command | Observed |
|---|---|---|
| `verify.sh` prints four labelled sections and one result line | `bash scripts/verify.sh` | `==> lint`, `==> types`, `==> tests`, `==> result`, `verify: ok`; exit 0 on two consecutive runs |
| the demo drives release, smoke pass, broken release, smoke fail and rollback | `bash scripts/demo.sh` | summary: `release (healthy) PASS`, `smoke (healthy) PASS`, `release (broken) PASS`, `smoke (broken) FAIL`, `rollback PASS`; exit 0 |
| the demo's rollback order is in `deploy.log` | `grep -E '^(deploy\.start\|health\.ok\|smoke\.(ok\|fail)\|rollback\.)' deploy.log \| tail -6` | `deploy.start → health.ok → smoke.fail → rollback.start → rollback.health.ok → rollback.smoke.ok` |
| the nine integration tests still pass | `bash scripts/verify.sh` | `Test Files 1 passed (1)`, `Tests 9 passed (9)`; exit 0 |
| each documented command has a captured transcript | `docs/OUTPUT.md` | command, exit code and 2026-10-23 output for verify, demo, release, smoke, status, service, the destructive gate, migrate, tests, build, assets and the image listing |

## Unverified — needs a remote and/or Actions

Every row below is `unverified`. No run, check, PR, attestation or registry
artifact exists for this repository.

| Claim | Command that would prove it on a machine with a remote | Status |
|---|---|---|
| the workflow runs at all | `gh workflow list`, then `gh run list --workflow=pr.yml` | `unverified` |
| all eight jobs go green on a clean PR | `gh run view <run-id> --log` | `unverified` |
| `ci-ok` is the check the ruleset requires | `gh api repos/{owner}/{repo}/branches/main/protection` (or the ruleset page) | `unverified` |
| a red PR cannot merge | `gh pr checks <n>` shows `ci-ok` failing, `gh pr view <n> --json mergeStateStatus` shows `BLOCKED` | `unverified` |
| the red PR fails in the expected job | `gh pr checks <n>`; expected failing job is `trivy` (see below) | `unverified` |
| the image builds on the runner | `gh run view <run-id> --log --job=image` | `unverified` |
| Trivy scans the loaded image and uploads SARIF | `gh run view <run-id> --log --job=trivy`; `gh api repos/{owner}/{repo}/code-scanning/alerts` | `unverified` |
| BuildKit cache actually helps | `grep -c CACHED build.log`; `gh api repos/{owner}/{repo}/actions/caches` | `unverified` |
| the image meets the size target | `docker buildx imagetools inspect ghcr.io/{owner}/invoice-api:<tag>` | `unverified` |
| migration-gate behaves the same in the service container | `gh run view <run-id> --log --job=migration-gate` | `unverified` |
| gitleaks blocks a committed secret | a second draft PR with a canary token; `gh pr checks <n>` | `unverified` |
| image provenance verifies | `gh attestation verify oci://ghcr.io/{owner}/invoice-api@sha256:<digest> --repo {owner}/invoice-api` | `unverified` |
| keyless signature verifies | `cosign verify ghcr.io/{owner}/invoice-api@sha256:<digest>` | `unverified` |

The attestation and signature rows are about `invoice-api` only. This
repository does not verify or ship the P2 storefront image: that image was
rebuilt independently and is not an input to this pipeline. There is also no
`release.yml` and no registry push here, so no attestation exists to verify for
either project.

## The red PR — exact body, unexecuted

The demonstration cannot exist without a remote: a pull request needs a
repository to live in, and `gh pr create` has no target here. What would be
opened — and what it must prove — is fixed below.

```text
Title:  [DEMO] expected failure — trivy image (CVE-2021-23337)
State:  draft
Base:   main
Branch: demo/trivy-cve-2021-23337
Change: add lodash@4.17.20 to dependencies and import it once in src/app.ts

This draft PR exists to prove the image gate can fail, not just run.

lodash 4.17.20 carries CVE-2021-23337 (command injection, HIGH).
The image job builds normally; the trivy job scans the loaded image with
severity CRITICAL,HIGH and exit-code 1, finds the fixable advisory, and
fails. ci-ok aggregates that failure and is red, so the required check
blocks the merge.

Expected failing job: trivy
Expected passing jobs: lint, typecheck, test, image, gitleaks,
                       migration-gate, bundle-size
Expected check: ci-ok — failure
Expected merge state: BLOCKED

Run link: none. This repository has no remote, so the workflow has never
run and no run URL can exist. Recorded as unverified in docs/EVIDENCE.md.
```

Commands that would produce the evidence on a machine with a remote:

```bash
git push -u origin demo/trivy-cve-2021-23337
gh pr create --draft \
  --title '[DEMO] expected failure — trivy image (CVE-2021-23337)' \
  --body-file <the block above>
gh pr checks <n>                       # trivy failed, ci-ok failed
gh pr view <n> --json mergeStateStatus # BLOCKED
gh run view <run-id> --log --job=trivy # CVE-2021-23337, exit 1
```

Status: `unverified`. The draft is intentional: a failing PR left open without
a reason reads as neglect; a draft with an expected-failure body and a run link
reads as a test. Here there is no run link, so the body says so.

## What “no remote” rules out

- No Actions run, so no `gh run view` output, no `CACHED` counts, no cache
  statistics. A number would be invented.
- No PR, so no `gh pr checks` output and no red check page. A screenshot would
  be a mock-up.
- No GHCR push and no OIDC token, so no attestation and no `cosign verify`
  output.
- The Docker daemon was unavailable when this section was first written; it
  came up on 2026-10-23 and the local image build and Trivy run above are the
  result. Rows that need a remote or registry remain `unverified`.

The locally verified table above is the complete set of claims this machine can
support. Everything else is marked `unverified` on purpose.
