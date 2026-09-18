-- =============================================================================
-- A volunteer must have a real name, and an abandoned sign-up is not a user.
--
-- Registration creates the anonymous auth session first, then the volunteer
-- profile. If the second step never happens — the form is abandoned, or the
-- call fails — an account is left with no name and no membership. Those were
-- appearing in the platform directory as "ללא שם".
-- =============================================================================

-- Defence in depth: register_volunteer already rejects short names, but the
-- table should not be able to hold one either.
alter table public.volunteers drop constraint if exists volunteers_full_name_present;
alter table public.volunteers add constraint volunteers_full_name_present
  check (length(btrim(full_name)) >= 2);

-- ---------------------------------------------------------------------------
-- The directory lists accounts, not abandoned sessions.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  is_platform_admin boolean,
  is_anonymous boolean,
  volunteer_id uuid,
  managed_orgs jsonb,
  campaigns jsonb,
  created_at timestamptz,
  last_sign_in_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select u.id,
           u.email::text,
           v.full_name,
           v.phone,
           exists (select 1 from public.platform_admins pa where pa.user_id = u.id),
           coalesce(u.is_anonymous, false),
           v.id,
           coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug))
                     from public.organization_managers om
                     join public.organizations o on o.id = om.organization_id
                     where om.user_id = u.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('campaign', ca.name, 'status', cv.status))
                     from public.campaign_volunteers cv
                     join public.campaigns ca on ca.id = cv.campaign_id
                     where cv.volunteer_id = v.id), '[]'::jsonb),
           u.created_at,
           u.last_sign_in_at
    from auth.users u
    left join public.volunteers v on v.user_id = u.id
    -- An anonymous session that never became a volunteer is an abandoned
    -- sign-up, not a person. It is reported separately and can be purged.
    where not (coalesce(u.is_anonymous, false) and v.id is null)
    order by u.created_at desc;
end $$;
grant execute on function public.admin_list_users() to authenticated;

-- How many abandoned sign-ups are lying around, and since when.
create or replace function public.admin_abandoned_signups()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'count', count(*),
      'oldest', min(u.created_at)
    )
    from auth.users u
    where coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.volunteers v where v.user_id = u.id)
      -- Ignore very recent ones: somebody may be filling in the form right now.
      and u.created_at < now() - interval '1 hour'
  );
end $$;
grant execute on function public.admin_abandoned_signups() to authenticated;

-- The Edge Function needs the ids to delete; it runs as service_role, and the
-- function is platform-admin gated for anyone else.
create or replace function public.admin_abandoned_signup_ids()
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_platform_admin() or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select u.id from auth.users u
    where coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.volunteers v where v.user_id = u.id)
      and u.created_at < now() - interval '1 hour';
end $$;
grant execute on function public.admin_abandoned_signup_ids() to authenticated, service_role;
