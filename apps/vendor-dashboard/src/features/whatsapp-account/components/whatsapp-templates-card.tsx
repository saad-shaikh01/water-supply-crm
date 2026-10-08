'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@water-supply-crm/ui';
import type { TemplateItem } from '../api/whatsapp-account.api';
import { useSaveWhatsAppSettings, useSyncWhatsAppTemplates, useWhatsAppTemplates } from '../hooks/use-whatsapp-account';

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  PENDING: { label: 'In review', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  IN_APPEAL: { label: 'In appeal', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  PAUSED: { label: 'Paused', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  DISABLED: { label: 'Disabled', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  NOT_FOUND: { label: 'Not created yet', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300' },
  UNKNOWN: { label: 'Not checked', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400' },
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error('Could not copy — select the text and copy it manually');
        }
      }}
    >
      {done ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />} {label}
    </Button>
  );
}

function TemplateRow({ t }: { t: TemplateItem }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_STYLE[t.status] ?? { label: t.status, className: 'bg-zinc-100 text-zinc-700' };
  const header = t.header.type === 'NONE' ? 'None' : t.header.type === 'TEXT' ? `Text — "${t.header.text}"` : `${t.header.type === 'DOCUMENT' ? 'Document (PDF)' : 'Image'} — upload any sample file`;
  return (
    <div className="rounded-xl border border-border/50">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {t.title} {t.required && <span className="ml-1 text-[10px] font-bold uppercase text-primary">required</span>}
            {t.internal && <span className="ml-1 text-[10px] font-bold uppercase text-muted-foreground">staff</span>}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{t.finalName}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.className}`}>{st.label}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/50 p-4 text-sm">
          <p className="text-xs text-muted-foreground">{t.usedFor}</p>
          {t.rejectedReason && <p className="text-xs font-medium text-destructive">Meta rejected it: {t.rejectedReason}</p>}
          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Name (exact)</dt><dd className="font-mono">{t.finalName}</dd></div>
            <div><dt className="text-muted-foreground">Category / language</dt><dd>Utility · English</dd></div>
            <div><dt className="text-muted-foreground">Header</dt><dd>{header}</dd></div>
          </dl>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Body (copy exactly — line breaks matter)</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-accent/40 p-3 text-xs leading-relaxed">{t.body}</pre>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Variables &amp; sample values (Meta asks for a sample of each)</p>
            <ul className="space-y-0.5 text-xs">
              {t.variables.map((v, i) => (
                <li key={i}><span className="font-mono">{`{{${i + 1}}}`}</span> — {v} · sample: <span className="font-mono">{t.sample[i]}</span></li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={t.finalName} label="Copy name" />
            <CopyButton text={t.body} label="Copy body" />
          </div>
        </div>
      )}
    </div>
  );
}

export function WhatsAppTemplatesCard({ vendorId, canManage }: { vendorId?: string; canManage: boolean }) {
  const { data, isLoading, isError } = useWhatsAppTemplates(vendorId);
  const sync = useSyncWhatsAppTemplates(vendorId);
  const save = useSaveWhatsAppSettings(vendorId);
  const [suffix, setSuffix] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
      </div>
    );
  }
  if (isError || !data) return null;

  const suffixValue = suffix ?? data.templateSuffix ?? '';
  const customer = data.items.filter((i) => !i.internal);
  const staff = data.items.filter((i) => i.internal);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Message templates
          <Badge variant="secondary">
            {data.approvedRequired} of {data.totalRequired} required approved
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          WhatsApp only delivers business messages that use templates approved by Meta. Create each template below in <b>Meta WhatsApp Manager → Message templates</b>
          {' '}with exactly this name and text (the text already carries your business name <b>{data.brand}</b>), wait for approval, then press <b>Refresh status</b>.
          Messages whose template is not approved are skipped (never sent from anyone else&apos;s account).
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          {canManage && data.hasAccount && (
            <Button type="button" variant="outline" size="sm" disabled={sync.isPending || !data.canSync} onClick={() => sync.mutate()}>
              {sync.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />} Refresh status
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {!data.hasAccount
              ? 'Connect your WhatsApp number first to check template status.'
              : !data.canSync
                ? 'Re-enter your credentials including the WhatsApp Business Account ID to read template status.'
                : data.syncedAt
                  ? `Last checked ${new Date(data.syncedAt).toLocaleString()}`
                  : 'Not checked yet'}
          </span>
        </div>

        {data.canEdit && data.hasAccount && (
          <div className="rounded-xl border border-border/50 p-4">
            <Label className="text-sm font-semibold">Template name suffix</Label>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Leave empty unless several brands share ONE WhatsApp Business Account — then each brand after the first adds a short suffix (e.g. <span className="font-mono">lorem</span> →{' '}
              <span className="font-mono">delivery_receipt_lorem</span>) so template names do not collide.
            </p>
            <div className="flex gap-2">
              <Input value={suffixValue} onChange={(e) => setSuffix(e.target.value)} placeholder="(none)" className="h-10 max-w-xs bg-accent/30 border-border/50 font-mono" />
              <Button
                type="button"
                size="sm"
                disabled={save.isPending || suffixValue === (data.templateSuffix ?? '')}
                onClick={() => save.mutate(suffixValue.trim() ? suffixValue.trim().toLowerCase() : null, { onSuccess: () => setSuffix(null) })}
              >
                {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer messages</p>
          {customer.map((t) => <TemplateRow key={t.name} t={t} />)}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Staff messages (optional)</p>
          {staff.map((t) => <TemplateRow key={t.name} t={t} />)}
        </div>
      </CardContent>
    </Card>
  );
}
