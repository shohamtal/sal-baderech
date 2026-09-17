import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/** Read a CSV / XLSX / XLS file in the browser into header→cell records. */
export async function readImportFile(file: File): Promise<Record<string, unknown>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(text.replace(/^﻿/, ''), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });
    if (parsed.errors.length && !parsed.data.length) {
      throw new Error(parsed.errors[0].message);
    }
    return parsed.data;
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
}

export function downloadTemplateCsv(headers: string[]): void {
  const csv = '﻿' + headers.join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sal-baderech-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
