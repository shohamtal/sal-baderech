export type CampaignStatus = 'DRAFT' | 'PUBLISHED' | 'ENDED';
export type VolunteerStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
export type DeliveryStatus = 'AVAILABLE' | 'RESERVED' | 'IN_PROGRESS' | 'DELIVERED' | 'CANCELLED';
export type CorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Organization {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationManager {
  id: string;
  organization_id: string;
  user_id: string | null;
  email: string;
  created_at: string;
}

export interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  city: string | null;
  status: CampaignStatus;
  public_slug: string;
  max_baskets_per_volunteer: number | null;
  created_at: string;
  updated_at: string;
}

export interface Volunteer {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignVolunteer {
  id: string;
  campaign_id: string;
  volunteer_id: string;
  status: VolunteerStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  volunteers?: Volunteer;
}

export interface Delivery {
  id: string;
  campaign_id: string;
  /** Single combined name, as real distribution lists provide it. */
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
  status: DeliveryStatus;
  reserved_by: string | null;
  reserved_at: string | null;
  started_at: string | null;
  delivered_at: string | null;
  delivered_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Limited columns exposed to approved volunteers for AVAILABLE deliveries. */
export interface AvailableDelivery {
  id: string;
  street: string;
  house_number: string;
  city: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Correction {
  id: string;
  delivery_id: string;
  volunteer_id: string;
  field_name: string;
  old_value: string | null;
  proposed_value: string | null;
  comment: string | null;
  status: CorrectionStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  deliveries?: Pick<Delivery, 'id' | 'full_name' | 'first_name' | 'last_name' | 'street' | 'house_number' | 'campaign_id'>;
  volunteers?: Pick<Volunteer, 'id' | 'full_name' | 'phone'>;
}

export interface AuditLog {
  id: number;
  organization_id: string | null;
  campaign_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PublicCampaign {
  campaign_id: string;
  campaign_name: string;
  description: string | null;
  status: CampaignStatus;
  organization_name: string;
  organization_id: string;
  my_status: VolunteerStatus | null;
  my_full_name: string | null;
  my_phone: string | null;
}

export interface MyContext {
  authenticated: boolean;
  user_id?: string;
  is_platform_admin?: boolean;
  manager_org_ids?: string[];
  volunteer?: { id: string; full_name: string; phone: string } | null;
}

export interface CampaignStats {
  total: number;
  available: number;
  reserved: number;
  in_progress: number;
  delivered: number;
  cancelled: number;
  missing_coords: number;
  volunteers_approved: number;
  volunteers_pending: number;
  corrections_pending: number;
}

export const DELIVERY_FIELDS = [
  'full_name', 'first_name', 'last_name', 'street', 'house_number', 'apartment', 'floor',
  'entrance', 'building_code', 'neighborhood', 'city', 'notes', 'phone', 'phone2', 'household_size',
] as const;
export type DeliveryField = (typeof DELIVERY_FIELDS)[number];
