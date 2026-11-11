'use client';

import { useEffect } from 'react';
import { useFieldArray, useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label } from '@water-supply-crm/ui';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { brandingSchema, toBrandingInput, type BrandingFormValues } from '../../schemas/branding';
import { apiErrorMessage } from '../../hooks/use-vendors';
import { useSaveBranding } from '../../hooks/use-vendor-detail';
import { vendorDetailApi } from '../../api/vendor-detail.api';
import type { BrandingDoc, BrandingView } from '../../types';

const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function toFormValues(view: BrandingView): BrandingFormValues {
  const b = view.branding;
  return {
    displayName: s(b?.displayName) || view.suggested.displayName || view.vendor.name,
    legalName: s(b?.legalName),
    address: s(b?.address) || (b ? '' : s(view.suggested.address)),
    phones: s(b?.phones),
    email: s(b?.email),
    website: s(b?.website),
    ntn: s(b?.ntn),
    strn: s(b?.strn),
    primaryColor: s(b?.primaryColor),
    accentColor: s(b?.accentColor),
    invoiceFooter: s(b?.invoiceFooter),
    paymentAccounts: (b?.paymentAccounts ?? []).map((a) => ({
      kind: a.kind,
      accountTitle: s(a.accountTitle),
      accountNumber: s(a.accountNumber),
      bankName: s(a.bankName),
      iban: s(a.iban),
      branch: s(a.branch),
      note: s(a.note),
    })),
  };
}

const TEXT_FIELDS: { name: Exclude<keyof BrandingFormValues, 'paymentAccounts'>; label: string; type?: string }[] = [
  { name: 'displayName', label: 'Display name *' },
  { name: 'legalName', label: 'Legal name' },
  { name: 'address', label: 'Address' },
  { name: 'phones', label: 'Phones' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'website', label: 'Website' },
  { name: 'ntn', label: 'NTN' },
  { name: 'strn', label: 'STRN' },
  { name: 'primaryColor', label: 'Primary colour (#RRGGBB)' },
  { name: 'accentColor', label: 'Accent colour (#RRGGBB)' },
  { name: 'invoiceFooter', label: 'Invoice footer' },
];

/** Maps class-validator messages such as "paymentAccounts.0.iban looks invalid" onto form fields. */
export function mapApiMessages(messages: string[], known: (path: string) => boolean): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  for (const m of messages) {
    const path = m.match(/^([A-Za-z]+(?:\.\d+\.[A-Za-z]+)?)\b/)?.[1];
    if (path && known(path)) out.push({ field: path, message: m });
  }
  return out;
}

export function BrandingForm({ vendorId, view }: { vendorId: string; view: BrandingView }) {
  const save = useSaveBranding(vendorId);
  const form = useForm<BrandingFormValues>({ resolver: zodResolver(brandingSchema), defaultValues: toFormValues(view) });
  const { register, control, handleSubmit, formState, reset, setError, getValues } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'paymentAccounts' });
  const dirty = formState.isDirty;

  // Re-seed from the server (after save / image changes) unless the user is mid-edit.
  const viewKey = JSON.stringify(view.branding) + String(view.exists);
  useEffect(() => {
    if (!form.formState.isDirty) reset(toFormValues(view));
  }, [viewKey]);

  // Unsaved-changes guard
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const onSubmit = (v: BrandingFormValues) => {
    save.mutate(toBrandingInput(v), {
      onSuccess: (fresh) => reset(toFormValues(fresh)),
      onError: (e) => {
        const raw = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
        const msgs = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const mapped = mapApiMessages(msgs, (p) => p in getValues() || /^paymentAccounts\.\d+\./.test(p));
        mapped.forEach((m) => setError(m.field as Path<BrandingFormValues>, { message: m.message }));
      },
    });
  };

  const preview = async (doc: BrandingDoc) => {
    const parsed = brandingSchema.safeParse(getValues());
    if (!parsed.success) {
      toast.error('Fix the highlighted fields before previewing.');
      void form.trigger();
      return;
    }
    try {
      const blob = await vendorDetailApi.previewBranding(vendorId, doc, toBrandingInput(parsed.data));
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not generate the preview.'));
    }
  };

  const errs = formState.errors;
  const accountErr = (i: number, f: string) => (errs.paymentAccounts?.[i] as Record<string, { message?: string }> | undefined)?.[f]?.message;
  const kinds = form.watch('paymentAccounts');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={`br-${f.name}`}>{f.label}</Label>
            <Input id={`br-${f.name}`} type={f.type} {...register(f.name)} />
            {errs[f.name] && <p className="text-sm text-destructive">{(errs[f.name] as { message?: string }).message}</p>}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Payment accounts</h3>
          <Button type="button" size="sm" variant="outline" disabled={fields.length >= 6} onClick={() => append({ kind: 'BANK', accountTitle: '', accountNumber: '', bankName: '', iban: '', branch: '', note: '' })}>
            <Plus className="mr-1 h-4 w-4" /> Add account
          </Button>
        </div>
        {fields.length === 0 && <p className="text-sm text-muted-foreground">No payment accounts yet. At least one is needed before go-live.</p>}
        {fields.map((f, i) => (
          <div key={f.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2" data-account={i}>
            <div className="space-y-1.5">
              <Label htmlFor={`pa-${i}-kind`}>Type</Label>
              <select id={`pa-${i}-kind`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register(`paymentAccounts.${i}.kind`)}>
                <option value="BANK">Bank</option>
                <option value="EASYPAISA">Easypaisa</option>
                <option value="JAZZCASH">JazzCash</option>
                <option value="RAAST">Raast</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pa-${i}-title`}>Account title *</Label>
              <Input id={`pa-${i}-title`} {...register(`paymentAccounts.${i}.accountTitle`)} />
              {accountErr(i, 'accountTitle') && <p className="text-sm text-destructive">{accountErr(i, 'accountTitle')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pa-${i}-number`}>Account number *</Label>
              <Input id={`pa-${i}-number`} {...register(`paymentAccounts.${i}.accountNumber`)} />
              {accountErr(i, 'accountNumber') && <p className="text-sm text-destructive">{accountErr(i, 'accountNumber')}</p>}
            </div>
            {kinds?.[i]?.kind === 'BANK' && (
              <div className="space-y-1.5">
                <Label htmlFor={`pa-${i}-bank`}>Bank name *</Label>
                <Input id={`pa-${i}-bank`} {...register(`paymentAccounts.${i}.bankName`)} />
                {accountErr(i, 'bankName') && <p className="text-sm text-destructive">{accountErr(i, 'bankName')}</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`pa-${i}-iban`}>IBAN</Label>
              <Input id={`pa-${i}-iban`} {...register(`paymentAccounts.${i}.iban`)} />
              {accountErr(i, 'iban') && <p className="text-sm text-destructive">{accountErr(i, 'iban')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pa-${i}-branch`}>Branch</Label>
              <Input id={`pa-${i}-branch`} {...register(`paymentAccounts.${i}.branch`)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`pa-${i}-note`}>Note</Label>
              <Input id={`pa-${i}-note`} {...register(`paymentAccounts.${i}.note`)} />
            </div>
            <div className="sm:col-span-2">
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => remove(i)}>
                <Trash2 className="mr-1 h-4 w-4" /> Remove account
              </Button>
            </div>
          </div>
        ))}
        {typeof errs.paymentAccounts?.message === 'string' && <p className="text-sm text-destructive">{errs.paymentAccounts.message}</p>}
      </div>

      {save.error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {apiErrorMessage(save.error, 'Could not save the branding.')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save branding'}
        </Button>
        <Button type="button" variant="outline" onClick={() => void preview('statement')}>
          <Eye className="mr-1 h-4 w-4" /> Preview statement
        </Button>
        <Button type="button" variant="outline" onClick={() => void preview('receipt')}>
          <Eye className="mr-1 h-4 w-4" /> Preview receipt
        </Button>
        {dirty && <span className="text-sm text-amber-600">Unsaved changes</span>}
      </div>
    </form>
  );
}
