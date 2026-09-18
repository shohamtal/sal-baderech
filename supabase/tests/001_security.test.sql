-- pgTAP tests: authorization (RLS), atomic claiming, corrections, org isolation.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;
alter default privileges in schema tests grant execute on functions to anon, authenticated;

create or replace function tests.create_user(p_id uuid, p_email text, p_anon boolean default false) returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    case when p_anon then null else now() end, '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', p_anon);
end $$;

-- Impersonate a user the same way PostgREST does (role + JWT claims).
create or replace function tests.login(p_id uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.login_anon() returns void language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function tests.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
\set admin      '''00000000-0000-0000-0000-00000000a001'''
\set manager_a  '''00000000-0000-0000-0000-00000000a002'''
\set manager_b  '''00000000-0000-0000-0000-00000000a003'''
\set vol_1      '''00000000-0000-0000-0000-00000000a004'''
\set vol_2      '''00000000-0000-0000-0000-00000000a005'''
\set org_a      '''00000000-0000-0000-0000-00000000b001'''
\set org_b      '''00000000-0000-0000-0000-00000000b002'''
\set camp_a     '''00000000-0000-0000-0000-00000000c001'''
\set camp_b     '''00000000-0000-0000-0000-00000000c002'''

select tests.create_user(:admin, 'admin@test.local');
select tests.create_user(:manager_a, 'manager-a@test.local');
select tests.create_user(:manager_b, 'manager-b@test.local');
select tests.create_user(:vol_1, null, true);
select tests.create_user(:vol_2, null, true);

insert into public.platform_admins (user_id, email) values (:admin, 'admin@test.local');
insert into public.organizations (id, name) values (:org_a, 'Org A'), (:org_b, 'Org B');
insert into public.organization_managers (organization_id, user_id, email) values
  (:org_a, :manager_a, 'manager-a@test.local'),
  (:org_b, :manager_b, 'manager-b@test.local');
insert into public.campaigns (id, organization_id, name, status, public_slug) values
  (:camp_a, :org_a, 'Campaign A', 'OPEN', 'slug-a'),
  (:camp_b, :org_b, 'Campaign B', 'OPEN', 'slug-b');
insert into public.deliveries (id, campaign_id, first_name, last_name, street, house_number, apartment, building_code, neighborhood) values
  ('00000000-0000-0000-0000-00000000d001', :camp_a, 'Cohen', 'Family', 'Herzl', '10', '3', '1234', 'Old Town'),
  ('00000000-0000-0000-0000-00000000d002', :camp_a, 'Levi', 'Family', 'Herzl', '12', '7', null, 'Old Town'),
  ('00000000-0000-0000-0000-00000000d003', :camp_a, 'Mizrahi', 'Family', 'Herzl', '14', '1', '5678', 'Old Town'),
  ('00000000-0000-0000-0000-00000000d004', :camp_a, 'Peretz', 'Family', 'Herzl', '18', '12', null, 'Old Town'),
  ('00000000-0000-0000-0000-00000000d005', :camp_a, 'Biton', 'Family', 'Allenby', '7', '2', null, 'Old Town'),
  ('00000000-0000-0000-0000-00000000d101', :camp_b, 'Other', 'Org', 'Secret St', '1', '1', '0000', 'Hidden');

-- ---------------------------------------------------------------------------
-- 1. Anonymous (not logged in) visitor with the public URL
-- ---------------------------------------------------------------------------
select tests.login_anon();

select is(
  (select campaign_name from public.get_public_campaign('slug-a')),
  'Campaign A',
  'anon: public campaign page returns campaign name');

select is((select count(*) from public.deliveries), 0::bigint,
  'anon: deliveries table returns 0 rows');

select throws_ok(
  $$ select * from public.get_available_deliveries('00000000-0000-0000-0000-00000000c001') $$,
  '42501', null,
  'anon: get_available_deliveries is not executable');

select tests.logout();

-- ---------------------------------------------------------------------------
-- 2. Volunteer 1 registers → PENDING → sees nothing sensitive
-- ---------------------------------------------------------------------------
select tests.login(:vol_1);

select is(
  public.register_volunteer('slug-a', 'Volunteer One', '050-1234567'),
  'PENDING'::public.volunteer_status,
  'vol1: registration creates PENDING membership');

select is(
  (select my_status from public.get_public_campaign('slug-a')),
  'PENDING'::public.volunteer_status,
  'vol1: can see own registration status');

select is((select count(*) from public.deliveries), 0::bigint,
  'vol1 PENDING: SELECT deliveries returns 0 rows');

select is((select count(*) from public.campaigns), 1::bigint,
  'vol1 PENDING: can see basic info of own campaign only');

select throws_ok(
  $$ select * from public.get_available_deliveries('00000000-0000-0000-0000-00000000c001') $$,
  '42501', 'FORBIDDEN',
  'vol1 PENDING: cannot list available deliveries');

select throws_ok(
  $$ select * from public.claim_deliveries('00000000-0000-0000-0000-00000000c001',
       array['00000000-0000-0000-0000-00000000d001']::uuid[]) $$,
  '42501', 'FORBIDDEN',
  'vol1 PENDING: cannot claim deliveries');

select is((select count(*) from public.audit_logs), 0::bigint,
  'vol1: cannot read audit logs');

update public.campaign_volunteers set status = 'APPROVED';
select is((select my_status from public.get_public_campaign('slug-a')), 'PENDING'::public.volunteer_status,
  'vol1: direct UPDATE to self-approve is silently ignored by RLS');

select tests.logout();

-- Volunteer 2 registers as well
select tests.login(:vol_2);
select is(public.register_volunteer('slug-a', 'Volunteer Two', '0529876543'), 'PENDING'::public.volunteer_status,
  'vol2: registration creates PENDING membership');
select tests.logout();

-- Capture membership ids (as the migration role, which bypasses RLS)
select cv.id as cv_vol1 from public.campaign_volunteers cv join public.volunteers v on v.id = cv.volunteer_id where v.user_id = :vol_1 \gset
select cv.id as cv_vol2 from public.campaign_volunteers cv join public.volunteers v on v.id = cv.volunteer_id where v.user_id = :vol_2 \gset

-- ---------------------------------------------------------------------------
-- 3. Manager B (other organization) cannot touch Org A
-- ---------------------------------------------------------------------------
select tests.login(:manager_b);

select is((select count(*) from public.deliveries where campaign_id = :camp_a), 0::bigint,
  'manager B: sees 0 deliveries of campaign A');
select is((select count(*) from public.deliveries), 1::bigint,
  'manager B: sees only own organization deliveries');
select is((select count(*) from public.campaigns where organization_id = :org_a), 0::bigint,
  'manager B: sees 0 campaigns of org A');
select is((select count(*) from public.campaign_volunteers), 0::bigint,
  'manager B: sees 0 volunteers of org A');

select throws_ok(
  format($$ select public.set_volunteer_status(%L, 'APPROVED') $$, :'cv_vol1'),
  '42501', 'FORBIDDEN',
  'manager B: cannot approve volunteers of org A');

select throws_ok(
  $$ insert into public.deliveries (campaign_id, street, house_number)
     values ('00000000-0000-0000-0000-00000000c001', 'X', '1') $$,
  '42501', null,
  'manager B: cannot insert deliveries into campaign A');

select tests.logout();

-- ---------------------------------------------------------------------------
-- 4. Manager A approves both volunteers
-- ---------------------------------------------------------------------------
select tests.login(:manager_a);

select is((select count(*) from public.deliveries), 5::bigint, 'manager A: sees all 5 campaign A deliveries');
select is((select count(*) from public.campaign_volunteers where status = 'PENDING'), 2::bigint,
  'manager A: sees 2 pending volunteers');

select is((select status from public.set_volunteer_status(:'cv_vol1', 'APPROVED')),
  'APPROVED'::public.volunteer_status, 'manager A: approves vol1');
select is((select status from public.set_volunteer_status(:'cv_vol2', 'APPROVED')),
  'APPROVED'::public.volunteer_status, 'manager A: approves vol2');

select is((select (campaign_stats(:camp_a))->>'volunteers_approved'), '2', 'manager A: stats show 2 approved volunteers');

select tests.logout();

-- ---------------------------------------------------------------------------
-- 5. Approved volunteer: limited available list, atomic claim
-- ---------------------------------------------------------------------------
select tests.login(:vol_1);

select is((select count(*) from public.get_available_deliveries(:camp_a)), 5::bigint,
  'vol1 APPROVED: sees 5 available deliveries (limited columns)');
select bag_has(
  $$ select neighborhood from public.get_available_deliveries('00000000-0000-0000-0000-00000000c001') $$,
  $$ values ('Old Town'::text) $$,
  'vol1 APPROVED: available list exposes neighbourhood for clustering');

select is((select count(*) from public.deliveries), 0::bigint,
  'vol1 APPROVED but nothing claimed: SELECT deliveries still returns 0 rows');

select is(
  (select count(*) from public.claim_deliveries(:camp_a, array[
     '00000000-0000-0000-0000-00000000d001',
     '00000000-0000-0000-0000-00000000d002',
     '00000000-0000-0000-0000-00000000d003']::uuid[])),
  3::bigint, 'vol1: claims 3 deliveries');

select is((select count(*) from public.deliveries where status = 'RESERVED'), 3::bigint,
  'vol1: now sees exactly the 3 claimed deliveries with full details');
select is((select building_code from public.deliveries where id = '00000000-0000-0000-0000-00000000d001'), '1234',
  'vol1: can read sensitive fields of own claimed delivery');

select tests.logout();

-- Volunteer 2 tries to claim an overlapping cluster → all-or-nothing conflict
select tests.login(:vol_2);

select throws_ok(
  $$ select * from public.claim_deliveries('00000000-0000-0000-0000-00000000c001', array[
       '00000000-0000-0000-0000-00000000d003',
       '00000000-0000-0000-0000-00000000d004']::uuid[]) $$,
  'P0001', 'CLAIM_CONFLICT',
  'vol2: claiming a cluster containing an already-reserved delivery fails');

select is((select count(*) from public.deliveries), 0::bigint,
  'vol2: partial claim did NOT happen (d004 was not assigned)');

select is((select count(*) from public.get_available_deliveries(:camp_a)), 2::bigint,
  'vol2: 2 deliveries remain available');

select is(
  (select count(*) from public.claim_deliveries(:camp_a, array['00000000-0000-0000-0000-00000000d004']::uuid[])),
  1::bigint, 'vol2: can claim the remaining available delivery');

select throws_ok(
  $$ select public.mark_delivered('00000000-0000-0000-0000-00000000d001') $$,
  '42501', 'FORBIDDEN',
  'vol2: cannot mark another volunteer''s delivery as delivered');

select tests.logout();

-- ---------------------------------------------------------------------------
-- 6. Delivery completion + correction flow
-- ---------------------------------------------------------------------------
select tests.login(:vol_1);

select is((select status from public.mark_delivered('00000000-0000-0000-0000-00000000d001')),
  'DELIVERED'::public.delivery_status, 'vol1: marks own delivery as delivered');

update public.deliveries set apartment = 'HACKED' where id = '00000000-0000-0000-0000-00000000d002';
select is((select apartment from public.deliveries where id = '00000000-0000-0000-0000-00000000d002'), '7',
  'vol1: direct UPDATE of a delivery is ignored by RLS');

select is(
  (select status from public.submit_correction('00000000-0000-0000-0000-00000000d002', 'apartment', '5', 'Family said apt 5')),
  'PENDING'::public.correction_status, 'vol1: submits a correction request');
select is(
  (select status from public.submit_correction('00000000-0000-0000-0000-00000000d002', 'full_name', 'משפחת כהן', null)),
  'PENDING'::public.correction_status, 'vol1: submits a full_name correction');
select is(
  (select status from public.submit_correction('00000000-0000-0000-0000-00000000d002', 'household_size', '5', null)),
  'PENDING'::public.correction_status, 'vol1: submits a household_size correction');

select tests.logout();

select tests.login(:manager_a);

select is(
  (select status from public.review_correction((select id from public.corrections where field_name = 'apartment'), true)),
  'APPROVED'::public.correction_status, 'manager A: approves the correction');
select is((select apartment from public.deliveries where id = '00000000-0000-0000-0000-00000000d002'), '5',
  'correction approval updated the delivery');
select is((select old_value from public.corrections where field_name = 'apartment'), '7',
  'correction record preserved old value (audit trail)');
select is((select reviewed_by from public.corrections where field_name = 'apartment'), :manager_a::uuid,
  'correction record stores reviewer');

-- Fields added for real-world lists: a combined name and a non-text column.
select is(
  (select status from public.review_correction((select id from public.corrections where field_name = 'full_name'), true)),
  'APPROVED'::public.correction_status, 'manager A: approves a full_name correction');
select is((select full_name from public.deliveries where id = '00000000-0000-0000-0000-00000000d002'),
  'משפחת כהן', 'full_name correction applied');
select is(
  (select status from public.review_correction((select id from public.corrections where field_name = 'household_size'), true)),
  'APPROVED'::public.correction_status, 'manager A: approves a household_size correction');
select is((select household_size from public.deliveries where id = '00000000-0000-0000-0000-00000000d002'), 5,
  'household_size correction cast text to integer correctly');
select ok(exists (select 1 from public.audit_logs where action = 'CORRECTION_APPROVED'),
  'audit log has CORRECTION_APPROVED entry');

-- ---------------------------------------------------------------------------
-- 7. Revoke → immediate loss of access + baskets released
-- ---------------------------------------------------------------------------
select is((select status from public.set_volunteer_status(:'cv_vol1', 'REVOKED')),
  'REVOKED'::public.volunteer_status, 'manager A: revokes vol1');

select tests.logout();
select tests.login(:vol_1);

select is((select count(*) from public.deliveries), 0::bigint,
  'vol1 REVOKED: SELECT deliveries returns 0 rows (even previously claimed ones)');
select throws_ok(
  $$ select * from public.get_available_deliveries('00000000-0000-0000-0000-00000000c001') $$,
  '42501', 'FORBIDDEN',
  'vol1 REVOKED: cannot list available deliveries');

select tests.logout();

select is((select count(*) from public.deliveries where campaign_id = :camp_a and status = 'AVAILABLE'), 3::bigint,
  'revocation released undelivered baskets (d002, d003 + d005) back to AVAILABLE');

-- ---------------------------------------------------------------------------
-- 8. Deleting a campaign with deliveries must not trip the audit foreign key
-- ---------------------------------------------------------------------------
select tests.login(:manager_a);

select lives_ok(
  $$ delete from public.campaigns where id = '00000000-0000-0000-0000-00000000c001' $$,
  'manager A: can delete a campaign that still has deliveries');
select is((select count(*) from public.deliveries where campaign_id = :camp_a), 0::bigint,
  'deleting the campaign removed its deliveries');

select tests.logout();

select * from finish();
rollback;
