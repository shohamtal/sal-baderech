import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedWorkbook {
  /** Sheet names, in file order. Empty for CSV. */
  sheetNames: string[];
  /** Header→cell records for one sheet (name ignored for CSV). */
  rowsFor: (sheetName?: string) => Record<string, unknown>[];
}

/**
 * Read a CSV / XLSX / XLS file once. The workbook is kept in memory so the
 * manager can switch sheets without re-reading the file.
 */
export async function readImportFile(file: File): Promise<ParsedWorkbook> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    const text = (await file.text()).replace(/^﻿/, '');
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });
    if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    const rows = parsed.data;
    return { sheetNames: [], rowsFor: () => rows };
  }

  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return {
    sheetNames: wb.SheetNames.slice(),
    rowsFor: (sheetName?: string) => {
      const target = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
      const sheet = target ? wb.Sheets[target] : undefined;
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', blankrows: false });
    },
  };
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
