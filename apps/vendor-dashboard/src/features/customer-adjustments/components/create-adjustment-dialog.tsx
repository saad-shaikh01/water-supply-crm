'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PlusCircle, TriangleAlert } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  cn,
} from '@water-supply-crm/ui';
import { ADJUSTMENT_KIND_POLICY, type AdjustmentDirection } from '@water-supply-crm/types';
import { useCustomer } from '../../customers/hooks/use-customers';
import { apiErrorMessage, type PostableAdjustmentKind } from '../api/customer-adjustments.api';
import { useCreateCustomerAdjustment } from '../hooks/use-customer-adjustments';
import { adjustmentKindLabel, fmtAdjustmentAmount } from '../format';
import {
  NOTE_MAX,
  REFERENCE_MAX,
  TITLE_MAX,
  balanceAfter,
  buildCreatePayload,
  dateBounds,
  describeBalance,
  emptyCreateForm,
  newIdempotencyKey,
  parseAmount,
  resolveFormDirection,
  validateCreateForm,
  type CreateFormState,
} from '../create-adjustment';

const FIELD_LABEL = 'font-bold text-xs uppercase tracking-widest text-muted-foreground';
const SELECT_CLASS =
  'h-10 w-full rounded-xl bg-background/50 border border-border text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer';

/** Dropdown groups: which permission tier lets the user post each kind. */
const TIER_LABELS = { create: 'Charges', create_credit: 'Credits', create_restricted: 'Restricted' } as const;

const EFFECT_TEXT: Record<AdjustmentDirection, string> = {
  CHARGE: 'Charge — raises what the customer owes',
  CREDIT: 'Credit — lowers what the customer owes',
};

function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface CreateAdjustmentDialogProps {
  customerId: string;
  /** The kinds THIS user may post (already filtered by permission — see permissions.ts). */
  kinds: PostableAdjustmentKind[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Posts one manual charge / credit / write-off / correction to the customer's ledger.
 *
 * The backend owns the rules; this form mirrors them so mistakes are caught before a round trip:
 * kinds offered = the ones the user holds a permission for, direction implied by the kind (only a
 * CORRECTION asks the user to choose, and only then is a direction sent), internal note required
 * where the policy says so, date limited to the current month up to today. Errors from the API
 * stay in the dialog with the form intact. One idempotency key per opening, so a double-click or a
 * retry after a dropped response can never post twice.
 */
export function CreateAdjustmentDialog({ customerId, kinds, open, onOpenChange }: CreateAdjustmentDialogProps) {
  const create = useCreateCustomerAdjustment();
  const { data: customer } = useCustomer(customerId);
  const balance = customer ? Number(customer.financialBalance ?? 0) : null;

  const [form, setForm] = useState<CreateFormState>(() => emptyCreateForm(kinds[0] ?? ''));
  const [attempted, setAttempted] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    if (open) {
      setForm(emptyCreateForm(kinds[0] ?? ''));
      setAttempted(false);
      idempotencyKey.current = newIdempotencyKey();
      create.reset();
    }
    // Only when the dialog opens: `kinds` / `create` change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const policy = form.kind ? ADJUSTMENT_KIND_POLICY[form.kind] : null;
  const direction = resolveFormDirection(form);
  const amount = parseAmount(form.amount);
  const errors = attempted ? validateCreateForm(form) : {};
  const { min, max } = dateBounds();

  const owed = balance === null ? null : Math.max(0, Math.round(balance * 100) / 100);
  const writeOffTooBig = form.kind === 'WRITE_OFF' && owed !== null && amount !== null && amount > owed;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return; // Enter in a field can submit while the button is disabled
    setAttempted(true);
    if (Object.keys(validateCreateForm(form)).length > 0) return;
    create.mutate(buildCreatePayload(customerId, form, idempotencyKey.current), {
      onSuccess: () => onOpenChange(false),
      onError: (err) => {
        // The key was already used for a DIFFERENT request (e.g. edited after a dropped response):
        // it can't be reused, so mint a new one for the next attempt.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409 && /idempotency key/i.test(apiErrorMessage(err, ''))) {
          idempotencyKey.current = newIdempotencyKey();
        }
      },
    });
  };

  const tiers = (Object.keys(TIER_LABELS) as (keyof typeof TIER_LABELS)[])
    .map((tier) => ({ tier, kinds: kinds.filter((k) => ADJUSTMENT_KIND_POLICY[k].permission === tier) }))
    .filter((g) => g.kinds.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" /> New charge or credit
          </DialogTitle>
          <DialogDescription>
            Posted to {customer?.name ?? 'this customer'}’s ledger and statement. It cannot be edited afterwards — a
            mistake is voided, which posts a reversal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4 py-2">
          <Field label="Type" htmlFor="adj-kind" required error={errors.kind}>
            <select
              id="adj-kind"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PostableAdjustmentKind, direction: '' }))}
              className={SELECT_CLASS}
            >
              {tiers.map((g) => (
                <optgroup key={g.tier} label={TIER_LABELS[g.tier]}>
                  {g.kinds.map((k) => (
                    <option key={k} value={k} className="bg-background text-foreground dark:text-white">
                      {adjustmentKindLabel(k)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          {policy &&
            (policy.direction === 'EITHER' ? (
              <Field label="Effect on balance" htmlFor="adj-direction" required error={errors.direction}>
                <select
                  id="adj-direction"
                  value={form.direction}
                  onChange={(e) => set('direction', e.target.value as AdjustmentDirection | '')}
                  className={SELECT_CLASS}
                >
                  <option value="">Choose…</option>
                  <option value="CHARGE">{EFFECT_TEXT.CHARGE}</option>
                  <option value="CREDIT">{EFFECT_TEXT.CREDIT}</option>
                </select>
              </Field>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="adj-effect">
                Effect: <span className="font-bold text-foreground dark:text-white">{direction ? EFFECT_TEXT[direction] : ''}</span>
              </p>
            ))}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₨)" htmlFor="adj-amount" required error={errors.amount}>
              <Input
                id="adj-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="0.00"
                className="h-10 rounded-xl"
              />
            </Field>
            <Field label="Date" htmlFor="adj-date" required error={errors.effectiveDate}>
              <Input
                id="adj-date"
                type="date"
                min={min}
                max={max}
                value={form.effectiveDate}
                onChange={(e) => set('effectiveDate', e.target.value)}
                className="h-10 rounded-xl"
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">Today, or an earlier day this month.</p>

          <Field
            label="Title"
            htmlFor="adj-title"
            required
            error={errors.title}
            hint={
              policy?.visibility === 'SUMMARIZED'
                ? 'Staff-only. The customer sees “Account adjustment”.'
                : 'Shown to the customer on their statement and portal — write it as they should read it.'
            }
          >
            <Input
              id="adj-title"
              value={form.title}
              maxLength={TITLE_MAX}
              onChange={(e) => set('title', e.target.value)}
              placeholder={form.kind ? adjustmentKindLabel(form.kind) : ''}
              className="h-10 rounded-xl"
            />
          </Field>

          <Field
            label="Internal note"
            htmlFor="adj-note"
            required={!!policy?.requiresInternalNote}
            error={errors.internalNote}
            hint="Staff-only — never shown to the customer."
          >
            <Textarea
              id="adj-note"
              value={form.internalNote}
              maxLength={NOTE_MAX}
              onChange={(e) => set('internalNote', e.target.value)}
              placeholder={policy?.requiresInternalNote ? 'Why is this balance being reduced or rewritten?' : 'Optional'}
              className="rounded-xl min-h-16"
            />
          </Field>

          <Field label="Reference no." htmlFor="adj-reference">
            <Input
              id="adj-reference"
              value={form.referenceNo}
              maxLength={REFERENCE_MAX}
              onChange={(e) => set('referenceNo', e.target.value)}
              placeholder="Optional — invoice or receipt number"
              className="h-10 rounded-xl"
            />
          </Field>

          {balance !== null && amount !== null && direction && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3" data-testid="adj-balance-preview">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Balance after (estimate)</p>
                <p className="text-[11px] text-muted-foreground">Now {describeBalance(balance)}</p>
              </div>
              <p
                className={cn(
                  'text-sm font-black tabular-nums text-right shrink-0',
                  balanceAfter(balance, direction, amount) > 0 ? 'text-rose-400' : 'text-emerald-400',
                )}
              >
                {describeBalance(balanceAfter(balance, direction, amount))}
              </p>
            </div>
          )}

          {writeOffTooBig && (
            <div className="flex gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-600 dark:text-amber-400">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                A write-off cannot exceed what the customer owes
                {owed ? ` (${fmtAdjustmentAmount(owed)})` : ' — they owe nothing right now'}.
              </p>
            </div>
          )}

          {create.isError && (
            <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              {apiErrorMessage(create.error, 'Failed to post the adjustment. Nothing was posted.')}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending} className="rounded-xl font-bold">
              {create.isPending ? 'Posting…' : 'Post adjustment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
