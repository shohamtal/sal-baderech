-- =============================================================================
-- סל בדרך — fields required by real-world recipient lists
--
-- Driven by an actual distribution sheet whose columns are:
--   Name | phone1 | phone2 | address | comments | neighberhood | street |
--   street-number | entrance | apartment | floor | lobby entrance code
--
-- Two shapes that the original schema could not hold:
--   * one combined "Name" column rather than first/last
--   * a neighbourhood, which is the only proximity signal when a list has no
--     coordinates (these lists never do)
-- =============================================================================

alter table public.deliveries
  add column if not exists full_name      text,
  add column if not exists phone2         text,
  add column if not exists neighborhood   text,
  add column if not exists household_size int;

alter table public.deliveries
  add constraint deliveries_household_size_sane
  check (household_size is null or (household_size between 1 and 30));

create index if not exists deliveries_neighborhood_idx
  on public.deliveries (campaign_id, neighborhood);

-- Corrections may target the new text fields and household size.
alter table public.corrections drop constraint if exists corrections_field_whitelist;
alter table public.corrections add constraint corrections_field_whitelist
  check (field_name in (
    'first_name','last_name','full_name','street','house_number','apartment','floor',
    'entrance','building_code','city','neighborhood','notes','phone','phone2','household_size'));

-- ---------------------------------------------------------------------------
-- Approved volunteers need neighbourhood for clustering. Return type changes,
-- so the function must be dropped rather than replaced.
-- ---------------------------------------------------------------------------
drop function if exists public.get_available_deliveries(uuid);

create function public.get_available_deliveries(p_campaign_id uuid)
returns table (
  id uuid, street text, house_number text, city text, neighborhood text,
  latitude double precision, longitude double precision
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_approved_volunteer(p_campaign_id) or app.can_manage_campaign(p_campaign_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- Still no recipient names, apartments, floors, codes, notes or phones here.
  return query
    select d.id, d.street, d.house_number, d.city, d.neighborhood, d.latitude, d.longitude
    from public.deliveries d
    join public.campaigns c on c.id = d.campaign_id
    where d.campaign_id = p_campaign_id
      and d.status = 'AVAILABLE'
      and c.status in ('OPEN', 'IN_PROGRESS')
    order by d.neighborhood nulls last, d.street, d.house_number, d.id;
end $$;
grant execute on function public.get_available_deliveries(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Import accepts the new fields.
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

  insert into public.deliveries (campaign_id, first_name, last_name, full_name, street, house_number,
    apartment, floor, entrance, building_code, city, neighborhood, notes, phone, phone2, household_size,
    latitude, longitude)
  select p_campaign_id,
         nullif(btrim(r.first_name), ''), nullif(btrim(r.last_name), ''), nullif(btrim(r.full_name), ''),
         btrim(r.street), btrim(r.house_number),
         nullif(btrim(r.apartment), ''), nullif(btrim(r.floor), ''), nullif(btrim(r.entrance), ''),
         nullif(btrim(r.building_code), ''), nullif(btrim(r.city), ''), nullif(btrim(r.neighborhood), ''),
         nullif(btrim(r.notes), ''), nullif(btrim(r.phone), ''), nullif(btrim(r.phone2), ''),
         r.household_size, r.latitude, r.longitude
  from jsonb_to_recordset(p_rows) as r(
    first_name text, last_name text, full_name text, street text, house_number text, apartment text,
    floor text, entrance text, building_code text, city text, neighborhood text, notes text,
    phone text, phone2 text, household_size int,
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
-- Approving a correction must cast to the target column's type, now that one
-- correctable field (household_size) is not text.
-- ---------------------------------------------------------------------------
create or replace function public.review_correction(p_correction_id uuid, p_approve boolean)
returns public.corrections language plpgsql security definer set search_path = '' as $$
declare
  c public.corrections;
  d public.deliveries;
  v_org uuid;
  v_type text;
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
    select data_type into v_type from information_schema.columns
    where table_schema = 'public' and table_name = 'deliveries' and column_name = c.field_name;
    if v_type is null then
      raise exception 'INVALID_FIELD' using errcode = '22023';
    end if;
    -- field_name is CHECK-constrained; the type comes from the catalog, not the caller.
    execute format('update public.deliveries set %I = nullif($1, '''')::%s where id = $2', c.field_name, v_type)
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

-- submit_correction must accept the widened field list too.
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
  if v_vol_id is null
     or (d.reserved_by is distinct from v_vol_id and d.delivered_by is distinct from v_vol_id)
     or not app.is_approved_volunteer(d.campaign_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_field_name not in ('first_name','last_name','full_name','street','house_number','apartment',
                          'floor','entrance','building_code','city','neighborhood','notes',
                          'phone','phone2','household_size') then
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
