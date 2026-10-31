# QA-7 — pipeline auth, headers, contrast, SEO

Branch: `qa-7-auth-headers`, cut from `origin/master` (`8bde0e9`). Not merged;
the supervisor opens the PR.

| Finding | Fix | Proof |
|---|---|---|
| `GET /invoices/:id` unauthenticated (High) | `SMOKE_TOKEN` bearer guard now covers the read path | local 401 without token, 404 with it; `smoke.sh` 5/5 |
| README says "no remote / not executed" | replaced with the registered workflow, green and red runs, ruleset and demo page | `README.md:37` |
| Demo contrast 3.07:1 / 3.25:1 on 10 nodes | `--dim` raised `#5d636c` → `#8b9199` | measured 5.855:1 / 6.195:1; Lighthouse a11y 94 → 100 |
| Demo page has no meta description | added one sentence | Lighthouse seo 90 → 100 |
| Neither service sends the security headers | one Fastify plugin per service | six headers on both; no CSP violation |

## 1. Invoice read path

`src/routes/invoices.ts` builds one guard and applies it to both routes:

```ts
const guardOptions = smokeToken === undefined ? {} : { preHandler: smokeTokenGuard(smokeToken) };
app.post('/invoices', guardOptions, ...);
app.get<{ Params: { id: string } }>('/invoices/:id', guardOptions, ...);
```

Order is authentication first, then validation and lookup, so an unknown UUID
without a token is `401`, not `404`. The POST path is unchanged.

Local proof against the fixed service on `127.0.0.1:18093`, started with the
token from `.env.local`:

```text
anon GET: 401
auth GET: 404
anon POST: 401
auth POST: 201
```

Authenticated unknown id body:

```json
{"error":{"code":"not_found","message":"Invoice not found"}}
```

`scripts/smoke.sh` assertion 4 now proves both statuses and the error shape.
Full run in the form the deploy job uses (`SMOKE_TOKEN` from the environment, an
explicit base URL, exit 0):

```text
$ SMOKE_TOKEN=… bash scripts/smoke.sh http://127.0.0.1:18093
smoke: http://127.0.0.1:18093 (release remote)
PASS 1/5 /health 200 {status:ok}
PASS 2/5 /ready 200 database+ok migrations+ok
PASS 3/5 POST /invoices 401 unauthenticated, 201 authenticated
PASS 4/5 GET /invoices/<random-uuid> 401 unauthenticated, 404 authenticated, no stack
PASS 5/5 /ready p95 14.4ms < 1000ms (5 warm samples)
smoke: ok (5 of 5 assertions)
```

The no-argument local form (`RELEASE_PORT=18093 bash scripts/smoke.sh`) also
passes 5/5; its transcript is `_orchestration/runs/QA-7/smoke-local.txt`.

The integration test suite stays at 9 tests: the existing GET tests now run on
the token-configured app with the header, and the token test covers the read
path's 401 and 200. `GET /invoices/:uuid` specifically asserts 401 without the
token and 404 with it.

**Left:** the hosted URL still serves the previous image. `deploy` is
master-only in `pr.yml`, so `https://invoice-api-26b4.onrender.com` changes only
after this branch merges and the deploy job runs. The proof above is a real
process using the same code and token, not the hosted instance.

## 2. Security headers

- `src/plugins/security-headers.ts` — registered in `src/app.ts` before the
  routes. API CSP is `default-src 'none'; base-uri 'none'; form-action 'none';
  frame-ancestors 'none'`.
- `demo/security-headers.mjs` — registered in `demo/server.mjs`, replacing the
  inline four-header hook. The demo CSP keeps `style-src 'unsafe-inline'` and
  `script-src 'unsafe-inline'`; `connect-src` stays `'self'`.

Both plugins opt out of Fastify's hook encapsulation with
`Symbol.for('skip-override')` (what `fastify-plugin` sets), so the `onSend` hook
covers every route without adding a dependency.

invoice-api, captured on a 200, a 401 and a 404:

```text
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: no-referrer
permissions-policy: camera=(), microphone=(), geolocation=()
content-security-policy: default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Demo service, same six headers, with its page CSP. Playwright (Chromium 1248,
1440×900) loaded the page and reported:

```json
"cspViolations": [],
"consoleErrors": [],
"pageErrors": [],
"description": "Dispatch the invoice-api gates, run a deliberately bad image past Trivy, and roll a faulty Render deploy back.",
"apiRun": { "status": 202, "followStatus": 200 }
```

The `/api/run` call was made with `fetch` from the page itself, so it also
proves `connect-src 'self'` still permits the call; `/api/run/:id` then answered
200. The inline style and script rendered: three action buttons, the full
heading outline, same document height (900) and width (1440) as before.

## 3. Contrast

One token changed: `--dim` from `#5d636c` to `#8b9199`. Layout, sizes and spacing
are untouched.

Computed from the rendered page (effective background walked up from each text
node); 10 nodes use the token, all of them:

| Node | Background | Before | After |
|---|---|---|---|
| `01`, `02`, `03` step numbers, evidence line | `#111316` | 3.072:1 | **5.855:1** |
| release rows | `#0a0b0d` | 3.250:1 | **6.195:1** |
| empty-state line, notes, recent `r` | `#111316` | 3.072:1 | **5.855:1** |
| footer | `#0a0b0d` | 3.250:1 | **6.195:1** |

No text node on the page falls below its WCAG AA threshold after the change
(`below threshold: 0`). Raw measurement:
`_orchestration/runs/QA-7/after-contrast.json`.

Screenshot comparison (`_orchestration/runs/QA-7/before-viewport.png` /
`after-viewport.png`), same 1440×900 canvas: 9,373 differing pixels (0.723%),
difference bounding box `158,113 → 1282,876` — only the muted text pixels; no
element moved or resized.

## 4. SEO

Added to `<head>`:

```html
<meta name="description" content="Dispatch the invoice-api gates, run a deliberately bad image past Trivy, and roll a faulty Render deploy back.">
```

## Lighthouse re-run

Both runs used the same Lighthouse 13.6.0 and Chromium 1248. The "before" run
served the pre-change `demo/page.mjs` from `git show HEAD:demo/page.mjs` so the
comparison is controlled, not remembered.

| Category | Before | After |
|---|---|---|
| accessibility | 94 | **100** |
| seo | 90 | **100** |

Before: `color-contrast` failed with 9 flagged items (10 text nodes) and
`meta-description` failed. After: no failing accessibility or SEO audit.

## 5. README

`README.md:37` no longer says "Local only", "no git remote" or "not executed".
It now records the registered workflow, the `main-protection` ruleset and
`ci-ok`, the green master run 40929181528 (gates → `ci-ok` → `publish` →
`deploy`), the red blocked run 40931333527, and the demo page that dispatches
`demo.yml`. No dates were added.

## Gate results

```text
bash scripts/verify.sh   -> verify: ok (lint, types, 9 tests passed)
docker build             -> exit 0, invoice-api:qa7, 284 MB
trivy image ...          -> exit 0, 0 CRITICAL/HIGH fixable findings (alpine 3.24.3)
```

No dependency was added; `package.json` and `package-lock.json` are unchanged.
`pr.yml` is untouched, so `ci-ok` remains the only required check, the Trivy
flags are unchanged, there is still no `continue-on-error`, and branch
protection is unchanged.

## Left / caveats

- **Hosted redeploy.** `invoice-api` updates on the master `deploy` job after
  merge; the `pipeline-demo` Render service needs a deploy from `master` before
  the new headers, contrast and meta description are visible at
  `https://pipeline-demo-57mh.onrender.com`. Until then both hosted URLs serve
  the pre-fix code.
- **Breaking change by design.** Anonymous readers of `GET /invoices/:id` now
  get `401`; that is the point of the finding, but any consumer holding only a
  UUID must send the bearer token.
- HSTS is one year with `includeSubDomains`, no `preload`.
- The `--dim` token also colors the queued job dot, so those dots lighten too;
  no layout change.
- Raw local artifacts (full Lighthouse JSON, Docker/Trivy logs) are in
  `.deploy/qa7/`, which is gitignored. The screenshots, contrast JSON and smoke
  transcript are copied into `_orchestration/runs/QA-7/`.
