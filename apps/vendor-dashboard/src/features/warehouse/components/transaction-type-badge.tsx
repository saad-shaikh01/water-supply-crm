'use client';

interface TransactionTypeBadgeProps {
  type: string;
}

const TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  FILL_IN: { label: 'Fill In', className: 'bg-green-500/10 text-green-500 border border-green-500/20' },
  OPENING_BALANCE: { label: 'Opening Balance', className: 'bg-green-500/10 text-green-500 border border-green-500/20' },
  RETURN_REPAIR: { label: 'Return Repair', className: 'bg-green-500/10 text-green-500 border border-green-500/20' },
  LOAD_OUT: { label: 'Load Out', className: 'bg-blue-500/10 text-blue-500 border border-blue-500/20' },
  CHECK_IN_FILLED: { label: 'Check-In Filled', className: 'bg-teal-500/10 text-teal-500 border border-teal-500/20' },
  CHECK_IN_EMPTY: { label: 'Check-In Empty', className: 'bg-teal-500/10 text-teal-500 border border-teal-500/20' },
  MARK_DAMAGED: { label: 'Mark Damaged', className: 'bg-orange-500/10 text-orange-500 border border-orange-500/20' },
  CHECK_IN_DAMAGED: { label: 'Check-In Damaged', className: 'bg-orange-500/10 text-orange-500 border border-orange-500/20' },
  MARK_LEAKED: { label: 'Mark Leaked', className: 'bg-red-500/10 text-red-500 border border-red-500/20' },
  CHECK_IN_LEAKED: { label: 'Check-In Leaked', className: 'bg-red-500/10 text-red-500 border border-red-500/20' },
  SEND_REPAIR: { label: 'Send Repair', className: 'bg-purple-500/10 text-purple-500 border border-purple-500/20' },
  WRITE_OFF: { label: 'Write Off', className: 'bg-muted text-muted-foreground border border-border/40' },
  DISCREPANCY_ADJUST: { label: 'Discrepancy Adj.', className: 'bg-muted text-muted-foreground border border-border/40' },
  REFILL: { label: 'Refill', className: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' },
  ADJUSTMENT: { label: 'Adjustment', className: 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' },
};

export function TransactionTypeBadge({ type }: TransactionTypeBadgeProps) {
  const config = TYPE_CONFIG[type] ?? {
    label: type,
    className: 'bg-muted text-muted-foreground border border-border/40',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ${config.className}`}>
      {config.label}
    </span>
  );
}
