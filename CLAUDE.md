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
| `0005_audit_cascade_fix.sql` | lets a campaign with deliveries actually be deleted |
| `0006_campaign_status.sql` | the three-state campaign lifecycle |
| `0007`–`0010` | organization slugs, user directories, the undeliverable state |

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

A campaign has exactly three states, and they gate real behaviour rather than being labels:

| State | Public link | Register | Claim |
|---|---|---|---|
| `DRAFT` | does not resolve | no | no |
| `PUBLISHED` | resolves | yes | yes |
| `ENDED` | resolves, read-only | no | no |

Enforced in SQL, not the UI: `get_public_campaign` hides `DRAFT`, and `register_volunteer`,
`claim_deliveries` and `get_available_deliveries` each require `PUBLISHED`. An earlier five-state enum
drew distinctions nothing acted on, so do not reintroduce them. Note `IN_PROGRESS` still exists on
`delivery_status` and is unrelated.

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

## Screens and who reaches them

| Route | Who | Holds |
|---|---|---|
| `/admin` | platform admin only | organizations, and every account on the platform |
| `/:orgSlug/admin` | platform admin + that org's managers | dashboard, users, campaigns, settings |
| `/:orgSlug/home` | anyone with the link | request approval, then pick addresses and work them |
| `/m/:campaignId` | managers | the campaign console, reached from the campaigns tab |

`/:orgSlug/home` is the one link an organization ever shares. It resolves to whichever campaign is
currently published, so it survives from one holiday to the next; `/c/:slug` still redirects there.
Static routes are declared before `/:orgSlug/…` so they always win, and reserved slugs are rejected by
a CHECK constraint and by the slug trigger.

An organization may have **one published campaign at a time**, enforced by a partial unique index
rather than by the UI, so a second publish fails loudly instead of silently splitting volunteers.

Account actions that need the service-role key (set a password, change an email, delete an account)
live in the `admin-users` Edge Function, never in the browser. It re-checks the caller: a platform
admin may act on anyone, an organization manager only on managers of their own organization, and
nobody may delete themselves. Deploy it with `npx supabase functions deploy admin-users --use-api`
(`--use-api` avoids Docker, which cannot mount this repo).

`UNDELIVERABLE` is not a failure state to clean up automatically. A volunteer who could not hand over
a basket freezes that address: it stays assigned to them and never returns to the pool, so nobody
repeats the trip. Only a manager decides, through `resolve_undeliverable`, whether it goes back to the
pool or is cancelled.

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

Geocoding is deliberately split across three files. `geocode.ts` asks Nominatim for the building then
the street. `addressSuggest.ts` proposes corrections through Photon for addresses that resolve to
nothing. `geocodeRun.ts` drives both and runs automatically after an import, because a list with no
coordinates would otherwise leave the manager staring at an empty map.

Four things there are load-bearing and were each found the hard way:

- **Nothing ever rewrites an address on its own.** A failed lookup produces a suggestion card that a
  manager approves. Silently correcting a street would send a volunteer to the wrong building with
  nobody noticing.
- **Never send the neighbourhood to a geocoder.** Lists use local names that differ from
  OpenStreetMap's (`חורש` against `החורש`), and the mismatch turns a working query into no result.
- **Photon picks its language from `Accept-Language`.** A browser asking for English gets `Harish` and
  `Achdut` where Node with no header gets `חריש` and `אחדות`, so the header is set explicitly and
  candidates are filtered by distance from the campaign rather than by comparing city names.
- **Nominatim returns 403 without a User-Agent.** Browsers always send one so the app is fine, but a
  Node script that geocodes must set it or every lookup silently fails.

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
