import type { Delivery } from './types';

export function fullName(d: Pick<Delivery, 'first_name' | 'last_name'>): string {
  const n = [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
  return n ? `משפחת ${n}` : 'נמען ללא שם';
}

export function addressLine(d: Pick<Delivery, 'street' | 'house_number' | 'city'>, fallbackCity?: string | null): string {
  const city = d.city ?? fallbackCity ?? null;
  return `${d.street} ${d.house_number}${city ? `, ${city}` : ''}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return p;
}
