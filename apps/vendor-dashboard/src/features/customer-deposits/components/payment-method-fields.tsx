'use client';

import { Input, Label } from '@water-supply-crm/ui';
import type { DepositPaymentMethod } from '../api/customer-deposits.api';
import { DEPOSIT_PAYMENT_METHOD_LABELS } from '../format';

const SELECT_CLASS =
  'h-10 w-full rounded-xl bg-background/50 border border-border text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer';
const FIELD_LABEL = 'font-bold text-xs uppercase tracking-widest text-muted-foreground';

interface PaymentMethodFieldsProps {
  method: DepositPaymentMethod;
  onMethodChange: (method: DepositPaymentMethod) => void;
  referenceNo: string;
  onReferenceNoChange: (value: string) => void;
  /** Show the "reference required" error (set after a failed submit attempt). */
  showReferenceError: boolean;
  /** "paid" for a collection, "refunded" for a refund — only used in the help text. */
  verb: 'collected' | 'refunded';
}

/**
 * How a CASH-type deposit's money moved. Only CASH is physical cash in/out of the
 * office box (→ Cash Ledger / Office Available Cash); bank-transfer / online change
 * the customer's held deposit but never the office cash, and need a transaction
 * reference so they can be traced.
 */
export function PaymentMethodFields({
  method,
  onMethodChange,
  referenceNo,
  onReferenceNoChange,
  showReferenceError,
  verb,
}: PaymentMethodFieldsProps) {
  const isCash = method === 'CASH';
  return (
    <>
      <div className="space-y-2">
        <Label className={FIELD_LABEL}>Payment method</Label>
        <select
          value={method}
          onChange={(e) => onMethodChange(e.target.value as DepositPaymentMethod)}
          className={SELECT_CLASS}
        >
          {(Object.keys(DEPOSIT_PAYMENT_METHOD_LABELS) as DepositPaymentMethod[]).map((m) => (
            <option key={m} value={m} className="bg-background text-foreground dark:text-white">
              {DEPOSIT_PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          {isCash
            ? `Counted in the Cash Ledger — office available cash ${verb === 'collected' ? 'goes up' : 'goes down'}.`
            : 'Not counted in the Cash Ledger — no cash moved through the office. Only the customer’s held deposit changes.'}
        </p>
      </div>

      {!isCash && (
        <div className="space-y-2">
          <Label className={FIELD_LABEL}>
            Transaction / reference no. <span className="text-destructive">*</span>
          </Label>
          <Input
            value={referenceNo}
            maxLength={200}
            onChange={(e) => onReferenceNoChange(e.target.value)}
            placeholder="Bank or wallet transaction ID"
            className="h-10 rounded-xl"
          />
          {showReferenceError && referenceNo.trim() === '' && (
            <p className="text-xs text-destructive">A reference number is required for a bank-transfer or online payment.</p>
          )}
        </div>
      )}
    </>
  );
}
