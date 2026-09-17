import { describe, expect, it } from 'vitest';
import { mapHeaders, normalizeRows } from './parseImport';

describe('mapHeaders', () => {
  it('maps English headers', () => {
    const { mapping, unknown } = mapHeaders(['First Name', 'Last Name', 'Street', 'House Number', 'Apartment', 'Floor', 'Entrance', 'Building Code', 'Notes', 'Latitude', 'Longitude']);
    expect(mapping.get('First Name')).toBe('first_name');
    expect(mapping.get('House Number')).toBe('house_number');
    expect(mapping.get('Building Code')).toBe('building_code');
    expect(mapping.get('Longitude')).toBe('longitude');
    expect(unknown).toEqual([]);
  });
  it('maps Hebrew headers and reports unknown ones', () => {
    const { mapping, unknown } = mapHeaders(['שם פרטי', 'שם משפחה', 'רחוב', "מס' בית", 'דירה', 'קומה', 'קוד בניין', 'הערות', 'מזהה פנימי']);
    expect(mapping.get("מס' בית")).toBe('house_number');
    expect(mapping.get('קוד בניין')).toBe('building_code');
    expect(unknown).toEqual(['מזהה פנימי']);
  });
});

describe('normalizeRows', () => {
  it('produces valid rows and skips blank lines', () => {
    const res = normalizeRows([
      { 'שם פרטי': 'משה', 'שם משפחה': 'כהן', 'רחוב': 'הרצל', 'מספר בית': 10, 'דירה': 3, 'קו רוחב': '32.06', 'קו אורך': '34.77' },
      { 'שם פרטי': '', 'שם משפחה': '', 'רחוב': '', 'מספר בית': '', 'דירה': '', 'קו רוחב': '', 'קו אורך': '' },
      { 'שם פרטי': 'שרה', 'שם משפחה': 'לוי', 'רחוב': 'אלנבי', 'מספר בית': '7א', 'דירה': '', 'קו רוחב': '', 'קו אורך': '' },
    ]);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ first_name: 'משה', street: 'הרצל', house_number: '10', apartment: '3', latitude: 32.06, longitude: 34.77 });
    expect(res.rows[1]).toMatchObject({ house_number: '7א', apartment: null, latitude: null, longitude: null });
  });

  it('reports row-level validation errors with row numbers', () => {
    const res = normalizeRows([
      { Street: 'Herzl', 'House Number': '', Latitude: '', Longitude: '' },
      { Street: '', 'House Number': '5', Latitude: '', Longitude: '' },
      { Street: 'Herzl', 'House Number': '5', Latitude: '32.1', Longitude: '' },
      { Street: 'Herzl', 'House Number': '6', Latitude: 'abc', Longitude: '34' },
      { Street: 'Herzl', 'House Number': '7', Latitude: '95', Longitude: '34' },
      { Street: 'Herzl', 'House Number': '8', Latitude: '32', Longitude: '34' },
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.errors.map((e) => e.row)).toEqual([1, 2, 3, 4, 5]);
  });

  it('fails when required columns are missing', () => {
    const res = normalizeRows([{ Name: 'x', City: 'y' }]);
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0].row).toBe(0);
  });
});
