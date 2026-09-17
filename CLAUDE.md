# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

סל בדרך is a mobile-first Hebrew PWA for nonprofits distributing holiday food baskets. React + Vite
frontend on GitHub Pages, Supabase (Postgres) as the only backend. No server, free tier only.

The UI is Hebrew and RTL. Talk to the user in English.

## Commands

```bash
npm run dev              # Vite dev server on :5173
npm run lint             # tsc --noEmit (this is the only linter; there is no ESLint)
npm run build            # tsc -b && vite build
npm test                 # vitest, EXCLUDES src/integration/**
npm run test:integration # needs a running local Supabase (see below)
npm run db:start         # npx supabase start
npm run db:reset         # re-apply migrations + seed.sql
npm run db:test          # pgTAP via supabase CLI
npm run db:sql           # concatenate migrations to clipboard, for pasting into the SQL Editor
```

Run one test file or case: `npx vitest run src/lib/clustering/clustering.test.ts`, `npx vitest run -t "atomic"`.

`npm test` excludes `src/integration/**` because those tests need a live database. Run them with:

```bash
SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=<local anon key> npm run test:integration
```

They self-skip when those env vars are absent, which is why CI can run `npm test` unconditionally.

On this machine Docker Desktop does not share the repo path, so `npm run db:test` and Supabase Studio
fail with "Mounts denied". Start the stack without Studio and run pgTAP by piping instead:

```bash
npx supabase start -x studio,imgproxy,logflare,vector,supavisor,edge-runtime
docker exec -i supabase_db_sal-baderech psql -U postgres -d postgres -tA -q < supabase/tests/001_security.test.sql
```

Local seed logins are in `supabase/seed.sql`. Demo campaign: `http://localhost:5173/#/c/demo12`.

## Security architecture

This is the part that needs reading several files to understand, and the part most likely to be broken
by a well-meaning change.

**The browser is never trusted.** React route guards and disabled buttons are UX only. Every
authorization decision is made in Postgres. The governing rule:

> The public campaign URL is for registration, not authorization.
> Volunteer approval is the authorization gate.
> Row Level Security is the final boundary.

Migrations apply in order, and the split between them is deliberate:

| File | Holds |
|---|---|
| `0001_schema.sql` | tables, enums, indexes, `updated_at` triggers |
| `0002_rls.sql` | `app.*` authorization predicates, audit triggers, every RLS policy |
| `0003_functions.sql` | the `public.*` RPCs that are the real write API |
| `0004_import_fields.sql` | fields real recipient lists need, and the RPCs that touch them |

`app.is_approved_volunteer(campaign_id)` is the gate for all sensitive data. `app.can_manage_org` and
`app.can_manage_campaign` handle tenant isolation. They are `SECURITY DEFINER` and `STABLE` so policies
can call them without recursive RLS evaluation.

The single most important policy is `deliveries_select`. A volunteer sees a delivery row only when they
have claimed it **and** are currently APPROVED:

```sql
app.can_manage_campaign(campaign_id)
OR (reserved_by IS NOT NULL AND reserved_by = app.my_volunteer_id() AND app.is_approved_volunteer(campaign_id))
```

Revoking a volunteer therefore removes access instantly, with no cache to invalidate. Unclaimed
`AVAILABLE` deliveries never come from a table read; they come from `get_available_deliveries()`, which
returns street, house number, neighbourhood and coordinates only, with no names, apartments, floors,
codes, notes or phones. Keep it that way when adding columns: anything added there is visible to every
approved volunteer before they claim anything.

`audit_logs`, `campaign_volunteers` and `corrections` have **no INSERT/UPDATE/DELETE policies at all**.
That is intentional, not an oversight. Every write to them goes through a `SECURITY DEFINER` RPC that
re-checks authorization in SQL. Do not "fix" this by adding write policies.

`claim_deliveries` is the concurrency-critical path. It updates all requested rows in one statement
filtered on `status = 'AVAILABLE'`, then compares the affected row count to the requested count. A
mismatch raises `CLAIM_CONFLICT`, which aborts the transaction, so a partial claim is impossible.
Never replace this with select-then-update.

Audit entries come from two places: table triggers for direct manager edits, and explicit `app.log()`
calls inside RPCs. `app.in_rpc()` reads a transaction-local setting that RPCs set so the triggers skip
rows the RPC already logged. If you add an RPC that writes to `deliveries`, call
`set_config('app.in_rpc', '1', true)` or you will get duplicate audit rows.

**When adding any sensitive read or write:** add the RLS policy or RPC, then add a matching assertion to
`supabase/tests/001_security.test.sql` and bump the `select plan(N)` count. That file is the security
spec; it asserts pending/rejected/revoked volunteers get zero rows, cross-organization isolation, claim
conflicts, and the correction audit trail.

## Authentication

Authentication and authorization are separate. Being signed in grants nothing by itself.

- **Volunteers** get a Supabase *anonymous* session (`ensureSession` in `AuthProvider`). Name and phone
  are contact information, not credentials. Membership starts PENDING. Anonymous sign-ins must be
  enabled in the Supabase project or registration breaks. A volunteer switching devices re-registers.
- **Managers and platform admins** use email and password, and are invited by email row
  (`organization_managers.email`, `platform_admins.email`). `get_my_context()` links an invite to the
  auth user on login **only if the email is confirmed**. That confirmation check is what makes
  invite-by-email safe, so keep email confirmations on.

`get_my_context()` is the one call that returns the caller's roles, and `AuthProvider` caches it.

## Frontend structure

Routing is `HashRouter` on purpose: GitHub Pages cannot do SPA rewrites, so URLs look like
`/#/c/:slug`. Auth uses the PKCE flow so it does not fight the app for the URL hash. `vite.config.ts`
reads `VITE_BASE`, which the deploy workflow sets to `/<repo>/`; forgetting it locally produces 404s on
assets under a subpath.

Pages are grouped by audience under `src/pages`: `public` (landing, login), `volunteer`, `manager`
(the campaign console is `CampaignManage.tsx` plus `campaign/*Tab.tsx`, sharing state via a context
hook `useCampaign`), and `admin`.

`src/lib/clustering/clustering.ts` is pure, deterministic and UI-independent, which is what makes it
unit-testable. Distance prefers coordinates, then neighbourhood, then same-street house numbers, and it
always returns the best available combination rather than nothing. The neighbourhood tier is not
decoration: real recipient lists arrive with a neighbourhood column and no coordinates whatsoever, so
without it every cluster would be guesswork. Deliberately no odd/even street-side logic. Keep it
decoupled from React.

`src/lib/import/parseImport.ts` is aligned to the columns real lists use (`Name`, `phone1`, `phone2`,
`address`, `comments`, `neighberhood` including that spelling, `street`, `street-number`, `entrance`,
`apartment`, `floor`, `lobby entrance code`), plus Hebrew equivalents. Three behaviours there exist
because of real data and should not be simplified away: a combined `address` column is parsed only to
fill fields the file did not supply; `אין קוד` and similar mean "no code" rather than being a code; and
a single `Name` column is stored whole in `full_name` rather than split, since Hebrew lists mix name
order. Note that JavaScript `\b` is ASCII-only and silently fails against Hebrew, which already caused
one parsing bug.

`src/lib/supabase.ts` resolves blank env values to placeholders. This matters: an unset GitHub Actions
secret arrives as an empty string, not `undefined`, so `??` would pass `""` to `createClient()`, which
throws at module load and white-screens the app before the config screen can render. `src/lib/supabase.test.ts`
guards this.

Hebrew strings live inline in components, with shared labels and Postgres-error translations in
`src/lib/labels.ts`. New RPC error codes should get a Hebrew message in `errorMessage()` there.

The service worker caches map tiles but uses `NetworkOnly` for all Supabase requests, so recipient data
is never written to a cache. Offline support is out of scope.

## Deployment

Push to `main` runs `.github/workflows/deploy.yml`: tests, build with `VITE_BASE`, copy `index.html` to
`404.html`, publish to Pages. `ci.yml` runs on pull requests and non-main pushes, and is the only place
the pgTAP suite runs automatically.

The two `VITE_SUPABASE_*` repository secrets are public values by design. The service_role key is used
nowhere in this project and must never be added to a build.

Deployment URLs and the Supabase project reference are in Claude Code memory for this project.
Setup steps for a fresh Supabase project are in `README.md`.

## Out of scope for V1

Do not add: SMS or OTP auth, push notifications, WhatsApp API, turn-by-turn navigation, route
optimization, or manual delivery assignment by managers. Clusters are generated on demand and claimed
by volunteers; that is the product decision, not a missing feature.
