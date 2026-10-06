'use client';

interface PaidFromCashFieldProps {
  /** true = paid in cash (default everywhere), false = bank / online. */
  value: boolean;
  onChange: (value: boolean) => void;
  title?: string;
  /** Shown while the toggle is ON. */
  onHint: string;
  /** Shown while the toggle is OFF. */
  offHint: string;
  disabled?: boolean;
}

/**
 * Cash vs. bank/online switch shared by the expense-type forms (maintenance,
 * advance, crew cash). Same look as the toggle in ExpenseForm / FuelLogFormDialog.
 * Always defaults to ON (cash) in the callers — turning it off only ever stops
 * the amount from being treated as a cash movement.
 */
export function PaidFromCashField({ value, onChange, title = 'Paid in cash?', onHint, offHint, disabled }: PaidFromCashFieldProps) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${value ? 'border-border/50' : 'border-blue-500/40 bg-blue-500/5'}`}>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{value ? onHint : offHint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${value ? 'bg-emerald-500' : 'bg-input dark:bg-muted'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
}
