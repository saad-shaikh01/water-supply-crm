'use client';

import { useEffect, useRef } from 'react';
import { Controller, useFieldArray, useForm, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowDown, ArrowUp, Eye, ImageIcon, Loader2, Plus, Save, Trash2, Upload } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Tabs, TabsContent, TabsList, TabsTrigger } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import type { ImageKind, PaymentAccountKind } from '../api/company-profile.api';
import {
  useCompanyProfile,
  useRemoveProfileImage,
  usePreviewDocument,
  useSaveCompanyProfile,
  useUploadProfileImage,
} from '../hooks/use-company-profile';
import {
  MISSING_LABELS,
  companyProfileSchema,
  emptyAccount,
  toFormValues,
  toPayload,
  type CompanyProfileFormValues,
} from '../schema';

const KIND_LABEL: Record<PaymentAccountKind, string> = {
  BANK: 'Bank account',
  EASYPAISA: 'Easypaisa',
  JAZZCASH: 'JazzCash',
  RAAST: 'Raast',
};

const selectClass = 'h-11 w-full rounded-md border border-border/50 bg-accent/30 px-3 text-sm';

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ImageSlot({
  kind,
  title,
  hint,
  url,
  builtin,
  canUpdate,
  vendorId,
}: {
  kind: ImageKind;
  title: string;
  hint: string;
  url: string | null;
  builtin: boolean;
  canUpdate: boolean;
  vendorId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadProfileImage(vendorId);
  const remove = useRemoveProfileImage(vendorId);
  const busy = upload.isPending || remove.isPending;
  const has = !!url || builtin;
  return (
    <div className="space-y-2 rounded-xl border border-border/50 p-4">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-white">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={title} className="max-h-20 max-w-full object-contain" />
        ) : builtin ? (
          <span className="text-xs text-muted-foreground">Built-in Blue Ice artwork (upload to replace)</span>
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate({ kind, file });
          e.target.value = '';
        }}
      />
      {canUpdate && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            {has ? 'Replace' : 'Upload'}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => remove.mutate(kind)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">PNG or JPEG, up to 1 MB. Saved immediately.</p>
    </div>
  );
}

function ColourField({
  label,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error?: string;
}) {
  return (
    <Field label={label} error={error} hint="Leave empty for the default blue.">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          disabled={disabled}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0d0d5e'}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 cursor-pointer rounded-md border border-border/50 bg-transparent p-1"
        />
        <Input value={value} disabled={disabled} placeholder="#0d0d5e" onChange={(e) => onChange(e.target.value)} className="h-11 bg-accent/30 border-border/50 font-mono" />
        {value && !disabled && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  );
}

function AccountCard({
  index,
  total,
  kind,
  register,
  errors,
  disabled,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  kind: PaymentAccountKind;
  register: UseFormRegister<CompanyProfileFormValues>;
  errors: FieldErrors<CompanyProfileFormValues>;
  disabled: boolean;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const e = errors.paymentAccounts?.[index];
  const p = (name: string) => `paymentAccounts.${index}.${name}` as `paymentAccounts.${number}.accountTitle`;
  const isBank = kind === 'BANK';
  return (
    <div className="space-y-4 rounded-xl border border-border/50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{KIND_LABEL[kind]}</Badge>
          {index < 2 && <span className="text-[11px] text-muted-foreground">shown on receipts too</span>}
        </div>
        {!disabled && (
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove account" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account title" error={e?.accountTitle?.message}>
          <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register(p('accountTitle'))} />
        </Field>
        <Field label={isBank ? 'Account number' : kind === 'RAAST' ? 'Raast ID / number' : 'Mobile account number'} error={e?.accountNumber?.message}>
          <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50 font-mono" {...register(p('accountNumber'))} />
        </Field>
        {isBank && (
          <>
            <Field label="Bank name" error={e?.bankName?.message}>
              <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register(p('bankName'))} />
            </Field>
            <Field label="Branch (optional)" error={e?.branch?.message}>
              <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register(p('branch'))} />
            </Field>
            <Field label="IBAN (optional)" hint="Printed on the monthly statement." error={e?.iban?.message}>
              <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50 font-mono uppercase" {...register(p('iban'))} />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

export function CompanyProfileEditor({ vendorId }: { vendorId?: string }) {
  const canUpdate = useCan('company_profile:update');
  const { data: view, isLoading, isError } = useCompanyProfile(vendorId);
  const save = useSaveCompanyProfile(vendorId);
  const preview = usePreviewDocument(vendorId);

  const form = useForm<CompanyProfileFormValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: view ? toFormValues(view) : undefined,
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    trigger,
    formState: { errors, isDirty },
  } = form;
  const accounts = useFieldArray({ control, name: 'paymentAccounts' });

  // Re-sync whenever the server copy changes (first load, after save, vendor switch).
  useEffect(() => {
    if (view) reset(toFormValues(view));
  }, [view, reset]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading company profile…
      </div>
    );
  }
  if (isError || !view) return <p className="text-sm text-destructive">Could not load the company profile.</p>;

  const disabled = !canUpdate || save.isPending;
  const hasBuiltinLogo = view.branding?.logoKey === 'builtin:blue-ice';
  const hasBuiltinIcon = view.branding?.iconKey === 'builtin:blue-ice';

  const runPreview = async (doc: 'statement' | 'receipt') => {
    // Preview uses the DRAFT values, so it must pass the same validation as Save.
    if (!(await trigger())) return;
    preview.mutate({ payload: toPayload(getValues()), doc });
  };

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(toPayload(v)))} className="space-y-6">
      {view.missing.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Required before going live</p>
            <p className="text-xs opacity-90">{view.missing.map((m) => MISSING_LABELS[m] ?? m).join(' · ')}</p>
          </div>
        </div>
      )}

      <Tabs defaultValue="business" className="space-y-6">
        <TabsList>
          <TabsTrigger value="business">Business info</TabsTrigger>
          <TabsTrigger value="look">Logo &amp; colours</TabsTrigger>
          <TabsTrigger value="payments">Payment accounts {accounts.fields.length > 0 && `(${accounts.fields.length})`}</TabsTrigger>
        </TabsList>

        <TabsContent value="business">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Business info</CardTitle>
              <p className="text-sm text-muted-foreground">Printed on statements, delivery receipts, salary slips and daily sheets. Use English letters and numbers only.</p>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field label="Company / brand name *" hint="Shown in the document header." error={errors.displayName?.message}>
                <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register('displayName')} />
              </Field>
              <Field label="Legal name" hint={'Used in "Please make all payments to …". Defaults to the company name.'} error={errors.legalName?.message}>
                <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register('legalName')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address *" error={errors.address?.message}>
                  <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register('address')} />
                </Field>
              </div>
              <Field label="Phone number(s) *" hint="e.g. Cell# 0300-1234567, 0321-7654321" error={errors.phones?.message}>
                <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register('phones')} />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <Input disabled={disabled} type="email" className="h-11 bg-accent/30 border-border/50" {...register('email')} />
              </Field>
              <Field label="Website" error={errors.website?.message}>
                <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register('website')} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="NTN" error={errors.ntn?.message}>
                  <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50 font-mono" {...register('ntn')} />
                </Field>
                <Field label="STRN" error={errors.strn?.message}>
                  <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50 font-mono" {...register('strn')} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Footer note" hint="One short line printed under the thank-you message (optional)." error={errors.invoiceFooter?.message}>
                  <Input disabled={disabled} className="h-11 bg-accent/30 border-border/50" {...register('invoiceFooter')} />
                </Field>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="look">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Logo &amp; colours</CardTitle>
              <p className="text-sm text-muted-foreground">Without a logo, documents show your company name only.</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <ImageSlot kind="logo" title="Logo" hint="Shown in the header chip. A wide logo on a white or transparent background works best." url={view.logoUrl} builtin={hasBuiltinLogo} canUpdate={canUpdate} vendorId={vendorId} />
                <ImageSlot kind="icon" title="Icon (optional)" hint="A small mark used for the faint background watermark. Defaults to the logo." url={view.iconUrl} builtin={hasBuiltinIcon} canUpdate={canUpdate} vendorId={vendorId} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Controller
                  name="primaryColor"
                  control={control}
                  render={({ field }) => <ColourField label="Header colour (dark end)" value={field.value} onChange={field.onChange} disabled={disabled} error={errors.primaryColor?.message} />}
                />
                <Controller
                  name="accentColor"
                  control={control}
                  render={({ field }) => <ColourField label="Header colour (light end)" value={field.value} onChange={field.onChange} disabled={disabled} error={errors.accentColor?.message} />}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment accounts</CardTitle>
              <p className="text-sm text-muted-foreground">
                These are the accounts your customers are told to pay into. Statements list all of them (up to 6); the compact delivery receipt shows the first two.
                If you add none, documents print no payment section.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {accounts.fields.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No payment accounts yet.</p>}
              {accounts.fields.map((f, i) => (
                <AccountCard
                  key={f.id}
                  index={i}
                  total={accounts.fields.length}
                  kind={getValues(`paymentAccounts.${i}.kind`)}
                  register={register}
                  errors={errors}
                  disabled={disabled}
                  onRemove={() => accounts.remove(i)}
                  onMove={(dir) => accounts.move(i, i + dir)}
                />
              ))}
              {errors.paymentAccounts?.message && <p className="text-xs font-medium text-destructive">{errors.paymentAccounts.message}</p>}
              {!disabled && accounts.fields.length < 6 && (
                <div className="flex flex-wrap gap-2">
                  {(['BANK', 'EASYPAISA', 'JAZZCASH', 'RAAST'] as PaymentAccountKind[]).map((k) => (
                    <Button
                      key={k}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => accounts.append(emptyAccount(k, getValues('legalName') || getValues('displayName')))}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> {KIND_LABEL[k]}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={preview.isPending} onClick={() => runPreview('statement')}>
            {preview.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />} Preview statement
          </Button>
          <Button type="button" variant="outline" disabled={preview.isPending} onClick={() => runPreview('receipt')}>
            <Eye className="mr-1.5 h-4 w-4" /> Preview receipt
          </Button>
        </div>
        {canUpdate && (
          <Button type="submit" disabled={save.isPending || !isDirty} className="sm:min-w-40">
            {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save changes
          </Button>
        )}
      </div>
    </form>
  );
}
