-- Campaign links shared before organization URLs existed must still work, so
-- the public lookup now reveals which organization to redirect to.
drop function if exists public.get_public_campaign(text);

create function public.get_public_campaign(p_slug text)
returns table (
  campaign_id uuid,
  campaign_name text,
  description text,
  status public.campaign_status,
  organization_name text,
  organization_id uuid,
  organization_slug text,
  my_status public.volunteer_status,
  my_full_name text,
  my_phone text
) language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.description, c.status, o.name, o.id, o.slug,
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
