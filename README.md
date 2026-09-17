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
supabase/migrations/   0001 schema · 0002 RLS + helpers · 0003 RPC functions
supabase/tests/        pgTAP suite: RLS, org isolation, atomic claim, corrections, revoke
supabase/seed.sql      local dev data (admin/manager users, demo campaign)
src/lib/clustering/    findDeliveryClusters() — pure, deterministic, unit-tested
src/lib/import/        CSV/XLSX header mapping + validation (Hebrew & English headers)
src/pages/public       campaign landing (/#/c/:slug), login, home
src/pages/volunteer    my campaigns, request cluster, my deliveries (+map, Waze, corrections)
src/pages/manager      org campaigns, campaign console (dashboard, deliveries, map, volunteers,
                       corrections, import, audit, settings + QR/WhatsApp share)
src/pages/admin        organizations & managers & platform admins
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

1. Create a project at supabase.com.
2. **Authentication → Providers → Anonymous sign-ins: enable.** (Volunteer registration relies on it.)
   Keep **Email** enabled with **Confirm email** on (this is what makes invite-by-email safe).
3. **Authentication → URL configuration:** set *Site URL* to your Pages URL
   (`https://<owner>.github.io/<repo>/`) and add it to *Redirect URLs*.
4. Apply the migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
5. Bootstrap the first platform admin (SQL editor). Use the email you will sign up with:
   ```sql
   insert into public.platform_admins (email) values ('you@example.com');
   ```
   Then open the app → *כניסת מנהלים* → *הרשמה*, confirm the email, log in.
   From `/#/admin` you create organizations and invite organization managers by email.

### 2. GitHub Pages

1. Push the repo to GitHub; **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions:** add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (public values, but kept out of the repo).
3. Push to `main` → `deploy.yml` runs tests, builds with `VITE_BASE=/<repo>/`, publishes `dist/`.
   The app uses hash routing (`/#/c/<slug>`) so deep links work on Pages; a `404.html` copy is added too.

Never add the service-role key to any secret that reaches the build.

---

## Data import

CSV / XLSX with headers (Hebrew or English): שם פרטי, שם משפחה, **רחוב**, **מספר בית**, דירה, קומה,
כניסה, קוד בניין, עיר, טלפון, הערות, קו רוחב, קו אורך. Rows with errors are listed and skipped only
after explicit confirmation. Missing coordinates can be filled later with the “השלמת מיקומים”
button (OpenStreetMap Nominatim, 1 req/s, best-effort) or edited manually.

## Clustering

`findDeliveryClusters(available, requested)` grows compact clusters from every seed using
haversine distance when coordinates exist, otherwise same-street house-number distance, and
scores by mean pairwise distance (+ penalties for shortfall and street count). Returns up to 3
mostly-disjoint suggestions; never returns nothing while deliveries remain. No odd/even logic.
