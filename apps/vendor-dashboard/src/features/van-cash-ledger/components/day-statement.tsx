'use client';

import { cn } from '@water-supply-crm/ui';
import type { CashLedgerBucket, CashLedgerDayStatement } from '../api/van-cash-ledger.api';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import { money, moneyOrDash } from '../format';
import { balanceText, balanceTone } from './timeline-format';

interface StatementLineProps {
  /** Operator glyph shown before the label (+ / − / =). */
  op?: '+' | '−' | '=';
  label: string;
  value: string;
  /** Tailwind text colour for the label + dot (bucket colour). */
  tone?: string;
  dot?: string;
  strong?: boolean;
  muted?: boolean;
  indent?: boolean;
  /** Draws a rule above the line (subtotal / total). */
  rule?: boolean;
}

function StatementLine({ op, label, value, tone, dot, strong, muted, indent, rule }: StatementLineProps) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1',
        rule && 'border-t border-border/40 mt-1 pt-1.5',
        indent && 'pl-4',
        muted && 'text-muted-foreground',
      )}
    >
      <span className={cn('flex items-center gap-2 min-w-0 text-xs', strong ? 'font-black' : 'font-semibold', tone)}>
        <span className="w-3 shrink-0 text-center font-mono text-muted-foreground" aria-hidden>{op}</span>
        {dot && <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} aria-hidden />}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          'font-mono tabular-nums text-xs shrink-0',
          strong ? 'font-black text-sm' : 'font-bold',
          strong ? (tone ?? 'text-foreground') : tone,
          muted && 'font-medium',
        )}
      >
        {value}
      </span>
    </div>
  );
}

const B = (k: CashLedgerBucket) => CASH_LEDGER_BUCKET_META[k];

/**
 * The full reconciliation for one PKT day, written as a vertical equation:
 * Opening + cash in = Available − expenses − transfers = Expected closing.
 * Zero figures render as an em dash; Payroll Cash is omitted when nil. Total
 * Expenses is a muted subtotal (transfers are NOT expenses, so it sits apart
 * from Owner Transfer / Fuel Card).
 */
export function DayStatement({ statement }: { statement: CashLedgerDayStatement }) {
  const available = statement.opening + statement.totalCashIn;

  return (
    <div
      className="rounded-2xl border border-border/40 bg-card/30 px-4 py-3 max-w-lg"
      role="group"
      aria-label="Day statement"
    >
      <StatementLine label="Opening cash" value={balanceText(statement.opening)} strong tone={balanceTone(statement.opening)} />
      <StatementLine
        op="+" label={B('SHEET_CASH_IN').label} value={moneyOrDash(statement.sheetCashIn)}
        tone={B('SHEET_CASH_IN').text} dot={B('SHEET_CASH_IN').dot}
      />
      <StatementLine
        op="+" label={B('OFFICE_CASH_IN').label} value={moneyOrDash(statement.officeCashIn)}
        tone={B('OFFICE_CASH_IN').text} dot={B('OFFICE_CASH_IN').dot}
      />
      <StatementLine op="=" label="Available cash" value={balanceText(available)} strong rule tone={balanceTone(available)} />
      <StatementLine
        op="−" label="Office Expenses" value={moneyOrDash(statement.officeExpenses)}
        tone={B('OFFICE_EXPENSE').text} dot={B('OFFICE_EXPENSE').dot}
      />
      {statement.payrollCash > 0 && (
        <StatementLine
          op="−" label={B('PAYROLL_CASH').label} value={money(statement.payrollCash)}
          tone={B('PAYROLL_CASH').text} dot={B('PAYROLL_CASH').dot}
        />
      )}
      <StatementLine
        op="−" label={B('CREW_CASH').label} value={moneyOrDash(statement.crewCash)}
        tone={B('CREW_CASH').text} dot={B('CREW_CASH').dot}
      />
      <StatementLine op="=" label="Total Expenses" value={moneyOrDash(statement.totalExpenses)} muted indent />
      <StatementLine
        op="−" label={B('OWNER_TRANSFER').label} value={moneyOrDash(statement.ownerTransfer)}
        tone={B('OWNER_TRANSFER').text} dot={B('OWNER_TRANSFER').dot}
      />
      <StatementLine
        op="−" label={B('FUEL_CARD').label} value={moneyOrDash(statement.fuelCard)}
        tone={B('FUEL_CARD').text} dot={B('FUEL_CARD').dot}
      />
      <StatementLine op="=" label="Expected closing cash" value={balanceText(statement.closing)} strong rule tone={balanceTone(statement.closing)} />
    </div>
  );
}
