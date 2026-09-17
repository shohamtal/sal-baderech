/**
 * Integration test against a LOCAL Supabase stack (npx supabase start).
 * Verifies the atomic claim under real concurrency: two approved volunteers race for
 * the same cluster through the public API and exactly one wins.
 *
 * Run: npm run test:integration   (skipped when SUPABASE_TEST_URL is not set)
 * Requires the seed users (manager@example.com / password123) and campaign slug demo12.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_ANON_KEY;
const SLUG = process.env.SUPABASE_TEST_SLUG ?? 'demo12';

const client = () => createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function volunteer(name: string): Promise<{ sb: SupabaseClient; campaignId: string }> {
  const sb = client();
  const { error: e1 } = await sb.auth.signInAnonymously();
  if (e1) throw e1;
  const { error: e2 } = await sb.rpc('register_volunteer', { p_slug: SLUG, p_full_name: name, p_phone: '0500000000' });
  if (e2) throw e2;
  const { data } = await sb.rpc('get_public_campaign', { p_slug: SLUG });
  return { sb, campaignId: data[0].campaign_id as string };
}

describe.skipIf(!URL || !KEY)('atomic claim (real concurrency, local Supabase)', () => {
  it('only one of two racing volunteers gets the cluster; the loser gets nothing', async () => {
    const manager = client();
    const { error: loginErr } = await manager.auth.signInWithPassword({ email: 'manager@example.com', password: 'password123' });
    if (loginErr) throw loginErr;

    const a = await volunteer('Racer A');
    const b = await volunteer('Racer B');
    const campaignId = a.campaignId;

    // Pending volunteers see nothing.
    const pendingAvail = await a.sb.rpc('get_available_deliveries', { p_campaign_id: campaignId });
    expect(pendingAvail.error?.message).toContain('FORBIDDEN');
    const pendingRows = await a.sb.from('deliveries').select('id');
    expect(pendingRows.data).toEqual([]);

    // Manager approves both.
    const { data: cvs, error: cvErr } = await manager
      .from('campaign_volunteers')
      .select('id, volunteers!inner(full_name)')
      .eq('campaign_id', campaignId)
      .eq('status', 'PENDING')
      .in('volunteers.full_name', ['Racer A', 'Racer B']);
    if (cvErr) throw cvErr;
    expect(cvs!.length).toBe(2);
    for (const cv of cvs!) {
      const { error } = await manager.rpc('set_volunteer_status', { p_cv_id: cv.id, p_status: 'APPROVED' });
      if (error) throw error;
    }

    // Both see the same available list.
    const { data: avail, error: availErr } = await a.sb.rpc('get_available_deliveries', { p_campaign_id: campaignId });
    if (availErr) throw availErr;
    expect(avail!.length).toBeGreaterThanOrEqual(3);
    const ids = (avail as { id: string }[]).slice(0, 3).map((d) => d.id);

    // RACE: fire both claims at once.
    const [ra, rb] = await Promise.all([
      a.sb.rpc('claim_deliveries', { p_campaign_id: campaignId, p_delivery_ids: ids }),
      b.sb.rpc('claim_deliveries', { p_campaign_id: campaignId, p_delivery_ids: ids }),
    ]);
    const successes = [ra, rb].filter((r) => !r.error);
    const failures = [ra, rb].filter((r) => r.error);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error!.message).toContain('CLAIM_CONFLICT');
    expect((successes[0].data as unknown[]).length).toBe(3);

    // Winner sees exactly 3 rows, loser sees 0 — enforced by RLS, not the client.
    const winner = ra.error ? b.sb : a.sb;
    const loser = ra.error ? a.sb : b.sb;
    const { data: winnerRows } = await winner.from('deliveries').select('id, building_code').eq('campaign_id', campaignId);
    const { data: loserRows } = await loser.from('deliveries').select('id').eq('campaign_id', campaignId);
    expect(winnerRows!.length).toBe(3);
    expect(loserRows!.length).toBe(0);

    // Cleanup: release the baskets so the seed stays reusable.
    for (const id of ids) {
      const { error } = await manager.rpc('manager_release_delivery', { p_delivery_id: id });
      if (error) throw error;
    }
    for (const cv of cvs!) await manager.rpc('set_volunteer_status', { p_cv_id: cv.id, p_status: 'REJECTED' });
  }, 30000);
});
