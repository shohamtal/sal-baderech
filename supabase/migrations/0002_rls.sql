-- =============================================================================
-- סל בדרך — Authorization helpers + Row Level Security
--
-- PRINCIPLE: the frontend is never trusted. Every sensitive read/write below is
-- decided here, in PostgreSQL. A PENDING / REJECTED / REVOKED volunteer must
-- receive ZERO delivery rows regardless of what the client asks for.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper predicates (SECURITY DEFINER so they can read the auth tables without
-- triggering recursive RLS evaluation). All are STABLE and cheap.
-- ---------------------------------------------------------------------------
create or replace function app.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function app.is_org_manager(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_managers om
    where om.organization_id = org and om.user_id = auth.uid()
  );
$$;

-- Platform admin OR manager of that organization.
create or replace function app.can_manage_org(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin() or app.is_org_manager(org);
$$;

create or replace function app.can_manage_campaign(c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.campaigns ca
    where ca.id = c and app.can_manage_org(ca.organization_id)
  );
$$;

create or replace function app.my_volunteer_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select v.id from public.volunteers v where v.user_id = auth.uid();
$$;

-- Any membership state (PENDING included) — grants access to *basic* campaign info only.
create or replace function app.is_campaign_member(c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.campaign_volunteers cv
    join public.volunteers v on v.id = cv.volunteer_id
    where cv.campaign_id = c and v.user_id = auth.uid()
  );
$$;

-- THE authorization gate for sensitive campaign data.
create or replace function app.is_approved_volunteer(c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.campaign_volunteers cv
    join public.volunteers v on v.id = cv.volunteer_id
    where cv.campaign_id = c
      and v.user_id = auth.uid()
      and cv.status = 'APPROVED'
  );
$$;

-- Audit helper. Owned by the migration role → bypasses RLS on audit_logs.
create or replace function app.log(
  p_org uuid, p_campaign uuid, p_action text,
  p_entity_type text default null, p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, campaign_id, user_id, action, entity_type, entity_id, metadata)
  values (p_org, p_campaign, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Set by RPCs so table triggers don't double-log.
create or replace function app.in_rpc()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.in_rpc', true), '') = '1';
$$;

-- ---------------------------------------------------------------------------
-- Audit triggers for direct (manager) table edits
-- ---------------------------------------------------------------------------
create or replace function app.audit_deliveries()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_changed text[];
begin
  if app.in_rpc() then
    return coalesce(new, old);
  end if;
  select organization_id into v_org from public.campaigns where id = coalesce(new.campaign_id, old.campaign_id);
  if tg_op = 'INSERT' then
    perform app.log(v_org, new.campaign_id, 'DELIVERY_CREATED', 'delivery', new.id, '{}'::jsonb);
  elsif tg_op = 'UPDATE' then
    select array_agg(key) into v_changed
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
      and n.key not in ('updated_at');
    perform app.log(v_org, new.campaign_id, 'DELIVERY_UPDATED', 'delivery', new.id,
      jsonb_build_object('fields', coalesce(v_changed, '{}'::text[]),
                         'status', new.status));
  elsif tg_op = 'DELETE' then
    perform app.log(v_org, old.campaign_id, 'DELIVERY_DELETED', 'delivery', old.id, '{}'::jsonb);
  end if;
  return coalesce(new, old);
end $$;

create trigger deliveries_audit after insert or update or delete on public.deliveries
  for each row execute function app.audit_deliveries();

create or replace function app.audit_campaigns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app.log(new.organization_id, new.id, 'CAMPAIGN_CREATED', 'campaign', new.id,
      jsonb_build_object('name', new.name));
  elsif tg_op = 'UPDATE' then
    perform app.log(new.organization_id, new.id, 'CAMPAIGN_UPDATED', 'campaign', new.id,
      jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;

create trigger campaigns_audit after insert or update on public.campaigns
  for each row execute function app.audit_campaigns();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. No policy ⇒ no access.
-- ---------------------------------------------------------------------------
alter table public.platform_admins        enable row level security;
alter table public.organizations          enable row level security;
alter table public.organization_managers  enable row level security;
alter table public.campaigns              enable row level security;
alter table public.volunteers             enable row level security;
alter table public.campaign_volunteers    enable row level security;
alter table public.deliveries             enable row level security;
alter table public.corrections            enable row level security;
alter table public.audit_logs             enable row level security;

-- platform_admins ------------------------------------------------------------
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (app.is_platform_admin() or user_id = auth.uid());
create policy platform_admins_insert on public.platform_admins for insert to authenticated
  with check (app.is_platform_admin());
create policy platform_admins_delete on public.platform_admins for delete to authenticated
  using (app.is_platform_admin() and user_id is distinct from auth.uid());

-- organizations ----------------------------------------------------------------
create policy organizations_select on public.organizations for select to authenticated
  using (
    app.can_manage_org(id)
    or exists (
      select 1 from public.campaigns c
      where c.organization_id = organizations.id and app.is_campaign_member(c.id)
    )
  );
create policy organizations_insert on public.organizations for insert to authenticated
  with check (app.is_platform_admin());
create policy organizations_update on public.organizations for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy organizations_delete on public.organizations for delete to authenticated
  using (app.is_platform_admin());

-- organization_managers --------------------------------------------------------
create policy organization_managers_select on public.organization_managers for select to authenticated
  using (app.can_manage_org(organization_id) or user_id = auth.uid());
create policy organization_managers_insert on public.organization_managers for insert to authenticated
  with check (app.is_platform_admin());
create policy organization_managers_delete on public.organization_managers for delete to authenticated
  using (app.is_platform_admin());

-- campaigns ----------------------------------------------------------------------
-- Campaign rows hold no recipient data. Members (any status) may read basics.
create policy campaigns_select on public.campaigns for select to authenticated
  using (app.can_manage_org(organization_id) or app.is_campaign_member(id));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (app.can_manage_org(organization_id));
create policy campaigns_update on public.campaigns for update to authenticated
  using (app.can_manage_org(organization_id)) with check (app.can_manage_org(organization_id));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (app.can_manage_org(organization_id));

-- volunteers ---------------------------------------------------------------------
create policy volunteers_select on public.volunteers for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.campaign_volunteers cv
      where cv.volunteer_id = volunteers.id and app.can_manage_campaign(cv.campaign_id)
    )
  );
create policy volunteers_insert on public.volunteers for insert to authenticated
  with check (user_id = auth.uid());
create policy volunteers_update on public.volunteers for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- campaign_volunteers --------------------------------------------------------------
-- Writes happen only through RPCs (register_volunteer / set_volunteer_status).
create policy campaign_volunteers_select on public.campaign_volunteers for select to authenticated
  using (volunteer_id = app.my_volunteer_id() or app.can_manage_campaign(campaign_id));

-- deliveries -------------------------------------------------------------------------
-- Volunteers see ONLY deliveries they have claimed, and ONLY while APPROVED.
-- AVAILABLE deliveries (limited columns) are exposed via get_available_deliveries().
create policy deliveries_select on public.deliveries for select to authenticated
  using (
    app.can_manage_campaign(campaign_id)
    or (
      reserved_by is not null
      and reserved_by = app.my_volunteer_id()
      and app.is_approved_volunteer(campaign_id)
    )
  );
create policy deliveries_insert on public.deliveries for insert to authenticated
  with check (app.can_manage_campaign(campaign_id));
create policy deliveries_update on public.deliveries for update to authenticated
  using (app.can_manage_campaign(campaign_id)) with check (app.can_manage_campaign(campaign_id));
create policy deliveries_delete on public.deliveries for delete to authenticated
  using (app.can_manage_campaign(campaign_id));

-- corrections ---------------------------------------------------------------------------
-- Writes happen only through RPCs (submit_correction / review_correction).
create policy corrections_select on public.corrections for select to authenticated
  using (
    volunteer_id = app.my_volunteer_id()
    or exists (
      select 1 from public.deliveries d
      where d.id = corrections.delivery_id and app.can_manage_campaign(d.campaign_id)
    )
  );

-- audit_logs -------------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id is not null and app.can_manage_org(organization_id));
