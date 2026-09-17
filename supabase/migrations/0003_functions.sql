-- =============================================================================
-- סל בדרך — RPC functions (all authorization re-checked inside, in SQL)
-- =============================================================================

-- Safety: revoke default EXECUTE on new public functions, then grant explicitly.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Context / roles
-- ---------------------------------------------------------------------------

-- Links pending manager/admin invitations (by CONFIRMED email) to the current
-- user, then returns the caller's roles. Called once after login.
create or replace function public.get_my_context()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_vol public.volunteers;
begin
  if v_uid is null then
    return jsonb_build_object('authenticated', false);
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is not null then
    update public.organization_managers set user_id = v_uid
      where user_id is null and lower(email) = v_email;
    update public.platform_admins set user_id = v_uid
      where user_id is null and lower(email) = v_email;
  end if;

  select * into v_vol from public.volunteers where user_id = v_uid;

  return jsonb_build_object(
    'authenticated', true,
    'user_id', v_uid,
    'is_platform_admin', app.is_platform_admin(),
    'manager_org_ids', coalesce((
      select jsonb_agg(om.organization_id) from public.organization_managers om where om.user_id = v_uid
    ), '[]'::jsonb),
    'volunteer', case when v_vol.id is null then null else
      jsonb_build_object('id', v_vol.id, 'full_name', v_vol.full_name, 'phone', v_vol.phone) end
  );
end $$;
grant execute on function public.get_my_context() to authenticated;

-- ---------------------------------------------------------------------------
-- Public campaign page (anon + authenticated). Exposes ONLY non-sensitive info.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_campaign(p_slug text)
returns table (
  campaign_id uuid,
  campaign_name text,
  description text,
  status public.campaign_status,
  organization_name text,
  organization_id uuid,
  my_status public.volunteer_status,
  my_full_name text,
  my_phone text
) language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.description, c.status, o.name, o.id,
         cv.status, v.full_name, v.phone
  from public.campaigns c
  join public.organizations o on o.id = c.organization_id
  left join public.volunteers v on v.user_id = auth.uid()
  left join public.campaign_volunteers cv on cv.campaign_id = c.id and cv.volunteer_id = v.id
  where c.public_slug = p_slug
    and o.active
    and c.status <> 'ARCHIVED';
$$;
grant execute on function public.get_public_campaign(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Volunteer registration → PENDING
-- ---------------------------------------------------------------------------
create or replace function app.normalize_phone(p text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g');
$$;

create or replace function public.register_volunteer(p_slug text, p_full_name text, p_phone text)
returns public.volunteer_status language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_campaign public.campaigns;
  v_vol_id uuid;
  v_status public.volunteer_status;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := app.normalize_phone(p_phone);
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 9 and 15 then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;

  select * into v_campaign from public.campaigns c
  join public.organizations o on o.id = c.organization_id and o.active
  where c.public_slug = p_slug;
  if v_campaign.id is null then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_campaign.status not in ('OPEN', 'IN_PROGRESS') then
    raise exception 'CAMPAIGN_NOT_OPEN' using errcode = 'P0001';
  end if;

  insert into public.volunteers (user_id, full_name, phone)
  values (v_uid, v_name, v_phone)
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone
  returning id into v_vol_id;

  insert into public.campaign_volunteers (campaign_id, volunteer_id)
  values (v_campaign.id, v_vol_id)
  on conflict (campaign_id, volunteer_id) do nothing;

  select status into v_status from public.campaign_volunteers
  where campaign_id = v_campaign.id and volunteer_id = v_vol_id;

  perform set_config('app.in_rpc', '1', true);
  perform app.log(v_campaign.organization_id, v_campaign.id, 'VOLUNTEER_REGISTERED', 'volunteer', v_vol_id,
    jsonb_build_object('status', v_status));
  return v_status;
end $$;
grant execute on function public.register_volunteer(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Manager: approve / reject / revoke. Revoking releases undelivered baskets.
-- ---------------------------------------------------------------------------
create or replace function public.set_volunteer_status(p_cv_id uuid, p_status public.volunteer_status)
returns public.campaign_volunteers language plpgsql security definer set search_path = '' as $$
declare
  v_cv public.campaign_volunteers;
  v_campaign public.campaigns;
  v_released int := 0;
begin
  select * into v_cv from public.campaign_volunteers where id = p_cv_id for update;
  -- Same error for "missing" and "not yours": don't leak existence across organizations.
  if v_cv.id is null or not app.can_manage_campaign(v_cv.campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status = 'PENDING' then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  select * into v_campaign from public.campaigns where id = v_cv.campaign_id;

  perform set_config('app.in_rpc', '1', true);

  update public.campaign_volunteers
  set status = p_status,
      approved_by = case when p_status = 'APPROVED' then auth.uid() else approved_by end,
      approved_at = case when p_status = 'APPROVED' then now() else approved_at end
  where id = p_cv_id
  returning * into v_cv;

  if p_status in ('REVOKED', 'REJECTED') then
    update public.deliveries
    set status = 'AVAILABLE', reserved_by = null, reserved_at = null, started_at = null
    where campaign_id = v_cv.campaign_id
      and reserved_by = v_cv.volunteer_id
      and status in ('RESERVED', 'IN_PROGRESS');
    get diagnostics v_released = row_count;
    if v_released > 0 then
      perform app.log(v_campaign.organization_id, v_campaign.id, 'DELIVERIES_RELEASED', 'volunteer', v_cv.volunteer_id,
        jsonb_build_object('count', v_released, 'reason', 'status_' || p_status::text));
    end if;
  end if;

  perform app.log(v_campaign.organization_id, v_campaign.id, 'VOLUNTEER_' || p_status::text, 'volunteer', v_cv.volunteer_id,
    jsonb_build_object('campaign_volunteer_id', v_cv.id));
  return v_cv;
end $$;
grant execute on function public.set_volunteer_status(uuid, public.volunteer_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Approved volunteer: limited view of AVAILABLE deliveries (for clustering).
-- No names, apartments, floors, codes, notes or phones.
-- ---------------------------------------------------------------------------
create or replace function public.get_available_deliveries(p_campaign_id uuid)
returns table (
  id uuid, street text, house_number text, city text,
  latitude double precision, longitude double precision
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_approved_volunteer(p_campaign_id) or app.can_manage_campaign(p_campaign_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select d.id, d.street, d.house_number, d.city, d.latitude, d.longitude
    from public.deliveries d
    join public.campaigns c on c.id = d.campaign_id
    where d.campaign_id = p_campaign_id
      and d.status = 'AVAILABLE'
      and c.status in ('OPEN', 'IN_PROGRESS')
    order by d.street, d.house_number, d.id;
end $$;
grant execute on function public.get_available_deliveries(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ATOMIC CLAIM. All-or-nothing: if any delivery is no longer AVAILABLE the
-- whole transaction is rolled back and CLAIM_CONFLICT is raised.
-- The UPDATE takes row locks, so two concurrent claims serialize and the
-- second one sees non-AVAILABLE rows → count mismatch → rollback.
-- ---------------------------------------------------------------------------
create or replace function public.claim_deliveries(p_campaign_id uuid, p_delivery_ids uuid[])
returns setof public.deliveries language plpgsql security definer set search_path = '' as $$
declare
  v_vol_id uuid := app.my_volunteer_id();
  v_campaign public.campaigns;
  v_requested int := coalesce(array_length(p_delivery_ids, 1), 0);
  v_updated int;
  v_current int;
begin
  if v_vol_id is null or not app.is_approved_volunteer(p_campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_requested = 0 or v_requested > 50 then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  select * into v_campaign from public.campaigns where id = p_campaign_id;
  if v_campaign.status not in ('OPEN', 'IN_PROGRESS') then
    raise exception 'CAMPAIGN_NOT_OPEN' using errcode = 'P0001';
  end if;

  if v_campaign.max_baskets_per_volunteer is not null then
    select count(*) into v_current from public.deliveries
    where campaign_id = p_campaign_id and reserved_by = v_vol_id and status in ('RESERVED', 'IN_PROGRESS');
    if v_current + v_requested > v_campaign.max_baskets_per_volunteer then
      raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.in_rpc', '1', true);

  update public.deliveries
  set status = 'RESERVED', reserved_by = v_vol_id, reserved_at = now()
  where campaign_id = p_campaign_id
    and status = 'AVAILABLE'
    and id = any (select distinct unnest(p_delivery_ids));
  get diagnostics v_updated = row_count;

  if v_updated <> (select count(distinct x) from unnest(p_delivery_ids) x) then
    -- Raising aborts the transaction → nothing is claimed.
    raise exception 'CLAIM_CONFLICT' using errcode = 'P0001',
      detail = format('%s of %s deliveries were no longer available', v_requested - v_updated, v_requested);
  end if;

  perform app.log(v_campaign.organization_id, p_campaign_id, 'DELIVERIES_CLAIMED', 'volunteer', v_vol_id,
    jsonb_build_object('count', v_updated, 'delivery_ids', to_jsonb(p_delivery_ids)));

  return query select * from public.deliveries where id = any (p_delivery_ids) order by street, house_number;
end $$;
grant execute on function public.claim_deliveries(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Volunteer delivery lifecycle (only on OWN claimed deliveries, while APPROVED)
-- ---------------------------------------------------------------------------
create or replace function app.own_active_delivery(p_delivery_id uuid)
returns public.deliveries language plpgsql security definer set search_path = '' as $$
declare
  d public.deliveries;
begin
  select * into d from public.deliveries where id = p_delivery_id for update;
  if d.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.reserved_by is distinct from app.my_volunteer_id() or not app.is_approved_volunteer(d.campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return d;
end $$;

create or replace function public.start_delivery(p_delivery_id uuid)
returns public.deliveries language plpgsql security definer set search_path = '' as $$
declare
  d public.deliveries := app.own_active_delivery(p_delivery_id);
begin
  if d.status <> 'RESERVED' then
    return d; -- idempotent
  end if;
  perform set_config('app.in_rpc', '1', true);
  update public.deliveries set status = 'IN_PROGRESS', started_at = now() where id = d.id returning * into d;
  return d;
end $$;
grant execute on function public.start_delivery(uuid) to authenticated;

create or replace function public.mark_delivered(p_delivery_id uuid)
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
  set status = 'DELIVERED', delivered_at = now(), delivered_by = d.reserved_by,
      started_at = coalesce(started_at, now())
  where id = d.id returning * into d;
  select organization_id into v_org from public.campaigns where id = d.campaign_id;
  perform app.log(v_org, d.campaign_id, 'DELIVERY_DELIVERED', 'delivery', d.id, '{}'::jsonb);
  return d;
end $$;
grant execute on function public.mark_delivered(uuid) to authenticated;

create or replace function public.release_delivery(p_delivery_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.deliveries := app.own_active_delivery(p_delivery_id);
  v_org uuid;
begin
  if d.status not in ('RESERVED', 'IN_PROGRESS') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  perform set_config('app.in_rpc', '1', true);
  update public.deliveries
  set status = 'AVAILABLE', reserved_by = null, reserved_at = null, started_at = null
  where id = d.id;
  select organization_id into v_org from public.campaigns where id = d.campaign_id;
  perform app.log(v_org, d.campaign_id, 'DELIVERIES_RELEASED', 'delivery', d.id, jsonb_build_object('count', 1, 'reason', 'volunteer'));
end $$;
grant execute on function public.release_delivery(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------
create or replace function public.submit_correction(
  p_delivery_id uuid, p_field_name text, p_proposed_value text, p_comment text
) returns public.corrections language plpgsql security definer set search_path = '' as $$
declare
  d public.deliveries;
  v_vol_id uuid := app.my_volunteer_id();
  v_old text;
  v_row public.corrections;
  v_org uuid;
begin
  select * into d from public.deliveries where id = p_delivery_id;
  if d.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Must be the volunteer who holds / delivered this basket, and still approved.
  if v_vol_id is null
     or (d.reserved_by is distinct from v_vol_id and d.delivered_by is distinct from v_vol_id)
     or not app.is_approved_volunteer(d.campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_field_name not in ('first_name','last_name','street','house_number','apartment','floor','entrance','building_code','city','notes','phone') then
    raise exception 'INVALID_FIELD' using errcode = '22023';
  end if;

  v_old := (to_jsonb(d) ->> p_field_name);

  insert into public.corrections (delivery_id, volunteer_id, field_name, old_value, proposed_value, comment)
  values (d.id, v_vol_id, p_field_name, v_old, nullif(btrim(p_proposed_value), ''), nullif(btrim(p_comment), ''))
  returning * into v_row;

  select organization_id into v_org from public.campaigns where id = d.campaign_id;
  perform set_config('app.in_rpc', '1', true);
  perform app.log(v_org, d.campaign_id, 'CORRECTION_SUBMITTED', 'correction', v_row.id,
    jsonb_build_object('field', p_field_name, 'delivery_id', d.id));
  return v_row;
end $$;
grant execute on function public.submit_correction(uuid, text, text, text) to authenticated;

create or replace function public.review_correction(p_correction_id uuid, p_approve boolean)
returns public.corrections language plpgsql security definer set search_path = '' as $$
declare
  c public.corrections;
  d public.deliveries;
  v_org uuid;
begin
  select * into c from public.corrections where id = p_correction_id for update;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into d from public.deliveries where id = c.delivery_id for update;
  if not app.can_manage_campaign(d.campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if c.status <> 'PENDING' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;

  perform set_config('app.in_rpc', '1', true);

  if p_approve then
    -- Whitelisted dynamic column update (field_name is CHECK-constrained).
    execute format('update public.deliveries set %I = $1 where id = $2', c.field_name)
      using c.proposed_value, d.id;
  end if;

  update public.corrections
  set status = case when p_approve then 'APPROVED' else 'REJECTED' end::public.correction_status,
      reviewed_at = now(), reviewed_by = auth.uid()
  where id = c.id returning * into c;

  select organization_id into v_org from public.campaigns where id = d.campaign_id;
  perform app.log(v_org, d.campaign_id,
    case when p_approve then 'CORRECTION_APPROVED' else 'CORRECTION_REJECTED' end,
    'correction', c.id, jsonb_build_object('field', c.field_name, 'delivery_id', d.id));
  return c;
end $$;
grant execute on function public.review_correction(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Manager: bulk import (single audit entry)
-- ---------------------------------------------------------------------------
create or replace function public.import_deliveries(p_campaign_id uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
  v_org uuid;
begin
  if not app.can_manage_campaign(p_campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  perform set_config('app.in_rpc', '1', true);

  insert into public.deliveries (campaign_id, first_name, last_name, street, house_number, apartment, floor,
    entrance, building_code, city, notes, phone, latitude, longitude)
  select p_campaign_id,
         nullif(btrim(r.first_name), ''), nullif(btrim(r.last_name), ''),
         btrim(r.street), btrim(r.house_number),
         nullif(btrim(r.apartment), ''), nullif(btrim(r.floor), ''), nullif(btrim(r.entrance), ''),
         nullif(btrim(r.building_code), ''), nullif(btrim(r.city), ''), nullif(btrim(r.notes), ''),
         nullif(btrim(r.phone), ''), r.latitude, r.longitude
  from jsonb_to_recordset(p_rows) as r(
    first_name text, last_name text, street text, house_number text, apartment text, floor text,
    entrance text, building_code text, city text, notes text, phone text,
    latitude double precision, longitude double precision)
  where btrim(coalesce(r.street, '')) <> '' and btrim(coalesce(r.house_number, '')) <> '';
  get diagnostics v_count = row_count;

  select organization_id into v_org from public.campaigns where id = p_campaign_id;
  perform app.log(v_org, p_campaign_id, 'DELIVERIES_IMPORTED', 'campaign', p_campaign_id,
    jsonb_build_object('count', v_count));
  return v_count;
end $$;
grant execute on function public.import_deliveries(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Manager: dashboard statistics
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
    'cancelled', (select count(*) from public.deliveries where campaign_id = p_campaign_id and status = 'CANCELLED'),
    'missing_coords', (select count(*) from public.deliveries where campaign_id = p_campaign_id and latitude is null and status <> 'CANCELLED'),
    'volunteers_approved', (select count(*) from public.campaign_volunteers where campaign_id = p_campaign_id and status = 'APPROVED'),
    'volunteers_pending', (select count(*) from public.campaign_volunteers where campaign_id = p_campaign_id and status = 'PENDING'),
    'corrections_pending', (select count(*) from public.corrections co join public.deliveries d on d.id = co.delivery_id
                              where d.campaign_id = p_campaign_id and co.status = 'PENDING')
  );
end $$;
grant execute on function public.campaign_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Manager: reset a delivery back to AVAILABLE (e.g. volunteer disappeared)
-- ---------------------------------------------------------------------------
create or replace function public.manager_release_delivery(p_delivery_id uuid)
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
  perform set_config('app.in_rpc', '1', true);
  update public.deliveries
  set status = 'AVAILABLE', reserved_by = null, reserved_at = null, started_at = null,
      delivered_at = null, delivered_by = null
  where id = d.id returning * into d;
  select organization_id into v_org from public.campaigns where id = d.campaign_id;
  perform app.log(v_org, d.campaign_id, 'DELIVERIES_RELEASED', 'delivery', d.id, jsonb_build_object('count', 1, 'reason', 'manager'));
  return d;
end $$;
grant execute on function public.manager_release_delivery(uuid) to authenticated;
