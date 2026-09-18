-- =============================================================================
-- Let an organization manager maintain their own organization's details.
--
-- organizations_update stays platform-admin only, because `slug` and `active`
-- are platform concerns: a slug change breaks every shared link, and `active`
-- is how a platform admin suspends an organization. This function exposes only
-- the descriptive fields.
-- =============================================================================
create or replace function public.org_update_details(
  p_org_id uuid, p_name text, p_description text, p_city text, p_address text,
  p_contact_name text, p_contact_phone text, p_contact_email text
) returns public.organizations language plpgsql security definer set search_path = '' as $$
declare
  o public.organizations;
begin
  if not app.can_manage_org(p_org_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  update public.organizations
  set name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      city = nullif(btrim(coalesce(p_city, '')), ''),
      address = nullif(btrim(coalesce(p_address, '')), ''),
      contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
      contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
      contact_email = nullif(btrim(coalesce(p_contact_email, '')), '')
  where id = p_org_id
  returning * into o;
  return o;
end $$;
grant execute on function public.org_update_details(uuid, text, text, text, text, text, text, text) to authenticated;

-- The slug trigger fires on name changes; keep the original slug stable so
-- links that are already shared keep working.
create or replace function app.organizations_set_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_slug text;
  v_n int := 1;
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new; -- renaming the organization must not move its URL
  end if;
  if new.slug is not null and btrim(new.slug) <> '' then
    v_base := app.slugify(new.slug);
  else
    v_base := app.slugify(new.name);
  end if;
  v_base := coalesce(v_base, 'org');
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
