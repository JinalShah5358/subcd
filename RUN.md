# Running the stack

Everything needed to get the API, the web app and the browser extension running
on a development machine, in the order you actually do it.

> Four things run, not two. The web app talks to the API, the API needs
> Postgres, and outbound mail goes to Mailhog. Starting the "frontend and
> backend" without the two containers gives you a sign-in page that fails with
> a network error and no obvious reason why.

|          | Runs on               | Started by               |
| -------- | --------------------- | ------------------------ |
| Web app  | http://localhost:5173 | `npm run dev`            |
| API      | http://localhost:4000 | `npm run dev`            |
| Postgres | localhost:**5433**    | `npm run db:up` (Docker) |
| Mailhog  | http://localhost:8025 | `npm run db:up` (Docker) |

Postgres is on **5433**, not 5432, because this machine already runs a Postgres
on the default port.+

---

## Every day

Docker Desktop has to be running first — the two containers live in it.

```bash
npm run db:up     # Postgres + Mailhog. Safe to re-run; does nothing if already up.
npm run dev       # API on :4000 and web on :5173, together
```

Both servers watch for changes, so leave them running. `npm run dev` prints
`api` and `web` output side by side in one terminal; `Ctrl+C` stops both.

### Is it actually up?

```bash
curl -s -o /dev/null -w "api %{http_code}\n" http://localhost:4000/health
curl -s -o /dev/null -w "web %{http_code}\n" http://localhost:5173/
```

Two `200`s and you are running. The API takes a few seconds longer than the web
app because it verifies its database connection and its RLS preconditions
before it will listen at all.

### Stopping

`Ctrl+C` in the `npm run dev` terminal stops the API and the web app. The
containers keep running, which is usually what you want. To stop those too:

```bash
npm run db:down
```

---

## First time on a machine

```bash
cp .env.example .env      # then fill in the three secrets below
npm install
npm run build:shared      # the API and the web app both import @ifp/shared
npm run db:up             # Postgres + Mailhog
npm run db:generate       # Prisma client
npm run db:deploy         # applies all migrations
npm run db:seed           # reference data + a demo firm (development only)
npm run dev
```

`.env` needs three generated secrets. They are not interchangeable and none of
them has a safe default, so the file ships without them:

```bash
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('KMS_LOCAL_MASTER_KEY='+require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('BLIND_INDEX_PEPPER='+require('crypto').randomBytes(32).toString('base64'))"
```

`BLIND_INDEX_PEPPER` is the one to be careful with: change it after seeding and
every existing identifier becomes unsearchable, because the blind index is a
keyed hash and the old hashes no longer match anything.

---

## Signing in

Open http://localhost:5173. In a development build the sign-in page has
one-click buttons, split into the firm's four roles and the platform account:

| Account               | Role            | Lands on                                |
| --------------------- | --------------- | --------------------------------------- |
| `admin@demo.local`    | Firm admin      | the case dashboard                      |
| `ca@demo.local`       | CA              | the case dashboard                      |
| `staff@demo.local`    | Staff           | the case dashboard                      |
| `reviewer@demo.local` | Reviewer        | the case dashboard                      |
| `platform@demo.local` | **Super admin** | `/platform` — firms, licences, renewals |

Password for all of them: `ChangeMe!Dev2026` (or whatever `SEED_DEMO_PASSWORD`
was set to at seed time — then set `VITE_DEMO_PASSWORD` to match).

The buttons are wrapped in `import.meta.env.DEV`, so Vite eliminates them from
a production build. The addresses and the password are not merely hidden there,
they are absent from the bundle.

One account belongs to one firm, so comparing roles means signing out and back
in. Sign-in is rate limited to **5 attempts per minute** — switching accounts
quickly gives you a `429`, which is the limiter working, not a bad password.

Mail (invitations, password resets) goes to Mailhog at http://localhost:8025 and
never leaves the machine.

---

## The browser extension

It is not started by `npm run dev`; it is loaded into Chrome once and then
stays. See [`apps/extension/README.md`](apps/extension/README.md).

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** →
   `apps/extension`
2. In the web app: **Browser extension** → **Pair a browser** → copy the code
   (it is single-use and lasts ten minutes)
3. Paste it into the extension and name the browser

There is a mock portal form at http://localhost:4000/dev/mock-ifp-form for
exercising capture and fill without the real government site. It is mounted
only when `NODE_ENV` is not `production`.

---

## When something is wrong

**`failed to connect to the docker API`** — Docker Desktop is not running. Start
it, wait for the whale icon to settle, then `npm run db:up`.

**The web app loads but every request fails** — the API is not up. Check the
`api` lines in the `npm run dev` output. The usual cause is the database: the
API refuses to start if it cannot reach Postgres or if the app role turns out to
be able to bypass Row Level Security.

**`EPERM ... query_engine-windows.dll.node`** on `npm run db:generate` — a
running API process has the Prisma engine open. Stop `npm run dev` first. If a
watcher was orphaned by an earlier crash:

```powershell
Get-Process node | Stop-Process -Force
```

**Port already in use** — usually an orphaned watcher from a previous session,
and the same command clears it. Stale `node` processes accumulate quietly across
crashes; if things behave strangely for no reason, look for them first.

**`429` on sign-in** — the login limiter, 5 per minute. Wait a minute. The smoke
tests trip it deliberately and wait it out.

**The extension says "Origin not allowed"** — expected in production until the
extension's id is listed in `EXTENSION_ORIGINS`. In development any extension
origin is accepted, but only on `/extension` routes. If you see it in
development, the API was started with `NODE_ENV=production`.

**Schema changed and the API will not compile** — `npm run build:shared` after
touching `packages/shared`, and `npm run db:generate` after touching
`prisma/schema.prisma`. Neither happens automatically.

---

## Tests

The unit suites need nothing running. The smoke tests need the API **and** the
database.

```bash
npx vitest run --root apps/api          # 302 tests
npx vitest run --root apps/web          #  42 tests
npx vitest run --root apps/extension    #  44 tests
npx vitest run --root packages/shared   #  20 tests

npm run test:smoke:all                  # 178 assertions, against a running API
```

`npm run test:smoke:all` runs both end-to-end suites in sequence. They share the
one 5-per-minute login budget, so the second waits the limiter out — that is the
limiter working, not a hang.

The tenant-isolation tests that need a database **skip** when there isn't one,
which is right on a laptop and wrong in CI, where a skipped isolation test looks
exactly like a passing one. Set `RLS_TESTS_REQUIRE_DB=1` in CI and an
unreachable database fails instead of silently proving nothing.

---

## Starting over

```bash
npm run db:reset    # drops, re-migrates and re-seeds. Destroys all local data.
```

Use it when a migration has been edited in place, or when the local data has
drifted somewhere confusing. It only ever touches the local Docker database.

