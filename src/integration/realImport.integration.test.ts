/**
 * End-to-end import of a real distribution sheet.
 *
 * Skipped unless REAL_IMPORT_FILE points at a spreadsheet, so no recipient data
 * ever lives in this repository. Run it against a local Supabase:
 *
 *   REAL_IMPORT_FILE="$HOME/Downloads/list.xlsx" \
 *   REAL_IMPORT_SHEET="סלי מזון תושבים רשימה כללית" \
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=<anon> \
 *   npm run test:integration
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { findDeliveryClusters } from '../lib/clustering/clustering';
import { normalizeRows } from '../lib/import/parseImport';

const FILE = process.env.REAL_IMPORT_FILE;
const SHEET = process.env.REAL_IMPORT_SHEET;
const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_ANON_KEY;

describe.skipIf(!FILE || !URL || !KEY)('real spreadsheet import', () => {
  it('parses, imports and clusters a real sheet end to end', async () => {
    const wb = XLSX.read(readFileSync(FILE!), { type: 'buffer' });
    const name = SHEET && wb.Sheets[SHEET] ? SHEET : wb.SheetNames[0];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], {
      defval: '', blankrows: false,
    });
    const parsed = normalizeRows(raw);

    // The sheet must be understood: most rows valid, address fields populated.
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeGreaterThan(raw.length * 0.9);
    expect(parsed.rows.every((r) => r.street && r.house_number)).toBe(true);

    const manager = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const { error: loginErr } = await manager.auth.signInWithPassword({
      email: 'manager@example.com', password: 'password123',
    });
    if (loginErr) throw loginErr;

    const { data: campaign, error: cErr } = await manager
      .from('campaigns')
      .insert({
        organization_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: `ייבוא אמיתי ${Date.now()}`,
        status: 'OPEN',
      })
      .select('id')
      .single();
    if (cErr) throw cErr;

    try {
      const { data: count, error: impErr } = await manager.rpc('import_deliveries', {
        p_campaign_id: campaign.id, p_rows: parsed.rows,
      });
      if (impErr) throw impErr;
      expect(count).toBe(parsed.rows.length);

      // Read back through the volunteer-facing RPC and cluster the result.
      const { data: avail, error: aErr } = await manager.rpc('get_available_deliveries', {
        p_campaign_id: campaign.id,
      });
      if (aErr) throw aErr;
      expect(avail).toHaveLength(parsed.rows.length);

      const clusters = findDeliveryClusters(
        (avail as { id: string; street: string; house_number: string; neighborhood: string | null }[])
          .map((a) => ({ id: a.id, street: a.street, houseNumber: a.house_number, neighborhood: a.neighborhood })),
        6,
      );
      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters[0].size).toBe(6);
      // With neighbourhoods present, a cluster must never straddle two of them.
      for (const c of clusters) expect(c.neighborhoods.length).toBeLessThanOrEqual(1);
    } finally {
      await manager.from('campaigns').delete().eq('id', campaign.id);
    }
  }, 60000);
});
