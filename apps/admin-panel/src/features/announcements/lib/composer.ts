import type { AnnouncementAudience, AnnouncementInput, AnnouncementSeverity } from '../api/announcements.api';
import { isFuturePkt, pktInputToIso } from './announcements';

export interface ComposerValues {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  vendors: { id: string; name: string }[];
  /** `YYYY-MM-DDTHH:mm` in PKT, '' when not scheduled */
  scheduledFor: string;
}

export type ComposerIntent = 'draft' | 'schedule' | 'send';
export type ComposerErrors = Partial<Record<'title' | 'body' | 'vendors' | 'scheduledFor', string>>;

export function validateComposer(v: ComposerValues, intent: ComposerIntent, now = Date.now()): ComposerErrors {
  const e: ComposerErrors = {};
  if (!v.title.trim()) e.title = 'Title is required';
  else if (v.title.length > 120) e.title = 'Title must be at most 120 characters';
  if (!v.body.trim()) e.body = 'Message is required';
  else if (v.body.length > 2000) e.body = 'Message must be at most 2000 characters';
  if (v.audience === 'SELECTED_VENDORS' && v.vendors.length === 0) e.vendors = 'Select at least one vendor';
  if (intent === 'schedule') {
    if (!v.scheduledFor) e.scheduledFor = 'Pick a date and time to schedule';
    else if (!isFuturePkt(v.scheduledFor, now)) e.scheduledFor = 'Schedule time must be in the future';
  }
  return e;
}

/** `draft`/`send` never carry a schedule; `schedule` carries the PKT time as an ISO instant. */
export function toAnnouncementInput(v: ComposerValues, intent: ComposerIntent, editing: boolean): AnnouncementInput {
  return {
    title: v.title.trim(),
    body: v.body.trim(),
    severity: v.severity,
    audience: v.audience,
    vendorIds: v.audience === 'SELECTED_VENDORS' ? v.vendors.map((x) => x.id) : [],
    ...(intent === 'schedule' ? { scheduledFor: pktInputToIso(v.scheduledFor) } : editing ? { scheduledFor: null } : {}),
  };
}
