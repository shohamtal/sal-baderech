import { describe, expect, it } from 'vitest';
import { buildQueries } from './geocode';

describe('geocode queries', () => {
  it('asks for the building first, then the street on its own', () => {
    expect(buildQueries({ street: 'אודם', house_number: '7', city: null }, 'חריש')).toEqual([
      'אודם 7, חריש',
      'אודם, חריש',
    ]);
  });

  it('never includes the neighbourhood', () => {
    // Lists say "חורש" where OpenStreetMap says "החורש"; sending it returns no result.
    const qs = buildQueries({ street: 'גפן', house_number: '24', city: 'חריש' }, null);
    expect(qs.every((q) => !q.includes('חורש') || q.includes('חריש'))).toBe(true);
    expect(qs[0]).toBe('גפן 24, חריש');
  });

  it('prefers the row city over the campaign default', () => {
    expect(buildQueries({ street: 'הרצל', house_number: '1', city: 'תל אביב' }, 'חריש')[0])
      .toBe('הרצל 1, תל אביב');
  });

  it('copes with a missing house number or city', () => {
    expect(buildQueries({ street: 'הרצל', house_number: '', city: null }, 'חריש')).toEqual(['הרצל, חריש']);
    expect(buildQueries({ street: 'הרצל', house_number: '1', city: null }, null)).toEqual(['הרצל 1', 'הרצל']);
    expect(buildQueries({ street: '', house_number: '1', city: 'חריש' }, null)).toEqual([]);
  });
});
