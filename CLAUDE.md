# סל בדרך — notes for Claude

* Hebrew RTL UI; talk to the user in English. Strings live inline + `src/lib/labels.ts`.
* Security lives in `supabase/migrations/0002_rls.sql` and `0003_functions.sql`. Frontend checks are UX only.
  Any new sensitive read/write needs an RLS policy or SECURITY DEFINER RPC **and** a pgTAP assertion in
  `supabase/tests/001_security.test.sql` (update `select plan(N)`).
* `npm test` excludes `src/integration/**` (needs a running local Supabase).
* Local pgTAP: `npx supabase test db`; if Docker mount is denied, pipe the file into
  `docker exec -i supabase_db_sal-baderech psql -U postgres -d postgres -tA -q`.
* Hash router (`/#/...`) on purpose for GitHub Pages; PKCE auth flow keeps the URL hash free.
