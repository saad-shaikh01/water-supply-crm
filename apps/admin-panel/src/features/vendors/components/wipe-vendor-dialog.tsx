'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { useSuspendVendor, useWipePreview, useWipeVendor } from '../hooks/use-vendors';

interface Props {
  vendor: { id: string; name: string; slug: string; isActive?: boolean } | null;
  onOpenChange: (open: boolean) => void;
}

/** Humanise a Prisma model name: "DailySheetItem" -> "Daily Sheet Item". */
const label = (model: string) => model.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/**
 * Super-admin "Wipe vendor data". Nothing is removed until: the vendor is suspended, the preview was
 * read, its slug is typed, the super admin's password is entered and the backup box is ticked.
 */
export function WipeVendorDialog({ vendor, onOpenChange }: Props) {
  const open = !!vendor;
  const preview = useWipePreview(vendor?.id ?? null, open);
  const suspend = useSuspendVendor();
  const wipe = useWipeVendor();

  const [slug, setSlug] = useState('');
  const [password, setPassword] = useState('');
  const [backup, setBackup] = useState(false);

  const resetWipe = wipe.reset;
  useEffect(() => {
    if (!open) {
      setSlug('');
      setPassword('');
      setBackup(false);
      resetWipe();
    }
  }, [open, resetWipe]);

  const data = preview.data;
  const blockers = data?.blockers ?? [];
  const notSuspended = blockers.some((b) => b.code === 'NOT_SUSPENDED');
  const hardBlockers = blockers.filter((b) => b.code !== 'NOT_SUSPENDED');
  const slugOk = !!vendor && slug.trim() === vendor.slug;
  const canWipe = !!data?.allowed && slugOk && password.length > 0 && backup && !wipe.isPending;

  const submit = () => {
    if (!vendor || !data) return;
    wipe.mutate(
      { id: vendor.id, confirmSlug: slug.trim(), password, acknowledgeBackup: backup, previewToken: data.previewToken },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !wipe.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Wipe all data of {vendor?.name}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          This permanently removes <strong>every customer, delivery, transaction, expense, payroll and fleet record</strong> of this vendor, and every
          user except the vendor admin, so it can be set up again from scratch. It cannot be undone — only restored from a database backup.
        </p>

        {preview.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Counting what would be removed…
          </div>
        )}
        {preview.isError && <p className="text-sm text-destructive">Could not load the preview: {preview.errorMessage}</p>}

        {data && (
          <div className="space-y-4">
            {hardBlockers.map((b) => (
              <div key={b.code} className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{b.message}</div>
            ))}

            {notSuspended && hardBlockers.length === 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-center justify-between gap-3">
                <span>The vendor is active. Suspend it first, so nobody can write data while it is being removed.</span>
                <Button size="sm" variant="outline" disabled={suspend.isPending} onClick={() => vendor && suspend.mutate(vendor.id, { onSuccess: () => preview.refetch() })}>
                  {suspend.isPending ? 'Suspending…' : 'Suspend vendor'}
                </Button>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold">What will be removed</p>
                <Badge variant="secondary">{data.totalRows.toLocaleString()} rows in {data.tables.length} tables</Badge>
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border divide-y text-sm">
                {data.tables.length === 0 && <p className="p-3 text-muted-foreground">Nothing to remove — this vendor has no data.</p>}
                {data.tables.map((t) => (
                  <div key={t.model} className="flex items-center justify-between px-3 py-1.5">
                    <span>{label(t.model)}</span>
                    <span className="font-mono tabular-nums">{t.rows.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold mb-1">What stays</p>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                {data.keeps.map((k) => <li key={k}>{k}</li>)}
              </ul>
            </div>

            {data.allowed && (
              <div className="space-y-3 rounded-lg border p-4">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 mt-0.5" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
                  <span>I have taken a <strong>fresh database backup</strong> (for example <code>bash deploy/backup-db.sh &lt;tenant&gt;</code>) and checked it.</span>
                </label>
                <div className="space-y-1.5">
                  <Label>Type the vendor slug <code className="font-mono">{vendor?.slug}</code> to confirm</Label>
                  <Input autoComplete="off" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={vendor?.slug} />
                </div>
                <div className="space-y-1.5">
                  <Label>Your (super admin) password</Label>
                  <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </div>
            )}

            {wipe.errorMessage && <p className="text-sm text-destructive">{wipe.errorMessage}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={wipe.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!canWipe} onClick={submit}>
            {wipe.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Removing data…</> : 'Wipe all data'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
