import type { CampaignStatus, CorrectionStatus, DeliveryField, DeliveryStatus, VolunteerStatus } from './types';

export const campaignStatusLabel: Record<CampaignStatus, string> = {
  DRAFT: 'טיוטה',
  PUBLISHED: 'פורסם',
  ENDED: 'הסתיים',
};

/** Shown next to the status selector so the choice is unambiguous. */
export const campaignStatusHint: Record<CampaignStatus, string> = {
  DRAFT: 'הקישור הציבורי אינו פעיל. רק מנהלי הארגון רואים את הקמפיין.',
  PUBLISHED: 'מתנדבים יכולים להירשם, לקחת סלים ולחלק.',
  ENDED: 'הקמפיין נסגר. אי אפשר להירשם או לקחת סלים חדשים.',
};

export const volunteerStatusLabel: Record<VolunteerStatus, string> = {
  PENDING: 'ממתין לאישור',
  APPROVED: 'מאושר',
  REJECTED: 'נדחה',
  REVOKED: 'הרשאה בוטלה',
};

export const deliveryStatusLabel: Record<DeliveryStatus, string> = {
  AVAILABLE: 'פנוי',
  RESERVED: 'שמור',
  IN_PROGRESS: 'בדרך',
  DELIVERED: 'נמסר',
  CANCELLED: 'בוטל',
};

export const correctionStatusLabel: Record<CorrectionStatus, string> = {
  PENDING: 'ממתין',
  APPROVED: 'אושר',
  REJECTED: 'נדחה',
};

export const deliveryFieldLabel: Record<DeliveryField, string> = {
  full_name: 'שם',
  first_name: 'שם פרטי',
  last_name: 'שם משפחה',
  street: 'רחוב',
  house_number: 'מספר בית',
  apartment: 'דירה',
  floor: 'קומה',
  entrance: 'כניסה',
  building_code: 'קוד בניין',
  neighborhood: 'שכונה',
  city: 'עיר',
  notes: 'הערות',
  phone: 'טלפון',
  phone2: 'טלפון נוסף',
  household_size: 'מספר נפשות',
};

export const auditActionLabel: Record<string, string> = {
  CAMPAIGN_CREATED: 'קמפיין נוצר',
  CAMPAIGN_UPDATED: 'קמפיין עודכן',
  DELIVERIES_IMPORTED: 'ייבוא נמענים',
  DELIVERY_CREATED: 'משלוח נוסף',
  DELIVERY_UPDATED: 'משלוח עודכן על ידי מנהל',
  DELIVERY_DELETED: 'משלוח נמחק',
  VOLUNTEER_REGISTERED: 'מתנדב נרשם',
  VOLUNTEER_APPROVED: 'מתנדב אושר',
  VOLUNTEER_REJECTED: 'מתנדב נדחה',
  VOLUNTEER_REVOKED: 'הרשאת מתנדב בוטלה',
  DELIVERIES_CLAIMED: 'משלוחים נתפסו',
  DELIVERIES_RELEASED: 'משלוחים שוחררו',
  DELIVERY_DELIVERED: 'משלוח נמסר',
  CORRECTION_SUBMITTED: 'בקשת תיקון הוגשה',
  CORRECTION_APPROVED: 'בקשת תיקון אושרה',
  CORRECTION_REJECTED: 'בקשת תיקון נדחתה',
};

/** Map Postgres/RPC error messages to Hebrew. */
export function errorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? String(err);
  const map: Record<string, string> = {
    CLAIM_CONFLICT: 'חלק מהמשלוחים נתפסו כבר על ידי מתנדב אחר. נסו הצעה אחרת.',
    FORBIDDEN: 'אין לך הרשאה לפעולה זו.',
    NOT_AUTHENTICATED: 'יש להתחבר מחדש.',
    CAMPAIGN_NOT_FOUND: 'הקמפיין לא נמצא.',
    CAMPAIGN_NOT_OPEN: 'הקמפיין אינו פתוח כעת.',
    CAMPAIGN_NOT_FOUND_DRAFT: 'הקמפיין עדיין לא פורסם.',
    INVALID_NAME: 'יש להזין שם מלא (2 עד 80 תווים).',
    INVALID_PHONE: 'מספר הטלפון אינו תקין.',
    INVALID_STATUS: 'סטטוס לא תקין.',
    INVALID_STATE: 'לא ניתן לבצע את הפעולה במצב הנוכחי.',
    INVALID_FIELD: 'שדה לא תקין.',
    INVALID_REQUEST: 'בקשה לא תקינה.',
    ALREADY_REVIEWED: 'הבקשה כבר נבדקה.',
    LIMIT_EXCEEDED: 'הגעת למספר הסלים המרבי שמאפשר הארגון.',
    NOT_FOUND: 'הפריט לא נמצא.',
    'Invalid login credentials': 'אימייל או סיסמה שגויים.',
    'Email not confirmed': 'יש לאשר את כתובת האימייל לפני ההתחברות.',
    'User already registered': 'משתמש עם אימייל זה כבר קיים.',
    'Anonymous sign-ins are disabled': 'הרשמה אנונימית אינה מופעלת בפרויקט Supabase. יש להפעיל אותה בהגדרות.',
  };
  for (const key of Object.keys(map)) {
    if (raw.includes(key)) return map[key];
  }
  if (raw.includes('row-level security')) return 'אין לך הרשאה לפעולה זו.';
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט.';
  return raw;
}
