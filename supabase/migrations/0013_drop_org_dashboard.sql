-- The organization dashboard tab is gone: a campaign's own overview already
-- shows its progress, and duplicating it left two places to keep in step.
drop function if exists public.org_dashboard(uuid);
