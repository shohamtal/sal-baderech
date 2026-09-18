import { describe, expect, it } from 'vitest';
import { bestStreetMatch, distanceBudget, editDistance, normalizeStreetName, rankSuggestions } from './addressSuggest';

/** The real street list of חריש, as OpenStreetMap has it. */
const HARISH = ['אביטל', 'אודם', 'אחדות', 'אלה', 'אלון', 'אתרוג', 'ברוש', 'ברקת', 'גמלא', 'גפן',
  'דולב', 'דפנה', 'דרך ארץ', 'האחווה', 'הגולן', 'הגשמה', 'החלומות', 'הקהילה', 'הר תבור', 'השראה',
  'התמדה', 'טורקיז', 'לוטם', 'נרקיס', 'סביון', 'ספיר', 'עינב', 'צאלון', 'רובין', 'רימון', 'רקפת',
  'שוהם', 'תמר', 'תנופה', 'אורן'];

describe('editDistance', () => {
  it('charges one edit for an adjacent transposition', () => {
    // Plain Levenshtein would say 2 and the typo would go unrepaired.
    expect(editDistance('נריקס', 'נרקיס')).toBe(1);
    expect(editDistance('ab', 'ba')).toBe(1);
  });
  it('handles insertion, deletion and substitution', () => {
    expect(editDistance('קהילה', 'הקהילה')).toBe(1);
    expect(editDistance('אחרות', 'אחדות')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
});

describe('normalizeStreetName', () => {
  it('strips street prefixes, quotes and extra spaces', () => {
    expect(normalizeStreetName("רח' הרצל")).toBe('הרצל');
    expect(normalizeStreetName('רחוב  אודם ')).toBe('אודם');
    expect(normalizeStreetName('דרך  ארץ')).toBe('ארץ');
  });
});

describe('bestStreetMatch against the real חריש street list', () => {
  it('repairs the three typos that appeared in a real sheet', () => {
    expect(bestStreetMatch('נריקס', HARISH)).toMatchObject({ name: 'נרקיס', exact: false });
    expect(bestStreetMatch('קהילה', HARISH)).toMatchObject({ name: 'הקהילה', exact: false });
    expect(bestStreetMatch('אחרות', HARISH)).toMatchObject({ name: 'אחדות', exact: false });
  });

  it('returns the street unchanged when it is already correct', () => {
    for (const s of ['אודם', 'גפן', 'הקהילה', 'דרך ארץ']) {
      expect(bestStreetMatch(s, HARISH)).toMatchObject({ name: s, distance: 0, exact: true });
    }
  });

  it('matches despite a street prefix in the file', () => {
    expect(bestStreetMatch("רח' אודם", HARISH)).toMatchObject({ name: 'אודם', exact: true });
  });

  it('refuses to guess when nothing is close', () => {
    expect(bestStreetMatch('רחובשאיןבכללבעיר', HARISH)).toBeNull();
    expect(bestStreetMatch('Nonexistent Boulevard', HARISH)).toBeNull();
  });

  it('refuses to guess when two streets are equally close', () => {
    // אלה and אלון are both one edit from אלן; picking either would be a coin flip.
    expect(bestStreetMatch('אלן', ['אלה', 'אלון'])).toBeNull();
  });

  it('never corrects a very short name, where one edit changes everything', () => {
    expect(distanceBudget('גן')).toBe(0);
    expect(bestStreetMatch('גן', ['גב', 'דן'])).toBeNull();
  });
});

describe('rankSuggestions', () => {
  // Harish is around 32.46,35.05; Tel Aviv around 32.07,34.78 (~100km away).
  const HARISH = { latitude: 32.462, longitude: 35.048 };
  const f = (name: string, city: string, lat: number, lon: number, hn?: string) => ({
    geometry: { coordinates: [lon, lat] as [number, number] },
    properties: { name, city, district: city, housenumber: hn },
  });
  const near = (name: string) => f(name, 'חריש', 32.455, 35.05);
  const far = (name: string) => f(name, 'תל אביב–יפו', 32.07, 34.78);

  it('keeps only nearby candidates, closest spelling first', () => {
    const out = rankSuggestions([far('חריף אייזיק'), near('אחדות'), near('אחווה')], 'אחרות', {
      reference: HARISH,
    });
    expect(out.map((s) => s.street)).toEqual(['אחדות', 'אחווה']);
    expect(out[0].distance).toBe(1);
  });

  it('filters by distance even when the city name comes back transliterated', () => {
    // Photon answers in the browser's language: "Harish", not "חריש". A
    // name-based filter would drop the only useful candidate.
    const translit = f('אחדות', 'Harish', 32.455, 35.05);
    expect(rankSuggestions([translit], 'אחרות', { reference: HARISH }).map((s) => s.street))
      .toEqual(['אחדות']);
    expect(rankSuggestions([translit], 'אחרות', { city: 'חריש' })).toEqual([]);
  });

  it('falls back to the city name when nothing has been placed yet', () => {
    const out = rankSuggestions([far('חריף אייזיק'), near('אחדות')], 'אחרות', { city: 'חריש' });
    expect(out.map((s) => s.street)).toEqual(['אחדות']);
  });

  it('drops a candidate identical to the street that already failed', () => {
    expect(rankSuggestions([near('אודם')], 'אודם', { reference: HARISH })).toEqual([]);
  });

  it('de-duplicates and caps the list at three', () => {
    const many = ['אחדות', 'אחדות', 'אלה', 'אלון', 'ברוש', 'גפן'].map(near);
    const out = rankSuggestions(many, 'אחרות', { reference: HARISH });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((s) => s.street)).size).toBe(3);
  });

  it('returns nothing when every candidate is far away', () => {
    expect(rankSuggestions([far('קהילת קנדה'), far('קהילת ונציה')], 'קהילה', { reference: HARISH }))
      .toEqual([]);
  });
});
