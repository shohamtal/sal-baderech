import { campaignStatusLabel, correctionStatusLabel, deliveryStatusLabel, volunteerStatusLabel } from '@/lib/labels';
import type { CampaignStatus, CorrectionStatus, DeliveryStatus, VolunteerStatus } from '@/lib/types';
import { Badge } from './ui';

export const deliveryStatusColor: Record<DeliveryStatus, string> = {
  AVAILABLE: 'slate',
  RESERVED: 'blue',
  IN_PROGRESS: 'amber',
  DELIVERED: 'green',
  CANCELLED: 'red',
};

/** Hex colors for map markers. */
export const deliveryStatusHex: Record<DeliveryStatus, string> = {
  AVAILABLE: '#64748b',
  RESERVED: '#0284c7',
  IN_PROGRESS: '#d97706',
  DELIVERED: '#059669',
  CANCELLED: '#dc2626',
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge color={deliveryStatusColor[status]}>{deliveryStatusLabel[status]}</Badge>;
}

export function VolunteerStatusBadge({ status }: { status: VolunteerStatus }) {
  const color: Record<VolunteerStatus, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', REVOKED: 'red' };
  return <Badge color={color[status]}>{volunteerStatusLabel[status]}</Badge>;
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const color: Record<CampaignStatus, string> = { DRAFT: 'slate', PUBLISHED: 'green', ENDED: 'purple' };
  return <Badge color={color[status]}>{campaignStatusLabel[status]}</Badge>;
}

export function CorrectionStatusBadge({ status }: { status: CorrectionStatus }) {
  const color: Record<CorrectionStatus, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red' };
  return <Badge color={color[status]}>{correctionStatusLabel[status]}</Badge>;
}
