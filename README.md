# סל בדרך — Food Basket Distribution Platform

Mobile-first PWA for nonprofits that distribute holiday food baskets. Multi-tenant
(organizations → campaigns), volunteer registration + manager approval, dynamic
delivery-cluster suggestions, atomic claiming, delivery tracking, correction
requests and a full audit log. UI is in Hebrew (RTL).

**Stack:** React 19 · TypeScript · Vite · Tailwind v4 · vite-plugin-pwa · Leaflet/OSM ·
Supabase (Postgres, Auth, RLS, RPC) · GitHub Actions → GitHub Pages. No servers, no paid services.

---

## Security model (read this first)

> The public campaign URL is for **registration**, not authorization.
> Volunteer **approval** is the authorization gate.
> Postgres **Row Level Security** is the final boundary.

* Every table has RLS enabled; there are no permissive policies for `anon`.
* Volunteers see a delivery row **only if** they have claimed it **and** their
  `campaign_volunteers.status = 'APPROVED'` — revoking removes access instantly.
* `AVAILABLE` deliveries are exposed to approved volunteers only through
  `get_available_deliveries()`, which returns street / house number / coordinates
  (no names, apartments, floors, codes, notes, phones).
* All state changes by volunteers go through `SECURITY DEFINER` RPCs that re-check
  authorization in SQL: `register_volunteer`, `claim_deliveries` (atomic, all-or-nothing),
  `start_delivery`, `mark_delivered`, `release_delivery`, `submit_correction`.
* Managers write through RLS-guarded table access plus RPCs (`set_volunteer_status`,
  `review_correction`, `import_deliveries`, `manager_release_delivery`, `campaign_stats`).
* Every sensitive action is written to `audit_logs`.
* The browser only ever holds the **anon key**. The service-role key is never used anywhere.

### Authentication (free, no OTP)

* **Volunteers:** name + phone → Supabase **anonymous sign-in** creates a device-bound
  identity; the membership starts as `PENDING`. Name/phone are contact info, not credentials.
  (If a volunteer switches devices they register again and get re-approved.)
* **Managers / platform admins:** email + password (Supabase Auth). They are *invited by email*
  (`organization_managers.email`, `platform_admins.email`) and linked to their auth user on first
  login **only if the email is confirmed** (`get_my_context()`).

---

## Project layout

```
supabase/migrations/   schema, RLS, RPCs, and later additions (see CLAUDE.md)
supabase/functions/    admin-users: account actions needing the service-role key
supabase/tests/        pgTAP suite: RLS, org isolation, atomic claim, corrections, revoke
supabase/seed.sql      local dev data (admin/manager users, demo campaign)
src/lib/clustering/    findDeliveryClusters() — pure, deterministic, unit-tested
src/lib/import/        CSV/XLSX header mapping + validation (Hebrew & English headers)
src/pages/public       login, role-based landing, legacy campaign links
src/pages/volunteer    /:orgSlug/home — approval, pick addresses, my tasks (Waze, delivered,
                       undeliverable, corrections)
src/pages/org          /:orgSlug/admin — dashboard, users, campaigns, settings
src/pages/manager      campaign console (dashboard, deliveries, map, volunteers, corrections,
                       import, audit, settings + QR/WhatsApp share)
src/pages/admin        /admin — organizations and the platform-wide user directory
src/integration/       real two-client concurrency test against a local Supabase
.github/workflows/     ci.yml (lint, unit tests, build, pgTAP) · deploy.yml (GitHub Pages)
```

---

## Local development

Prereqs: Node 20+, Docker (for local Supabase).

```bash
npm install
npx supabase start            # local Postgres + Auth + PostgREST (applies migrations + seed)
cp .env.example .env.local    # then paste the local API URL + anon key printed by `supabase start`
npm run dev                   # http://localhost:5173
```

Local seed logins (email/password): `admin@example.com` / `password123` (platform admin),
`manager@example.com` / `password123` (org manager). Demo campaign: `http://localhost:5173/#/c/demo12`.

### Tests

```bash
npm test                 # vitest: clustering, import parsing, navigation links
npm run lint             # tsc
npm run db:test          # pgTAP: 45 assertions (RLS, isolation, claim conflict, corrections, revoke)
SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=<local anon key> npm run test:integration
                         # two anonymous volunteers race for the same cluster → exactly one wins
```

If Docker Desktop refuses to mount the repo (`Mounts denied`), run the pgTAP file directly:

```bash
docker exec -i supabase_db_sal-baderech psql -U postgres -d postgres -tA -q < supabase/tests/001_security.test.sql
```

---

## Production setup (free tier)

### 1. Supabase project

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) (free tier is enough).
   Pick a region near your users and save the database password somewhere safe.

2. **Create the schema.** Copy all three migrations to your clipboard:
   ```bash
   npm run db:sql        # = cat supabase/migrations/*.sql | pbcopy
   ```
   Open **SQL Editor → New query**, paste, **Run**. It applies as a single transaction and
   creates 9 tables, 24 RLS policies and 14 functions.

   *(CLI alternative, better once you have more migrations: `npx supabase login`,
   `npx supabase link --project-ref <ref>`, `npx supabase db push`.)*

3. **Enable anonymous sign-ins** — volunteer registration depends on it.
   **Authentication → Sign In / Providers → Anonymous sign-ins → enable.**
   Leave **Email** enabled with **Confirm email ON**; that confirmation is what makes
   invite-by-email safe for managers.

4. **Set the URLs.** **Authentication → URL Configuration:**
   * *Site URL:* `https://<owner>.github.io/<repo>/`
   * *Redirect URLs:* add `https://<owner>.github.io/<repo>/**`

5. **Bootstrap yourself as platform admin.** In the SQL Editor, with the email you will sign up with:
   ```sql
   insert into public.platform_admins (email) values ('you@example.com');
   ```
   Then open the app → *כניסת מנהלים* → *הרשמה*, confirm the email, and log in.
   From `/#/admin` you create organizations and invite organization managers by email.

6. **Copy the two public keys.** **Project Settings → API Keys:**
   * `VITE_SUPABASE_URL` = Project URL (`https://<ref>.supabase.co`)
   * `VITE_SUPABASE_ANON_KEY` = the **publishable key** (`sb_publishable_…`) *or* the
     legacy **anon** key under *Legacy API keys*. Both are public and both work.

   Never copy the **service_role** / **secret** key. It is not used anywhere in this project.

### 2. GitHub Pages

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → New repository secret**, add the two values
   from step 6 above. Or from the CLI:
   ```bash
   gh secret set VITE_SUPABASE_URL      --body "https://<ref>.supabase.co"
   gh secret set VITE_SUPABASE_ANON_KEY --body "sb_publishable_..."
   ```
3. Push to `main` (or re-run the workflow) → `deploy.yml` runs tests, builds with
   `VITE_BASE=/<repo>/` and publishes `dist/`.

The app uses hash routing (`/#/c/<slug>`) so deep links survive on Pages; `404.html` is written too.
Until the secrets exist the deployed page shows *"חסרה הגדרת Supabase"* — that is expected.

## Data import

Aligned to the column set real distribution lists use:

```
Name | phone1 | phone2 | address | comments | neighberhood | street |
street-number | entrance | apartment | floor | lobby entrance code
```

Hebrew headers are equally accepted (שם, טלפון, כתובת, הערות, שכונה, רחוב, בית, כניסה, דירה, קומה,
קוד כניסה לדלת, מספר נפשות), as is the plainer First Name / Last Name style.

* **XLSX with several sheets:** the manager picks the sheet, and the preview re-runs instantly.
* **Required:** street and house number, *or* a combined `address` column such as
  `אודם 7 דירה 9 קומה 2`, from which street, house number, apartment, floor and entrance are parsed.
  Explicit columns always win; parsing only fills what is missing, and the preview says how many rows
  relied on it.
* **`lobby entrance code`** accepts real codes (`#2580`, `*3434`) and access instructions
  (`מנעול 1590`). Phrases meaning "no code" (`אין קוד`, `ללא קוד`, `N/A`, `-`) are stored as empty.
* **A single `Name` column** is kept intact rather than guessed apart, because Hebrew lists mix
  "family given" and "given family" order.
* **Unnamed spreadsheet columns** are reported as ignored rather than silently dropped.
* Rows with errors are listed with their row numbers and skipped only after the manager confirms.

### Locating addresses

Lists rarely carry coordinates, so geocoding starts **automatically** once an import finishes, and can
be re-run at any time from the deliveries screen. It uses OpenStreetMap Nominatim at one address per
second and reports how many were pinpointed to the building against placed on the street.

Addresses that resolve to nothing are never altered. Each one becomes a card showing the address as
written, up to three suggested corrections (from Photon, restricted to the campaign's area), and a
field for typing the correct street. A correction is applied only when a manager approves it, and the
delivery keeps its original address until then.

## Clustering

`findDeliveryClusters(available, requested)` grows compact clusters from every seed and scores them by
mean pairwise distance, with penalties for falling short of the requested size and for spanning extra
streets or neighbourhoods. Distance uses, in order of trust:

1. haversine distance, when both deliveries have coordinates;
2. the neighbourhood, which real lists carry and which matters because they almost never carry
   coordinates: two addresses in different neighbourhoods are never put in one cluster, while different
   streets inside one neighbourhood stay walkable;
3. same-street house-number distance.

Returns up to 3 mostly-disjoint suggestions and never returns nothing while deliveries remain.
No odd/even street-side logic.
