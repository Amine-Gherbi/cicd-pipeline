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
| the service still passes its own checks | `npm run verify` | `verify: ok`; 9/9 integration tests passed |
| the smoke gate passes on the live local release | `bash scripts/smoke.sh` | `PASS 1/5` … `PASS 5/5`; `/ready` p95 7.7 ms; exit 0 |
| the local release is live | `bash scripts/release-local.sh status` | `current: .releases/3b8fe59…`; `previous:` same; `pid: 2547 (alive)` |
| the bundle budget has headroom | `npm run build && du -sk dist` | `64 dist` (64 KiB) against a 512 KiB budget |
| the Dockerfile is multi-stage, non-root and has a healthcheck | `grep -nE '^(FROM\|USER\|HEALTHCHECK\|EXPOSE)' Dockerfile` | 2 `FROM` stages (build, runtime); `USER node`; `HEALTHCHECK`; `EXPOSE 8080`; `npm ci --omit=dev` in runtime. This is a structural check, not a build. |
| `capture-assets` writes four WebP at the contract size | `node scripts/capture-assets.mjs` | `hero.webp`, `shot-01..03.webp`: all 2880x1800 WebP; manifest with 6 measurements, 3 invariants, 5 limits |
| the hub accepts the snapshot | `ASSET_ROOT=… ASSET_PROJECTS_DIR=… node portfolio-site/scripts/check-assets.mjs` | `manifest valid, 4 shots present, 6 measurements and 3 invariants backed by files`; exit 0 |
| the hero is labelled as a mock | `node -e "console.log(require('../_shared/assets/cicd-pipeline/manifest.json').shots[0].alt)"` | `alt` begins “Mock of the blocked pull-request check page, rendered from .github/workflows/pr.yml”; the image itself carries the same label |

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

### Local image build — measured 2026-10-23

The Docker engine came up on this machine (server 28.1.1, linux/amd64), so the
Dockerfile was built for real rather than left as a claim:

| Claim | Command | Observed |
|---|---|---|
| the image builds from this Dockerfile | `docker build -t invoice-api:local .` | built, image id `881604849cd3` |
| the container starts and Node is present | `docker run --rm invoice-api:local node -e "console.log('container ok', process.version)"` | `container ok v22.23.4`, exit 0 |
| image size | `docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}'` | **535 MB** — the plan's 120 MB target is **not met** |
| where the size goes | `docker history invoice-api:local` | `npm ci --omit=dev` 206 MB, `@prisma/client` 77 MB, `.prisma` 24 MB, rest base image |
| Trivy scan, CRITICAL/HIGH, fix available only | `trivy image --severity CRITICAL,HIGH --ignore-unfixed invoice-api:local` | **11 HIGH, 0 CRITICAL — the CI gate would FAIL** (`exit-code: '1'`) |
| where the findings are | `trivy image --format json` → `evidence/trivy.json` | `brace-expansion` ×4, `picomatch`, `deepmerge-ts`, `sigstore`, all fixable by version bump |

The 535 MB figure is reported, not excused: a slim runtime (alpine + pruned
Prisma engines, or shipping `dist` and running `prisma generate` outside the
image) is the obvious fix and is **not done**. Full log:
`_orchestration/evidence/docker-c3.txt`, Trivy JSON: `_orchestration/evidence/trivy.json`.

The scan is the more useful finding: **the image as built would be blocked by its
own Trivy gate** (11 HIGH with fixes available, largely transitive dev packages
surviving `npm ci --omit=dev`). That is the gate working, not failing —
`docs/PIPELINE.md` lists it as a gate precisely because it can stop a build.

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
| P2's published image signature verifies | `cosign verify ghcr.io/<owner>/ecommerce-platform@sha256:<digest> --certificate-identity-regexp '…/release.yml@refs/heads/main' --certificate-oidc-issuer https://token.actions.githubusercontent.com` | `unverified` |
| P2's provenance attestation verifies | `gh attestation verify oci://ghcr.io/<owner>/ecommerce-platform@sha256:<digest> --repo <owner>/ecommerce-platform --signer-workflow <owner>/ecommerce-platform/.github/workflows/release.yml` | `unverified` |
| the attested P2 commit is deployable locally | `./scripts/release-local.sh <sha>` in the `ecommerce-platform` repository | `unverified` |

Notes on the last five rows: attestation, signing, the image build and the
promotion path belong to the release lane (tag → image → attest → push), which
is **not present** in this repository (there is no `release.yml`) and is not
part of `.github/workflows/pr.yml`. They are listed so the absence is explicit,
not to imply an artifact exists. The exact promotion commands, and what each
one does and does not prove, are in `docs/PIPELINE.md`.

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
- No Docker daemon locally, so the `Dockerfile` added for the `image` job has
  never been built here.

The locally verified table above is the complete set of claims this machine can
support. Everything else is marked `unverified` on purpose.
