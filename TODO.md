# IFP Subsidy Platform — Active TODO

**Scope approved 2026-09-20:** Frontend + Backend (admin side) only.
**Browser extension: DEFERRED** to a later phase.

Status legend: `[ ]` TODO · `[~]` IN PROGRESS · `[x]` DONE · `[!]` BLOCKED

---

## Scope decisions for this build

| Decision | Choice | Rationale |
|---|---|---|
| Package manager | **npm workspaces** | `pnpm` not installed; npm 9 supports workspaces |
| Node | 20.5.0 | Pins Vite 5 + React 18 (Vite 7 needs Node 20.19+) |
| Database | Postgres 16 via `docker-compose` | Docker installed; daemon must be started |
| Multi-tenancy | **Built in from day one** | Retrofitting tenancy is far more expensive (ADR-001) |
| Documents | **Checklist only, no file uploads** | Q-04 default; uploads deferred (ADR-010) |
| Form/mapping models | **Deferred** to extension phase | `FormDefinition`, `FormVersion`, `FormField`, `FieldMapping`, `DropdownMapping`, `AutofillSession`, `AutofillFieldOutcome`, `ExtensionDevice` are not in the first migration |
| Access token alg | HS256 (config switch to RS256) | Only our own API verifies it — see ADR-016 |
| Password hashing | `@node-rs/argon2` (argon2id) | Prebuilt binaries; no node-gyp build on Windows |
| Primary keys | Field named **`id`**, value is a **UUID v7 GUID** | Confirmed 2026-09-20: GUID values, `id` naming (not `guid`) |

---

## Milestone A — Foundation

- [x] **A-01** Root workspace scaffold (`package.json`, tsconfig base, `.gitignore`, `.env.example`)
- [x] **A-02** `docker-compose.yml` — Postgres 16 with `pg_trgm` + `citext`, Mailhog
- [x] **A-03** `packages/shared` — enums, field codes, shared Zod schemas, DTO types
- [x] **A-04** `apps/api` scaffold — Express, Zod-validated config, structured logging with redaction, problem+json error handler, health route

## Milestone B — Data layer

- [x] **B-01** `prisma/schema.prisma` — 24 MVP models (tenancy, client/case, documents, scheme, validation, audit, consent)
- [x] **B-02** Raw SQL migration — partial unique indexes, CHECK constraints, Aadhaar block, audit-log grants, RLS policies on every tenant table
- [x] **B-03** Seed script — roles, document types, banks, GJ districts/talukas, scheme v1 (DRAFT), consent template (DRAFT), validation rules, dev demo firm
- [x] **B-04** Run first migration against a live database *(needs Docker Desktop running)*

## Milestone C — Auth, tenancy, audit

- [x] **C-01** Crypto service — AES-256-GCM envelope encryption, per-firm DEK, AAD binding, local KMS stub
- [x] **C-02** Blind index (HMAC-SHA256) for PAN / GSTIN / loan account
- [x] **C-03** Password hashing (argon2id) + policy
- [x] **C-04** Token service — access JWT + rotating refresh with family reuse detection
- [x] **C-05** `/auth` routes — login, refresh, logout, me, forgot, reset, change, accept-invite
- [x] **C-06** `authenticate` + `authorize` middleware with permission strings
- [x] **C-07** Tenant context — AsyncLocalStorage + Prisma client extension + RLS session wiring
- [x] **C-08** Audit writer with redaction allow-list + `changedFields` (names only)
- [x] **C-09** Security middleware — helmet, CORS allowlist, rate limits, body limits

## Milestone D — Domain APIs

- [x] **D-01** `/firms` + `/users` + invitations
- [x] **D-02** `/clients` + promoters + duplicate detection + audited reveal
- [x] **D-03** `/cases` + status state machine
- [x] **D-04** Case section upserts — project, loan, employment, investment, first-sale
- [x] **D-05** `/cases/:id/documents` checklist
- [x] **D-06** Validation engine — ruleset resolution, operator evaluator, run persistence
- [x] **D-07** `/validation` routes + readiness scoring
- [x] **D-08** `/consent` templates + records
- [x] **D-09** `/audit` query API
- [x] **D-10** `/banks` + `/reference` (districts, talukas, document types, schemes)

## Milestone E — Frontend

- [x] **E-01** `apps/web` scaffold — Vite + React 18 + TS + Router
- [x] **E-02** Design tokens + UI kit (Button, Input, Select, DateField, MoneyField, Table, Modal, Toast, StatusPill, EmptyState)
- [x] **E-03** API client with in-memory access token + single-flight refresh
- [x] **E-04** Auth context, route guards, `Can` permission component
- [x] **E-05** Auth screens — login, forgot, reset, accept invite
- [x] **E-06** App shell — nav, firm/user header, dashboard
- [x] **E-07** Clients — list, detail, create/edit, promoters, duplicate UX, masked reveal
- [x] **E-08** Cases — list + create
- [x] **E-09** Case wizard — project, loan, employment, investment, first sale
- [x] **E-10** Document checklist screen
- [x] **E-11** Consent capture screen
- [x] **E-12** Validation panel + readiness meter + status transitions
- [x] **E-13** Case review page (print-friendly)
- [x] **E-14** Admin — users, invitations, firm settings, audit log viewer

## Milestone G — UI system (added 2026-09-20)

- [x] **G-01** Tailwind 3.4 + shadcn/ui (CLI 2.5) — shadcn 4.x needs Node >=20.18.1, we are on 20.5.0
- [x] **G-02** 24 shadcn primitives installed; Badge/Alert extended with semantic status variants; Progress extended with an indicator colour
- [x] **G-03** `form-fields.tsx` — Text, Textarea, Select, Combobox, Date, Money, Number, Percent, Checkbox, MaskedValue, all RHF + Zod bound
- [x] **G-04** Every page migrated off the hand-rolled stylesheet; `styles.css` and the old `ui.tsx` deleted
- [x] **G-05** Class-based dark mode with a system/light/dark switcher
- [x] **G-06** Fixed: refresh-token rotation had a check-then-act race — concurrent presentations of one token both succeeded, defeating reuse detection. Now an atomic conditional claim.

## Milestone H — Theme, paging and the firm-settings bug (added 2026-09-20)

- [x] **H-01** Fixed: **firm settings never loaded.** `Firm` was in neither `TENANT_MODELS` nor `HYBRID_MODELS`, so the Prisma extension skipped the model, no tenant transaction was opened, `app.firm_id` was never set, the RLS policy failed closed and `GET /firms/current` 404'd on a firm that plainly exists. Added `SELF_MODELS` — the firm row's tenant key is its own `id`. RLS re-verified in both directions afterwards (own tenant 1 row, foreign 0, no tenant 0)
- [x] **H-02** The page also swallowed the failure (`.catch(() => undefined)`) and sat on a spinner forever, so a broken endpoint looked like a slow one. It now shows the error and a retry
- [x] **H-03** Page-based pagination replaces the keyset cursor on `/clients`, `/cases`, `/audit` and `/users`: `?page=&pageSize=&sort=&dir=` in, `{items, page, pageSize, total, totalPages, hasPrev, hasNext}` out. `pageSize` capped at 100, `sort` a closed enum per endpoint
- [x] **H-04** `data-table.tsx` — one shadcn Table surface for every list: sortable headers, skeleton, empty state, page-size selector, windowed page buttons with ellipsis, keyboard-reachable rows
- [x] **H-05** `usePagedList` — query state, stale-response guard, filter-change page reset (done during render, not in an effect, so a filter change costs one request rather than two)
- [x] **H-06** Calendar: shadcn Calendar on react-day-picker 8 with month/year dropdowns. `DateField` is now type-or-pick — `15/03/2024` typed, or the popover — and refuses dates that do not exist instead of rolling `31/02` into March
- [x] **H-07** Theme rebuilt: sidebar/elevation/radius tokens, Inter bundled locally (Latin subsets only, no font CDN), pre-paint theme script so dark mode does not flash white, focus-visible ring, thin scrollbars, reduced-motion honoured
- [x] **H-08** Chrome: sidebar on its own surface with an active rail, avatar menu, mobile drawer that closes on navigation, breadcrumbs on detail pages, two-panel sign-in
- [x] **H-09** Fixed: dashboard tiles counted statuses **within the ten most recent cases** — a firm with sixty drafts saw "3". They now read `total` off filtered queries
- [x] **H-10** Fixed: `DateField` dropped the `id` and `aria-*` that `FormControl` passes down, so its label pointed at nothing and errors went unannounced
- [x] **H-11** 21 web unit tests (date parsing incl. leap years, page-window maths, mounted DataTable and Calendar); smoke test grown to 82 assertions with pagination bounds, sorting and a firm-settings regression check

## Parked — the 7 scheme-policy rules (2026-09-20)

**Decision: left inactive, deliberately. Revisit when the Government Resolution
is available.**

The GR is the notification from the Industries & Mines Department, Government
of Gujarat that constitutes the IFP scheme. It is the document that fixes the
eligibility windows, ratios and claim caps. Nobody has read it yet, so these
seven rules ship `DRAFT` with `sourceReference: null` and the engine skips
them. `GET /validation/rules/inactive` lists them and the UI shows them, so
"no findings" can never be read as "eligible".

The placeholder parameters currently in `prisma/seed/data/rules.ts` were
**invented** and must not be trusted or quietly activated:

| Rule | Placeholder | What the GR decides |
|---|---|---|
| `APP_DATE_AFTER_DISBURSEMENT` | `windowMonths: 12` | window after first disbursement |
| `APP_DATE_VS_PRODUCTION` | `windowMonths: 12` | window after commercial production |
| `EPF_RATIO` | `minRatio: 0.8` | minimum EPF-registered share |
| `LOCAL_EMPLOYMENT_RATIO` | `minRatio: 0.85` | minimum local-employment share |
| `TERM_LOAN_EXPECTED` | — | whether a term loan is mandatory |
| `FIRST_SALE_REQUIRED` | — | whether first sale must precede application |
| `SUBSIDY_CLAIM_LTE_ELIGIBLE` | — | the cap formula |

To activate: read the GR, set the parameters, put the clause reference in
`sourceReference`, bump the `SchemeVersion`, activate. Rules are pinned to a
scheme version so a later amendment cannot rewrite the verdict on a case
already filed.

Not built yet, and worth doing when this is picked up: make activation
*require* a citation, so a rule with `sourceReference: null` cannot be turned
on at all.

---

## Milestone I — Platform administration (added 2026-09-20)

- [x] **I-01** `platform_*` SECURITY DEFINER functions: list/detail/create/set-status/totals. Return types carry firm metadata and counts only — no client, case, identifier or document column exists in any of them
- [x] **I-02** `POST /platform/firms` provisions a firm **and** invites its first admin in one operation; the invitation takes the ordinary firm-scoped path, so the token is hashed and audited like any other
- [x] **I-03** `PATCH /platform/firms/:id/status` — suspend/restore, reason required, audited. Verified end-to-end that a suspended firm's users are refused sign-in and that reactivation restores them with nothing lost
- [x] **I-04** Platform console UI at `/platform`, visible only with `platform:admin` — its own Overview, Firms and Renewals, and its own sidebar. A platform admin sees no Clients, Cases, Browser extension, Users, Firm settings or Audit log, because their tenant holds none of it
- [x] **I-10** `platform:admin` is no longer a wildcard. `hasPermission` used to return true for any permission when the caller held `platform:admin`, making it a global superuser flag on every route in the application; RLS was the only remaining boundary. Now `PLATFORM_ADMIN` holds exactly that one permission and every firm route refuses it with 403. Verified by mutation: restoring the wildcard let `/clients`, `/cases`, `/audit` and `/users` all return 200 again. Two extension device routes that had been relying on authentication alone gained the permission they should always have had
- [x] **I-05** Platform operator gets its own tenant (`slug: platform`) rather than making `User.firmId` nullable, which would have put a hole in the RLS policy on every user query
- [x] **I-06** 20 smoke assertions, including the one that matters: the platform admin gets **0 rows** from `/clients` and `/cases`, and no client name or PAN appears anywhere in the firms list. A further 27 cover licensing, half of them asserting what expiry does **not** do
- [x] **I-07** Licensing — plan, expiry, grace period, and quotas on users/clients/cases. An expired licence makes a firm **read-only**, never locked out: sign-in, reading and export keep working, creation and change do not. That is the one decision in this milestone worth defending — these are a CA firm's professional records and a late renewal is not a reason to withhold them. Enforced by a router-level guard on every tenant router (with a coverage test that fails the build if a router loses it) plus explicit quota checks at the three creation points. A firm cannot set its own licence: the update schema carries no licence field *and* a BEFORE UPDATE trigger refuses any licence change arriving from inside a tenant transaction
- [ ] **I-08** Billing / payments. Deferred (P5-014) — only if the platform is commercialised as SaaS. Licences are set by hand in the console; nothing collects money
- [x] **I-09** Licence console — set/renew from the Firms screen, a Renewals list ordered expired-first-then-soonest, and a banner in the firm's own app from 30 days out. Every change needs a stated reason and is audited as `FIRM_LICENSE_CHANGED`

## Milestone F — Verification

- [x] **F-01** Cross-tenant isolation — three independent layers, each mutation-tested to prove it can fail: schema↔registry (6), query shaping across 21 models × 15 operations (163), and the database itself (10). Reintroducing the firm bug, dropping a model from the registry, leaving a stale entry, and `ALTER TABLE … DISABLE ROW LEVEL SECURITY` were each confirmed to break the suite
- [x] **F-02** Auth flows — 16 rotation/reuse tests + 14 lockout tests, plus a live four-way concurrent-refresh probe in the smoke test. The check-then-act race now has a regression test that was verified to fail against the old code (4 of 4 rotations succeeded)
- [x] **F-03** Validation engine unit tests
- [x] **F-04** Audit canary test — no sensitive value reaches a log or audit row
- [x] **F-05** Crypto round-trip + AAD-binding tests
- [x] **F-06** End-to-end smoke run against a live database *(needs Docker Desktop running)*

---

## Milestone J — Browser extension (added 2026-09-20)

- [x] **J-01** Form catalog: `FormDefinition` (global), `FormVersion` / `FormField` / `FieldMapping` (hybrid — a firm's capture becomes a shared catalog row once curated), `ExtensionDevice` / `AutofillSession` / `AutofillFieldOutcome` (tenant). The F-01 registry test caught all seven before they could ship unscoped
- [x] **J-02** RLS + CHECK constraints: a `form_field` with a password/file/CAPTCHA identity must carry `refused_reason`; a `form_definition` host cannot contain a wildcard
- [x] **J-03** Device auth — a ten-minute single-use pairing code exchanged for a firm-scoped, expiring, revocable device secret. Only the hash is stored. `auth_find_device` is a SECURITY DEFINER lookup, because which tenant a device belongs to is what the request is trying to establish
- [x] **J-04** `/extension` API: me, mapping, cases, payload, captures, sessions, outcomes + web-side pairing, devices, capture review, mapping, activation
- [x] **J-05** Payload builder with 47 canonical source paths and a closed set of named transforms — never an expression, so a captured mapping can never become code. Releasing it needs `sensitive:reveal` and writes an audit row naming the paths
- [x] **J-06** The extension itself: MV3, one host, three permissions, no declarative content script, injection only on a click in the popup
- [x] **J-07** Capture / fill / mark content script. Refusals are applied at capture time AND re-checked against the live element at fill time, so a tampered mapping still cannot reach a password box
- [x] **J-08** Drift detection — a digest of the form's shape, compared per run
- [x] **J-09** Web UI: pairing, device management, capture review and field mapping
- [x] **J-10** 37 extension tests (22 against a hostile synthetic form, 15 asserting the guarantees against the source) + 30 end-to-end assertions through the real API and a real DOM
- [x] **J-11** Fixed before shipping: the two fingerprint formulas disagreed, so an unchanged page reported drift on every run — a warning that cries wolf is one people learn to click past
- [x] **J-12** Fixed before shipping: the djb2 fallback produced an 8-character digest that could never equal the server's SHA-256. Now returns null, and the server skips the check rather than claiming a change it cannot see
- [x] **J-13** Fixed before shipping: the audit metadata allow-list silently dropped every new key, so platform and extension audit rows recorded `null` metadata

### Still open on the extension

- [ ] **J-14** Phase 0 proper: capture the REAL IFP form and curate the field map. Needs portal access via a pilot CA — the machinery is built and ships with no guessed selectors
- [ ] **J-15** Promote a firm's reviewed capture into the shared catalog (the curate step; the data model supports it, there is no endpoint yet)
- [ ] **J-16** Multi-page forms. Today a capture is one page; the IFP application may be a wizard
- [ ] **J-17** Pairing codes live in process memory, so a multi-instance deployment needs shared storage for them

---

## Deferred

- Autofill telemetry dashboards and drift alerting (the data is recorded; nothing reports on it yet)

See `PROJECT_PLAN.html` for the full plan, risks, and open questions.
