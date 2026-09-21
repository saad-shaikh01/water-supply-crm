'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  cn,
} from '@water-supply-crm/ui';
import { ADJUSTMENT_SUMMARIZED_LABEL } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';
import type { CustomerAdjustment } from '../api/customer-adjustments.api';
import {
  adjustmentKindLabel,
  directionSign,
  fmtAdjustmentAmount,
  fmtAdjustmentDate,
  fmtAdjustmentDateTime,
} from '../format';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</p>
      <div className="rounded-2xl border border-border/40 bg-accent/20 p-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-semibold text-foreground dark:text-white break-words min-w-0">{children}</span>
    </div>
  );
}

interface AdjustmentDetailDialogProps {
  adjustment: CustomerAdjustment | null;
  onClose: () => void;
}

/**
 * Read-only detail for one charge/credit: what it is, what the customer sees on the ledger,
 * the staff-only note, and its void chain / transfer link. Everything comes from the list row
 * (the list endpoint returns the same shape as the single-item endpoint), so opening it costs
 * no request. Void / edit actions arrive in a later phase.
 */
export function AdjustmentDetailDialog({ adjustment, onClose }: AdjustmentDetailDialogProps) {
  return (
    <Dialog open={!!adjustment} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
        {adjustment && <Body a={adjustment} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ a }: { a: CustomerAdjustment }) {
  const isVoided = a.status === 'VOIDED';
  const isCharge = a.direction === 'CHARGE';
  const ledgerDescription = a.transaction?.description;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {adjustmentKindLabel(a.kind)}
          <StatusBadge status={a.status} />
        </DialogTitle>
        <DialogDescription>{a.title}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-2xl border border-border/40 bg-accent/20 p-4">
          <p
            className={cn(
              'font-mono font-black text-2xl',
              isCharge ? 'text-rose-400' : 'text-emerald-400',
              isVoided && 'line-through opacity-60',
            )}
          >
            {directionSign(a.direction)} {fmtAdjustmentAmount(a.amount)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {isCharge ? 'Increased' : 'Reduced'} what {a.customer.name} owes
            {isVoided ? ' — cancelled by a reversal' : ''}.
          </p>
        </div>

        <Section title="Details">
          <Row label="Customer">
            {a.customer.name} <span className="text-muted-foreground font-mono">({a.customer.customerCode})</span>
          </Row>
          <Row label="Effective date">{fmtAdjustmentDate(a.effectiveDate)}</Row>
          <Row label="Posted">
            {fmtAdjustmentDateTime(a.createdAt)}
            {a.createdBy ? ` by ${a.createdBy.name}` : ''}
          </Row>
          {a.referenceNo && <Row label="Reference no.">{a.referenceNo}</Row>}
        </Section>

        <Section title="What the customer sees">
          <Row label="Statement / portal line">{ledgerDescription || '—'}</Row>
          <Row label="Wording">
            <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wide">
              {a.customerVisibility === 'SUMMARIZED' ? 'Summarised' : 'Itemised'}
            </Badge>
          </Row>
          {a.customerVisibility === 'SUMMARIZED' && (
            <p className="text-[11px] text-muted-foreground">
              Shown as “{ADJUSTMENT_SUMMARIZED_LABEL}”. The amount is visible; the title and note above are staff-only.
            </p>
          )}
        </Section>

        {a.internalNote && (
          <Section title="Internal note (staff only)">
            <p className="text-xs whitespace-pre-wrap break-words">{a.internalNote}</p>
          </Section>
        )}

        {(a.reversalOf || isVoided || a.groupId) && (
          <Section title="History">
            {a.reversalOf && (
              <Row label="Reverses">
                {adjustmentKindLabel(a.reversalOf.kind)} · {a.reversalOf.title} · {fmtAdjustmentDate(a.reversalOf.effectiveDate)}
              </Row>
            )}
            {isVoided && (
              <>
                <Row label="Voided">
                  {a.voidedAt ? fmtAdjustmentDateTime(a.voidedAt) : '—'}
                  {a.voidedBy ? ` by ${a.voidedBy.name}` : ''}
                </Row>
                {a.voidReason && <Row label="Reason">{a.voidReason}</Row>}
                {a.reversedBy && <Row label="Reversal posted">{fmtAdjustmentDate(a.reversedBy.effectiveDate)}</Row>}
              </>
            )}
            {a.groupId && (
              <Row label="Balance transfer">
                Part of a two-sided transfer
                {a.counterpartyCustomerId && (
                  <Link
                    href={`/dashboard/customers/${a.counterpartyCustomerId}`}
                    className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Other account <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </Row>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
