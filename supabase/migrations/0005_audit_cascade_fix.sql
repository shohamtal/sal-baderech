-- =============================================================================
-- Deleting a campaign (or an organization) always failed.
--
-- The delete cascades to deliveries, and the deliveries audit trigger then
-- inserted a DELIVERY_DELETED row referencing the campaign that had just been
-- removed, violating audit_logs_campaign_id_fkey. Nothing could be deleted:
--
--   ERROR: insert or update on table "audit_logs" violates foreign key
--   constraint "audit_logs_campaign_id_fkey"
--
-- When the campaign itself is going away its whole audit trail goes with it, so
-- there is nothing worth recording for each cascaded row.
-- =============================================================================

create or replace function app.audit_deliveries()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_changed text[];
begin
  if app.in_rpc() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    -- Skip when the parent campaign is being deleted in the same statement:
    -- its audit rows are cascade-deleted anyway, and logging would fail the FK.
    if not exists (select 1 from public.campaigns where id = old.campaign_id) then
      return old;
    end if;
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
