-- =============================================================================
-- Campaign lifecycle reduced to three states: DRAFT → PUBLISHED → ENDED.
--
-- The old five (DRAFT, OPEN, IN_PROGRESS, COMPLETED, ARCHIVED) drew
-- distinctions nobody acted on: OPEN and IN_PROGRESS allowed exactly the same
-- things, as did COMPLETED and ARCHIVED.
--
--   DRAFT      not public; the campaign link does not resolve
--   PUBLISHED  volunteers may register, claim and deliver
--   ENDED      still visible and readable, but closed to registration and claims
--
-- Note: IN_PROGRESS also exists on delivery_status and is unaffected.
-- =============================================================================

create type public.campaign_status_new as enum ('DRAFT', 'PUBLISHED', 'ENDED');

-- Functions that mention the old type must go before it can be dropped.
drop function if exists public.get_public_campaign(text);

alter table public.campaigns
  alter column status drop default,
  alter column status type public.campaign_status_new
    using (case status::text
             when 'DRAFT'       then 'DRAFT'
             when 'OPEN'        then 'PUBLISHED'
             when 'IN_PROGRESS' then 'PUBLISHED'
             when 'COMPLETED'   then 'ENDED'
             when 'ARCHIVED'    then 'ENDED'
           end)::public.campaign_status_new,
  alter column status set default 'DRAFT';

drop type public.campaign_status;
alter type public.campaign_status_new rename to campaign_status;

-- ---------------------------------------------------------------------------
-- Public campaign page. A DRAFT campaign is not public at all; an ENDED one is
-- still readable so a volunteer following an old link sees what happened.
-- ---------------------------------------------------------------------------
create function public.get_public_campaign(p_slug text)
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
    and c.status <> 'DRAFT';
$$;
grant execute on function public.get_public_campaign(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Everything that used to accept OPEN or IN_PROGRESS now accepts PUBLISHED.
-- ---------------------------------------------------------------------------
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
  if v_campaign.status <> 'PUBLISHED' then
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

create or replace function public.get_available_deliveries(p_campaign_id uuid)
returns table (
  id uuid, street text, house_number text, city text, neighborhood text,
  latitude double precision, longitude double precision
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_approved_volunteer(p_campaign_id) or app.can_manage_campaign(p_campaign_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select d.id, d.street, d.house_number, d.city, d.neighborhood, d.latitude, d.longitude
    from public.deliveries d
    join public.campaigns c on c.id = d.campaign_id
    where d.campaign_id = p_campaign_id
      and d.status = 'AVAILABLE'
      and c.status = 'PUBLISHED'
    order by d.neighborhood nulls last, d.street, d.house_number, d.id;
end $$;
grant execute on function public.get_available_deliveries(uuid) to authenticated;

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
  if v_campaign.status <> 'PUBLISHED' then
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
    raise exception 'CLAIM_CONFLICT' using errcode = 'P0001',
      detail = format('%s of %s deliveries were no longer available', v_requested - v_updated, v_requested);
  end if;

  perform app.log(v_campaign.organization_id, p_campaign_id, 'DELIVERIES_CLAIMED', 'volunteer', v_vol_id,
    jsonb_build_object('count', v_updated, 'delivery_ids', to_jsonb(p_delivery_ids)));

  return query select * from public.deliveries where id = any (p_delivery_ids) order by street, house_number;
end $$;
grant execute on function public.claim_deliveries(uuid, uuid[]) to authenticated;
