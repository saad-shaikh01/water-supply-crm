'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button,
} from '@water-supply-crm/ui';
import { Download, Truck, AlertCircle, Loader2, CalendarDays, Wallet } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { dailySheetsApi } from '../../api/daily-sheets.api';
import type { ExportPreviewResponse, ExportType } from '../../api/daily-sheets.api';
import { useExportPreview } from '../../hooks/use-daily-sheets';
import { useAllVans } from '../../../vans/hooks/use-vans';

type Step = 'select' | 'preview';

const slideVariants = {
  enter: { x: 40, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -40, opacity: 0 },
};

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const [step, setStep] = useState<Step>('select');
  const [date, setDate] = useState<string>(todayStr());
  const [vanMode, setVanMode] = useState<'all' | 'specific'>('all');
  const [selectedVanIds, setSelectedVanIds] = useState<string[]>([]);
  const [exportType, setExportType] = useState<ExportType>('both');
  const [preview, setPreview] = useState<ExportPreviewResponse | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const { data: vansData } = useAllVans();
  const allVans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string; isActive: boolean }>;
  const activeVans = allVans.filter((v) => v.isActive !== false);

  const previewMutation = useExportPreview();

  useEffect(() => {
    if (!open) {
      setStep('select');
      setDate(todayStr());
      setVanMode('all');
      setSelectedVanIds([]);
      setExportType('both');
      setPreview(null);
      setIsDownloading(false);
      previewMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleVan = (vanId: string) => {
    setSelectedVanIds((prev) =>
      prev.includes(vanId) ? prev.filter((id) => id !== vanId) : [...prev, vanId],
    );
  };

  const handleClose = () => {
    onClose();
  };

  const handlePreview = async () => {
    if (!date) return;
    try {
      const vanIds = vanMode === 'specific' ? selectedVanIds : undefined;
      const result = await previewMutation.mutateAsync({ date, vanIds, exportType });
      setPreview(result);
      setStep('preview');
    } catch {
      // toast fired by onError in hook
    }
  };

  const handleDownload = async () => {
    if (!preview) return;
    setIsDownloading(true);
    try {
      const vanIds = vanMode === 'specific' ? selectedVanIds : undefined;
      const res = await dailySheetsApi.downloadExportCsv(date, vanIds, exportType);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-sheets-export-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download CSV');
    } finally {
      setIsDownloading(false);
    }
  };

  const canPreview = !!date && !(vanMode === 'specific' && selectedVanIds.length === 0);

  // What counts as "nothing to export" depends on exportType — a Payments
  // Only preview always reports totals.completed === 0 by design (no
  // delivery query even runs), so that alone can't gate the button; check
  // only the figures this exportType actually downloads.
  const nothingToExport = (() => {
    if (!preview) return true;
    if (exportType === 'deliveries') return preview.totals.completed === 0;
    if (exportType === 'payments') return preview.totals.standalonePayments === 0;
    return preview.totals.completed === 0 && preview.totals.standalonePayments === 0;
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Export CSV
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <AnimatePresence mode="wait" initial={false}>
            {/* ── Step: Select ─────────────────────────────────── */}
            {step === 'select' && (
              <motion.div
                key="select"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18 }}
                className="space-y-4 py-4"
              >
                {/* Date picker */}
                <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-foreground mb-0.5">Delivery Date</p>
                    <p className="text-[11px] text-muted-foreground">Completed deliveries for this date will be exported.</p>
                  </div>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                  />
                </div>

                {/* Export type — deliveries, standalone payments (Record
                    Payment / office / online transfer), or both. A payment
                    has no van of its own, so this choice is independent of
                    Van Selection below. */}
                <div className="space-y-3 p-6 rounded-2xl bg-accent/20 border border-border/30">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    Export Type
                  </p>
                  <div className="flex gap-2">
                    {([
                      { value: 'both', label: 'Both' },
                      { value: 'deliveries', label: 'Deliveries Only' },
                      { value: 'payments', label: 'Payments Only' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setExportType(opt.value)}
                        className={cn(
                          'flex-1 py-2 px-3 rounded-xl text-xs sm:text-sm font-semibold border transition-all',
                          exportType === opt.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border/50 text-muted-foreground hover:border-primary/50',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground italic">
                    {exportType === 'deliveries'
                      ? 'Only delivery rows — standalone (Record Payment) collections are excluded.'
                      : exportType === 'payments'
                        ? 'Only standalone (Record Payment) collections — no delivery rows, and never filtered by van.'
                        : 'Deliveries and standalone payments together, one row per customer per day.'}
                  </p>
                </div>

                {/* Van selection */}
                <div className="space-y-3 p-6 rounded-2xl bg-accent/20 border border-border/30">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Truck className="h-4 w-4 text-primary" />
                    Van Selection
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVanMode('all')}
                      className={cn(
                        'flex-1 py-2 px-4 rounded-xl text-sm font-semibold border transition-all',
                        vanMode === 'all'
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border/50 text-muted-foreground hover:border-primary/50',
                      )}
                    >
                      All Vans
                    </button>
                    <button
                      type="button"
                      onClick={() => setVanMode('specific')}
                      className={cn(
                        'flex-1 py-2 px-4 rounded-xl text-sm font-semibold border transition-all',
                        vanMode === 'specific'
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border/50 text-muted-foreground hover:border-primary/50',
                      )}
                    >
                      Select Specific
                    </button>
                  </div>

                  {vanMode === 'specific' && (
                    <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                      {activeVans.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">No active vans found</p>
                      ) : (
                        activeVans.map((van) => (
                          <label
                            key={van.id}
                            className={cn(
                              'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                              selectedVanIds.includes(van.id)
                                ? 'bg-primary/10 border-primary/40'
                                : 'bg-background border-border/40 hover:border-primary/30',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="rounded accent-primary h-4 w-4"
                              checked={selectedVanIds.includes(van.id)}
                              onChange={() => toggleVan(van.id)}
                            />
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-semibold">{van.plateNumber}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}

                  {vanMode === 'specific' && selectedVanIds.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {selectedVanIds.length} van{selectedVanIds.length > 1 ? 's' : ''} selected
                    </p>
                  )}
                  {vanMode === 'all' && (
                    <p className="text-[11px] text-muted-foreground italic">
                      All active vans will be included in the export.
                    </p>
                  )}
                  {exportType === 'payments' && (
                    <p className="text-[11px] text-amber-600 font-medium">
                      Van selection has no effect for a Payments Only export — a payment has no van of its own.
                    </p>
                  )}
                </div>

                {previewMutation.isError && (
                  <div className="flex items-center gap-2 text-sm text-destructive font-semibold px-1">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {(previewMutation.error as any)?.response?.data?.message ??
                      'Failed to load export preview. Please try again.'}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Step: Preview ─────────────────────────────────── */}
            {step === 'preview' && preview && (
              <motion.div
                key="preview"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18 }}
                className="space-y-4 py-4"
              >
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Total Completed', value: preview.totals.completed, color: 'text-emerald-600' },
                    { label: 'Total Pending', value: preview.totals.pending, color: 'text-amber-600' },
                    { label: 'Total Cancelled', value: preview.totals.cancelled, color: 'text-destructive' },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-border/50 bg-muted/20 p-3 text-center">
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">{s.label}</p>
                      <p className={cn('text-xl font-black font-mono', s.color)}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Bottle + cash summary — mirrors what generateExportCsv will
                    actually put in the CSV (same completed+empty_only scope
                    for bottles/delivery-cash; Record Payment collections are
                    never van-scoped, so that one card doesn't change with
                    the van selection). */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Bottles Delivered', value: preview.totals.filledDropped.toLocaleString(), color: 'text-sky-600' },
                    { label: 'Empty Received', value: preview.totals.emptyReceived.toLocaleString(), color: 'text-purple-600' },
                    { label: 'Cash Collected (Deliveries)', value: `₨${preview.totals.cashCollected.toLocaleString()}`, color: 'text-emerald-600' },
                    { label: 'Record Payment Collected', value: `₨${preview.totals.standalonePayments.toLocaleString()}`, color: 'text-emerald-600' },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-border/50 bg-muted/20 p-3 text-center">
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">{s.label}</p>
                      <p className={cn('text-lg font-black font-mono', s.color)}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Per-van breakdown */}
                <div className="rounded-2xl border border-border/50 overflow-hidden">
                  <div className="px-4 py-2 border-b border-border/30 bg-muted/20">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Per-Van Breakdown</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-border/30">
                    {preview.perVan.map((v) => (
                      <div key={v.vanId} className="flex items-center gap-3 px-4 py-2.5">
                        <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-xs font-bold text-foreground flex-1">{v.plateNumber}</span>
                        <span className="text-[10px] font-mono font-bold text-emerald-600">{v.completed} completed</span>
                        <span className="text-[10px] font-mono font-bold text-amber-600">{v.pending} pending</span>
                        <span className="text-[10px] font-mono font-bold text-destructive">{v.cancelled} cancelled</span>
                      </div>
                    ))}
                  </div>
                </div>

                {nothingToExport && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground font-semibold px-1">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {exportType === 'payments'
                      ? 'No standalone payments found for this date — nothing to export.'
                      : exportType === 'deliveries'
                        ? 'No completed deliveries found for this selection — nothing to export.'
                        : 'No completed deliveries or standalone payments found for this selection — nothing to export.'}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter className="shrink-0 pt-2 border-t border-border/40 mt-2">
          {step === 'select' && (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                disabled={!canPreview || previewMutation.isPending}
                onClick={handlePreview}
                className="rounded-xl font-bold min-w-[150px]"
              >
                {previewMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</>
                ) : (
                  'Preview'
                )}
              </Button>
            </>
          )}

          {step === 'preview' && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep('select');
                  setPreview(null);
                  previewMutation.reset();
                }}
                disabled={isDownloading}
              >
                ← Back
              </Button>
              <Button
                disabled={nothingToExport || isDownloading}
                onClick={handleDownload}
                className="rounded-xl font-bold min-w-[160px]"
              >
                {isDownloading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Downloading…</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" />Download CSV</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
