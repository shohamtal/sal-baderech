import { Alert, Button, Card, Input } from '@/components/ui';
import { applySuggestion, type GeocodeProgress, type UnresolvedAddress } from '@/lib/geocodeRun';
import { errorMessage } from '@/lib/labels';
import { useState } from 'react';

/** Live progress of a geocoding run, plus approval cards for what it could not resolve. */
export function GeocodePanel({
  progress, running, onStop, onResolved,
}: {
  progress: GeocodeProgress;
  running: boolean;
  onStop: () => void;
  onResolved: (id: string) => void;
}) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const [handled, setHandled] = useState<Record<string, 'approved' | 'skipped'>>({});
  const pending = progress.unresolved.filter((u) => !handled[u.id]);

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-bold">{running ? 'מאתר מיקומים…' : 'איתור מיקומים הסתיים'}</div>
          {running && <Button size="sm" variant="secondary" onClick={onStop}>עצירה</Button>}
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>{progress.done} / {progress.total}</span>
          <span>מדויק: {progress.house}</span>
          <span>ברמת רחוב: {progress.street}</span>
          {progress.failed > 0 && <span className="text-amber-700">דורשות טיפול: {progress.failed}</span>}
        </div>
        {running && (
          <div className="text-xs text-slate-500">
            התהליך משתמש בשירות מפות חינמי ומוגבל לכתובת אחת בשנייה. השאירו את המסך פתוח.
          </div>
        )}
      </Card>

      {pending.length > 0 && (
        <Alert kind="warning">
          {pending.length} כתובות לא נמצאו במפה. הן יובאו ונשמרו כרגיל, אך לא יופיעו במפה עד שתאשרו תיקון.
          שום כתובת לא תשונה ללא אישורכם.
        </Alert>
      )}

      {pending.map((u) => (
        <UnresolvedCard
          key={u.id}
          item={u}
          onApproved={() => { setHandled((h) => ({ ...h, [u.id]: 'approved' })); onResolved(u.id); }}
          onSkipped={() => setHandled((h) => ({ ...h, [u.id]: 'skipped' }))}
        />
      ))}
    </div>
  );
}

function UnresolvedCard({
  item, onApproved, onSkipped,
}: { item: UnresolvedAddress; onApproved: () => void; onSkipped: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  async function approve(streetName: string, lat?: number, lng?: number) {
    setBusy(streetName);
    setError(null);
    try {
      if (lat != null && lng != null) {
        await applySuggestion(item.id, {
          street: streetName, houseNumber: item.house_number,
          latitude: lat, longitude: lng, distance: 0, label: streetName,
        });
      } else {
        // Manual entry: re-geocode the street the manager typed.
        const { geocodeDelivery } = await import('@/lib/geocode');
        const hit = await geocodeDelivery(
          { street: streetName, house_number: item.house_number, city: item.city }, item.city,
        );
        if (!hit) {
          setError('גם הכתובת הזו לא נמצאה במפה. נסו איות אחר.');
          setBusy(null);
          return;
        }
        await applySuggestion(item.id, {
          street: streetName, houseNumber: item.house_number,
          latitude: hit.latitude, longitude: hit.longitude, distance: 0, label: streetName,
        });
      }
      onApproved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3">
      <div>
        <div className="text-xs text-slate-500">כתובת שלא נמצאה</div>
        <div className="text-lg font-bold">{item.street} {item.house_number}</div>
      </div>

      {item.suggestions.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm text-slate-600">האם התכוונתם ל:</div>
          {item.suggestions.map((s) => (
            <div key={s.street} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
              <div>
                <div className="font-semibold">{s.street} {item.house_number}</div>
                <div className="text-xs text-slate-500">
                  {s.label}
                  {s.distance > 0 && ` · הבדל של ${s.distance} תווים`}
                </div>
              </div>
              <Button size="sm" variant="success" loading={busy === s.street}
                onClick={() => approve(s.street, s.latitude, s.longitude)}>
                אישור התיקון
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-500">לא נמצאו הצעות אוטומטיות. הזינו את שם הרחוב הנכון:</div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label className="mb-1 block text-xs text-slate-500">תיקון ידני של שם הרחוב</label>
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={item.street} />
        </div>
        <Button size="sm" variant="secondary" disabled={!manual.trim()} loading={busy === manual}
          onClick={() => approve(manual.trim())}>
          בדיקה ואישור
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkipped}>דילוג</Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
    </Card>
  );
}
