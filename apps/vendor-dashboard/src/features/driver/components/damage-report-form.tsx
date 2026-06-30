'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Card,
  CardContent,
} from '@water-supply-crm/ui';
import { AlertCircle, ExternalLink, ShieldAlert } from 'lucide-react';
import { DamagePhotoUpload } from './damage-photo-upload';
import { useReportDamage } from '../hooks/use-damage-cases';
import { useAllCustomers } from '../../customers/hooks/use-customers';
import { productsApi } from '../../products/api/products.api';
import { useQuery } from '@tanstack/react-query';
import type { DamageSeverity } from '../api/damage-case.api';

const schema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  productId: z.string().min(1, 'Product is required'),
  severity: z.enum(['MINOR', 'MODERATE', 'SEVERE']),
  bottleCount: z.number().int().min(1, 'Must be at least 1'),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface DamageReportFormProps {
  dailySheetItemId?: string;
  prefillCustomerId?: string;
  prefillProductId?: string;
}

interface ConflictInfo {
  existingCaseId: string;
  severity: string;
}

const SEVERITY_OPTIONS: { value: DamageSeverity; label: string }[] = [
  { value: 'MINOR', label: 'Minor' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'SEVERE', label: 'Severe' },
];

function getDraftKey(dailySheetItemId?: string) {
  return `damage-draft-${dailySheetItemId ?? 'adhoc'}`;
}

export function DamageReportForm({ dailySheetItemId, prefillCustomerId, prefillProductId }: DamageReportFormProps) {
  const router = useRouter();
  const { mutateAsync: reportDamage, isPending } = useReportDamage();
  const { data: customersData } = useAllCustomers();
  const { data: productsData } = useQuery({
    queryKey: ['products', 'all-active'],
    queryFn: () => productsApi.getAll({ limit: 500, isActive: true }).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const draftKey = getDraftKey(dailySheetItemId);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      severity: 'MODERATE',
      bottleCount: 1,
    },
  });

  // Auto-select product when only one exists and none is chosen yet
  useEffect(() => {
    const allProducts = (productsData as { data?: any[] } | undefined)?.data ?? [];
    if (allProducts.length === 1 && !watch('productId') && !prefillProductId) {
      setValue('productId', allProducts[0].id, { shouldValidate: true });
    }
  }, [productsData]);

  // Rehydrate draft on mount, then apply URL pre-fills (URL wins over draft)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<FormValues>;
        if (draft.severity) setValue('severity', draft.severity);
        if (draft.bottleCount) setValue('bottleCount', draft.bottleCount);
        if (draft.description) setValue('description', draft.description);
        if (draft.customerId) setValue('customerId', draft.customerId);
        if (draft.productId) setValue('productId', draft.productId);
      }
    } catch {
      // ignore
    }
    // URL-provided context overrides draft (came from delivery dialog)
    if (prefillCustomerId) setValue('customerId', prefillCustomerId, { shouldValidate: true });
    if (prefillProductId)  setValue('productId',  prefillProductId,  { shouldValidate: true });
  }, [draftKey, setValue, prefillCustomerId, prefillProductId]);

  // Persist draft on change
  const watchedValues = watch();
  useEffect(() => {
    const { customerId, productId, severity, bottleCount, description } = watchedValues;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ customerId, productId, severity, bottleCount, description }),
      );
    } catch {
      // ignore
    }
  }, [watchedValues, draftKey]);

  const customers = (
    (customersData as { data?: Array<{ id: string; name: string; customerCode?: string }> } | undefined)
      ?.data ?? []
  );
  const products = (
    (productsData as { data?: Array<{ id: string; name: string }> } | undefined)?.data ?? []
  );

  const onSubmit = async (data: FormValues) => {
    setConflict(null);
    try {
      await reportDamage({
        ...data,
        dailySheetItemId,
        photoPaths,
      });
      localStorage.removeItem(draftKey);
      reset({ severity: 'MODERATE', bottleCount: 1 });
      setPhotoPaths([]);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string; existingCaseId?: string; severity?: string } };
      };
      if (axiosErr?.response?.status === 409) {
        const body = axiosErr.response?.data ?? {};
        setConflict({
          existingCaseId: body.existingCaseId ?? '',
          severity: body.severity ?? 'existing',
        });
        return;
      }
      toast.error(axiosErr?.response?.data?.message ?? 'Failed to report damage');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Delivery context banner */}
      {dailySheetItemId && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm text-primary">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>Linked to delivery stop — customer &amp; product pre-filled</span>
        </div>
      )}

      {/* 409 Conflict alert */}
      {conflict && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-2 flex-1">
              <p className="text-sm font-semibold text-amber-300">
                A {conflict.severity.toLowerCase()} damage case already exists for this stop.
              </p>
              <button
                type="button"
                onClick={() => router.push(`/dashboard/damage-report/${conflict.existingCaseId}`)}
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline font-semibold"
              >
                Update the existing case
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Customer */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Customer
        </Label>
        <Select
          value={watch('customerId')}
          onValueChange={(v) => setValue('customerId', v, { shouldValidate: true })}
        >
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Select customer..." />
          </SelectTrigger>
          <SelectContent>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.customerCode ? ` (${c.customerCode})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.customerId && (
          <p className="text-xs text-destructive">{errors.customerId.message}</p>
        )}
      </div>

      {/* Product */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Product
        </Label>
        <Select
          value={watch('productId')}
          onValueChange={(v) => setValue('productId', v, { shouldValidate: true })}
        >
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Select product..." />
          </SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.productId && (
          <p className="text-xs text-destructive">{errors.productId.message}</p>
        )}
      </div>

      {/* Severity */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Severity
        </Label>
        <div className="flex gap-2">
          {SEVERITY_OPTIONS.map((opt) => {
            const isSelected = watch('severity') === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setValue('severity', opt.value, { shouldValidate: true })}
                className={[
                  'flex-1 py-2 rounded-xl text-sm font-semibold transition-all border',
                  isSelected
                    ? opt.value === 'MINOR'
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                      : opt.value === 'MODERATE'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                        : 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                    : 'bg-card/40 border-border text-muted-foreground hover:bg-card/60',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {errors.severity && (
          <p className="text-xs text-destructive">{errors.severity.message}</p>
        )}
      </div>

      {/* Bottle Count */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Bottle Count
        </Label>
        <Input
          type="number"
          min={1}
          {...register('bottleCount', { valueAsNumber: true })}
          className="h-11"
        />
        {errors.bottleCount && (
          <p className="text-xs text-destructive">{errors.bottleCount.message}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Description (optional)
        </Label>
        <Textarea
          placeholder="Describe what happened..."
          rows={3}
          {...register('description')}
          className="resize-none"
        />
      </div>

      {/* Photos */}
      <DamagePhotoUpload onPhotosChange={setPhotoPaths} maxPhotos={5} />

      <Button
        type="submit"
        disabled={isPending}
        className="w-full h-12 rounded-xl font-bold text-sm"
      >
        {isPending ? 'Submitting...' : 'Submit Damage Report'}
      </Button>
    </form>
  );
}
