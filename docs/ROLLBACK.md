# Local release lane and rollback

Two lanes, never conflated:

- **CI lane** — build → Trivy → attest → push to GHCR (GitHub Actions only; this
  host has no Docker daemon).
- **Local lane** — `scripts/release-local.sh`: build → swap → wait → smoke →
  rollback. This is the only place a deploy actually happens.

The local lane is recorded here because a deploy you cannot roll back is not a
deploy. The order of lines in `deploy.log` is the evidence, not a screenshot.

## Scripts

| Command | What it does |
|---|---|
| `./scripts/release-local.sh <sha> [label]` | Build `.releases/<full-sha>[-label]/`, capture `PREVIOUS_REF`, swap `current`, restart, wait for `/health` + `/ready`, run smoke; on failure roll back, restart, re-wait, re-smoke |
| `./scripts/release-local.sh status` | Print current, previous, pid, and the last 20 lines of `deploy.log` |
| `./scripts/service.sh start\|stop\|restart\|status` | Manage the process for the release `current` points at |
| `./scripts/smoke.sh` | The five assertions, one printed line each |

Release layout: `.releases/<sha>[-label]/{dist,prisma,package.json,manifest.json}`.
`manifest.json` records the sha, build time, Node version, dirty flag, and an
optional injected fault.

### `current` on Windows (pointer file, not a pretend symlink)

A native symlink needs `SeCreateSymbolicLinkPrivilege`. In this Git Bash,
`ln -s` silently copies a directory instead of linking it, so `release-local.sh`
probes for real symlink support and, when it is absent, writes `current.txt`
containing the release path relative to the repo root. `service.sh` reads either
`current` (if it is a real symlink) or `current.txt`. The header of
`release-local.sh` says this; the scripts never treat a copy as a symlink.

### Port

`invoice-api` documents **8080** as its default. Windows excludes TCP
**8001–8300** on this host, so every local command uses **8787**. Override with
`RELEASE_PORT` if that range changes. The service is started with
`NODE_ENV=production` and its `DATABASE_URL` from `.env`; `service.sh` seeds a
random `SMOKE_TOKEN` in `.env.local` (gitignored) the first time it starts.

`POST /invoices` requires `Authorization: Bearer $SMOKE_TOKEN` when that variable
is set. Smoke assertion 3 proves both halves: no token → 401, token → 201.

## Recorded run — 2026-10-23

Host: Windows 11, Git Bash, Node v22.23.4, PostgreSQL 16 on `localhost:5433`
(`invoice_dev`), service on `127.0.0.1:8787`. Deployed sha:
`3b8fe5926fe4f150ef376c9a74b233a517d8c58f` (HEAD; `dirty=1` because the C4
scripts were still uncommitted when this was recorded).

### 1. Healthy deploy

```
$ bash scripts/release-local.sh 3b8fe59
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 3b8fe5926fe4f150ef376c9a74b233a517d8c58f (release 3b8fe5926fe4f150ef376c9a74b233a517d8c58f, dirty=1)
==> build
==> PREVIOUS_REF=(none, first deploy)
==> built .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f
==> current -> .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f
service is not running (no pid file)
started release .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f (pid 2224) on 127.0.0.1:8787
==> health.ok
/p/portfolio/cicd-pipeline/scripts/smoke.sh: line 89: CURRENT_LINK: unbound variable
smoke: http://127.0.0.1:8787 (release )
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 6.8ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
==> smoke.ok
release 3b8fe5926fe4f150ef376c9a74b233a517d8c58f is live on http://127.0.0.1:8787
```

The `CURRENT_LINK: unbound variable` line was a cosmetic header bug in the
first recorded attempt (the release path printed empty). It is fixed in
`smoke.sh`; assertions and exit status were unaffected, and the line above is
left in the transcript rather than edited out.

### 2. Deliberately broken build → smoke fails → rollback

The broken artifact is built by the same script with
`RELEASE_FAULT=invoices-500`: after compilation, the release's
`dist/routes/invoices.js` throws on `POST /invoices`. `/health` and `/ready`
stay healthy, so the **smoke gate** — not the readiness wait — is the thing that
fires.

```
$ bash -c 'RELEASE_FAULT=invoices-500 bash scripts/release-local.sh 3b8fe59 broken'
==> current pointer: current.txt (native symlinks unavailable on this host)
==> deploy.start 3b8fe5926fe4f150ef376c9a74b233a517d8c58f (release 3b8fe5926fe4f150ef376c9a74b233a517d8c58f-broken, dirty=1)
==> build
==> injected deliberate fault: invoices-500
==> PREVIOUS_REF=.releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f
==> built .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f-broken
==> current -> .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f-broken
stopped pid 2224
started release .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f-broken (pid 2466) on 127.0.0.1:8787
==> health.ok
smoke: http://127.0.0.1:8787 (release .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f-broken)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
FAIL 3/5 POST /invoices authenticated — authenticated request returned 500, expected 201
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 6.8ms < 300ms (5 warm samples)
smoke: FAIL (1 of 5 assertions)
smoke gate failed
==> rollback to .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f
stopped pid 2466
started release .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f (pid 2547) on 127.0.0.1:8787
smoke: http://127.0.0.1:8787 (release .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 404 not_found, no stack
PASS 5/5 /ready p95 8.2ms < 300ms (5 warm samples)
smoke: ok (5 of 5 assertions)
rollback complete: .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f is live and passes smoke
rolled back to .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f after smoke.fail
```

The command exits **1** because the deploy failed; that is correct. The service
is live again on the previous release, verified by a fresh `wait` and a full
smoke run after the restart. Swapping the pointer without restarting would have
left the old process serving and proved nothing.

### `deploy.log` (the evidence)

```
deploy.start 3b8fe5926fe4f150ef376c9a74b233a517d8c58f 2026-10-23T00:17:49Z
health.ok 2026-10-23T00:17:59Z
smoke.ok 2026-10-23T00:18:03Z
deploy.start 3b8fe5926fe4f150ef376c9a74b233a517d8c58f 2026-10-23T00:18:23Z
health.ok 2026-10-23T00:18:32Z
smoke.fail 2026-10-23T00:18:36Z
rollback.start 2026-10-23T00:18:36Z
rollback.health.ok 2026-10-23T00:18:39Z
rollback.smoke.ok 2026-10-23T00:18:47Z
```

Required order for the broken deploy is present and in file order:
`deploy.start → health.ok → smoke.fail → rollback.start`. `smoke.fail` and
`rollback.start` share a second because the gate fired immediately; line order
is the ordering, not timestamp resolution.

### Status

```
$ bash scripts/release-local.sh status
current:  .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f
previous: .releases/3b8fe5926fe4f150ef376c9a74b233a517d8c58f
pid:      2547 (alive)
--- deploy.log (last 20 lines) ---
deploy.start 3b8fe5926fe4f150ef376c9a74b233a517d8c58f 2026-10-23T00:17:49Z
health.ok 2026-10-23T00:17:59Z
smoke.ok 2026-10-23T00:18:03Z
deploy.start 3b8fe5926fe4f150ef376c9a74b233a517d8c58f 2026-10-23T00:18:23Z
health.ok 2026-10-23T00:18:32Z
smoke.fail 2026-10-23T00:18:36Z
rollback.start 2026-10-23T00:18:36Z
rollback.health.ok 2026-10-23T00:18:39Z
rollback.smoke.ok 2026-10-23T00:18:47Z
```

`previous` equals `current` after a rollback because the recorded
`PREVIOUS_REF` was the good release and it is now serving again. The broken
release is not promoted to "previous"; it was never live long enough to pass the
gate.

## Why `/ready` 500 is caught before smoke

`RELEASE_FAULT=ready-500` is supported too. It makes `/ready` return 500, which
the `wait` gate rejects (no `health.ok` is written), and the deploy rolls back
without running smoke. That is the correct behaviour: the smoke gate is only
reached by a build that is already healthy. The recorded smoke-failure demo
therefore breaks `POST /invoices`, which leaves `/health` and `/ready` green and
lets the five assertions name the failing behaviour.

## Limits — one minor version back, expand/contract only

Rollback is **valid one minor version back and only when the migration followed
expand/contract**. It swaps code (the `current` pointer) and restarts the
process; it does **not** undo a database migration. If the failed release
applied a destructive or non-backward-compatible migration, the previous code
may be unable to read the new schema, and no amount of pointer swapping fixes
that.

- **One minor version:** keep N-1 deployable. Do not roll back across two minor
  versions; the older code may assume columns or semantics that N-2 already
  changed. Pre-pulling N-1 and pinning images by digest is what makes this
  mechanical in the CI lane.
- **Expand/contract only:** a migration must first expand (add nullable columns,
  backfill, dual-write), deploy code that tolerates both shapes, and only then
  contract (drop/rename) in a later release. A `DROP`/`RENAME` in the same
  release that introduces it breaks rollback by construction.
- **No schema rollback:** rolling the code back does not roll the schema back.
  The readiness check will still pass if the schema is expand-compatible; that
  is the only case where the rollback above is trustworthy.
- **One release back, not many:** `PREVIOUS_REF` records exactly the release
  that was current before the swap. There is no history stack.
- **Local lane only:** this proves the deploy state machine, health gate, smoke
  gate and rollback. It does not prove a registry digest was pulled; that is the
  CI lane's job (`cosign verify`, `gh attestation verify`).
