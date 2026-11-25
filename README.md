# IFP Subsidy Platform — admin side

Multi-tenant case management for Chartered Accountant firms preparing Gujarat IFP
subsidy applications. Web app, API, and a Chrome MV3 extension that fills a
prepared case into the portal form.

> **This platform does not file anything.** It captures and validates case data.
> Submitting on the government portal — logging in, solving the CAPTCHA, pressing
> submit — remains entirely with the CA.

Just want it running? [`RUN.md`](RUN.md) is the runbook — daily start, first-time
setup, sign-in accounts and what to do when something will not start.

New here? [`HOW_IT_WORKS.html`](HOW_IT_WORKS.html) is a plain-language walkthrough
of the whole thing — the case workflow, the extension, roles, licensing and the
limits — written for the people who will use it rather than build it. Open it in
a browser.

See [`PROJECT_PLAN.html`](PROJECT_PLAN.html) for the full architecture, risks and
open questions, and [`TODO.md`](TODO.md) for build status.

---

## Quick start

Requires Node 20+ and Docker Desktop.

```bash
cp .env.example .env     # then fill in the three generated secrets, see below
npm install
npm run build:shared     # the API and web both import @ifp/shared
npm run db:up            # Postgres on :5433 + Mailhog on :8025
npm run db:generate
npm run db:deploy        # applies the migrations
npm run db:seed          # reference data + a demo firm (dev only)
npm run dev              # API on :4000, web on :5173
```

Generate the secrets `.env` needs:

```bash
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('KMS_LOCAL_MASTER_KEY='+require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('BLIND_INDEX_PEPPER='+require('crypto').randomBytes(32).toString('base64'))"
```

### Dev sign-in

Seeded by `npm run db:seed`, **development only**:

| Email | Role | Can |
|---|---|---|
| `admin@demo.local` | Firm admin | everything in the firm, incl. users + audit |
| `ca@demo.local` | CA | clients, cases, reveal identifiers, consent, transitions |
| `staff@demo.local` | Staff | data entry only — no reveal, no consent, no filing |
| `reviewer@demo.local` | Reviewer | read-only + audit |
| `platform@demo.local` | Platform admin | provision/suspend firms — **no** client data |

Password: `ChangeMe!Dev2026` (override with `SEED_DEMO_PASSWORD`).

In a **development** build the sign-in page shows one button per role that fills
the form for you. It is wrapped in `import.meta.env.DEV`, so Vite eliminates it
from a production build — the addresses and password are not merely hidden, they
are absent from the bundle. If you seeded with a custom `SEED_DEMO_PASSWORD`,
set `VITE_DEMO_PASSWORD` to match.

Outbound mail (invites, password resets) goes to Mailhog: http://localhost:8025

> Postgres is mapped to **5433**, not 5432, because this machine already runs a
> Postgres on the default port.

---

## Layout

```
apps/
  extension/    Chrome MV3. Fills the portal form; never submits it — see its README
  api/          Express + Prisma. Layered: routes -> services -> tenant-scoped repository
  web/          React 18 + Vite + TypeScript SPA
    src/index.css          the theme: every colour in the app resolves to a token here
    src/components/ui/     shadcn/ui primitives (owned source, edit freely)
    src/components/form-fields.tsx  RHF + Zod field wrappers — the only way a form renders an input
    src/components/data-table.tsx   the list surface: table, sorting, empty state, pagination
    src/lib/use-paged-list.ts       query state + fetching behind every paged list
packages/
  shared/       Zod schemas, enums, permissions, UUIDv7 — imported by both apps
prisma/
  schema.prisma 36 models
  migrations/   init, security (RLS/CHECKs/grants), auth fns, platform fns,
                extension, licensing — 11 in all
  seed/         reference data, scheme v1 (DRAFT), validation rules, demo firm
scripts/
  smoke.mjs     142-assertion end-to-end test against a running API
```

---

## Lists are paged

Every list endpoint returns the same envelope:

```json
{ "items": [], "page": 1, "pageSize": 25, "total": 213, "totalPages": 9,
  "hasPrev": false, "hasNext": true }
```

Query it with `?page=&pageSize=&sort=&dir=`. `pageSize` is capped at 100 and
`sort` is a closed enum per endpoint, so an unknown key is a 422 rather than a
surprise ORDER BY. Asking for a page past the end returns empty `items` with
the real `total`, which lets the client clamp instead of concluding the list
is empty.

A keyset cursor scales better, but it only moves forward: it cannot answer
"how many are there" or "take me to page 7". At firm scale — thousands of
clients, not millions — OFFSET with a COUNT is the honest trade.

On the client, `usePagedList` owns that state. Two of its rules are easy to
get wrong page-by-page and so live in one place: changing a filter resets to
page 1, and a response is discarded unless it is the newest one requested
(otherwise a slow early response overwrites what the user actually typed).

---

## Theme

`src/index.css` holds the whole palette as HSL tokens, light and dark, plus
sidebar, elevation and radius. Components read tokens only — a status colour
hard-coded in one table cannot be corrected for contrast in dark mode.

Inter is bundled from `@fontsource-variable`, not fetched: the app has to work
on a locked-down firm network, and a font CDN should not be told the URL of
every page a CA opens. Only the Latin subsets are declared.

`index.html` applies the stored theme in a blocking script before first paint,
so a dark-mode user does not get a white flash on every reload.

---

## The browser extension

`apps/extension` — load unpacked, pair it with a ten-minute code from
**Browser extension** in the web app, and it fills the IFP application form
with a case you already prepared.

**It never presses submit, never touches a CAPTCHA, never reads a password
field, and never stores an IFP credential.** Those are properties of the code,
not settings: `apps/extension/test/safety.test.js` asserts them against the
source and fails the build if one stops holding. Each has been mutation-tested.

No selectors ship with it. Nobody on this project has seen the authenticated
portal form, and a guessed selector would type a PAN into whatever box happened
to match — so the field map is **captured from the real page** through the
extension's "Learn this page", then reviewed and activated by a human in the
web app. Captures store a digest of the form's shape, so when the portal
changes the extension says so instead of filling the wrong boxes.

Revealing a case through the extension needs the same `sensitive:reveal`
permission and writes the same audit row as revealing a PAN in the web app.
Telemetry records which field NAMES were attempted and what happened — never a
value, and every run records `submitted: false`.

The extension calls from `chrome-extension://<id>`, which cannot be in
`WEB_ORIGIN`. Development accepts any extension origin on `/extension` routes
and nowhere else; production must name the id in `EXTENSION_ORIGINS`.

See [`apps/extension/README.md`](apps/extension/README.md).

---

## Platform administration

`/platform/firms` provisions tenants: create a firm with its first
administrator (who receives a single-use invitation and sets their own
password), suspend a firm, restore it. Suspension refuses sign-in for everyone
in that firm and **deletes nothing** — it is reversible from the same screen.

A platform administrator gets a **different application**, not the firm's app
with the interesting parts greyed out: Overview, Firms and Renewals, and
nothing else in the sidebar. Their tenant holds no clients and no cases by
design, so the case dashboard would have greeted them with three zeroes.

`platform:admin` is **one permission, not a wildcard**. It used to satisfy
every check in the application — one role that passed `client:read`,
`audit:read` and the rest on every route — which left Row Level Security as the
only thing between a platform administrator and a client record. There is no
wildcard now, and `PLATFORM_ADMIN` holds exactly one permission, so every
firm-facing route answers it with 403 rather than with an empty list. The
smoke test asserts the refusal on `/clients`, `/cases`, `/audit`, `/users` and
`/extension/devices`.

The interesting part is what it cannot do. A platform administrator sees firm
names, status, licences and counts, and that is all. The routes read through SECURITY
DEFINER functions whose *return types* carry no client, case, identifier or
document column, so the limit is enforced by the database rather than by the
API remembering to leave fields out. The platform admin's own tenant holds no
clients, so their ordinary firm-scoped access reaches nothing either.

Three ways to allow cross-tenant reads were considered; the reasoning is in
`prisma/migrations/20260920000004_platform_functions/migration.sql`. Giving the
app role `BYPASSRLS` was rejected: it would disable every policy for every
query the app ever makes, not just these.

---

## Licensing

A platform administrator sets each firm's plan, the date it ends, a grace
period, and quotas on users, clients and cases. Any quota may be left empty,
which means unlimited. `/platform/licenses` lists what is about to lapse,
expired first.

**An expired licence makes a firm read-only. It does not lock them out.**
Sign-in keeps working, every case stays readable and exportable, and nothing is
deleted or hidden; creating or changing a record is refused with a distinct
problem type so the UI can say why. These are a CA firm's professional records
and they may be obliged to produce them — a late renewal is not a reason for
software to withhold a client's own case file. Suspension is the separate,
reasoned, audited lever that refuses sign-in.

Enforcement is one guard mounted on every tenant router, so the failure mode
being designed against is a route added later by somebody who never read this —
`license.coverage.test.ts` fails the build if a router loses it, and every
non-GET extension route must name it too. Quotas are checked at the three
creation points, where the message can name the thing the user was adding.
Seats count outstanding invitations, so a firm on three seats cannot invite
thirty people and find out one acceptance at a time.

A firm cannot set its own licence. `updateFirmSchema` carries no licence field,
and because "the Zod schema does not have that field" is one refactor away from
being false, a `BEFORE UPDATE` trigger refuses any licence change arriving from
inside a tenant transaction. The platform functions run with no tenant set and
are unaffected. Both walls have a test.

The state machine — valid, expiring soon, in grace, read-only — lives in
`packages/shared/src/util/license.ts` and is pure, with `now` as a parameter.
The API and the browser both call it, so the banner that says "4 days left" and
the refusal that arrives on day five cannot disagree. Dates are evaluated as IST
calendar days against a `DATE` column, because a Gujarat subsidy licence should
not expire at half past five in the morning.

## How tenant isolation works

Two independent layers. Neither is trusted alone.

1. **Prisma client extension** (`apps/api/src/db/tenant.ts`) — injects `firmId`
   into every query on a tenant-owned model, stamps it on every create, and
   rejects a `firmId` supplied in a request body. Application code can only
   obtain a client through `db()`, which is always firm-scoped. The `firm` row
   itself is scoped by `id` instead (`SELF_MODELS`), because it has no
   `firm_id` column.
2. **PostgreSQL Row Level Security** — policies keyed on a transaction-local
   `app.firm_id`. Every tenant query runs inside a transaction that sets it, so
   a pooled connection cannot inherit a stale tenant. The app connects as
   `ifp_app`, which is `NOBYPASSRLS` and does not own the tables; the API
   refuses to start if that is not true (`assertRlsActive`).

With no tenant set, every policy fails closed — which is why the six
authentication lookups (login, bearer-token resolution, refresh/reset/invite
redemption, cross-firm email uniqueness) go through narrowly scoped
`SECURITY DEFINER` functions rather than weakening RLS. See
`prisma/migrations/20260920000003_auth_functions/migration.sql`.

Verify it yourself:

```bash
# no tenant set -> no tenant rows, catalog still readable
docker exec ifp_postgres psql "postgresql://ifp_app:ifp_app_dev_pw@127.0.0.1:5432/ifp" \
  -c "SELECT count(*) FROM client;" -c "SELECT count(*) FROM district;"
```

## How sensitive data is stored

| Data | At rest |
|---|---|
| PAN, GSTIN, Udyam, loan account | AES-256-GCM ciphertext, per-firm key, AAD bound to `firm:table:column:row` |
| Searchable identifiers | HMAC-SHA256 blind index (pepper lives outside the database) |
| Aadhaar | **Last 4 digits only.** Full storage is blocked by a DB CHECK constraint pending a legal decision |
| Passwords | Argon2id (19 MiB, t=2, p=1), rehashed on login when parameters rise |
| Refresh / reset / invite tokens | SHA-256 of a 32-byte random value; the raw token is never stored |

A ciphertext moved to another row, column or firm fails to decrypt rather than
silently returning someone else's identifier. Identifiers leave the API masked;
the full value requires the audited `/reveal` endpoint.

---

## Testing

```bash
npx vitest run --root apps/api        # 302 tests
npx vitest run --root apps/web        #  42 tests
npx vitest run --root apps/extension  #  44 tests
npx vitest run --root packages/shared #  20 tests
npm run test:smoke:all                # 178 assertions end-to-end against a running API
```

`test:smoke:all` runs both end-to-end suites in sequence. They share one
5-per-minute login budget, so the second waits the limiter out — that is the
limiter working, not a failure.

Tenant isolation is checked in three independent layers, because each one can
pass while another is broken:

| Layer | File | Catches |
|---|---|---|
| Schema ↔ registry | `tenant.registry.test.ts` | a model added to `schema.prisma` and never classified — the firm-settings bug, exactly |
| Query shaping | `tenant.scope.test.ts` | a tenant predicate missing from any of 21 models × 15 operations |
| The database | `tenant.rls.test.ts` | RLS disabled, a policy missing, a leak to a stranger's tenant, or the app connecting as a role that can bypass it |

The third needs a database. It skips when there isn't one, which is wrong for
CI — set `RLS_TESTS_REQUIRE_DB=1` there and an unreachable database fails
instead of silently proving nothing.

The web tests mount the real components — the calendar opens, a page button
reports the page it was given, `31/02/2024` is refused rather than rolled
forward into March.

The smoke test walks a real case from login through client creation, duplicate
rejection, section entry, validation, document checklist, consent, every status
transition, RBAC denials, a cross-tenant probe, pagination bounds and sorting,
and finally asserts that no PAN, Aadhaar-shaped value or account number appears
anywhere in the audit trail.

It logs in four times, so running it twice inside a minute trips the login rate
limiter (5/min) — that is the limiter working; the test waits and retries.

---

## What is deliberately not here

- **File uploads.** The document checklist works without them; storage, AV
  scanning and per-object keys arrive with the upload increment.
- **Billing.** Licences are set by hand in the platform console — plan, expiry,
  grace period and quotas. Nothing collects money, and nothing renews on its own.
- **Confirmed eligibility rules.** 21 structural rules (formats, arithmetic,
  date ordering, required fields, documents, consent) are active. The 7 rules
  that depend on the **Government Resolution** — the Industries & Mines
  Department notification that constitutes the scheme — ship as `DRAFT` and
  **do not run**, because that document has not been read. Their parameters in
  `prisma/seed/data/rules.ts` are invented placeholders and must not be
  activated on the strength of looking plausible.
  `GET /validation/rules/inactive` lists exactly what is not being checked and
  the UI shows it, so nobody assumes eligibility has been verified when it has
  not. Parked for future discussion — see `TODO.md`.
- **Legal artefacts.** The consent template is an engineering placeholder
  flagged `isDraftText`. Retention defaults to 96 months and the system only
  ever *flags* expiring data — it never deletes on its own.
#   s u b s i d y  
 