import { describe, expect, it } from 'vitest';
import { mapHeaders, normalizeBuildingCode, normalizeRows, parseAddressLine } from './parseImport';

/** The exact header row of a real distribution sheet. */
const REAL_HEADERS = ['Name', 'phone1', 'phone2', 'address', 'comments', 'neighberhood', 'street',
  'street-number', 'entrance', 'apartment', 'floor', 'lobby entrance code'];

/** One real row, values as the spreadsheet reader hands them over. */
const realRow = (over: Record<string, unknown> = {}) => ({
  Name: 'לוי טלמור',
  phone1: '0503535553',
  phone2: '',
  address: 'אודם 7 דירה 9 קומה 2',
  comments: '',
  neighberhood: 'אבני חן',
  street: 'אודם',
  'street-number': 7,
  entrance: '',
  apartment: 9,
  floor: 2,
  'lobby entrance code': 'אין קוד',
  ...over,
});

describe('mapHeaders', () => {
  it('maps the real-world English header set exactly', () => {
    const { mapping, unknown } = mapHeaders(REAL_HEADERS);
    expect(Object.fromEntries(mapping)).toEqual({
      Name: 'full_name',
      phone1: 'phone',
      phone2: 'phone2',
      address: 'address_line',
      comments: 'notes',
      neighberhood: 'neighborhood',
      street: 'street',
      'street-number': 'house_number',
      entrance: 'entrance',
      apartment: 'apartment',
      floor: 'floor',
      'lobby entrance code': 'building_code',
    });
    expect(unknown).toEqual([]);
  });

  it('does not let "street" swallow "street-number"', () => {
    const { mapping } = mapHeaders(['street', 'street-number']);
    expect(mapping.get('street')).toBe('street');
    expect(mapping.get('street-number')).toBe('house_number');
  });

  it('maps the Hebrew variant of the same sheet', () => {
    const { mapping, unknown } = mapHeaders(['Name', 'מספר טלפון 1', 'מספר טלפון 2', 'כתובת',
      'מספר נפשות', 'הערות', 'שכונה', 'רחוב', 'בית', 'כניסה', 'דירה', 'קומה', 'קוד כניסה לדלת', 'עו"ס']);
    expect(mapping.get('מספר טלפון 1')).toBe('phone');
    expect(mapping.get('מספר טלפון 2')).toBe('phone2');
    expect(mapping.get('שכונה')).toBe('neighborhood');
    expect(mapping.get('בית')).toBe('house_number');
    expect(mapping.get('קוד כניסה לדלת')).toBe('building_code');
    expect(mapping.get('מספר נפשות')).toBe('household_size');
    expect(unknown).toEqual(['עו"ס']);
  });

  it('treats blank spreadsheet headers as unnamed, not as fields', () => {
    const { mapping, unknown } = mapHeaders(['street', 'street-number', '__EMPTY', '__EMPTY_1']);
    expect(mapping.has('__EMPTY')).toBe(false);
    expect(unknown).toEqual(['__EMPTY', '__EMPTY_1']);
  });

  it('still maps the original First/Last Name style', () => {
    const { mapping } = mapHeaders(['First Name', 'Last Name', 'Street', 'House Number', 'Building Code']);
    expect(mapping.get('First Name')).toBe('first_name');
    expect(mapping.get('Last Name')).toBe('last_name');
    expect(mapping.get('House Number')).toBe('house_number');
    expect(mapping.get('Building Code')).toBe('building_code');
  });
});

describe('normalizeBuildingCode', () => {
  it('treats "no code" phrases as absent', () => {
    for (const v of ['אין קוד', 'אין קוד בניין', 'ללא קוד', 'no code', 'N/A', '-', '']) {
      expect(normalizeBuildingCode(v)).toBeNull();
    }
  });
  it('keeps real codes and access instructions verbatim', () => {
    expect(normalizeBuildingCode('#2580')).toBe('#2580');
    expect(normalizeBuildingCode('*3434')).toBe('*3434');
    expect(normalizeBuildingCode('0909#')).toBe('0909#');
    expect(normalizeBuildingCode('מנעול 1590')).toBe('מנעול 1590');
    expect(normalizeBuildingCode('מפתח 4580')).toBe('מפתח 4580');
  });
});

describe('parseAddressLine', () => {
  it('splits a Hebrew combined address', () => {
    expect(parseAddressLine('אודם 7 דירה 9 קומה 2')).toEqual({
      street: 'אודם', house_number: '7', apartment: '9', floor: '2', entrance: null,
    });
  });
  it('handles negative floors (basements)', () => {
    expect(parseAddressLine('ברקת 25 דירה 2 קומה -3')).toMatchObject({
      street: 'ברקת', house_number: '25', apartment: '2', floor: '-3',
    });
  });
  it('handles multi-word streets and an entrance', () => {
    expect(parseAddressLine('הרב קוק 12 כניסה ב דירה 4')).toMatchObject({
      street: 'הרב קוק', house_number: '12', entrance: 'ב', apartment: '4',
    });
  });
  it('degrades gracefully when there is no house number', () => {
    expect(parseAddressLine('אודם')).toMatchObject({ street: 'אודם', house_number: null });
    expect(parseAddressLine('')).toMatchObject({ street: null, house_number: null });
  });
});

describe('normalizeRows on real-world sheets', () => {
  it('imports a real row, using the single Name column and dropping "אין קוד"', () => {
    const res = normalizeRows([realRow()]);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toEqual({
      full_name: 'לוי טלמור',
      first_name: null,
      last_name: null,
      street: 'אודם',
      house_number: '7',
      apartment: '9',
      floor: '2',
      entrance: null,
      building_code: null,
      city: null,
      neighborhood: 'אבני חן',
      notes: null,
      phone: '0503535553',
      phone2: null,
      household_size: null,
      latitude: null,
      longitude: null,
    });
  });

  it('keeps a real door code and a second phone', () => {
    const res = normalizeRows([realRow({ 'lobby entrance code': '#2580', phone2: '0539344393' })]);
    expect(res.rows[0]).toMatchObject({ building_code: '#2580', phone: '0503535553', phone2: '0539344393' });
  });

  it('rescues a row whose street column is blank by parsing the address column', () => {
    const res = normalizeRows([realRow({ street: '', 'street-number': '' })]);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ street: 'אודם', house_number: '7' });
    expect(res.derivedFromAddress).toBe(1);
  });

  it('accepts a file that only has a combined address column', () => {
    const res = normalizeRows([
      { Name: 'שי בר', address: 'אודם 9 דירה 9 קומה 3', neighberhood: 'אבני חן' },
    ]);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ street: 'אודם', house_number: '9', apartment: '9', floor: '3' });
  });

  it('preserves floor 0 and negative floors', () => {
    const res = normalizeRows([realRow({ floor: 0 }), realRow({ floor: -3 })]);
    expect(res.rows.map((r) => r.floor)).toEqual(['0', '-3']);
  });

  it('merges several note columns and validates household size', () => {
    const res = normalizeRows([{
      Name: 'פלוני', רחוב: 'אלה', בית: '6',
      הערות: 'דובר אנגלית בלבד', 'הערות לכתובת': 'הדלת מאחור',
      'מספר נפשות': 3,
    }, {
      Name: 'אלמוני', רחוב: 'אלה', בית: '8', 'מספר נפשות': 'לא ידוע',
    }]);
    expect(res.rows[0].notes).toBe('דובר אנגלית בלבד · הדלת מאחור');
    expect(res.rows[0].household_size).toBe(3);
    // Nonsense household size is ignored rather than rejecting the family.
    expect(res.rows[1].household_size).toBeNull();
    expect(res.errors).toEqual([]);
  });

  it('skips blank rows and reports unnamed columns separately', () => {
    const res = normalizeRows([
      realRow({ __EMPTY: 'עטרה' }),
      { Name: '', phone1: '', address: '', street: '', 'street-number': '', __EMPTY: '' },
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.unknownColumns).toEqual(['__EMPTY']);
  });

  it('rejects the trailing totals row that a real sheet ended with', () => {
    // Real file, last row: address literally "null", with column sums in the
    // numeric columns and everything else blank.
    const res = normalizeRows([
      realRow(),
      { Name: '', phone1: '', phone2: '', address: 'null', comments: '', neighberhood: '',
        street: '', 'street-number': 1904, entrance: '', apartment: 948, floor: 185,
        'lobby entrance code': '' },
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row).toBe(2);
    expect(res.errors[0].message).toContain('חסר רחוב');
    expect(res.rows.some((r) => r.street === 'null')).toBe(false);
  });

  it('treats placeholder text as empty wherever it appears', () => {
    for (const p of ['null', 'NULL', 'undefined', 'NaN', 'N/A', '#N/A', '#VALUE!', '-', '--', 'none']) {
      const res = normalizeRows([realRow({ street: p, address: p, 'street-number': p })]);
      expect(res.rows, `placeholder ${p} should not become data`).toHaveLength(0);
    }
  });

  it('keeps the delivery but drops an impossible floor', () => {
    const res = normalizeRows([realRow({ floor: 185, apartment: 948 })]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].floor).toBeNull();
    // 948 is odd but a 3-digit apartment is legitimate, so it is kept.
    expect(res.rows[0].apartment).toBe('948');
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].row).toBe(1);
    expect(res.warnings[0].message).toContain('קומה');
  });

  it('only drops an apartment number that cannot exist', () => {
    expect(normalizeRows([realRow({ apartment: 401 })]).rows[0].apartment).toBe('401');
    const absurd = normalizeRows([realRow({ apartment: 94812 })]);
    expect(absurd.rows[0].apartment).toBeNull();
    expect(absurd.warnings).toHaveLength(1);
  });

  it('still accepts real basements and high floors', () => {
    const res = normalizeRows([realRow({ floor: -3 }), realRow({ floor: 0 }), realRow({ floor: 25 })]);
    expect(res.warnings).toEqual([]);
    expect(res.rows.map((r) => r.floor)).toEqual(['-3', '0', '25']);
  });

  it('fails clearly when there is neither address nor street columns', () => {
    const res = normalizeRows([{ Name: 'x', neighberhood: 'y' }]);
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0].row).toBe(0);
  });

  it('still reports coordinate errors per row', () => {
    const res = normalizeRows([
      { Street: 'Herzl', 'House Number': '5', Latitude: '32.1', Longitude: '' },
      { Street: 'Herzl', 'House Number': '6', Latitude: 'abc', Longitude: '34' },
      { Street: 'Herzl', 'House Number': '7', Latitude: '32', Longitude: '34' },
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.errors.map((e) => e.row)).toEqual([1, 2]);
  });
});
