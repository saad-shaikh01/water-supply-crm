import type { AnnouncementSeverity, AnnouncementStatus } from '../api/announcements.api';

/** Scheduling is entered in Pakistan time (UTC+5, no DST). `YYYY-MM-DDTHH:mm` -> ISO. */
export const pktInputToIso = (v: string): string => new Date(`${v}:00+05:00`).toISOString();

/** ISO -> `YYYY-MM-DDTHH:mm` in PKT for a datetime-local input. */
export function isoToPktInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export const fmtPkt = (iso: string | null | undefined) =>
  iso
    ? `${new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} PKT`
    : '-';

export const isFuturePkt = (v: string, now = Date.now()) => !!v && new Date(`${v}:00+05:00`).getTime() > now;

export const EDITABLE: AnnouncementStatus[] = ['DRAFT', 'SCHEDULED'];

export const statusVariant: Record<AnnouncementStatus, 'outline' | 'info' | 'warning' | 'success' | 'secondary' | 'destructive'> = {
  DRAFT: 'outline',
  SCHEDULED: 'info',
  SENDING: 'warning',
  SENT: 'success',
  CANCELLED: 'secondary',
  FAILED: 'destructive',
};

export const severityVariant: Record<AnnouncementSeverity, 'info' | 'warning' | 'destructive'> = {
  INFO: 'info',
  IMPORTANT: 'warning',
  CRITICAL: 'destructive',
};

/** Same prefixing the dispatcher applies to the in-app notification title. */
export const previewTitle = (severity: AnnouncementSeverity, title: string) =>
  severity === 'IMPORTANT' ? `[Important] ${title}` : severity === 'CRITICAL' ? `[Critical] ${title}` : title;

export const readRatePct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;
