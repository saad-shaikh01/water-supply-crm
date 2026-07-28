import type { BadgeProps } from '@water-supply-crm/ui';

/** Single source of truth for ticket status/priority badge colors — previously
 * duplicated verbatim between support/page.tsx and ticket-detail-dialog.tsx. */
export const TICKET_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  OPEN: 'warning',
  IN_PROGRESS: 'info',
  RESOLVED: 'success',
  CLOSED: 'secondary',
};

export const TICKET_PRIORITY_VARIANT: Record<string, BadgeProps['variant']> = {
  LOW: 'secondary',
  NORMAL: 'info',
  HIGH: 'warning',
  URGENT: 'destructive',
};

export const TICKET_TYPE_VARIANT: Record<string, BadgeProps['variant']> = {
  COMPLAINT: 'destructive',
  FEEDBACK: 'success',
};
