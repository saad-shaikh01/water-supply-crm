'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, ArrowRightLeft, CheckCircle2, Loader2, TriangleAlert, X } from 'lucide-react';
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
import { useCustomer, useCustomerSearch } from '../../customers/hooks/use-customers';
import { apiErrorMessage } from '../api/customer-adjustments.api';
import { useCreateBalanceTransfer, useTransferPreview } from '../hooks/use-customer-adjustments';
import { fmtAdjustmentAmount } from '../format';
import {
  NOTE_MAX,
  REFERENCE_MAX,
  buildTransferPayload,
  emptyTransferForm,
  newTransferKey,
  parseTransferAmount,
  validateTransferForm,
  type TransferFormErrors,
  type TransferFormState,
} from '../transfer-balance';

// ── Shared small components ──────────────────────────────────────────────────

const FIELD_LABEL = 'font-bold text-xs uppercase tracking-widest text-muted-foreground';

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
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function BalancePill({ balance, label }: { balance: number; label: string }) {
  const owed = balance > 0;
  return (
    <div className="rounded-xl border border-border/40 bg-accent/20 px-3 py-2 text-center min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">{label}</p>
      <p className={cn('font-mono font-black text-sm mt-0.5', owed ? 'text-rose-400' : 'text-emerald-400')}>
        {owed ? '+' : '−'} {fmtAdjustmentAmount(Math.abs(balance))}
      </p>
      <p className="text-[10px] text-muted-foreground">{owed ? 'owed' : balance < 0 ? 'credit' : 'settled'}</p>
    </div>
  );
}

// ── Customer search combobox ─────────────────────────────────────────────────

interface CustomerComboboxProps {
  id: string;
  value: string; // selected customerId
  onChange: (id: string, name: string) => void;
  excludeId?: string; // the source customer — exclude from results
  error?: string;
}

function CustomerCombobox({ id, value, onChange, excludeId, error }: CustomerComboboxProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: results, isFetching } = useCustomerSearch(debouncedQuery, open || debouncedQuery.length > 0);

  const customers = (results as any)?.data ?? [];
  const filtered = customers.filter((c: { id: string }) => c.id !== excludeId);

  const handleInput = (raw: string) => {
    setQuery(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(raw), 300);
    if (!open) setOpen(true);
  };

  const select = (customer: { id: string; name: string; customerCode: string }) => {
    onChange(customer.id, customer.name);
    setQuery(`${customer.name} (${customer.customerCode})`);
    setOpen(false);
  };

  const clear = () => {
    onChange('', '');
    setQuery('');
    setDebouncedQuery('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Input
          id={id}
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search by name or customer code…"
          className={cn('h-10 rounded-xl pr-8', error && 'border-destructive')}
          autoComplete="off"
        />
        {(value || query) && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (query.length > 0 || debouncedQuery.length > 0) && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          {isFetching ? (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">No customers found.</p>
          ) : (
            <ul className="max-h-52 overflow-y-auto">
              {filtered.map((c: { id: string; name: string; customerCode: string; financialBalance: number }) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c)}
                    className={cn(
                      'w-full flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-left hover:bg-accent/60 transition-colors',
                      value === c.id && 'bg-primary/10',
                    )}
                  >
                    <span>
                      <span className="font-semibold">{c.name}</span>
                      <span className="ml-2 font-mono text-muted-foreground">{c.customerCode}</span>
                    </span>
                    <span
                      className={cn(
                        'font-mono font-bold shrink-0',
                        Number(c.financialBalance) > 0 ? 'text-rose-400' : 'text-emerald-400',
                      )}
                    >
                      {Number(c.financialBalance) > 0 ? '+' : '−'}{' '}
                      {fmtAdjustmentAmount(Math.abs(Number(c.financialBalance)))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main dialog ──────────────────────────────────────────────────────────────

interface TransferBalanceDialogProps {
  /** The customer on whose detail page this dialog was opened (the source). */
  fromCustomerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'form' | 'confirm';

/**
 * Two-step wizard for posting a balance transfer.
 *
 * Step 1 — fill in target customer + amount + optional note + reference.
 *           The preview endpoint runs live to validate the target and cap the amount.
 * Step 2 — confirmation screen showing both legs before committing.
 *
 * One idempotency key per dialog-open, so double-clicks or retries after a
 * dropped response never move the money twice.
 */
export function TransferBalanceDialog({ fromCustomerId, open, onOpenChange }: TransferBalanceDialogProps) {
  const [step, setStep] = useState<Step>('form');
  const [form, setForm] = useState<TransferFormState>(emptyTransferForm);
  const [targetName, setTargetName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const idempotencyKey = useRef(newTransferKey());

  const transfer = useCreateBalanceTransfer();
  const { data: sourceCustomer } = useCustomer(fromCustomerId);
  const { data: preview, isFetching: previewFetching } = useTransferPreview(
    fromCustomerId,
    form.toCustomerId || undefined,
  );

  // Reset everything when the dialog opens.
  useEffect(() => {
    if (open) {
      setStep('form');
      setForm(emptyTransferForm());
      setTargetName('');
      setAttempted(false);
      idempotencyKey.current = newTransferKey();
      transfer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pre-fill amount with the full transferable balance when preview first loads.
  useEffect(() => {
    if (preview?.source && form.amount === '') {
      const amt = preview.source.transferableAmount;
      if (amt > 0) setForm((f) => ({ ...f, amount: String(amt) }));
    }
    // Only on first preview load (amount is '' until the first run).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.source?.transferableAmount]);

  const set = useCallback(<K extends keyof TransferFormState>(key: K, value: TransferFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const errors: TransferFormErrors = attempted ? validateTransferForm(form, preview) : {};
  const parsedAmount = parseTransferAmount(form.amount);
  const blockers = preview?.blockers ?? [];
  const canProceed = blockers.length === 0 && preview?.canTransfer;

  // ── Step 1: form submit → show confirm ────────────────────────────────────
  const handleFormNext = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (Object.keys(validateTransferForm(form, preview)).length > 0) return;
    if (!canProceed) return;
    setStep('confirm');
  };

  // ── Step 2: confirm submit → post ─────────────────────────────────────────
  const handleConfirm = () => {
    if (transfer.isPending) return;
    transfer.mutate(buildTransferPayload(fromCustomerId, form, idempotencyKey.current), {
      onSuccess: () => onOpenChange(false),
      onError: (err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409 && /idempotency/i.test(apiErrorMessage(err, ''))) {
          idempotencyKey.current = newTransferKey();
        }
        setStep('form'); // Go back to form so the user can see the error
      },
    });
  };

  // ── Source info ───────────────────────────────────────────────────────────
  const sourceName = sourceCustomer?.name ?? '…';
  const sourceCode = sourceCustomer?.customerCode ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            {step === 'confirm' ? 'Confirm transfer' : 'Transfer balance'}
          </DialogTitle>
          <DialogDescription>
            {step === 'confirm'
              ? 'Review the transfer below. This cannot be undone — a mistake is voided, which posts a reversal on both accounts.'
              : 'Move part or all of what this customer owes onto another account. Both ledgers update in the same transaction.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' ? (
          <FormStep
            form={form}
            set={set}
            errors={errors}
            fromCustomerId={fromCustomerId}
            sourceName={sourceName}
            sourceCode={sourceCode}
            preview={preview}
            previewFetching={previewFetching}
            parsedAmount={parsedAmount}
            blockers={blockers}
            canProceed={!!canProceed}
            onTargetChange={(id, name) => {
              set('toCustomerId', id);
              setTargetName(name);
            }}
            onSubmit={handleFormNext}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <ConfirmStep
            form={form}
            sourceName={sourceName}
            sourceCode={sourceCode}
            targetName={targetName}
            preview={preview}
            parsedAmount={parsedAmount!}
            isPending={transfer.isPending}
            error={transfer.isError ? apiErrorMessage(transfer.error, 'Failed to post the transfer') : null}
            onBack={() => { setStep('form'); transfer.reset(); }}
            onConfirm={handleConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Step 1: form ──────────────────────────────────────────────────────────────

interface FormStepProps {
  form: TransferFormState;
  set: <K extends keyof TransferFormState>(key: K, value: TransferFormState[K]) => void;
  errors: TransferFormErrors;
  fromCustomerId: string;
  sourceName: string;
  sourceCode: string;
  preview: ReturnType<typeof useTransferPreview>['data'];
  previewFetching: boolean;
  parsedAmount: number | null;
  blockers: { code: string; message: string }[];
  canProceed: boolean;
  onTargetChange: (id: string, name: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

function FormStep({
  form,
  set,
  errors,
  fromCustomerId,
  sourceName,
  sourceCode,
  preview,
  previewFetching,
  parsedAmount,
  blockers,
  canProceed,
  onTargetChange,
  onSubmit,
  onCancel,
}: FormStepProps) {
  const transferable = preview?.source?.transferableAmount ?? null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 py-2">
      {/* Source info */}
      <div className="rounded-2xl border border-border/40 bg-accent/20 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">From</p>
        <p className="text-sm font-bold mt-0.5">
          {sourceName}
          {sourceCode && <span className="ml-2 font-mono text-xs text-muted-foreground">({sourceCode})</span>}
        </p>
        {preview?.source ? (
          <p className="text-xs text-muted-foreground mt-0.5">
            Transferable:{' '}
            <span className="font-bold text-foreground dark:text-white">
              {fmtAdjustmentAmount(preview.source.transferableAmount)}
            </span>
            {preview.source.transferableAmount <= 0 && (
              <span className="ml-2 text-amber-500"> — nothing to transfer</span>
            )}
          </p>
        ) : previewFetching ? (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading balance…
          </p>
        ) : null}
      </div>

      {/* Target customer */}
      <Field label="Transfer to" htmlFor="tf-target" required error={errors.toCustomerId}>
        <CustomerCombobox
          id="tf-target"
          value={form.toCustomerId}
          onChange={onTargetChange}
          excludeId={fromCustomerId}
          error={errors.toCustomerId}
        />
      </Field>

      {/* Blockers from preview */}
      {blockers.length > 0 && form.toCustomerId && (
        <div className="space-y-2">
          {blockers.map((b) => (
            <div
              key={b.code}
              className="flex gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-600 dark:text-amber-400"
            >
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">{b.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Amount */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₨)" htmlFor="tf-amount" required error={errors.amount}>
          <div className="relative">
            <Input
              id="tf-amount"
              type="number"
              min={0.01}
              step="0.01"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="0.00"
              className="h-10 rounded-xl"
            />
          </div>
        </Field>
        {transferable !== null && transferable > 0 && (
          <div className="flex flex-col justify-end pb-0.5">
            <button
              type="button"
              onClick={() => set('amount', String(transferable))}
              className="text-xs text-primary font-bold hover:underline text-left h-10 flex items-center"
            >
              Use full balance ({fmtAdjustmentAmount(transferable)})
            </button>
          </div>
        )}
      </div>

      {/* Internal note */}
      <Field
        label="Internal note"
        htmlFor="tf-note"
        error={errors.internalNote}
        hint="Staff-only — never shown to the customer."
      >
        <Textarea
          id="tf-note"
          value={form.internalNote}
          maxLength={NOTE_MAX}
          onChange={(e) => set('internalNote', e.target.value)}
          placeholder="Optional — reason for the transfer"
          className="rounded-xl min-h-16"
        />
      </Field>

      {/* Reference */}
      <Field label="Reference no." htmlFor="tf-reference" error={errors.referenceNo}>
        <Input
          id="tf-reference"
          value={form.referenceNo}
          maxLength={REFERENCE_MAX}
          onChange={(e) => set('referenceNo', e.target.value)}
          placeholder="Optional — invoice or receipt number"
          className="h-10 rounded-xl"
        />
      </Field>

      {/* Balance preview */}
      {preview?.source && preview.target && parsedAmount !== null && (
        <div className="grid grid-cols-3 items-center gap-2">
          <BalancePill
            balance={preview.source.financialBalance - parsedAmount}
            label={preview.source.customerCode}
          />
          <ArrowRight className="h-5 w-5 mx-auto text-muted-foreground shrink-0" />
          <BalancePill
            balance={preview.target.financialBalance + parsedAmount}
            label={preview.target.customerCode}
          />
        </div>
      )}

      {/* Warnings about pending deliveries / held bottles */}
      {preview?.source && (preview.source.pendingDeliveryCount > 0 || preview.source.heldBottleCount > 0) && (
        <div className="flex gap-2 rounded-xl bg-blue-500/10 border border-blue-500/30 p-3 text-blue-600 dark:text-blue-400">
          <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed space-y-0.5">
            {preview.source.pendingDeliveryCount > 0 && (
              <p>
                This customer has <strong>{preview.source.pendingDeliveryCount}</strong> pending{' '}
                {preview.source.pendingDeliveryCount === 1 ? 'delivery' : 'deliveries'} today.
              </p>
            )}
            {preview.source.heldBottleCount > 0 && (
              <p>
                They hold <strong>{preview.source.heldBottleCount}</strong>{' '}
                {preview.source.heldBottleCount === 1 ? 'bottle' : 'bottles'} — separate from the balance.
              </p>
            )}
          </div>
        </div>
      )}

      <DialogFooter className="pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canProceed && form.toCustomerId !== ''} className="rounded-xl font-bold">
          Review transfer
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Step 2: confirm ───────────────────────────────────────────────────────────

interface ConfirmStepProps {
  form: TransferFormState;
  sourceName: string;
  sourceCode: string;
  targetName: string;
  preview: ReturnType<typeof useTransferPreview>['data'];
  parsedAmount: number;
  isPending: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}

function ConfirmStep({ sourceName, sourceCode, targetName, preview, parsedAmount, isPending, error, onBack, onConfirm }: ConfirmStepProps) {
  const targetCode = preview?.target?.customerCode ?? '';

  return (
    <div className="space-y-4 py-2">
      {/* Amount hero */}
      <div className="rounded-2xl border border-border/40 bg-accent/20 px-4 py-4 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Transferring</p>
        <p className="font-mono font-black text-3xl text-foreground dark:text-white">
          {fmtAdjustmentAmount(parsedAmount)}
        </p>
      </div>

      {/* Legs summary */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="rounded-2xl border border-border/40 bg-accent/20 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">From</p>
          <p className="text-xs font-bold mt-0.5 truncate">{sourceName}</p>
          {sourceCode && <p className="text-[10px] font-mono text-muted-foreground">{sourceCode}</p>}
          {preview?.source && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Balance:{' '}
              <span className={cn('font-bold', preview.source.financialBalance > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                {fmtAdjustmentAmount(preview.source.financialBalance - parsedAmount)}
              </span>
            </p>
          )}
        </div>

        <ArrowRight className="h-5 w-5 text-primary shrink-0" />

        <div className="rounded-2xl border border-border/40 bg-accent/20 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">To</p>
          <p className="text-xs font-bold mt-0.5 truncate">{targetName}</p>
          {targetCode && <p className="text-[10px] font-mono text-muted-foreground">{targetCode}</p>}
          {preview?.target && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Balance:{' '}
              <span className={cn('font-bold', (preview.target.financialBalance + parsedAmount) > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                {fmtAdjustmentAmount(preview.target.financialBalance + parsedAmount)}
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 rounded-xl bg-primary/5 border border-primary/20 p-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <p className="text-[11px] leading-relaxed text-foreground dark:text-white">
          Both accounts update in a single atomic transaction. A mistake can be voided, which posts reversals on both ledgers.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <DialogFooter className="pt-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={isPending}>
          Back
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="rounded-xl font-bold gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Posting…
            </>
          ) : (
            'Confirm transfer'
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}
