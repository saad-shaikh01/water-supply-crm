'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { HandCoins } from 'lucide-react';
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
} from '@water-supply-crm/ui';
import type { CustomerDeposit, DepositPaymentMethod } from '../api/customer-deposits.api';
import { PaymentMethodFields } from './payment-method-fields';
import { apiErrorMessage } from '../api/customer-deposits.api';
import { useApplyDepositToBalance, useRefundDeposit } from '../hooks/use-customer-deposits';
import { depositTitle, fmtDepositAmount } from '../format';

const FIELD_LABEL = 'font-bold text-xs uppercase tracking-widest text-muted-foreground';

interface SettleDepositDialogProps {
  deposit: CustomerDeposit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Gives part or all of a held deposit back to the customer. A BOTTLE deposit
 * always returns as bottles (no cash value, per the owner-locked design). A
 * CASH deposit can be split between physical cash and a credit against what
 * the customer owes — e.g. deposit ₨1000, customer owes ₨600 → 600 applied to
 * the balance, 400 refunded in cash. Posts up to two separate API calls (each
 * already atomic on its own); the two split fields are validated to never
 * exceed the held balance together.
 */
export function SettleDepositDialog({ deposit, open, onOpenChange }: SettleDepositDialogProps) {
  const refund = useRefundDeposit(deposit.id);
  const applyToBalance = useApplyDepositToBalance(deposit.id);
  const isCash = deposit.type === 'CASH';

  const [refundAmount, setRefundAmount] = useState('');
  const [applyAmount, setApplyAmount] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<DepositPaymentMethod>('CASH');
  const [referenceNo, setReferenceNo] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setRefundAmount('');
      setApplyAmount('');
      setNote('');
      setPaymentMethod('CASH');
      setReferenceNo('');
      setAttempted(false);
      refund.reset();
      applyToBalance.reset();
    }
    // Only when the dialog opens: mutation objects change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedRefund = refundAmount.trim() === '' ? 0 : Number(refundAmount);
  const parsedApply = isCash && applyAmount.trim() !== '' ? Number(applyAmount) : 0;
  const total = parsedRefund + parsedApply;
  const bothZero = parsedRefund <= 0 && parsedApply <= 0;
  const exceedsBalance = total - deposit.balance > 1e-6;
  const notIntegerBottles = !isCash && !Number.isInteger(parsedRefund);
  // The payment method only applies to the money refunded, not to "apply to balance".
  const referenceMissing = isCash && parsedRefund > 0 && paymentMethod !== 'CASH' && referenceNo.trim() === '';
  const invalid =
    bothZero || exceedsBalance || notIntegerBottles || parsedRefund < 0 || parsedApply < 0 || referenceMissing;

  const isPending = refund.isPending || applyToBalance.isPending;
  const isError = refund.isError || applyToBalance.isError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    setAttempted(true);
    if (invalid) return;

    try {
      if (parsedRefund > 0) {
        await refund.mutateAsync({
          amount: parsedRefund,
          paymentMethod: isCash ? paymentMethod : undefined,
          referenceNo: isCash && paymentMethod !== 'CASH' ? referenceNo.trim() : undefined,
          note: note.trim() || undefined,
        });
      }
      if (parsedApply > 0) {
        await applyToBalance.mutateAsync({ amount: parsedApply, note: note.trim() || undefined });
      }
      onOpenChange(false);
    } catch {
      // Toasted by the mutations themselves; dialog stays open with the form intact.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-emerald-500" /> Settle {depositTitle(deposit)}
          </DialogTitle>
          <DialogDescription>
            Held: {fmtDepositAmount(deposit.type, deposit.balance)}
            {isCash && ' — split between cash refunded and credit against the customer’s balance.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className={FIELD_LABEL}>{isCash ? 'Refund to customer (₨)' : 'Bottles returned'}</Label>
            <Input
              type="number"
              min={0}
              step={isCash ? '0.01' : '1'}
              inputMode={isCash ? 'decimal' : 'numeric'}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              placeholder="0"
              className="h-10 rounded-xl"
            />
          </div>

          {isCash && parsedRefund > 0 && (
            <PaymentMethodFields
              method={paymentMethod}
              onMethodChange={setPaymentMethod}
              referenceNo={referenceNo}
              onReferenceNoChange={setReferenceNo}
              showReferenceError={attempted}
              verb="refunded"
            />
          )}

          {isCash && (
            <div className="space-y-2">
              <Label className={FIELD_LABEL}>Apply to customer&apos;s balance (₨)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={applyAmount}
                onChange={(e) => setApplyAmount(e.target.value)}
                placeholder="0"
                className="h-10 rounded-xl"
              />
              <p className="text-[11px] text-muted-foreground">
                Posted as a credit on the Charges &amp; Credits tab — reduces what the customer owes instead of
                paying cash.
              </p>
            </div>
          )}

          {attempted && bothZero && (
            <p className="text-xs text-destructive">Enter an amount to refund and/or apply to the balance.</p>
          )}
          {attempted && exceedsBalance && (
            <p className="text-xs text-destructive">
              The total ({isCash ? `₨${total.toLocaleString()}` : total}) cannot exceed the held deposit (
              {fmtDepositAmount(deposit.type, deposit.balance)}).
            </p>
          )}
          {attempted && notIntegerBottles && (
            <p className="text-xs text-destructive">A whole number of bottles is required.</p>
          )}

          <div className="space-y-2">
            <Label className={FIELD_LABEL}>Note</Label>
            <Textarea
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              className="rounded-xl min-h-16"
            />
          </div>

          {isError && (
            <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              {apiErrorMessage(refund.error ?? applyToBalance.error, 'Failed to settle the deposit')}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="rounded-xl font-bold">
              {isPending ? 'Settling…' : 'Settle deposit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
