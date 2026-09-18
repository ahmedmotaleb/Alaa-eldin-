# Security Review — Sections 28–43

Scope: this review continues from an existing, already-hardened codebase (2FA, security
headers, CSRF/Origin checks, cookie flags, session management, password policy were all
already in place before this review started). It covers **only** sections 28 through 43
of the requested spec. Nothing from sections 1–27 was redone. No functional/business
behavior (checkout, catalog, orders, inventory, loyalty, admin workflows) was changed —
verified by running the full pre-existing test suite, type checks, and all three
production builds after every change.

Per the "do not overclaim" rule governing this report: every claim below is scoped to
what was actually run and observed. Nothing is stated as true of the live Railway
deployment unless explicitly marked "VERIFIED IN PRODUCTION" — nothing has been deployed
yet as of this report, so no such claim appears anywhere below.

---

## 1. Existing Controls (audited, not modified)

Confirmed present and unchanged from before this review: bcryptjs password hashing (cost
10), otplib TOTP 2FA (opt-in, any user, not admin-exclusive), helmet security headers
with an explicit CSP tailored to this app's actual asset origins, a same-origin CORS
policy for production, a dedicated CSRF/Origin-check layer independent of CORS
(`csrfOriginCheck.ts`), HttpOnly/SameSite=Lax session cookies (Secure in production),
DB-backed sessions with device/session management, structured pino logging with request
IDs, parameterized `pg` queries throughout (no string-concatenated SQL found in any
route/service audited).

## 2. New Controls Added (sections 28–41)

- Dependabot configuration (root/server/admin, weekly, grouped patch/minor, majors
  excluded from auto-updates).
- Gitleaks secret scanning wired into CI (blocking on current content, non-blocking
  historical report).
- `npm audit --audit-level=high` added as a CI gate after each `npm ci` (root, server,
  admin).
- Admin Security Settings page extended with 5 new status cards (HTTPS, security
  headers, CAPTCHA, password policy, dependency security) backed by a new safe
  diagnostic-only endpoint.
- Password UX overhaul: reusable `PasswordField` component (admin + storefront), correct
  `autocomplete` values, show/hide toggle, no silent truncation, paste allowed.
- Per-route JSON body-size limits (5MB for bulk admin-product routes, 256KB default
  elsewhere), returning 413.
- Content-Type allowlist middleware for `/api` (JSON + multipart only), returning 415.
- Cache-Control: no-store enforced uniformly on all `/api/*` responses.
- Database privilege documentation (recommendations only — no credential changes).
- 30 new real HTTP-level automated tests (see §17) exercising the actual Express app via
  supertest, replacing what was previously zero end-to-end HTTP test coverage.
- A manual, local, production-mode smoke test covering 26 of the spec's checklist items
  (see §19).

## 3. Dependency Automation

`.github/dependabot.yml` covers `/` (storefront), `/server`, `/admin` (npm), and
`/` (github-actions), weekly on Monday. Patch/minor updates are grouped; major version
updates are excluded from Dependabot's normal update PRs via an `ignore` rule (security
updates are exempted from that ignore rule, so a critical major-version security fix
still surfaces). Nothing is set to auto-merge — every PR still requires human review.

## 4. Secret Scanning

Gitleaks v8.21.2 (plain binary, no third-party Action wrapper) runs in CI: a blocking
scan of current repository content, and a non-blocking full-history scan whose JSON
report is uploaded as a CI artifact and summarized in the job summary — historical
secrets (if any) would be reported as file/commit/type, never as the secret value
itself. Verified locally twice: current working tree → "no leaks found"; full 80-commit
history → "no leaks found". This means: no secret matching gitleaks' default ruleset
plus 4 project-specific custom rules (WhatsApp token, VAPID private key, Cloudinary
secret, session IP-hash salt) was found in this repository's history as of this scan.
It does not mean no secret of any kind, in any form, could ever exist — gitleaks is a
pattern-based scanner, not a proof of absence.

## 5. Dependency Audit

`npm audit --audit-level=high` returns 0 vulnerabilities in all three package trees
(root, server, admin) as of this review. This is a point-in-time result from the `npm
audit` advisory database — it does not mean the dependency tree has no vulnerabilities
of any kind (only high/critical ones gate CI; and `npm audit`'s advisory coverage is
itself incomplete by nature). No `npm audit fix --force` was run at any point.

## 6. CAPTCHA

Not applicable. An exhaustive search of the server and both frontends found no CAPTCHA
or Turnstile integration anywhere in this codebase, before or after this review. No
CAPTCHA was built from scratch, since section 31 only asked to instrument logging *if*
CAPTCHA already existed. This is stated plainly rather than fabricating a status: the
new Admin Security Settings page's CAPTCHA card correctly reports "غير مفعّل" (not
enabled), reading the real state rather than a hardcoded true/false.

## 7. Password Security

Policy (unchanged, audited): minimum 8 characters, at least one letter and one digit,
identical for customer and admin accounts. The Admin Security page shows this real
policy summary — it does **not** claim a stronger illustrative 12-character rule that
was never actually implemented. New automated tests confirm: a weak password is
rejected at registration (400 `weak_password`), a strong one is accepted, the password
hash is never present in any API response, and the stored value in the database is a
bcrypt hash (`$2[aby]$...` prefix), never the plaintext.

## 8. Rate Limiting

Pre-existing, re-verified with real HTTP requests in this review: login is limited to
10 failed attempts / 15 minutes per client (successful logins don't count against the
limit), forgot-password to 5 / 15 minutes. Both were driven to their actual 429 response
in a dedicated, isolated test file and again manually in a live local production-mode
server (see §17, §19).

## 9. CORS / CSRF

CORS remains same-origin-only in production (dev keeps a permissive allowance for local
Vite ports). The independent CSRF/Origin-check layer was verified with real requests in
production mode: a state-changing request from an unapproved cross-site Origin gets 403
`invalid_origin`; the same request with no Origin header (native app / same-origin
edge case) is accepted; a safe GET request is never blocked regardless of Origin.

## 10. Security Headers

Helmet's full default header set was confirmed present on live responses:
`Content-Security-Policy` (site-specific, no `unsafe-inline`), `Strict-Transport-
Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection: 0` (the modern, correct value —
disabling the legacy broken XSS auditor rather than enabling it), `Cross-Origin-
Opener-Policy`, `Cross-Origin-Resource-Policy`, `Referrer-Policy: no-referrer`.

## 11. Input / SQL Injection Review

Every route and service file touched or read during this review constructs SQL via
parameterized queries (`$1, $2...` placeholders with a separate values array) — no
string concatenation of user input into SQL text was found anywhere in the codebase
areas covered by this review. This was verified two ways: (a) source-level reading of
`catalogService.ts`'s search-query builder and every route touched in sections 36–40; (b)
live requests with `' OR 1=1 --` through both the public catalog search and the login
email field, in both the automated suite and the manual smoke test, returning normal,
unaffected results (empty search results / `invalid_credentials`) with no error, no
data dump, and no SQL error message leaked to the client. This is not a claim that the
*entire* codebase (all ~90 route/service files) was individually audited line-by-line
in this pass — it is scoped to the files read and the endpoints exercised.

## 12. Output Security (XSS)

This is a JSON API consumed by two separate SPA frontends — there is no server-side HTML
templating that could inject user input into markup. Verified live: a `<script>` payload
submitted as a user's full name is returned by the API as an inert JSON string
(`Content-Type: application/json`), stored and echoed back byte-for-byte, never
interpreted as HTML by the server. This confirms the specific property asked for
(stored input is never executed by the server), not a general claim about how either
frontend's React rendering handles arbitrary strings (React itself escapes text content
by default, which was not separately re-audited in this pass).

## 13. File Exposure

`/.env` and any path with a dot in its last segment (e.g. `/server/.env`,
`/server/src/index.ts`) correctly return a generic 404. Paths like `/.git/config`,
`/server/`, `/logs/`, `/backup/` (no dot in the last path segment) return HTTP 200 — but
the response body in every case is the storefront's generic SPA `index.html` shell, not
any real file content. This is the SPA client-side-routing fallback (needed so a
deep-linked route like `/product/tomato` works on a hard refresh), not a real file
disclosure: `.git`, `/server` source, `/logs`, and `/backup` are never inside the
directory Express serves as static files. This is flagged as a minor precision gap
(see §21) — returning 404 for these paths too would be more correct/less confusing to a
recon scan — but it is explicitly **not** a content-exposure vulnerability, and is
reported as such rather than either downplaying or overstating it.

## 14. Error Handling

Live-verified: a malformed-JSON request (a genuine, unhandled server-side exception,
`SyntaxError: Unexpected end of JSON input`) produces a client response of exactly
`{"error":"server_error"}` — no stack trace, no file path, no SQL text. The *same*
request, inspected in the server's own structured log file, contains the full stack
trace, error message, request ID, method, and path — confirming the internal diagnostic
detail is preserved for operators while the client only ever sees the generic message.
One precision gap noted: this case is currently classified as a 500 rather than a 400
(malformed client JSON is a client error, not a server fault) — the security property
(no information leakage) holds either way; the status-code accuracy is a separate,
minor correctness improvement listed in §21.

## 15. Cache Security

All `/api/*` responses now carry `Cache-Control: no-store` uniformly, including
authentication, account, orders, addresses, loyalty, admin, and the new security-status
endpoint — verified live on `/api/auth/me` (both authenticated and unauthenticated) and
on `/api/admin/security-status`. This is stricter than the spec's minimum bar (which
allowed public catalog/banner data to be cacheable) — it trades a small amount of
possible public-data caching efficiency for a simpler, uniformly-safe rule with zero risk
of an authenticated response ever being cached. Static built assets under `/assets/*`
keep their existing long-lived immutable cache; `index.html`/service worker keep
`no-cache` (always revalidated) — both unchanged by this review.

## 16. CI Security Gates

`ci.yml` now runs (in order, after `fetch-depth: 0` was added to checkout so the
history scan works): install gitleaks binary → blocking secret scan of current content →
non-blocking full-history secret scan (report uploaded as an artifact) → the pipeline's
pre-existing steps (migrations, server tests, TS checks, storefront/admin/server builds),
with an `npm audit --audit-level=high` step added right after each of the three `npm ci`
steps. This was validated by parsing the YAML with `python3`/`yaml` to confirm step order
and structure — it was not validated by an actual GitHub Actions run in this session
(that only happens on push/PR).

## 17. Automated Tests (exact counts)

Full server suite: **793 tests passed, 793 total, 0 failed, across 68 test files**
(up from 763 tests / 65 files before this review — 30 new tests in 3 new files).

The 30 new tests are genuine HTTP-level tests using `supertest` against the real,
fully-configured Express `app` (not mocked req/res, not service-layer calls) — the first
tests in this codebase to do so:

- `httpSecurity.test.ts` (24 tests): security headers, generic 404, cache headers on
  private endpoints, weak/strong password handling, password hash never returned, a full
  2FA setup→confirm→login→verify round trip (using a real otplib-generated TOTP code),
  customer-vs-admin and staff-vs-full-admin authorization, cross-customer IDOR on
  addresses and order lists, SQL-injection-style search/login input treated as data,
  stored-XSS payload round-tripped as inert JSON, oversized-JSON 413, wrong-Content-Type
  415, zero-body POST content-type exemption, cookie HttpOnly/SameSite attributes,
  malformed-JSON error-handling with no leaked internals, and the new admin
  security-status endpoint's no-secret-exposure + no-store guarantees.
- `httpSecurityRateLimit.test.ts` (2 tests, isolated in its own file/process so tripping
  the limiter doesn't affect other tests): login rate limit trips at the 11th failed
  attempt (10 real 401s then 429), forgot-password trips at the 6th (5 real 204s then
  429).
- `httpSecurityProduction.test.ts` (4 tests, `NODE_ENV=production` forced before
  dynamically importing the app): cross-site Origin rejected with 403, no-Origin request
  accepted, safe GET always allowed regardless of Origin, session cookie carries
  `Secure` in production.

This required a structural refactor: `server/src/index.ts` was split into `app.ts`
(the fully configured, listen()-free Express app, now exported for tests) and a thin
`index.ts` entrypoint (PORT, `app.listen`, the two `process.on` crash handlers) — a
behavior-preserving change confirmed by running the full pre-existing 763-test suite,
type-check, and all three production builds immediately after the split, before any new
test was added.

## 18. Build Verification

Run after every change in this review, every time, in this order: `tsc --noEmit`
(server) → full server test suite → `npm run build` (server, storefront, admin). All
three production builds succeeded on the final pass. The compiled server (`node
dist/index.js`) was also manually booted twice (once in dev-like mode, once in
`NODE_ENV=production`) and its `/health` endpoint and various routes were exercised live
with curl to confirm the compiled output behaves identically to the source.

## 19. Manual Smoke Tests (local production-mode only)

Performed against a real local server process running the actual compiled production
build (`NODE_ENV=production node dist/index.js`, real local Postgres), driven entirely
with `curl`/`psql` — not the automated suite, a second independent pass. Results:

| # | Check | Result |
|---|---|---|
| 1 | Login with valid credentials | 200, session cookie set |
| 2 | Login with invalid password | 401 `invalid_credentials` |
| 3 | Login rate throttling | 401×9 then 429 on the 10th/11th |
| 4 | CAPTCHA behavior | N/A — none exists (see §6) |
| 5 | 2FA setup → confirm → login → verify | Full round trip succeeded; wrong code correctly rejected (401 `invalid_code`) |
| 6 | Password reset (forgot → reset → login with new password) | 204 → 204 → 200 |
| 7 | Origin rejection (unapproved cross-site Origin, state-changing request) | 403 `invalid_origin` |
| 8 | Origin acceptance (approved dev origin) | 204 |
| 9 | CSRF rejection | Same mechanism as #7, confirmed |
| 10 | Customer hitting an admin-only endpoint | 403 `forbidden` |
| 11 | IDOR (customer B reading/deleting customer A's address) | 404 `address_not_found` both times; A's address unaffected |
| 12 | SQLi string (`' OR 1=1 --`) through search and login | Treated as literal text — empty results / `invalid_credentials`, no error |
| 13 | XSS payload (`<script>alert(1)</script>`) through registration | Returned as inert JSON string, `Content-Type: application/json` |
| 14 | Oversized JSON body | 413 `payload_too_large` |
| 15 | Invalid upload (unauthenticated) | 401; authenticated-admin path additionally confirmed fail-closed with 503 `image_storage_not_configured` when Cloudinary isn't configured (this sandbox has no real Cloudinary credentials, so the MIME/magic-byte file-type rejection itself was verified by source-code review, not a live end-to-end request — see §21) |
| 16 | `/.env` | 404 |
| 17 | `/.git/config` | 200, but body is the generic SPA shell, not real file content (see §13) |
| 18 | `/server/` | 200, same SPA-shell caveat |
| 19 | `/logs/` | 200, same SPA-shell caveat |
| 20 | `/backup/` | 200, same SPA-shell caveat |
| 21 | Generic 500 with no stack trace | Confirmed — client got `{"error":"server_error"}` only |
| 22 | Internal logger still records diagnostics | Confirmed — full stack trace present in the server's own log file for the same request |
| 23 | Security headers present | Confirmed (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection: 0) |
| 24 | HTTPS URLs correct | **Not independently verifiable from this sandbox** — see §20 |
| 25 | Production cookies Secure | Confirmed — `Secure; HttpOnly; SameSite=Lax` present |
| 26 | Private API responses no-store | Confirmed on `/api/auth/me` |

## 20. Production Verification

**VERIFIED LOCALLY ONLY.** Nothing in this review has been committed, pushed, or
deployed to Railway as of this report. Everything in §17–§19 was run against a local
compiled build and/or a local test database — none of it is evidence about the actual
live Railway deployment's behavior. Specifically:

- The Railway environment's `PUBLIC_APP_URL` value could not be read in this session
  (Railway returned variable *names* only, redacted values, for this session's access
  level) — so item #24 (HTTPS URLs) could not be directly confirmed either way. Railway's
  own platform-provided public domain is HTTPS-terminated at Railway's edge by default
  (a platform-level guarantee, not app config), so links built from Railway's own domain
  variables are HTTPS by construction; if a custom domain was configured instead, its TLS
  setup was not verified here.
- CI's new secret-scan and `npm audit` gates have not yet actually run in GitHub Actions
  in this session — their YAML structure was validated locally, not their live execution.
- **NOT VERIFIED**: whether the live Railway deployment currently serves over HTTPS with
  a valid certificate, whether Railway's edge enforces the same headers this review
  confirmed at the app layer, or any other characteristic of the actual running
  production service. A `railway list-deployments`/`get-logs` check after the next real
  deploy would be needed before any of that could be claimed.

## 21. Remaining Risks / Minor Findings (not fixed in this pass, listed for transparency)

1. Malformed-JSON requests currently return 500 instead of the more semantically correct
   400 — no information leaks either way, but the status code is imprecise (§14).
2. The SPA fallback route returns 200 + generic index.html for several sensitive-sounding
   paths (`/.git/config`, `/server/`, `/logs/`, `/backup/`) instead of a 404 — no real
   content is exposed, but a 404 would be less confusing to a recon scanner (§13).
3. The image-upload MIME/magic-byte rejection path exists in source and was code-reviewed,
   but could not be exercised end-to-end live in this sandbox (no real Cloudinary
   credentials configured here) — worth a live check once deployed.
4. Database access still uses a single, shared, presumably-superuser-level Postgres role
   for both migrations and runtime queries — least-privilege separation is documented as
   a recommendation only (§9 of `server/docs/DATABASE_PRIVILEGES.md`), not implemented.
5. No CAPTCHA exists on any public form (registration, login, forgot-password) — this
   was explicitly out of scope to build from scratch per the task's own instructions,
   but remains a gap against automated credential-stuffing/registration-abuse beyond what
   rate limiting alone provides.

## 22. External Configuration Still Required

- Manually create a least-privilege Postgres role and switch the app's runtime
  `DATABASE_URL` to it, per `server/docs/DATABASE_PRIVILEGES.md` (deliberately not done
  automatically in this review).
- Confirm the live Railway service's actual `PUBLIC_APP_URL` value and its scheme.
- After merging, watch the first real CI run to confirm the new gitleaks/`npm audit`
  steps behave as expected in GitHub Actions (not just validated locally).
- Decide whether to add a CAPTCHA/Turnstile provider for public forms — currently none
  exists.

## 23. Recommended Next Security Actions

1. Deploy this branch and re-run the same manual smoke-test checklist against the real
   Railway URL, specifically re-confirming HTTPS, headers, and cookie flags on the actual
   deployed service (closing the §20 gap).
2. Fix the two minor precision gaps in §21 (malformed-JSON status code, SPA-fallback
   404s for dotfile/sensitive-looking paths) in a small, separate follow-up change.
3. Implement the least-privilege database role split described in
   `server/docs/DATABASE_PRIVILEGES.md` on a maintenance window, with a rollback plan.
4. Consider a CAPTCHA/Turnstile provider on public registration/login/forgot-password if
   abuse is ever observed in production logs.
