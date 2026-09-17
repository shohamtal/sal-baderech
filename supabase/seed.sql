-- Local development seed (NOT applied in production).
-- Creates: platform admin, one organization + manager, one OPEN campaign with sample deliveries.
--
-- Local login (email/password):
--   admin@example.com   / password123   (platform admin)
--   manager@example.com / password123   (organization manager)

create or replace function pg_temp.seed_user(p_id uuid, p_email text, p_password text) returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', false);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id, p_id::text, jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
end $$;

select pg_temp.seed_user('11111111-1111-1111-1111-111111111111', 'admin@example.com', 'password123');
select pg_temp.seed_user('22222222-2222-2222-2222-222222222222', 'manager@example.com', 'password123');

insert into public.platform_admins (user_id, email) values ('11111111-1111-1111-1111-111111111111', 'admin@example.com');

insert into public.organizations (id, name, description, city, contact_name, contact_phone)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'חסד לדוגמה', 'עמותה לדוגמה לסביבת פיתוח', 'תל אביב', 'ישראל ישראלי', '0501234567');

insert into public.organization_managers (organization_id, user_id, email)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'manager@example.com');

insert into public.campaigns (id, organization_id, name, description, city, status, public_slug)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'פסח 2027',
        'חלוקת סלי מזון לחג הפסח. החלוקה מתבצעת ביום ראשון בין 9:00 ל-14:00 מנקודת האיסוף ברחוב הרצל 1.',
        'תל אביב', 'OPEN', 'demo12');

insert into public.deliveries (campaign_id, first_name, last_name, street, house_number, apartment, floor, entrance, building_code, city, notes, latitude, longitude) values
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'משה', 'כהן', 'הרצל', '10', '3', '1', 'א', '1234', 'תל אביב', 'לדפוק חזק', 32.0603, 34.7710),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'שרה', 'לוי', 'הרצל', '12', '7', '2', null, null, 'תל אביב', null, 32.0606, 34.7712),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'דוד', 'מזרחי', 'הרצל', '14', '1', '0', 'ב', '5678', 'תל אביב', null, 32.0609, 34.7714),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'רחל', 'פרץ', 'הרצל', '18', '12', '4', null, null, 'תל אביב', 'אין מעלית', 32.0614, 34.7718),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'יוסף', 'ביטון', 'הרצל', '21', '2', '1', null, null, 'תל אביב', null, 32.0618, 34.7716),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'מרים', 'אזולאי', 'אלנבי', '7', '5', '2', 'א', '2222', 'תל אביב', null, 32.0640, 34.7700),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'אברהם', 'דהן', 'אלנבי', '9', '4', '2', null, null, 'תל אביב', null, 32.0643, 34.7702),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'לאה', 'חדד', 'אלנבי', '15', '8', '3', null, '9999', 'תל אביב', null, 32.0650, 34.7706),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'יעקב', 'אוחיון', 'דיזנגוף', '100', '6', '3', null, null, 'תל אביב', null, 32.0790, 34.7740),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'רבקה', 'עמר', 'דיזנגוף', '104', '2', '1', 'ג', null, 'תל אביב', null, 32.0795, 34.7742),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'שמעון', 'גבאי', 'בן יהודה', '50', '9', '4', null, null, 'תל אביב', 'להתקשר לפני', 32.0820, 34.7700),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'חנה', 'ברוך', 'רוטשילד', '30', '1', '0', null, null, 'תל אביב', null, null, null),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'אליהו', 'שלום', 'רוטשילד', '32', '3', '1', null, null, 'תל אביב', null, null, null);
