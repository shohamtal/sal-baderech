-- =============================================================================
-- Readable campaign URLs: /:orgSlug/campaigns/:campaignSlug/...
--
-- `public_slug` stays as it is. It is the opaque token in links shared before
-- organization URLs existed, and it should not become guessable.
-- This slug is for authenticated management screens, which RLS guards anyway.
-- =============================================================================

alter table public.campaigns add column if not exists slug text;

-- Backfill from the name, unique within each organization.
with numbered as (
  select id, organization_id, app.slugify(name) as base,
         row_number() over (partition by organization_id, app.slugify(name)
                            order by created_at, id) as n
  from public.campaigns
  where slug is null
)
update public.campaigns c
set slug = case when n = 1 then coalesce(base, 'campaign') else coalesce(base, 'campaign') || '-' || n end
from numbered where numbered.id = c.id;

update public.campaigns
set slug = 'campaign-' || substring(replace(id::text, '-', '') from 1 for 8)
where slug is null or slug = '';

alter table public.campaigns alter column slug set not null;
create unique index if not exists campaigns_org_slug_key on public.campaigns (organization_id, slug);

-- Tab names must never be shadowed by a campaign slug.
alter table public.campaigns drop constraint if exists campaigns_slug_not_reserved;
alter table public.campaigns add constraint campaigns_slug_not_reserved
  check (slug not in ('overview','deliveries','map','fix-suggestions','import','log','settings','users','campaigns','home','new'));

create or replace function app.campaigns_set_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_slug text;
  v_n int := 1;
begin
  -- Renaming a campaign must not move a URL someone has already bookmarked.
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;
  v_base := coalesce(app.slugify(coalesce(nullif(btrim(coalesce(new.slug, '')), ''), new.name)), 'campaign');
  if v_base in ('overview','deliveries','map','fix-suggestions','import','log','settings','users','campaigns','home','new') then
    v_base := v_base || '-campaign';
  end if;
  v_slug := v_base;
  while exists (
    select 1 from public.campaigns c
    where c.organization_id = new.organization_id and c.slug = v_slug and c.id is distinct from new.id
  ) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  new.slug := v_slug;
  return new;
end $$;

drop trigger if exists campaigns_slug on public.campaigns;
create trigger campaigns_slug before insert or update of slug, name on public.campaigns
  for each row execute function app.campaigns_set_slug();

-- The organization dashboard links into the campaign, so it needs the slug.
create or replace function public.org_dashboard(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.campaigns;
begin
  if not app.can_manage_org(p_org_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into c from public.campaigns where organization_id = p_org_id and status = 'PUBLISHED' limit 1;
  if c.id is null then
    return jsonb_build_object('campaign', null);
  end if;
  return jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'public_slug', c.public_slug),
    'stats', public.campaign_stats(c.id)
  );
end $$;
grant execute on function public.org_dashboard(uuid) to authenticated;
