# Pipeline — the PR gate set

This document describes `.github/workflows/pr.yml`: the gates a pull request
must pass before it can merge, and the two jobs that run only after them on
`master` — `publish` (GHCR + cosign) and `deploy` (Render). The PR lane stops at
`ci-ok`; a pull request never reaches either downstream job.

## One required check: `ci-ok`

Seven gate jobs start in parallel. `trivy` is the exception: it consumes the
image artifact, so it waits for `image`. None of them is a required status
check. The ruleset requires exactly one string: **`ci-ok`**.

```text
lint ─────────────┐
typecheck ────────┤
test ─────────────┤
image ──▶ trivy ──┼──▶ ci-ok ──▶ publish ──▶ deploy   (master only)
gitleaks ─────────┤
migration-gate ───┤
bundle-size ──────┘
```

Why an aggregator instead of eight required checks:

- a matrix job reports as `test (22)`, so a required check named `test` never
  matches — the PR would be green while the test job was red;
- eight literal names have to be kept in sync by hand in repository settings;
- `ci-ok` runs with `if: always()`, so a failed or skipped upstream job still
  produces a red check instead of leaving the PR waiting forever.

Required approvals are 0. A solo repository cannot approve its own PR; asking
for one approval either stalls every PR or gets bypassed, and a bypassed rule is
worse than a rule that matches reality.

## Gate → why

| Gate | What it runs | Why it exists | Red when |
|---|---|---|---|
| `lint` | `npm run lint` (ESLint 9 + typescript-eslint) | catches unsafe patterns the type checker accepts | any lint error |
| `typecheck` | `npm run typecheck` (`tsc --noEmit`) | a build can emit JavaScript from code that does not type-check; this cannot | any type error |
| `test` | `vitest run` against a `postgres:16` service, Node 22 | proves health/readiness, validation, 404 shape and DB round-trips against a real database | any of the 9 integration tests fails |
| `image` | Buildx build of `Dockerfile`, `load: true`, exported as an artifact | the scan must see the artifact that would ship, not the source tree | the image does not build |
| `trivy` | `trivy image` on the loaded artifact | base-image and bundled-dependency CVEs are invisible to a source scan | a CRITICAL or HIGH CVE with a fix available |
| `gitleaks` | `gitleaks/gitleaks-action` over the PR history | a secret in a commit is a secret even if the file is deleted later | a secret is found |
| `migration-gate` | fixture → `prisma migrate deploy` under locks → drift diff → destructive check | a migration that passes on an empty database can still fail or lock on production-shaped data | the migration fails, drifts, or is unlabelled destructive |
| `bundle-size` | `npm run build`, then `du -sk dist` against a 512 KiB budget | dependency creep is easier to stop at PR time than at runtime | `dist/` > 512 KiB |
| `ci-ok` | `jq` over `toJSON(needs)` | the single check the ruleset can name exactly | any upstream result is not `success` |

`ci-ok` is the only job with `permissions: {}` and no checkout: it reads job
results, nothing else.

## Details that are wrong if written the obvious way

- **Trivy must be allowed to fail the build.** `exit-code: '1'`,
  `severity: 'CRITICAL,HIGH'`, `ignore-unfixed: true`. Without `exit-code` the
  action reports findings and exits 0 — a gate that scans but never blocks.
- **The image must be loaded.** `docker/build-push-action` with `load: true`,
  then `docker save` / `docker load` for the `trivy` job. Without it the image
  exists only in the Buildx cache and `trivy image` has nothing local to scan.
- **The scan depends on the build.** `trivy` declares `needs: [image]` because
  it downloads the `invoice-api-image` artifact that `image` uploads. Without
  the edge both jobs start together, `download-artifact` runs before the upload
  exists, and the gate dies with `Artifact not found` (run 40902199280).
  Declaring the dependency is the fix; `continue-on-error` or a retry would only
  mask it.
- **The SARIF upload must not create a second failure.** It runs
  `if: always() && hashFiles('trivy-results.sarif') != ''`, so a scan that
  crashed before writing a report does not add “Path does not exist” on top of
  the real failure. The scan step keeps `exit-code: '1'` and still fails the
  job. This private repository has code scanning disabled, so the workflow
  probes the code-scanning API and keeps the SARIF as a run artifact instead of
  letting `upload-sarif` fail with “Code scanning is not enabled”.
- **Cache modes differ by branch.** `cache-from: type=gha,scope=invoice-api`
  and `cache-to` with `mode=max` only when `github.ref` is `refs/heads/master`;
  `mode=min` otherwise. PR refs cannot seed master's cache, and `mode=max` on
  every PR exhausts the 10 GB cache budget.
- **Lock timeouts belong in `PGOPTIONS`.** `prisma migrate deploy` opens its
  own session, so a `SET lock_timeout` in a previous step would not apply:
  `PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy`.
  This is what turns "the migration wedges the deploy" into "the gate fails in
  three seconds".
- **`prisma migrate diff --exit-code` has three outcomes.** 0 = no drift,
  2 = drift, 1 = the command failed. The step handles 0 and 2 explicitly and
  treats 1 as a failure; it does not use `continue-on-error` or `|| true`.
- **Every action is pinned to a full commit SHA**, with `.github/dependabot.yml`
  (`github-actions` ecosystem) keeping the SHAs current. No `@master`, no
  version tags in `uses:`.
- **Permissions are declared per job.** The workflow starts from
  `permissions: {}`; `trivy` additionally requires `security-events: write` to
  upload SARIF, and `gitleaks` requires `pull-requests: read`.
- **The migration gate uses two URLs.** Prisma needs `?schema=public`; libpq
  (and therefore `psql`) rejects `schema` as an unknown URI parameter. The
  fixture step uses `PSQL_URL` without the query string.

## The migration gate, step by step

1. `psql fixtures/pre-release.sql` builds a database that looks like the last
   release: tables, indexes, four rows, and a `_prisma_migrations` row whose
   checksum is sha256 of the baseline migration. Without that row,
   `migrate deploy` would try to create tables the fixture already created.
2. `PGOPTIONS=... npx prisma migrate deploy` applies only migrations the
   previous release does not have, under a 3 s lock timeout and a 30 s
   statement timeout.
3. `npx prisma migrate diff --from-url ... --to-schema-datamodel ...
   --exit-code` compares the migrated database with `prisma/schema.prisma`.
   Exit 2 means the migration history and the schema disagree.
4. `scripts/check-destructive.sh prisma/migrations` strips SQL comments, then
   requires any `DROP`, `RENAME` or `TRUNCATE` migration to carry both:

   ```sql
   -- destructive: <what is lost, and why that is acceptable>
   -- expand-contract: <how the previous release keeps working during the swap>
   ```

   The expand/contract note is the precondition for the rollback described in
   `docs/ROLLBACK.md`: a destructive change without one cannot be rolled back
   safely regardless of how good the deploy state machine is.

## Two lanes, never conflated

- **CI lane:** gates → `publish` (GHCR image, keyless cosign sign + verify) →
  `deploy` (Render). The gate half runs on every PR; `publish` and `deploy` run
  only on `master`, after `ci-ok`.
- **Local lane:** `scripts/release-local.sh` → swap → wait for health → smoke →
  rollback, with `deploy.log` as evidence.

The hosted deploy lane does not stand in for the local one, and vice versa: the
runner still cannot reach this machine, so the local lane remains the proof of
the swap/wait/smoke/rollback state machine. The Render lane proves the same
five smoke assertions against a public URL.

## What this repository ships

The only artifact this repository builds and scans is its own demo service,
`invoice-api`. It does not build, verify, or ship the P2 storefront image. The
store was rebuilt independently and this pipeline never consumed its image, so
there is no artifact path from P2 into this repository:

- `Dockerfile` builds `invoice-api` from this repository's `src/` and `prisma/`.
- The `image` and `trivy` jobs inspect that image only.
- `release-local.sh` builds and swaps `invoice-api` from this repository; it
  never fetches or runs the storefront.
- On `master`, `publish` pushes the image to
  `ghcr.io/amine-gherbi/invoice-api` and signs the pushed digest keyless with
  cosign. There is no `release.yml`; the release steps live in `pr.yml`.
- `deploy` asks Render to build the same commit and then smokes the public
  service. It does not consume the GHCR image.

The local lane still records the full commit SHA in
`.releases/<sha>/manifest.json`; a digest is never replaced by a tag, because a
tag can move and a digest cannot.

## Portable core

The same gate shapes are reused across the four projects; only the tooling
under each gate changes. Four copies of roughly 120 lines are deliberate: a
shared workflow repository would rename checks to `<caller> / <called>` and
silently unmatch every ruleset — the exact failure this project demonstrates it
understands.

| Gate | P1 Astro | P2 Next | **P3 invoice-api** | P4 Python |
|---|---|---|---|---|
| lint / type / unit | tsc + eslint | tsc + eslint + vitest | **tsc + eslint + vitest** | ruff + mypy + pytest |
| trivy fs + gitleaks | yes | yes | **yes** | yes |
| image build + scan | no | yes (P2 builds its own image) | **yes (`invoice-api`; build + Trivy measured 2026-10-23; pushed and signed in Actions)** | yes |
| migration gate | no | Prisma | **Prisma + lock timeout + drift + destructive check** | Alembic |
| smoke | preview URL | preview deploy | **local release lane, 5 assertions** | eval report |
| release | static deploy | static deploy + image | **GHCR push + keyless cosign (run 40905865091); Render deploy on master** | GHCR + eval artifact |

The one string that must match repository settings is `ci-ok` in every project
that uses this shape. Nothing else is required by the ruleset.

## Hosted deploy lane (master only)

`deploy` is a job in `pr.yml`, not a separate workflow. It has
`needs: [ci-ok, publish]` and `if: github.ref == 'refs/heads/master'`, so a pull
request cannot reach it and it cannot deploy a branch other than `master`.

- **Target:** Render service `invoice-api`
  (`srv-dbhni75g1s2s73ahheig`), Docker, free plan, region `frankfurt`, health
  check `/health`, `autoDeploy: no`. Render injects `PORT` at runtime; the
  service reads it (`src/config.ts`), with the Dockerfile's 8080 as the default.
- **Public URL:** <https://invoice-api-26b4.onrender.com>. Render assigned the
  `-26b4` suffix; the bare `invoice-api.onrender.com` name was not available.
- **Database:** Neon project `ep-autumn-glitter-b9vtz0q5`, database `invoice`,
  owned by `neondb_owner`. The existing `neondb` and `docqa` databases were not
  touched.
- **Schema:** `prisma migrate deploy` was run from this machine against the Neon
  `invoice` database before the first deploy. The runtime image does not carry
  the Prisma CLI — it is omitted deliberately so the Trivy gate stays at zero
  HIGH/CRITICAL — and the Render free plan has no pre-deploy command, so the
  container does not migrate itself. This is the exact place migrations happen:
  an operator runs the command below against Neon before deploying a commit that
  adds one. The gate that makes this safe is `/ready`: it compares applied
  migrations with the `prisma/migrations` directory in the image and returns 503
  `pending_migrations` when they disagree. Smoke assertion 2 fails on that, so a
  service answering `/health` with missing tables is not accepted as deployed.
- **Trigger:** Render's API has no deploy-hook creation endpoint (probed
  2026-10-29: `/deploy-hooks` → 404), so the job stores `RENDER_API_KEY` and
  calls `POST /v1/services/{id}/deploys` with `commitId`. That key is
  workspace-wide and can administer every service — a wider permission than a
  deploy hook. A dashboard-created hook remains the narrower option, but this
  API cannot create one.
- **Secrets:** `RENDER_API_KEY` and `SMOKE_TOKEN`. The hosted service requires
  the bearer token for `POST /invoices`; assertion 3 proves 401 without it and
  201 with it. Both values were set with `gh secret set`; neither appears in a
  file, a log or a commit.
- **Waits:** the deploy status is polled until `live` or a failure state with a
  600 s deadline; `/health` is polled every 5 s with a 360 s deadline. A free
  instance cold-starts in about 60 s; every wait is bounded.
- **Smoke:** `bash scripts/smoke.sh "$PUBLIC_URL"` runs the same five
  assertions and fails the job. The latency assertion keeps the 300 ms local
  budget and uses 1000 ms for a public URL: the samples share one TLS
  connection (one curl, six URLs, first transfer discarded), but a free
  instance and the public network still vary, so the wider budget keeps the
  gate about the service rather than about the internet. The budget used is
  printed in the line.
- **Summary:** the job writes the run URL, deploy id, commit, public URL and the
  smoke transcript to `$GITHUB_STEP_SUMMARY`.

```bash
# Before a deploy whose commit adds a migration:
DATABASE_URL='postgresql://…/invoice?sslmode=require' \
PGOPTIONS='-c lock_timeout=3s -c statement_timeout=30s' npx prisma migrate deploy
```

## Execution status

The repository has a remote (`origin` →
`https://github.com/Amine-Gherbi/cicd-pipeline.git`), and Actions executed the
workflow for the first time on the merge of W3-a:

- **Run 40902199280** (`push` to `master`, 2026-10-29): seven gates green;
  `trivy` failed because it downloaded the `invoice-api-image` artifact without
  `needs: [image]`; its `always()` SARIF upload then failed on the missing file.
  `ci-ok` failed and `publish` was skipped.
- **The fix** is on `w3-b1-green-lane`: `needs: [image]` on `trivy`, a guarded
  SARIF upload, and a code-scanning availability probe so a disabled scanning
  target cannot turn a clean scan red.
- **Green run:** `https://github.com/Amine-Gherbi/cicd-pipeline/actions/runs/40905865091`. **Pushed digest:** `sha256:e45898df9f0f2aab5982069f696ee26a465ea34ef0c3897bc7dae690049b31da`.

Locally on 2026-10-29: `bash scripts/verify.sh` exit 0 (9/9 tests);
`docker build -t invoice-api:$SHA .` exit 0; `trivy image --exit-code 1
--severity CRITICAL,HIGH --ignore-unfixed invoice-api:$SHA` exit 0 with 0
CRITICAL and 0 HIGH across 2 targets. Commands and output: `docs/EVIDENCE.md`.

Hosted target measured on 2026-10-29 (before the `deploy` job could run in
Actions): the Neon `invoice` database has `_prisma_migrations` and `invoices`;
Render service `srv-dbhni75g1s2s73ahheig` is live at
<https://invoice-api-26b4.onrender.com>; the latest deploy
`dep-dbhnjfg8v5cc738v0mq0` is `live` for commit
`f6c4355f2a6e7e01a884b2a599002f9b570b42a1`; and `bash scripts/smoke.sh
https://invoice-api-26b4.onrender.com` passed 5/5 from this machine.

Not executed yet: the `deploy` job inside Actions (it exists and parses, but it
runs only after this branch is merged and a master run starts), and a red PR
(none has been opened). The GHCR push and keyless signature did run: run
40905865091 published digest
`sha256:e45898df9f0f2aab5982069f696ee26a465ea34ef0c3897bc7dae690049b31da`.
There is still no `release.yml` and no attestation artifact; the supply-chain
steps live in the `publish` job.
