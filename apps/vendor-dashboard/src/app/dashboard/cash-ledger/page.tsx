'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PageHeader } from '../../../components/shared/page-header';
import { formatYmdShort } from '../../../lib/date-pkt';
import { CashLedgerTimeline } from '../../../features/van-cash-ledger/components/cash-ledger-timeline';
import { CashLedgerDayTable } from '../../../features/van-cash-ledger/components/cash-ledger-day-table';
import { CashLedgerToolbar } from '../../../features/van-cash-ledger/components/cash-ledger-toolbar';
import { CashLedgerSummary } from '../../../features/van-cash-ledger/components/cash-ledger-summary';
import { CashLedgerAlertStrip } from '../../../features/van-cash-ledger/components/cash-ledger-alert-strip';
import { CashLedgerScopeNotice } from '../../../features/van-cash-ledger/components/cash-ledger-scope-notice';
import { CashLedgerMiniBar } from '../../../features/van-cash-ledger/components/cash-ledger-mini-bar';
import { CashLedgerLegend } from '../../../features/van-cash-ledger/components/cash-ledger-legend';
import { CashLedgerPeriodPill } from '../../../features/van-cash-ledger/components/cash-ledger-period-pill';
import { CashLedgerPeriodBanner } from '../../../features/van-cash-ledger/components/cash-ledger-period-banner';
import { SupplierBillCards } from '../../../features/van-cash-ledger/components/supplier-bill-cards';
import { RecordMenu } from '../../../features/van-cash-ledger/components/record-menu';
import { PendingApprovalsPanel } from '../../../features/van-cash-ledger/components/pending-approvals-panel';
import { AddCashInDialog } from '../../../features/van-cash-ledger/components/add-cash-in-dialog';
import { RecordRemittanceDialog } from '../../../features/van-cash-ledger/components/record-remittance-dialog';
import { useCashLedgerSummary } from '../../../features/van-cash-ledger/hooks/use-van-cash-ledger';
import { useCashLedgerView } from '../../../features/van-cash-ledger/hooks/use-cash-ledger-view';
import { AddExpenseWizard } from '../../../features/expense-center/wizard/add-expense-wizard';
import { TopUpFuelCardDialog } from '../../../features/fuel-cards/components/topup-fuel-card-dialog';

/** Fallback height of the sticky toolbar before it has been measured. */
const STICKY_FALLBACK_PX = 64;

/** "1 Sep → 18 Sep 2026" (year shown once, or on both ends when the range crosses a year). */
function rangeLabel(from?: string, to?: string): string {
  if (!from && !to) return 'All dates';
  const fromYear = from?.slice(0, 4);
  const toYear = to?.slice(0, 4);
  if (from && to && from === to) return `${formatYmdShort(from)} ${fromYear}`;
  const left = from ? `${formatYmdShort(from)}${fromYear !== toYear ? ` ${fromYear}` : ''}` : '…';
  const right = to ? `${formatYmdShort(to)} ${toYear}` : '…';
  return `${left} → ${right}`;
}

export default function CashLedgerPage() {
  const [addCashInOpen, setAddCashInOpen] = useState(false);
  const [remittanceOpen, setRemittanceOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [fuelTopUpOpen, setFuelTopUpOpen] = useState(false);
  const [pendingPanelOpen, setPendingPanelOpen] = useState(false);

  const { vanId, range } = useCashLedgerSummary();
  const [view] = useCashLedgerView();

  // Sentinel for the mini-bar: it appears once the summary hero scrolls out of view.
  const heroRef = useRef<HTMLDivElement>(null);

  // `--cl-sticky-top` = measured height of the sticky toolbar, consumed by the timeline's sticky day headers.
  // The toolbar (view toggle + filters + chips) changes height as chips appear / wrap, hence the ResizeObserver.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [stickyTop, setStickyTop] = useState(STICKY_FALLBACK_PX);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) setStickyTop(h);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const menuHandlers = {
    onAddCashIn: () => setAddCashInOpen(true),
    onAddExpense: () => setExpenseOpen(true),
    onOwnerTransfer: () => setRemittanceOpen(true),
    onFuelTopUp: () => setFuelTopUpOpen(true),
  };
  const openPending = () => setPendingPanelOpen(true);

  return (
    <div
      className="pb-24"
      style={{ '--cl-sticky-top': `${stickyTop}px` } as CSSProperties}
    >
      <PageHeader
        title="Cash Ledger"
        description={`${vanId ? 'Van view' : 'Office cash'} · ${rangeLabel(range.from, range.to)}`}
        action={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex-1 sm:flex-none">
              <RecordMenu variant="header" {...menuHandlers} />
            </div>
            <CashLedgerPeriodPill />
            <CashLedgerLegend />
          </div>
        }
      />

      <div className="space-y-4">
        <CashLedgerAlertStrip onReview={openPending} />

        <CashLedgerPeriodBanner />

        <div ref={heroRef}>
          <CashLedgerSummary />
        </div>

        <SupplierBillCards />

        <CashLedgerToolbar ref={toolbarRef} />

        <CashLedgerScopeNotice />

        {view === 'table' ? <CashLedgerDayTable /> : <CashLedgerTimeline />}
      </div>

      <CashLedgerMiniBar sentinelRef={heroRef} onOpenPending={openPending} />
      <RecordMenu variant="fab" {...menuHandlers} />

      <PendingApprovalsPanel open={pendingPanelOpen} onOpenChange={setPendingPanelOpen} />
      <AddCashInDialog open={addCashInOpen} onOpenChange={setAddCashInOpen} />
      <RecordRemittanceDialog open={remittanceOpen} onOpenChange={setRemittanceOpen} />
      <AddExpenseWizard open={expenseOpen} onOpenChange={setExpenseOpen} />
      <TopUpFuelCardDialog open={fuelTopUpOpen} onOpenChange={setFuelTopUpOpen} />
    </div>
  );
}
