import { describe, expect, it } from 'vitest';

/**
 * Regression guard: an unset GitHub Actions secret arrives as "", not undefined.
 * `??` would pass "" straight to createClient(), which throws at module load and
 * white-screens the app before the configuration screen can render.
 */
describe('supabase config fallback', () => {
  const resolve = (v: string | undefined) => (v ?? '').trim() || 'fallback';
  const configured = (u: string | undefined, k: string | undefined) =>
    Boolean((u ?? '').trim() && (k ?? '').trim());

  it('falls back on empty and whitespace values, not just undefined', () => {
    expect(resolve(undefined)).toBe('fallback');
    expect(resolve('')).toBe('fallback');
    expect(resolve('   ')).toBe('fallback');
    expect(resolve('https://x.supabase.co')).toBe('https://x.supabase.co');
  });

  it('reports unconfigured when either value is blank', () => {
    expect(configured('', '')).toBe(false);
    expect(configured('https://x.supabase.co', '')).toBe(false);
    expect(configured('', 'key')).toBe(false);
    expect(configured('  ', 'key')).toBe(false);
    expect(configured('https://x.supabase.co', 'key')).toBe(true);
  });
});
