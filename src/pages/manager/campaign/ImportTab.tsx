import { Alert, Button, Card } from '@/components/ui';
import { IMPORT_TEMPLATE_HEADERS, normalizeRows, type ImportResult } from '@/lib/import/parseImport';
import { downloadTemplateCsv, readImportFile } from '@/lib/import/readImportFile';
import { deliveryFieldLabel, errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { DeliveryField } from '@/lib/types';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCampaign } from '../CampaignManage';

export default function ImportTab() {
  const { campaign } = useCampaign();
  const navigate = useNavigate();
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    setResult(null);
    setDone(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const raw = await readImportFile(file);
      setResult(normalizeRows(raw));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function confirmImport() {
    if (!result?.rows.length) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('import_deliveries', { p_campaign_id: campaign.id, p_rows: result.rows });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setDone(data as number);
    setResult(null);
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-bold">ייבוא נמענים מקובץ</h2>
        <p className="mb-3 text-sm text-slate-500">
          קובץ CSV או Excel עם עמודות: {IMPORT_TEMPLATE_HEADERS.join(', ')}. חובה: רחוב ומספר בית. קואורדינטות אופציונליות.
          כותרות באנגלית (First Name, Street, House Number…) נתמכות גם כן.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800">
            בחירת קובץ
            <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <Button variant="ghost" size="sm" onClick={() => downloadTemplateCsv(IMPORT_TEMPLATE_HEADERS)}>הורדת תבנית CSV</Button>
          {fileName && <span className="text-sm text-slate-500">{fileName}</span>}
        </div>
      </Card>

      {error && <Alert kind="error">{error}</Alert>}
      {done != null && (
        <Alert kind="success">
          יובאו {done} משלוחים בהצלחה.{' '}
          <button type="button" className="underline" onClick={() => navigate(`/m/${campaign.id}/deliveries`)}>למשלוחים</button>
        </Alert>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card><div className="text-sm text-slate-500">שורות תקינות</div><div className="text-3xl font-bold text-emerald-700">{result.rows.length}</div></Card>
            <Card><div className="text-sm text-slate-500">שורות עם שגיאות</div><div className="text-3xl font-bold text-red-700">{result.errors.length}</div></Card>
          </div>

          {result.unknownColumns.length > 0 && (
            <Alert kind="warning">עמודות שלא זוהו ולא ייובאו: {result.unknownColumns.join(', ')}</Alert>
          )}
          <div className="text-sm text-slate-500">
            עמודות שזוהו: {result.mappedFields.map((f) => deliveryFieldLabel[f as DeliveryField] ?? f).join(', ')}
          </div>

          {result.errors.length > 0 && (
            <Card>
              <h3 className="mb-2 font-bold text-red-700">שגיאות ({result.errors.length}) — שורות אלו לא ייובאו</h3>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {result.errors.map((e, i) => (
                  <li key={i}>{e.row === 0 ? e.message : `שורה ${e.row}: ${e.message}`}</li>
                ))}
              </ul>
            </Card>
          )}

          {result.rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-right text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-2">#</th>
                      <th className="px-2 py-2">שם</th>
                      <th className="px-2 py-2">כתובת</th>
                      <th className="px-2 py-2">דירה</th>
                      <th className="px-2 py-2">קומה</th>
                      <th className="px-2 py-2">כניסה</th>
                      <th className="px-2 py-2">קוד</th>
                      <th className="px-2 py-2">מיקום</th>
                      <th className="px-2 py-2">הערות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-1">{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
                        <td className="px-2 py-1">{r.street} {r.house_number}{r.city ? `, ${r.city}` : ''}</td>
                        <td className="px-2 py-1">{r.apartment}</td>
                        <td className="px-2 py-1">{r.floor}</td>
                        <td className="px-2 py-1">{r.entrance}</td>
                        <td className="px-2 py-1">{r.building_code}</td>
                        <td className="px-2 py-1">{r.latitude != null ? '✓' : '—'}</td>
                        <td className="max-w-[12rem] truncate px-2 py-1">{r.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length > 50 && <div className="px-3 py-2 text-xs text-slate-500">מוצגות 50 השורות הראשונות מתוך {result.rows.length}</div>}
              </div>
              <Alert kind={result.errors.length ? 'warning' : 'info'}>
                {result.errors.length
                  ? `ייובאו ${result.rows.length} שורות תקינות בלבד. ${result.errors.length} שורות עם שגיאות יידלגו — תקנו את הקובץ וייבאו אותן בנפרד.`
                  : `כל ${result.rows.length} השורות תקינות.`}
              </Alert>
              <Button size="lg" className="w-full" loading={busy} onClick={confirmImport}>
                אישור וייבוא {result.rows.length} משלוחים
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
