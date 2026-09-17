-- =============================================================================
-- סל בדרך — Schema
-- =============================================================================
create extension if not exists pgcrypto;

-- Internal helper schema. NOT exposed through PostgREST (only `public` is).
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.campaign_status as enum ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');
create type public.volunteer_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');
create type public.delivery_status as enum ('AVAILABLE', 'RESERVED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED');
create type public.correction_status as enum ('PENDING', 'APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Platform admins (bootstrapped by SQL; linked to auth user by confirmed email)
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  city text,
  address text,
  contact_name text,
  contact_phone text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();

-- Managers are invited by email; user_id is linked when a user with that
-- (confirmed) email signs in — see public.get_my_context().
create table public.organization_managers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);
create index organization_managers_user_idx on public.organization_managers (user_id);

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  city text,                        -- default city for geocoding / navigation
  status public.campaign_status not null default 'DRAFT',
  public_slug text not null unique default encode(gen_random_bytes(6), 'hex'),
  max_baskets_per_volunteer int,    -- optional organizational limit (null = none)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_org_idx on public.campaigns (organization_id);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Volunteers (identity) — one row per auth user
-- ---------------------------------------------------------------------------
create table public.volunteers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger volunteers_updated_at before update on public.volunteers
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Campaign volunteers — THE authorization table
-- ---------------------------------------------------------------------------
create table public.campaign_volunteers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  volunteer_id uuid not null references public.volunteers (id) on delete cascade,
  status public.volunteer_status not null default 'PENDING',
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, volunteer_id)
);
create index campaign_volunteers_volunteer_idx on public.campaign_volunteers (volunteer_id);
create trigger campaign_volunteers_updated_at before update on public.campaign_volunteers
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Deliveries (one food basket → one family)
-- ---------------------------------------------------------------------------
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  first_name text,
  last_name text,
  street text not null,
  house_number text not null,
  apartment text,
  floor text,
  entrance text,
  building_code text,
  city text,
  notes text,
  phone text,
  latitude double precision,
  longitude double precision,
  status public.delivery_status not null default 'AVAILABLE',
  reserved_by uuid references public.volunteers (id) on delete set null,
  reserved_at timestamptz,
  started_at timestamptz,
  delivered_at timestamptz,
  delivered_by uuid references public.volunteers (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deliveries_lat_lng_both check ((latitude is null) = (longitude is null)),
  constraint deliveries_lat_range check (latitude is null or (latitude between -90 and 90)),
  constraint deliveries_lng_range check (longitude is null or (longitude between -180 and 180))
);
create index deliveries_campaign_status_idx on public.deliveries (campaign_id, status);
create index deliveries_reserved_by_idx on public.deliveries (reserved_by);
create trigger deliveries_updated_at before update on public.deliveries
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Corrections (volunteers never edit deliveries directly)
-- ---------------------------------------------------------------------------
create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  volunteer_id uuid not null references public.volunteers (id) on delete cascade,
  field_name text not null,
  old_value text,
  proposed_value text,
  comment text,
  status public.correction_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint corrections_field_whitelist check (field_name in (
    'first_name','last_name','street','house_number','apartment','floor',
    'entrance','building_code','city','notes','phone'))
);
create index corrections_delivery_idx on public.corrections (delivery_id);
create index corrections_status_idx on public.corrections (status);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  user_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_campaign_idx on public.audit_logs (campaign_id, created_at desc);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
