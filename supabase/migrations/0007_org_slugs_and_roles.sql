-- =============================================================================
-- Organization-scoped URLs, a platform/organization user directory, and an
-- UNDELIVERABLE delivery state.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Organization slug, used for /:orgSlug/home and /:orgSlug/admin
-- ---------------------------------------------------------------------------
alter table public.organizations add column if not exists slug text;

create or replace function app.slugify(p text)
returns text language sql immutable as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '[^a-z0-9֐-׿]+', '-', 'g'),
      '-{2,}', '-', 'g')),
    '');
$$;

-- Backfill, keeping slugs unique.
with numbered as (
  select id, app.slugify(name) as base,
         row_number() over (partition by app.slugify(name) order by created_at, id) as n
  from public.organizations
  where slug is null
)
update public.organizations o
set slug = case when n = 1 then coalesce(base, 'org') else coalesce(base, 'org') || '-' || n end
from numbered where numbered.id = o.id;

update public.organizations
set slug = 'org-' || substring(replace(id::text, '-', '') from 1 for 8)
where slug is null or slug = '';

alter table public.organizations alter column slug set not null;
create unique index if not exists organizations_slug_key on public.organizations (slug);

-- Reserved words would shadow application routes.
alter table public.organizations drop constraint if exists organizations_slug_not_reserved;
alter table public.organizations add constraint organizations_slug_not_reserved
  check (slug not in ('admin', 'login', 'logout', 'home', 'c', 'v', 'm', 'o', 'org', 'api', 'assets', 'static'));

-- ---------------------------------------------------------------------------
-- One published campaign per organization at a time
-- ---------------------------------------------------------------------------
-- Keep the newest PUBLISHED campaign per organization; end any older ones.
with ranked as (
  select id, organization_id,
         row_number() over (partition by organization_id order by updated_at desc, created_at desc) as n
  from public.campaigns where status = 'PUBLISHED'
)
update public.campaigns c set status = 'ENDED'
from ranked where ranked.id = c.id and ranked.n > 1;

create unique index if not exists campaigns_one_published_per_org
  on public.campaigns (organization_id) where status = 'PUBLISHED';

-- ---------------------------------------------------------------------------
-- UNDELIVERABLE: the volunteer could not hand the basket over. The delivery is
-- frozen — it does not return to the pool, so nobody else wastes a trip on it
-- until a manager decides what to do.
-- ---------------------------------------------------------------------------
alter type public.delivery_status add value if not exists 'UNDELIVERABLE';

alter table public.deliveries
  add column if not exists undeliverable_reason text,
  add column if not exists undeliverable_at timestamptz;

-- ---------------------------------------------------------------------------
-- Generate a slug on insert so callers never have to supply one, and keep it
-- unique by appending a counter.
-- ---------------------------------------------------------------------------
create or replace function app.organizations_set_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_slug text;
  v_n int := 1;
begin
  if new.slug is not null and btrim(new.slug) <> '' then
    v_base := app.slugify(new.slug);
  else
    v_base := app.slugify(new.name);
  end if;
  v_base := coalesce(v_base, 'org');
  -- Reserved words would shadow application routes.
  if v_base in ('admin','login','logout','home','c','v','m','o','org','api','assets','static') then
    v_base := v_base || '-org';
  end if;

  v_slug := v_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug and o.id is distinct from new.id) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  new.slug := v_slug;
  return new;
end $$;

create trigger organizations_slug before insert or update of slug, name on public.organizations
  for each row execute function app.organizations_set_slug();
