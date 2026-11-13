'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea } from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { NativeSelect } from '../../observability/components/native-select';
import { useVendorSearch } from '../../vendor-picker/vendor-picker';
import { apiErrorMessage } from '../../../lib/api-error';
import { announcementsApi, type Announcement } from '../api/announcements.api';
import { useActiveVendorCount, useCreateAnnouncement, useSendAnnouncement, useUpdateAnnouncement } from '../hooks/use-announcements';
import { isoToPktInput, previewTitle, severityVariant } from '../lib/announcements';
import { toAnnouncementInput, validateComposer, type ComposerErrors, type ComposerIntent, type ComposerValues } from '../lib/composer';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/query-keys';

const EMPTY: ComposerValues = { title: '', body: '', severity: 'INFO', audience: 'ALL_VENDORS', vendors: [], scheduledFor: '' };

function fromAnnouncement(a: Announcement): ComposerValues {
  return {
    title: a.title,
    body: a.body,
    severity: a.severity,
    audience: a.audience,
    vendors: (a.vendors ?? []).map((x) => ({ id: x.vendor.id, name: x.vendor.name })),
    scheduledFor: isoToPktInput(a.scheduledFor),
  };
}

function VendorMultiSelect({ selected, onChange, error }: { selected: { id: string; name: string }[]; onChange: (v: { id: string; name: string }[]) => void; error?: string }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const vendors = useVendorSearch(q);
  const ids = new Set(selected.map((s) => s.id));
  const toggle = (v: { id: string; name: string }) => onChange(ids.has(v.id) ? selected.filter((s) => s.id !== v.id) : [...selected, v]);

  return (
    <div className="space-y-2" data-testid="vendor-multiselect">
      <Input aria-label="Search target vendors" placeholder="Search vendors" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
        {vendors.isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
        {vendors.data?.length === 0 && <p className="text-xs text-muted-foreground">No vendors found.</p>}
        {(vendors.data ?? []).map((v) => (
          <label key={v.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ids.has(v.id)} onChange={() => toggle(v)} aria-label={`Target ${v.name}`} />
            {v.name}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Selected vendors">
        {selected.map((s) => (
          <Badge key={s.id} variant="secondary" className="gap-1">
            {s.name}
            <button type="button" aria-label={`Remove ${s.name}`} onClick={() => toggle(s)}>
              x
            </button>
          </Badge>
        ))}
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  /** Existing DRAFT/SCHEDULED announcement being edited (full record with vendors), or null for a new one. */
  announcement: Announcement | null;
  onClose: () => void;
}

export function ComposerDialog({ open, announcement, onClose }: Props) {
  const qc = useQueryClient();
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const send = useSendAnnouncement();
  const [v, setV] = useState<ComposerValues>(EMPTY);
  const [errors, setErrors] = useState<ComposerErrors>({});
  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);
  const count = useActiveVendorCount(open && v.audience === 'ALL_VENDORS');

  useEffect(() => {
    if (open) {
      setV(announcement ? fromAnnouncement(announcement) : EMPTY);
      setErrors({});
      setConfirmSend(false);
    }
  }, [open, announcement]);

  const set = <K extends keyof ComposerValues>(k: K, val: ComposerValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const pending = create.isPending || update.isPending || send.isPending || sending;

  const validate = (intent: ComposerIntent) => {
    const e = validateComposer(v, intent);
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = (intent: ComposerIntent) => {
    if (!validate(intent)) return;
    const body = toAnnouncementInput(v, intent, !!announcement);
    if (announcement) update.mutate({ id: announcement.id, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  // Send now: persist (create or update) then trigger send; the list refreshes either way.
  const sendNow = async () => {
    setSending(true);
    try {
      const body = toAnnouncementInput(v, 'send', !!announcement);
      const saved = announcement ? await announcementsApi.update(announcement.id, body) : await announcementsApi.create(body);
      await announcementsApi.send(saved.id);
      toast.success('Announcement is being sent');
      setConfirmSend(false);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Failed to send announcement'));
      setConfirmSend(false);
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: queryKeys.announcements.all });
    }
  };

  const recipients = v.audience === 'ALL_VENDORS' ? (count.data !== undefined ? `all ${count.data} active vendors` : 'all active vendors') : `${v.vendors.length} selected vendor(s)`;

  return (
    <>
      <Dialog open={open && !confirmSend} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{announcement ? 'Edit announcement' : 'New announcement'}</DialogTitle>
            <DialogDescription>Delivered to vendor admins through the in-app notification bell. Times are Pakistan time (PKT).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="ann-title">Title</Label>
                <Input id="ann-title" value={v.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!errors.title} />
                <div className="flex justify-between text-xs">
                  <span className="text-destructive" role={errors.title ? 'alert' : undefined}>
                    {errors.title}
                  </span>
                  <span className="text-muted-foreground">{v.title.length}/120</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ann-body">Message</Label>
                <Textarea id="ann-body" rows={5} value={v.body} onChange={(e) => set('body', e.target.value)} aria-invalid={!!errors.body} />
                <div className="flex justify-between text-xs">
                  <span className="text-destructive" role={errors.body ? 'alert' : undefined}>
                    {errors.body}
                  </span>
                  <span className="text-muted-foreground">{v.body.length}/2000</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ann-severity">Severity</Label>
                  <NativeSelect id="ann-severity" value={v.severity} onChange={(e) => set('severity', e.target.value as ComposerValues['severity'])}>
                    <option value="INFO">Info</option>
                    <option value="IMPORTANT">Important</option>
                    <option value="CRITICAL">Critical</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ann-audience">Audience</Label>
                  <NativeSelect id="ann-audience" value={v.audience} onChange={(e) => set('audience', e.target.value as ComposerValues['audience'])}>
                    <option value="ALL_VENDORS">All vendors</option>
                    <option value="SELECTED_VENDORS">Selected vendors</option>
                  </NativeSelect>
                </div>
              </div>
              {v.audience === 'SELECTED_VENDORS' && <VendorMultiSelect selected={v.vendors} onChange={(x) => set('vendors', x)} error={errors.vendors} />}
              <div className="space-y-1">
                <Label htmlFor="ann-schedule">Schedule for (PKT, optional)</Label>
                <Input id="ann-schedule" type="datetime-local" value={v.scheduledFor} onChange={(e) => set('scheduledFor', e.target.value)} aria-invalid={!!errors.scheduledFor} />
                {errors.scheduledFor && (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.scheduledFor}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2" data-testid="ann-preview">
              <p className="text-xs font-medium uppercase text-muted-foreground">Preview (vendor bell)</p>
              <div className="rounded-md border bg-card p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant={severityVariant[v.severity]}>{v.severity}</Badge>
                  <span className="text-sm font-medium">{previewTitle(v.severity, v.title || 'Title')}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{v.body || 'Your message appears here.'}</p>
              </div>
              <p className="text-xs text-muted-foreground">Recipients: {recipients}.</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => save('draft')}>
              Save draft
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => save('schedule')}>
              Schedule
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if (validate('send')) setConfirmSend(true);
              }}
            >
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={open && confirmSend}
        onOpenChange={(o) => !o && setConfirmSend(false)}
        title="Send announcement now?"
        description={`"${v.title}" will be delivered immediately to ${recipients}. This cannot be undone.`}
        confirmLabel="Send now"
        isPending={sending}
        onConfirm={sendNow}
      />
    </>
  );
}
