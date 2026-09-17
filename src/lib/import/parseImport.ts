/**
 * Recipient import: header mapping (Hebrew / English), validation and preview rows.
 * Pure functions here are unit-tested; file parsing (CSV/XLSX) lives in readImportFile.ts.
 */

export interface ImportRow {
  first_name: string | null;
  last_name: string | null;
  street: string;
  house_number: string;
  apartment: string | null;
  floor: string | null;
  entrance: string | null;
  building_code: string | null;
  city: string | null;
  notes: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface RowError {
  /** 1-based row number in the source file (excluding header). */
  row: number;
  message: string;
}

export interface ImportResult {
  rows: ImportRow[];
  errors: RowError[];
  /** Columns from the file that were not recognized. */
  unknownColumns: string[];
  /** Which target fields were found in the file. */
  mappedFields: (keyof ImportRow)[];
}

const HEADER_SYNONYMS: Record<keyof ImportRow, string[]> = {
  first_name: ['first name', 'firstname', 'first_name', 'שם פרטי', 'שם'],
  last_name: ['last name', 'lastname', 'last_name', 'family', 'שם משפחה', 'משפחה'],
  street: ['street', 'street name', 'רחוב', 'שם רחוב', 'כתובת'],
  house_number: ['house number', 'house_number', 'house', 'number', 'no', 'מספר בית', 'מס בית', "מס' בית", 'מספר', 'בית'],
  apartment: ['apartment', 'apt', 'flat', 'דירה', 'מספר דירה', 'מס דירה'],
  floor: ['floor', 'קומה'],
  entrance: ['entrance', 'כניסה'],
  building_code: ['building code', 'building_code', 'code', 'door code', 'קוד', 'קוד בניין', 'קוד כניסה', 'קוד דלת'],
  city: ['city', 'town', 'עיר', 'יישוב', 'ישוב'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'הערות', 'הערה'],
  phone: ['phone', 'mobile', 'tel', 'טלפון', 'נייד', 'פלאפון'],
  latitude: ['latitude', 'lat', 'קו רוחב'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'קו אורך'],
};

function normHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[׳'"׳״.]/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Map file headers → ImportRow fields. Exact synonym match first, then prefix match. */
export function mapHeaders(headers: string[]): { mapping: Map<string, keyof ImportRow>; unknown: string[] } {
  const mapping = new Map<string, keyof ImportRow>();
  const unknown: string[] = [];
  const used = new Set<keyof ImportRow>();
  const fields = Object.keys(HEADER_SYNONYMS) as (keyof ImportRow)[];

  for (const header of headers) {
    const n = normHeader(header);
    if (!n) continue;
    let target: keyof ImportRow | undefined;
    for (const f of fields) {
      if (used.has(f)) continue;
      if (HEADER_SYNONYMS[f].some((s) => normHeader(s) === n)) {
        target = f;
        break;
      }
    }
    if (!target) {
      for (const f of fields) {
        if (used.has(f)) continue;
        if (HEADER_SYNONYMS[f].some((s) => n.startsWith(normHeader(s)) && normHeader(s).length >= 3)) {
          target = f;
          break;
        }
      }
    }
    if (target) {
      mapping.set(header, target);
      used.add(target);
    } else {
      unknown.push(header);
    }
  }
  return { mapping, unknown };
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const num = (v: unknown): number | null | 'invalid' => {
  if (v == null || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 'invalid';
};

/** Convert raw sheet objects (header → cell) into validated rows. */
export function normalizeRows(raw: Record<string, unknown>[]): ImportResult {
  const headers = raw.length ? Object.keys(raw[0]) : [];
  const { mapping, unknown } = mapHeaders(headers);
  const rows: ImportRow[] = [];
  const errors: RowError[] = [];

  const mappedFields = Array.from(new Set(mapping.values()));
  if (!mappedFields.includes('street') || !mappedFields.includes('house_number')) {
    errors.push({ row: 0, message: 'הקובץ חייב לכלול עמודות "רחוב" ו"מספר בית".' });
    return { rows, errors, unknownColumns: unknown, mappedFields };
  }

  raw.forEach((rec, idx) => {
    const rowNo = idx + 1;
    const get = (f: keyof ImportRow): unknown => {
      for (const [h, target] of mapping) if (target === f) return rec[h];
      return undefined;
    };

    const values = Object.values(rec);
    if (values.every((v) => v == null || String(v).trim() === '')) return; // skip blank lines

    const street = str(get('street'));
    const house = str(get('house_number'));
    const rowErrors: string[] = [];
    if (!street) rowErrors.push('חסר רחוב');
    if (!house) rowErrors.push('חסר מספר בית');

    const lat = num(get('latitude'));
    const lng = num(get('longitude'));
    if (lat === 'invalid' || lng === 'invalid') rowErrors.push('קואורדינטות לא תקינות');
    else if ((lat == null) !== (lng == null)) rowErrors.push('יש למלא גם קו רוחב וגם קו אורך');
    else if (lat != null && (Math.abs(lat) > 90 || Math.abs(lng!) > 180)) rowErrors.push('קואורדינטות מחוץ לטווח');

    if (rowErrors.length) {
      errors.push({ row: rowNo, message: rowErrors.join(', ') });
      return;
    }

    rows.push({
      first_name: str(get('first_name')),
      last_name: str(get('last_name')),
      street: street!,
      house_number: house!,
      apartment: str(get('apartment')),
      floor: str(get('floor')),
      entrance: str(get('entrance')),
      building_code: str(get('building_code')),
      city: str(get('city')),
      notes: str(get('notes')),
      phone: str(get('phone')),
      latitude: lat as number | null,
      longitude: lng as number | null,
    });
  });

  return { rows, errors, unknownColumns: unknown, mappedFields };
}

export const IMPORT_TEMPLATE_HEADERS = [
  'שם פרטי', 'שם משפחה', 'רחוב', 'מספר בית', 'דירה', 'קומה', 'כניסה', 'קוד בניין', 'עיר', 'טלפון', 'הערות', 'קו רוחב', 'קו אורך',
];
