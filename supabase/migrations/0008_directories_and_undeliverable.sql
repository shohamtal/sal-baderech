-- =============================================================================
-- User directories, organization-scoped entry points, and the undeliverable flow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Volunteer entry point: /:orgSlug/home
-- Exposes only the organization's public face and the caller's own status.
-- ---------------------------------------------------------------------------
create or replace function public.get_org_home(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.organizations;
  c public.campaigns;
  v public.volunteers;
  cv public.campaign_volunteers;
begin
  select * into o from public.organizations where slug = p_slug and active;
  if o.id is null then
    return null;
  end if;

  -- At most one campaign is published per organization.
  select * into c from public.campaigns
  where organization_id = o.id and status = 'PUBLISHED' limit 1;

  select * into v from public.volunteers where user_id = auth.uid();
  if c.id is not null and v.id is not null then
    select * into cv from public.campaign_volunteers
    where campaign_id = c.id and volunteer_id = v.id;
  end if;

  return jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug,
                                       'description', o.description, 'city', o.city,
                                       'contact_name', o.contact_name, 'contact_phone', o.contact_phone),
    'campaign', case when c.id is null then null else
      jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'city', c.city) end,
    'my_status', cv.status,
    'my_name', v.full_name,
    'my_phone', v.phone
  );
end $$;
grant execute on function public.get_org_home(text) to anon, authenticated;

create or replace function public.register_volunteer_for_org(p_org_slug text, p_full_name text, p_phone text)
returns public.volunteer_status language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
begin
  select c.public_slug into v_slug
  from public.campaigns c
  join public.organizations o on o.id = c.organization_id and o.active
  where o.slug = p_org_slug and c.status = 'PUBLISHED'
  limit 1;
  if v_slug is null then
    raise exception 'CAMPAIGN_NOT_OPEN' using errcode = 'P0001';
  end if;
  return public.register_volunteer(v_slug, p_full_name, p_phone);
end $$;
grant execute on function public.register_volunteer_for_org(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform directory. Every account on the platform, with its roles.
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
    order by u.created_at desc;
end $$;
grant execute on function public.admin_list_users() to authenticated;

-- Invitations that nobody has signed up for yet: they have no auth user.
create or replace function public.admin_list_invites()
returns table (email text, kind text, organization_name text, organization_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select pa.email, 'PLATFORM_ADMIN'::text, null::text, null::uuid
    from public.platform_admins pa where pa.user_id is null
    union all
    select om.email, 'ORGANIZATION_MANAGER'::text, o.name, o.id
    from public.organization_managers om
    join public.organizations o on o.id = om.organization_id
    where om.user_id is null;
end $$;
grant execute on function public.admin_list_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Organization directory: managers plus everyone who volunteered for it.
-- ---------------------------------------------------------------------------
create or replace function public.org_list_users(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  role text,
  volunteer_id uuid,
  campaign_volunteer_id uuid,
  campaign_id uuid,
  campaign_name text,
  volunteer_status public.volunteer_status,
  claimed int,
  delivered int,
  created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_org(p_org_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    -- Managers
    select om.user_id, om.email::text, null::text, null::text, 'ORGANIZATION_MANAGER'::text,
           null::uuid, null::uuid, null::uuid, null::text, null::public.volunteer_status,
           0, 0, om.created_at
    from public.organization_managers om
    where om.organization_id = p_org_id
    union all
    -- Volunteers, one row per campaign membership
    select v.user_id, null::text, v.full_name, v.phone, 'VOLUNTEER'::text,
           v.id, cv.id, ca.id, ca.name, cv.status,
           (select count(*)::int from public.deliveries d
             where d.campaign_id = ca.id and d.reserved_by = v.id
               and d.status in ('RESERVED', 'IN_PROGRESS', 'UNDELIVERABLE')),
           (select count(*)::int from public.deliveries d
             where d.campaign_id = ca.id and d.delivered_by = v.id and d.status = 'DELIVERED'),
           cv.created_at
    from public.campaign_volunteers cv
    join public.campaigns ca on ca.id = cv.campaign_id and ca.organization_id = p_org_id
    join public.volunteers v on v.id = cv.volunteer_id
    order by 13 desc;
end $$;
grant execute on function public.org_list_users(uuid) to authenticated;

-- A manager may correct a volunteer's contact details; a platform admin, anyone's.
create or replace function public.admin_update_volunteer(p_volunteer_id uuid, p_full_name text, p_phone text)
returns public.volunteers language plpgsql security definer set search_path = '' as $$
declare
  v public.volunteers;
  v_allowed boolean;
begin
  select * into v from public.volunteers where id = p_volunteer_id;
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select app.is_platform_admin() or exists (
    select 1 from public.campaign_volunteers cv
    where cv.volunteer_id = v.id and app.can_manage_campaign(cv.campaign_id)
  ) into v_allowed;
  if not v_allowed then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  update public.volunteers
  set full_name = btrim(p_full_name), phone = app.normalize_phone(p_phone)
  where id = p_volunteer_id returning * into v;
  return v;
end $$;
grant execute on function public.admin_update_volunteer(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Undeliverable: the volunteer went and could not hand the basket over.
-- The delivery is frozen rather than returned to the pool, so no one else
-- makes the same wasted trip before a manager looks at it.
-- ---------------------------------------------------------------------------
create or replace function public.mark_undeliverable(p_delivery_id uuid, p_reason text)
returns public.deliveries language plpgsql security definer set search_path = '' as $$
declare
  d public.deliveries := app.own_active_delivery(p_delivery_id);
  v_org uuid;
begin
  if d.status not in ('RESERVED', 'IN_PROGRESS') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  perform set_config('app.in_rpc', '1', true);
  update public.deliveries
  set status = 'UNDELIVERABLE',
      undeliverable_reason = nullif(btrim(p_reason), ''),
      undeliverable_at = now()
  where id = d.id returning * into d;
  select organization_id into v_org from public.campaigns where id = d.campaign_id;
  perform app.log(v_org, d.campaign_id, 'DELIVERY_UNDELIVERABLE', 'delivery', d.id,
    jsonb_build_object('reason', nullif(btrim(p_reason), '')));
  return d;
end $$;
grant execute on function public.mark_undeliverable(uuid, text) to authenticated;

-- Manager decides: back to the pool, or cancelled for good.
create or replace function public.resolve_undeliverable(p_delivery_id uuid, p_action text)
returns public.deliveries language plpgsql security definer set search_path = '' as $$
declare
  d public.deliveries;
  v_org uuid;
begin
  select * into d from public.deliveries where id = p_delivery_id for update;
  if d.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not app.can_manage_campaign(d.campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if d.status <> 'UNDELIVERABLE' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if p_action not in ('RETRY', 'CANCEL') then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;

  perform set_config('app.in_rpc', '1', true);
  if p_action = 'RETRY' then
    update public.deliveries
    set status = 'AVAILABLE', reserved_by = null, reserved_at = null, started_at = null,
        undeliverable_reason = null, undeliverable_at = null
    where id = d.id returning * into d;
  else
    update public.deliveries set status = 'CANCELLED' where id = d.id returning * into d;
  end if;

  select organization_id into v_org from public.campaigns where id = d.campaign_id;
  perform app.log(v_org, d.campaign_id, 'UNDELIVERABLE_' || p_action, 'delivery', d.id, '{}'::jsonb);
  return d;
end $$;
grant execute on function public.resolve_undeliverable(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Statistics gain the new state.
-- ---------------------------------------------------------------------------
create or replace function public.campaign_stats(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_manage_campaign(p_campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.deliveries where campaign_id = p_campaign_id),
    'available', (select count(*) from public.deliveries where campaign_id = p_campaign_id and status = 'AVAILABLE'),
    'reserved', (select count(*) from public.deliveries where campaign_id = p_campaign_id and status = 'RESERVED'),
    'in_progress', (select count(*) from public.deliveries where campaign_id = p_campaign_id and status = 'IN_PROGRESS'),
    'delivered', (select count(*) from public.deliveries where campaign_id = p_campaign_id and status = 'DELIVERED'),
    'undeliverable', (select count(*) from public.deliveries where campaign_id = p_campaign_id and status = 'UNDELIVERABLE'),
    'cancelled', (select count(*) from public.deliveries where campaign_id = p_campaign_id and status = 'CANCELLED'),
    'missing_coords', (select count(*) from public.deliveries where campaign_id = p_campaign_id and latitude is null and status <> 'CANCELLED'),
    'volunteers_approved', (select count(*) from public.campaign_volunteers where campaign_id = p_campaign_id and status = 'APPROVED'),
    'volunteers_pending', (select count(*) from public.campaign_volunteers where campaign_id = p_campaign_id and status = 'PENDING'),
    'corrections_pending', (select count(*) from public.corrections co join public.deliveries d on d.id = co.delivery_id
                              where d.campaign_id = p_campaign_id and co.status = 'PENDING')
  );
end $$;
grant execute on function public.campaign_stats(uuid) to authenticated;

-- The organization dashboard: its published campaign, if any, with statistics.
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
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'public_slug', c.public_slug),
    'stats', public.campaign_stats(c.id)
  );
end $$;
grant execute on function public.org_dashboard(uuid) to authenticated;
