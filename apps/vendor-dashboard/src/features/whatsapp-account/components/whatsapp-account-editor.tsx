'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CheckCircle2, Link2, Loader2, PlugZap, RefreshCw, ShieldAlert, Trash2, Unplug } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import type { WhatsAppAccountStatus } from '../api/whatsapp-account.api';
import {
  useConnectWhatsApp,
  useDisconnectWhatsApp,
  useImportPlatformWhatsApp,
  useLinkWhatsApp,
  usePlatformWhatsAppAccounts,
  useVerifyWhatsApp,
  useWhatsAppAccount,
} from '../hooks/use-whatsapp-account';
import { WhatsAppTemplatesCard } from './whatsapp-templates-card';

const schema = z.object({
  wabaId: z.string().regex(/^\d{5,30}$/, 'Numeric WhatsApp Business Account ID (digits only)'),
  phoneNumberId: z.string().regex(/^\d{5,30}$/, 'Numeric Phone Number ID (digits only) — not the phone number itself'),
  accessToken: z.string().min(20, 'Paste the full access token').max(1000).regex(/^\S+$/, 'The token must not contain spaces'),
  label: z.string().max(80),
});
type FormValues = z.infer<typeof schema>;

const STATUS_LABEL: Record<WhatsAppAccountStatus, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  READY: { text: 'Connected', tone: 'ok' },
  TOKEN_INVALID: { text: 'Access token invalid', tone: 'bad' },
  SUSPENDED: { text: 'Suspended', tone: 'bad' },
  NOT_CONFIGURED: { text: 'Not configured', tone: 'warn' },
};

const toneClass = {
  ok: 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  warn: 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  bad: 'border-red-300/60 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
} as const;

function Banner({ tone, title, children }: { tone: keyof typeof toneClass; title: string; children?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? ShieldAlert : AlertTriangle;
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${toneClass[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-xs opacity-90">{children}</div>}
      </div>
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export function WhatsAppAccountEditor({ vendorId, isSuperAdmin = false }: { vendorId?: string; isSuperAdmin?: boolean }) {
  const canManage = useCan('whatsapp:manage');
  const { data: view, isLoading, isError } = useWhatsAppAccount(vendorId);
  const connect = useConnectWhatsApp(vendorId);
  const verify = useVerifyWhatsApp(vendorId);
  const disconnect = useDisconnectWhatsApp(vendorId);
  const platformAccounts = usePlatformWhatsAppAccounts(isSuperAdmin);
  const link = useLinkWhatsApp(vendorId ?? '');
  const importPlatform = useImportPlatformWhatsApp(vendorId ?? '');
  const [linkId, setLinkId] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { wabaId: '', phoneNumberId: '', accessToken: '', label: '' } });
  const { register, handleSubmit, reset, formState: { errors } } = form;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading WhatsApp settings…
      </div>
    );
  }
  if (isError || !view) return <p className="text-sm text-destructive">Could not load the WhatsApp settings.</p>;

  const acct = view.account;
  const status = acct ? STATUS_LABEL[acct.status] : null;
  const editable = view.canEdit && (canManage || isSuperAdmin);
  const busy = connect.isPending || verify.isPending || disconnect.isPending;

  return (
    <div className="space-y-6">
      {!view.masterEnabled && (
        <Banner tone="bad" title="WhatsApp sending is switched off for the whole platform">
          Nothing is sent to customers until the platform administrator turns it on.
        </Banner>
      )}

      {/* Current state */}
      {acct ? (
        <Banner tone={status!.tone} title={`${status!.text}${acct.displayNumber ? ` — ${acct.displayNumber}` : ''}`}>
          {acct.status === 'READY' && <>Customer messages for this business are sent from this number.</>}
          {acct.status === 'TOKEN_INVALID' && <>WhatsApp no longer accepts the saved access token. Paste a new one below — until then no messages are sent from this number.</>}
          {acct.lastHealthError && acct.status !== 'READY' && <p className="mt-1">Last error: {acct.lastHealthError}</p>}
        </Banner>
      ) : view.sending.via === 'PLATFORM' ? (
        <Banner tone="warn" title="Using the platform's shared WhatsApp number">
          This business has no WhatsApp number of its own yet. Connect yours below so customers see your name and number.
        </Banner>
      ) : (
        <Banner tone="warn" title="WhatsApp is not connected">
          Customer messages (receipts, statements, reminders) are <b>not sent</b> until you connect your own WhatsApp Business number.
        </Banner>
      )}

      {acct && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Sender details {status && <Badge variant="secondary">{status.text}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Display number</dt><dd className="font-mono">{acct.displayNumber ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Verified business name</dt><dd>{acct.verifiedName ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Phone Number ID</dt><dd className="font-mono">{acct.phoneNumberId ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">WhatsApp Business Account ID</dt><dd className="font-mono">{acct.wabaId ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Quality rating</dt><dd>{acct.qualityRating ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Last checked</dt><dd>{fmt(acct.lastHealthCheckAt)}</dd></div>
            </dl>
            {acct.sharedCount > 0 && (
              <p className="rounded-lg bg-accent/40 p-3 text-xs text-muted-foreground">
                This number is shared with {acct.sharedCount} other brand{acct.sharedCount > 1 ? 's' : ''}
                {isSuperAdmin && acct.sharedWith.length > 0 ? `: ${acct.sharedWith.map((v) => v.name).join(', ')}` : ''}.
                {!isSuperAdmin && ' Only the platform administrator can change it.'}
              </p>
            )}
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => verify.mutate()}>
                  {verify.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />} Verify connection
                </Button>
                {!confirmDisconnect ? (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
                    <Unplug className="mr-1.5 h-3.5 w-3.5" /> Disconnect
                  </Button>
                ) : (
                  <span className="flex items-center gap-2 text-xs">
                    Customer messages will stop. Sure?
                    <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => { disconnect.mutate(); setConfirmDisconnect(false); }}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Yes, disconnect
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connect / replace credentials */}
      {editable && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="h-4 w-4 text-muted-foreground" /> {acct ? 'Replace credentials' : 'Connect your WhatsApp Business number'}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Create a <b>System User</b> in your Meta Business Manager, give it access to your WhatsApp Business Account, and generate a permanent access token.
              We verify the details with WhatsApp before saving. The token is stored encrypted and is never shown again.
            </p>
          </CardHeader>
          <CardContent>
            {!view.keyConfigured && (
              <div className="mb-4">
                <Banner tone="bad" title="This server cannot store WhatsApp credentials yet">
                  The platform administrator must configure the encryption key (WHATSAPP_TOKEN_KEY) first.
                </Banner>
              </div>
            )}
            <form
              onSubmit={handleSubmit((v) =>
                connect.mutate({ wabaId: v.wabaId, phoneNumberId: v.phoneNumberId, accessToken: v.accessToken, ...(v.label.trim() ? { label: v.label.trim() } : {}) }, { onSuccess: () => reset() }),
              )}
              className="grid gap-5 sm:grid-cols-2"
              autoComplete="off"
            >
              <Field label="WhatsApp Business Account ID" error={errors.wabaId?.message} hint="Meta Business Manager → WhatsApp accounts.">
                <Input className="h-11 bg-accent/30 border-border/50 font-mono" inputMode="numeric" {...register('wabaId')} />
              </Field>
              <Field label="Phone Number ID" error={errors.phoneNumberId?.message} hint="WhatsApp Manager → Phone numbers (the ID, not the number).">
                <Input className="h-11 bg-accent/30 border-border/50 font-mono" inputMode="numeric" {...register('phoneNumberId')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Permanent access token" error={errors.accessToken?.message}>
                  <Input type="password" autoComplete="new-password" className="h-11 bg-accent/30 border-border/50 font-mono" {...register('accessToken')} />
                </Field>
              </div>
              <Field label="Label (optional)" error={errors.label?.message} hint="Only used inside this app.">
                <Input className="h-11 bg-accent/30 border-border/50" {...register('label')} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !view.keyConfigured} className="sm:min-w-44">
                  {connect.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1.5 h-4 w-4" />} Verify &amp; save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Message templates the business must have approved on its own WhatsApp account */}
      <WhatsAppTemplatesCard vendorId={vendorId} canManage={canManage || isSuperAdmin} />

      {/* Platform administrator tools */}
      {isSuperAdmin && vendorId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-muted-foreground" /> Platform administrator
            </CardTitle>
            <p className="text-sm text-muted-foreground">Share one WhatsApp number between sister brands owned by the same company, or adopt the platform credentials for this vendor.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                aria-label="Existing WhatsApp account"
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
                className="h-11 w-full rounded-md border border-border/50 bg-accent/30 px-3 text-sm sm:max-w-md"
              >
                <option value="">{platformAccounts.isLoading ? 'Loading…' : 'Use an existing WhatsApp number…'}</option>
                {(platformAccounts.data ?? [])
                  .filter((a) => a.id !== acct?.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.displayNumber ?? a.phoneNumberId} ({a.vendors.map((v) => v.name).join(', ') || 'unused'})
                    </option>
                  ))}
              </select>
              <Button type="button" variant="outline" disabled={!linkId || link.isPending} onClick={() => link.mutate(linkId, { onSuccess: () => setLinkId('') })}>
                {link.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />} Link
              </Button>
            </div>
            {view.platformCredentials && !acct && (
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" disabled={importPlatform.isPending || !view.keyConfigured} onClick={() => importPlatform.mutate()}>
                  {importPlatform.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1.5 h-4 w-4" />} Use the platform credentials for this vendor
                </Button>
                <span className="text-[11px] text-muted-foreground">Copies the server&apos;s current WhatsApp credentials into this vendor&apos;s own (encrypted) account.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
