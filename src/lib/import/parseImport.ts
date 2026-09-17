/**
 * Recipient import: header mapping, address parsing, validation and preview rows.
 *
 * Aligned to the column set real distribution lists use:
 *   Name | phone1 | phone2 | address | comments | neighberhood | street |
 *   street-number | entrance | apartment | floor | lobby entrance code
 *
 * Hebrew equivalents (שם, טלפון, כתובת, הערות, שכונה, רחוב, בית, כניסה, דירה,
 * קומה, קוד כניסה לדלת, מספר נפשות) and the plainer First/Last Name style are
 * all accepted. Everything here is pure so it can be unit-tested.
 */

export interface ImportRow {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  street: string;
  house_number: string;
  apartment: string | null;
  floor: string | null;
  entrance: string | null;
  building_code: string | null;
  city: string | null;
  neighborhood: string | null;
  notes: string | null;
  phone: string | null;
  phone2: string | null;
  household_size: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface RowError {
  /** 1-based row number in the source sheet, excluding the header. */
  row: number;
  message: string;
}

export interface ImportResult {
  rows: ImportRow[];
  errors: RowError[];
  /** Headers present in the file that were not recognised. */
  unknownColumns: string[];
  mappedFields: string[];
  /** How many rows had street/house parsed out of a combined address column. */
  derivedFromAddress: number;
}

/** Target fields, plus `address_line`: a source-only column used as a fallback. */
type Target = keyof ImportRow | 'address_line';

const HEADER_SYNONYMS: Record<Target, string[]> = {
  // A single combined name column is the common real-world shape.
  full_name: ['name', 'full name', 'recipient', 'recipient name', 'שם', 'שם מלא', 'שם הנמען', 'שם משפחה ופרטי'],
  first_name: ['first name', 'firstname', 'שם פרטי'],
  last_name: ['last name', 'lastname', 'family', 'family name', 'שם משפחה', 'משפחה'],
  address_line: ['address', 'full address', 'כתובת', 'כתובת מלאה'],
  street: ['street', 'street name', 'רחוב', 'שם רחוב'],
  house_number: ['street number', 'streetnumber', 'house number', 'house no', 'house', 'building number',
    'number', 'no', 'מספר בית', 'מס בית', 'בית', 'מספר'],
  apartment: ['apartment', 'apt', 'flat', 'דירה', 'מספר דירה', 'מס דירה'],
  floor: ['floor', 'קומה'],
  entrance: ['entrance', 'כניסה'],
  building_code: ['lobby entrance code', 'lobby code', 'entrance code', 'door code', 'building code', 'code',
    'קוד כניסה לדלת', 'קוד כניסה', 'קוד בניין', 'קוד דלת', 'קוד'],
  neighborhood: ['neighberhood', 'neighborhood', 'neighbourhood', 'area', 'שכונה', 'אזור'],
  city: ['city', 'town', 'עיר', 'יישוב', 'ישוב'],
  notes: ['comments', 'comment', 'notes', 'note', 'remarks', 'הערות', 'הערה', 'הערות לכתובת'],
  phone: ['phone1', 'phone 1', 'phone', 'mobile', 'tel', 'telephone', 'טלפון', 'נייד', 'פלאפון',
    'מספר טלפון 1', 'מספר טלפון', 'טלפון 1'],
  phone2: ['phone2', 'phone 2', 'second phone', 'alternate phone', 'טלפון 2', 'מספר טלפון 2', 'טלפון נוסף'],
  household_size: ['household size', 'people', 'persons', 'family size', 'מספר נפשות', 'נפשות'],
  latitude: ['latitude', 'lat', 'קו רוחב'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'קו אורך'],
};

/** Fields allowed to collect values from more than one source column. */
const MULTI_VALUE: Target[] = ['notes'];

const FIELD_ORDER: Target[] = [
  'full_name', 'first_name', 'last_name', 'address_line', 'street', 'house_number', 'apartment',
  'floor', 'entrance', 'building_code', 'neighborhood', 'city', 'notes', 'phone', 'phone2',
  'household_size', 'latitude', 'longitude',
];

function normHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[׳״'"״׳.]/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Spreadsheet readers name blank headers __EMPTY, __EMPTY_1, … */
export function isUnnamedHeader(h: string): boolean {
  return /^__EMPTY(_\d+)?$/.test(String(h ?? '').trim()) || String(h ?? '').trim() === '';
}

export function mapHeaders(headers: string[]): { mapping: Map<string, Target>; unknown: string[] } {
  const mapping = new Map<string, Target>();
  const unknown: string[] = [];
  const used = new Set<Target>();
  const claim = (h: string, t: Target) => {
    mapping.set(h, t);
    if (!MULTI_VALUE.includes(t)) used.add(t);
  };

  // Exact synonym match first, so "street number" beats a "street" prefix match.
  const pending: string[] = [];
  for (const header of headers) {
    const n = normHeader(header);
    if (!n || isUnnamedHeader(header)) {
      unknown.push(header);
      continue;
    }
    const exact = FIELD_ORDER.find((f) => !used.has(f) && HEADER_SYNONYMS[f].some((s) => normHeader(s) === n));
    if (exact) claim(header, exact);
    else pending.push(header);
  }

  // Then prefix matches for headers like "קוד כניסה לדלת ראשית".
  for (const header of pending) {
    const n = normHeader(header);
    const prefix = FIELD_ORDER.find(
      (f) => !used.has(f) && HEADER_SYNONYMS[f].some((s) => {
        const ns = normHeader(s);
        return ns.length >= 3 && n.startsWith(ns);
      }),
    );
    if (prefix) claim(header, prefix);
    else unknown.push(header);
  }

  return { mapping, unknown };
}

// ---------------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------------

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

/** Phrases that mean "there is no code" rather than being a code. */
const NO_CODE = /^(אין\s*קוד(\s*(בניין|כניסה|דלת))?|ללא\s*קוד|אין|no\s*code|none|n\/?a|-+)$/i;

export function normalizeBuildingCode(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return NO_CODE.test(s) ? null : s;
}

/**
 * Parse a combined address such as "אודם 7 דירה 9 קומה 2" or "ברקת 25 דירה 2 קומה -3".
 * Used only to fill fields the file did not provide in their own columns.
 */
export function parseAddressLine(value: string): {
  street: string | null;
  house_number: string | null;
  apartment: string | null;
  floor: string | null;
  entrance: string | null;
} {
  const out = { street: null, house_number: null, apartment: null, floor: null, entrance: null } as {
    street: string | null; house_number: string | null; apartment: string | null;
    floor: string | null; entrance: string | null;
  };
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return out;

  const grab = (re: RegExp): string | null => {
    const m = raw.match(re);
    return m ? m[1].trim() : null;
  };
  out.apartment = grab(/(?:דירה|דירה מס'?|apt\.?|apartment)\s*[:.]?\s*(-?\d+[א-ת]?)/i);
  out.floor = grab(/(?:קומה|floor)\s*[:.]?\s*(-?\d+)/i);
  // No \b here: JavaScript word boundaries are ASCII-only and never match after a Hebrew letter.
  out.entrance = grab(/(?:כניסה|entrance)\s*[:.]?\s*([א-ת]|\d+|[A-Za-z])(?=\s|,|$)/i);

  // Street + house number: everything before the first standalone number.
  const head = raw.split(/(?:,|דירה|קומה|כניסה|apt\.?|apartment|floor|entrance)/i)[0].trim();
  const m = head.match(/^(.*?)\s*(\d+[א-ת]?(?:\/\d+)?)\s*$/);
  if (m && m[1].trim()) {
    out.street = m[1].trim();
    out.house_number = m[2].trim();
  } else if (head) {
    out.street = head;
  }
  return out;
}

/** Convert raw sheet records (header → cell) into validated rows. */
export function normalizeRows(raw: Record<string, unknown>[]): ImportResult {
  const headers = raw.length ? Object.keys(raw[0]) : [];
  const { mapping, unknown } = mapHeaders(headers);
  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  let derivedFromAddress = 0;

  const targets = Array.from(new Set(mapping.values()));
  const mappedFields = targets.filter((t) => t !== 'address_line') as string[];

  const hasStreetCols = targets.includes('street') && targets.includes('house_number');
  const hasAddressLine = targets.includes('address_line');
  if (!hasStreetCols && !hasAddressLine) {
    errors.push({
      row: 0,
      message: 'הקובץ חייב לכלול עמודות "רחוב" ו"מספר בית", או עמודת "כתובת" מלאה.',
    });
    return { rows, errors, unknownColumns: unknown, mappedFields, derivedFromAddress };
  }

  const columnsFor = (t: Target): string[] => headers.filter((h) => mapping.get(h) === t);
  const cache = new Map<Target, string[]>();
  const cols = (t: Target): string[] => {
    let c = cache.get(t);
    if (!c) { c = columnsFor(t); cache.set(t, c); }
    return c;
  };

  raw.forEach((rec, idx) => {
    const rowNo = idx + 1;
    if (Object.values(rec).every((v) => v == null || String(v).trim() === '')) return; // blank line

    const one = (t: Target): unknown => {
      for (const h of cols(t)) {
        const v = rec[h];
        if (v != null && String(v).trim() !== '') return v;
      }
      return undefined;
    };
    const joined = (t: Target): string | null => {
      const parts = cols(t).map((h) => str(rec[h])).filter((v): v is string => Boolean(v));
      return parts.length ? Array.from(new Set(parts)).join(' · ') : null;
    };

    let street = str(one('street'));
    let house = str(one('house_number'));
    let apartment = str(one('apartment'));
    let floor = str(one('floor'));
    let entrance = str(one('entrance'));

    // Fall back to the combined address column for anything still missing.
    const addressLine = str(one('address_line'));
    if (addressLine && (!street || !house || !apartment || !floor || !entrance)) {
      const p = parseAddressLine(addressLine);
      let used = false;
      if (!street && p.street) { street = p.street; used = true; }
      if (!house && p.house_number) { house = p.house_number; used = true; }
      if (!apartment && p.apartment) { apartment = p.apartment; used = true; }
      if (!floor && p.floor) { floor = p.floor; used = true; }
      if (!entrance && p.entrance) { entrance = p.entrance; used = true; }
      if (used) derivedFromAddress++;
    }

    const rowErrors: string[] = [];
    if (!street) rowErrors.push('חסר רחוב');
    if (!house) rowErrors.push('חסר מספר בית');

    const lat = num(one('latitude'));
    const lng = num(one('longitude'));
    if (lat === 'invalid' || lng === 'invalid') rowErrors.push('קואורדינטות לא תקינות');
    else if ((lat == null) !== (lng == null)) rowErrors.push('יש למלא גם קו רוחב וגם קו אורך');
    else if (lat != null && (Math.abs(lat) > 90 || Math.abs(lng!) > 180)) rowErrors.push('קואורדינטות מחוץ לטווח');

    if (rowErrors.length) {
      errors.push({ row: rowNo, message: rowErrors.join(', ') });
      return;
    }

    // Household size is soft data: ignore nonsense rather than rejecting the family.
    const sizeRaw = num(one('household_size'));
    const size = typeof sizeRaw === 'number' && Number.isInteger(sizeRaw) && sizeRaw >= 1 && sizeRaw <= 30
      ? sizeRaw
      : null;

    rows.push({
      full_name: str(one('full_name')),
      first_name: str(one('first_name')),
      last_name: str(one('last_name')),
      street: street!,
      house_number: house!,
      apartment,
      floor,
      entrance,
      building_code: normalizeBuildingCode(one('building_code')),
      city: str(one('city')),
      neighborhood: str(one('neighborhood')),
      notes: joined('notes'),
      phone: str(one('phone')),
      phone2: str(one('phone2')),
      household_size: size,
      latitude: lat as number | null,
      longitude: lng as number | null,
    });
  });

  return { rows, errors, unknownColumns: unknown, mappedFields, derivedFromAddress };
}

/** Template mirrors the real-world column set. */
export const IMPORT_TEMPLATE_HEADERS = [
  'Name', 'phone1', 'phone2', 'address', 'comments', 'neighberhood', 'street',
  'street-number', 'entrance', 'apartment', 'floor', 'lobby entrance code',
];
