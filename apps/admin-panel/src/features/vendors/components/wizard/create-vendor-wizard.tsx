'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { Check, Copy, Eye, EyeOff, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { createVendorSchema, type CreateVendorInput } from '../../schemas';
import { apiErrorMessage, useCreateVendor } from '../../hooks/use-vendors';
import { generateStrongPassword } from '../../lib/generate-password';
import type { CreateVendorResult } from '../../types';

const STEPS = ['Company', 'Admin', 'Review', 'Done'] as const;
const STEP_FIELDS: (keyof CreateVendorInput)[][] = [['name', 'slug', 'address'], ['adminName', 'adminEmail', 'adminPassword']];

const humanize = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function summaryRows(summary: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(summary).map(([key, v]) => ({
    key: humanize(key),
    value: Array.isArray(v) ? String(v.length) : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
  }));
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Create vendor + its admin in 3 steps, then show what provisioning set up. */
export function CreateVendorWizard({ open, onOpenChange }: Props) {
  const router = useRouter();
  const create = useCreateVendor();
  const [step, setStep] = useState(0);
  const [showPw, setShowPw] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [result, setResult] = useState<CreateVendorResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const form = useForm<CreateVendorInput>({
    resolver: zodResolver(createVendorSchema),
    mode: 'onTouched',
    defaultValues: { name: '', slug: '', address: '', adminName: '', adminEmail: '', adminPassword: '' },
  });
  const { register, formState, getValues, setValue, trigger, setError, reset } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!open) {
      reset();
      setStep(0);
      setShowPw(false);
      setGenerated(null);
      setResult(null);
      setSubmitError(null);
      create.reset();
      inFlight.current = false;
    }
  }, [open]);

  const next = async () => {
    if (await trigger(STEP_FIELDS[step])) setStep((s) => s + 1);
  };

  const submit = async () => {
    if (inFlight.current || create.isPending) return; // double submit sends ONE request
    inFlight.current = true;
    setSubmitError(null);
    const v = getValues();
    try {
      const res = await create.mutateAsync({
        name: v.name.trim(),
        slug: v.slug,
        ...(v.address?.trim() ? { address: v.address.trim() } : {}),
        adminName: v.adminName.trim(),
        adminEmail: v.adminEmail.trim().toLowerCase(),
        adminPassword: v.adminPassword,
      });
      setResult(res);
      setStep(3);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const msg = apiErrorMessage(e, 'Failed to create the vendor.');
      if (status === 409 && /slug/i.test(msg) && !/email/i.test(msg)) {
        setError('slug', { message: msg });
        setStep(0);
      } else if (status === 409 && /email/i.test(msg) && !/slug/i.test(msg)) {
        setError('adminEmail', { message: msg });
        setStep(1);
      } else if (status === 409) {
        setSubmitError(msg);
      } else {
        setSubmitError(msg);
      }
    } finally {
      inFlight.current = false;
    }
  };

  const copyLogin = async () => {
    if (!result) return;
    const pw = getValues('adminPassword');
    const lines = [`Vendor: ${result.vendor.name}`, `Login email: ${result.admin.email}`];
    // The password is only included when this wizard generated it (so the operator has not typed a personal one).
    if (generated && pw === generated) lines.push(`Temporary password: ${pw}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Login details copied');
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  const review = getValues();

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Vendor</DialogTitle>
        </DialogHeader>

        <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-1 ${i === step ? 'font-semibold text-foreground' : 'text-muted-foreground'}`} aria-current={i === step ? 'step' : undefined}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${i < step ? 'bg-primary text-primary-foreground' : ''}`}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
              {s}
              {i < STEPS.length - 1 && <span className="mx-1 text-muted-foreground">/</span>}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-4" data-step="company">
            <div className="space-y-2">
              <Label htmlFor="wiz-name">Vendor name</Label>
              <Input id="wiz-name" placeholder="Acme Water Co." {...register('name')} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wiz-slug">Slug</Label>
              <Input id="wiz-slug" placeholder="acme-water" {...register('slug')} />
              <p className="text-xs text-muted-foreground">Permanent identifier. Lowercase letters, digits and hyphens. It cannot be changed later.</p>
              {errors.slug && <p className="text-sm text-destructive">{errors.slug.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wiz-address">Address (optional)</Label>
              <Input id="wiz-address" {...register('address')} />
              {errors.address && <p className="text-sm text-destructive">{errors.address.message}</p>}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4" data-step="admin">
            <div className="space-y-2">
              <Label htmlFor="wiz-admin-name">Admin name</Label>
              <Input id="wiz-admin-name" placeholder="John Smith" {...register('adminName')} />
              {errors.adminName && <p className="text-sm text-destructive">{errors.adminName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wiz-admin-email">Admin email</Label>
              <Input id="wiz-admin-email" type="email" placeholder="admin@acme.com" {...register('adminEmail')} />
              {errors.adminEmail && <p className="text-sm text-destructive">{errors.adminEmail.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wiz-admin-password">Admin password</Label>
              <div className="flex gap-2">
                <Input id="wiz-admin-password" type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="Min 8 characters, letters and digits" {...register('adminPassword')} />
                <Button type="button" variant="outline" size="icon" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((s) => !s)}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const p = generateStrongPassword();
                    setGenerated(p);
                    setValue('adminPassword', p, { shouldValidate: true, shouldDirty: true });
                    setShowPw(true);
                  }}
                >
                  <Wand2 className="mr-1 h-4 w-4" /> Generate
                </Button>
              </div>
              {errors.adminPassword && <p className="text-sm text-destructive">{errors.adminPassword.message}</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm" data-step="review">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 rounded-lg border p-3">
              <dt className="text-muted-foreground">Vendor</dt>
              <dd>{review.name}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="font-mono">{review.slug}</dd>
              <dt className="text-muted-foreground">Address</dt>
              <dd>{review.address || '—'}</dd>
              <dt className="text-muted-foreground">Admin</dt>
              <dd>{review.adminName}</dd>
              <dt className="text-muted-foreground">Admin email</dt>
              <dd>{review.adminEmail.trim().toLowerCase()}</dd>
              <dt className="text-muted-foreground">Password</dt>
              <dd>{'•'.repeat(Math.min(review.adminPassword.length, 12))}</dd>
            </dl>
            {submitError && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                {submitError}
              </p>
            )}
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-3 text-sm" data-step="result">
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <strong>{result.vendor.name}</strong> was created with admin <strong>{result.admin.email}</strong>.
            </p>
            <div>
              <p className="mb-1 font-semibold">Provisioning summary</p>
              <ul className="divide-y rounded-lg border" aria-label="Provisioning summary">
                {summaryRows(result.provisioning?.summary ?? {}).map((r) => (
                  <li key={r.key} className="flex justify-between px-3 py-1.5">
                    <span>{r.key}</span>
                    <span className="font-mono tabular-nums">{r.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step < 3 && (
            <Button variant="outline" disabled={create.isPending} onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
          )}
          {step < 2 && <Button onClick={next}>Next</Button>}
          {step === 2 && (
            <Button disabled={create.isPending} onClick={submit}>
              {create.isPending ? 'Creating...' : 'Create Vendor'}
            </Button>
          )}
          {step === 3 && result && (
            <>
              <Button variant="outline" onClick={copyLogin}>
                <Copy className="mr-1 h-4 w-4" /> Copy login details
              </Button>
              <Button
                onClick={() => {
                  const id = result.vendor.id;
                  onOpenChange(false);
                  router.push(`/vendors/${id}?tab=readiness`);
                }}
              >
                Open vendor
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
