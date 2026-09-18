'use client';

import * as Popover from '@radix-ui/react-popover';
import { HelpCircle } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import type { CashLedgerBucket } from '../api/van-cash-ledger.api';

const KEY_BUCKETS: CashLedgerBucket[] = [
  'SHEET_CASH_IN', 'OFFICE_CASH_IN', 'OFFICE_EXPENSE', 'PAYROLL_CASH', 'CREW_CASH', 'OWNER_TRANSFER', 'FUEL_CARD',
];

const STATE_CHIPS: Array<{ label: string; description: string }> = [
  { label: 'Backdated · 3d', description: 'Recorded later than the business date it belongs to (here, 3 days later).' },
  { label: 'Edited', description: 'The record was changed after it was first entered.' },
  { label: 'Pending', description: 'Waiting for approval — not yet counted in the balance.' },
  { label: 'Voided', description: 'Cancelled with a reason; shown struck through and counted as zero.' },
];

const chipBase = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider';

/** "?" icon button + popover explaining how to read the Cash Ledger page. */
export function CashLedgerLegend() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="How to read the cash ledger"
          title="How to read this page"
          className="inline-flex h-11 w-11 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/50 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(24rem,calc(100vw-1.5rem))] max-h-[80vh] overflow-y-auto rounded-2xl border border-border/60 bg-popover text-popover-foreground shadow-2xl p-4 space-y-4 outline-none"
        >
          <section className="space-y-1.5">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">The equation</h2>
            <p className="text-xs leading-relaxed font-medium">
              Brought forward + Sheet Cash In + Office Cash In = Available cash. Available cash − Expenses − Owner
              Transfer − Fuel Card = <span className="font-bold">Expected Closing</span>.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Colours</h2>
            <ul className="flex flex-wrap gap-1.5">
              {KEY_BUCKETS.map((key) => {
                const meta = CASH_LEDGER_BUCKET_META[key];
                const Icon = meta.icon;
                return (
                  <li key={key}>
                    <span className={cn(chipBase, 'gap-1', meta.chip)}>
                      <Icon className="h-3 w-3" aria-hidden />
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-bold text-foreground">Filled</span> chips are cash in or costs.{' '}
              <span className="font-bold text-foreground">Outlined</span> chips (Owner Transfer, Fuel Card) move cash
              but are not costs, so they are left out of Total Expenses.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Row chips</h2>
            <dl className="space-y-1.5">
              {STATE_CHIPS.map((c) => (
                <div key={c.label} className="flex items-start gap-2">
                  <dt className={cn(chipBase, 'shrink-0 border-border/60 bg-muted/40 text-muted-foreground whitespace-nowrap')}>
                    {c.label}
                  </dt>
                  <dd className="text-[11px] leading-relaxed text-muted-foreground">{c.description}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-1.5">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Dates</h2>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-bold text-foreground">Business date</span> is the day an entry belongs to.{' '}
              <span className="font-bold text-foreground">Recorded</span> is when it was actually entered.
            </p>
          </section>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
