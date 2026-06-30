'use client';

import { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button,
} from '@water-supply-crm/ui';
import {
  Upload, FileSpreadsheet, AlertCircle, CheckCircle2, XCircle,
  Loader2, Download, X, AlertTriangle, ChevronDown, Truck, CalendarDays, Calendar,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { dailySheetsApi } from '../../api/daily-sheets.api';
import type {
  GlobalImportPreviewResponse,
  GlobalPreviewGroup,
  GlobalImportConfirmResponse,
} from '../../api/daily-sheets.api';
import { usePreviewGlobalBulkImport, useConfirmGlobalBulkImport } from '../../hooks/use-daily-sheets';

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];
const ACCEPTED_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const MAX_BYTES = 20 * 1024 * 1024;

type Step = 'upload' | 'preview' | 'done';

const slideVariants = {
  enter: { x: 40, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -40, opacity: 0 },
};

const isBlocked = (g: GlobalPreviewGroup) => !g.sheetFound || g.isClosed;
const groupKey = (g: GlobalPreviewGroup) => `${g.date}::${g.vanPlateNumber}`;

function formatGroupDate(dateStr: string) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

interface GlobalImportDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenSheetGenerate: () => void;
}

export function GlobalImportDialog({ open, onClose, onOpenSheetGenerate }: GlobalImportDialogProps) {
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState<string>(todayStr());
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<GlobalImportPreviewResponse | null>(null);
  const [confirmResult, setConfirmResult] = useState<GlobalImportConfirmResponse | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewMutation = usePreviewGlobalBulkImport();
  const confirmMutation = useConfirmGlobalBulkImport();

  const reset = () => {
    setStep('upload');
    setFile(null);
    setDate(todayStr());
    setFileError(null);
    setIsDragging(false);
    setPreview(null);
    setConfirmResult(null);
    setExpandedKeys(new Set());
    setIgnoredKeys(new Set());
    previewMutation.reset();
    confirmMutation.reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const validateAndSetFile = (f: File) => {
    setFileError(null);
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_MIMES.includes(f.type) && !ACCEPTED_EXTENSIONS.includes(ext)) {
      setFileError('Only Excel files (.xlsx, .xls) are accepted.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError('File size must be under 20 MB.');
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) validateAndSetFile(dropped);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) validateAndSetFile(selected);
    e.target.value = '';
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await dailySheetsApi.downloadGlobalBulkImportTemplate();
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'global-import-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download template');
    }
  };

  const handlePreview = async () => {
    if (!file || !date) return;
    try {
      const result = await previewMutation.mutateAsync({ file, date });
      setPreview(result);
      // Start with blocked groups expanded so user notices them immediately
      const initialExpanded = new Set<string>();
      result.groups.forEach((g) => {
        if (isBlocked(g)) initialExpanded.add(groupKey(g));
      });
      setExpandedKeys(initialExpanded);
      setStep('preview');
    } catch {
      // toast fired by onError in hook
    }
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleIgnored = (key: string) => {
    setIgnoredKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!preview) return;
    const groups = preview.groups
      .filter((g) => !isBlocked(g) && g.valid.length > 0)
      .map((g) => ({
        sheetId: g.sheetId!,
        rows: g.valid.map((r) => ({
          itemId: r.itemId!,
          status: r.importStatus as 'COMPLETED' | 'SKIPPED' | 'FAILED',
          filledDropped: r.filledDropped,
          emptyReturned: r.emptyReturned,
          cashCollected: r.cashCollected,
          failureReason: r.failureReason,
        })),
      }));

    if (groups.length === 0) return;

    try {
      const result = await confirmMutation.mutateAsync(groups);
      setConfirmResult(result);
      setStep('done');
    } catch {
      // toast fired by onError
    }
  };

  const groups = preview?.groups ?? [];
  const unblockedGroups = groups.filter((g) => !isBlocked(g));
  const blockedGroups = groups.filter((g) => isBlocked(g));
  const hasUnignoredBlocked = blockedGroups.some((g) => !ignoredKeys.has(groupKey(g)));
  const importableRows = unblockedGroups.reduce((sum, g) => sum + g.valid.length, 0);
  const importableSheets = unblockedGroups.filter((g) => g.valid.length > 0).length;
  const canConfirm = !hasUnignoredBlocked && importableRows > 0;

  // All unique sanitization warnings from valid rows of unblocked groups
  const allWarnings = unblockedGroups.flatMap((g) => g.valid.flatMap((r) => r.warnings));
  const uniqueWarnings = [...new Set(allWarnings)];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-3xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Global Master Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <AnimatePresence mode="wait" initial={false}>
            {/* ── Step: Upload ─────────────────────────────────── */}
            {step === 'upload' && (
              <motion.div
                key="upload"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18 }}
                className="space-y-4 py-4"
              >
                <div className="flex items-start justify-between gap-3 px-1">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Select a delivery date, download the template, fill in delivery data, then upload. Each row is matched by CustomerCode — the van is resolved automatically.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadTemplate}
                    className="gap-1.5 shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Template
                  </Button>
                </div>

                {/* Date picker */}
                <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-foreground mb-0.5">Delivery Date</p>
                    <p className="text-[11px] text-muted-foreground">All rows in the file will be imported for this date.</p>
                  </div>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                  />
                </div>

                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200',
                    'flex flex-col items-center justify-center gap-3 p-10 text-center select-none',
                    isDragging
                      ? 'border-primary bg-primary/5 scale-[1.01]'
                      : file
                        ? 'border-emerald-500/60 bg-emerald-500/5'
                        : 'border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-primary/5',
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {file ? (
                    <>
                      <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                        <FileSpreadsheet className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-emerald-600">{file.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(file.size / 1024).toFixed(1)} KB — ready to preview
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFile(null); setFileError(null); }}
                        className="absolute top-3 right-3 rounded-full p-1 hover:bg-muted transition-colors text-muted-foreground"
                        aria-label="Remove file"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
                        <Upload className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Drop your global master file here</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          or click to browse — .xlsx, .xls, max 20 MB
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {fileError && (
                  <div className="flex items-center gap-2 text-sm text-destructive font-semibold px-1">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {fileError}
                  </div>
                )}

                {previewMutation.isError && (
                  <div className="flex items-center gap-2 text-sm text-destructive font-semibold px-1">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {(previewMutation.error as any)?.response?.data?.message ??
                      'Failed to parse file. Check the format and try again.'}
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
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Total Rows', value: preview.summary.totalRows, color: 'text-foreground' },
                    { label: 'Valid', value: preview.summary.validRows, color: 'text-emerald-600' },
                    {
                      label: 'Invalid',
                      value: preview.summary.invalidRows,
                      color: preview.summary.invalidRows > 0 ? 'text-destructive' : 'text-muted-foreground',
                    },
                    {
                      label: 'Blocked',
                      value: preview.summary.blockedGroups,
                      color: preview.summary.blockedGroups > 0 ? 'text-amber-600' : 'text-muted-foreground',
                    },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-border/50 bg-muted/20 p-3 text-center">
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">{s.label}</p>
                      <p className={cn('text-xl font-black font-mono', s.color)}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Blocked groups warning */}
                {blockedGroups.length > 0 && hasUnignoredBlocked && (
                  <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {blockedGroups.filter((g) => !ignoredKeys.has(groupKey(g))).length} group{blockedGroups.filter((g) => !ignoredKeys.has(groupKey(g))).length !== 1 ? 's are' : ' is'} blocked. Expand each blocked group and click "Skip Group" to proceed with the rest.
                    </p>
                  </div>
                )}

                {/* Sanitization warnings */}
                {uniqueWarnings.length > 0 && (
                  <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 space-y-1.5">
                    <p className="text-xs font-black text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Data sanitization warnings — values were auto-corrected
                    </p>
                    <ul className="space-y-0.5 pl-1">
                      {uniqueWarnings.slice(0, 5).map((w, i) => (
                        <li key={i} className="text-[11px] text-amber-700 dark:text-amber-500">• {w}</li>
                      ))}
                      {uniqueWarnings.length > 5 && (
                        <li className="text-[11px] text-amber-700 dark:text-amber-500">
                          • …and {uniqueWarnings.length - 5} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Groups accordion */}
                <div className="space-y-2">
                  {groups.map((g) => {
                    const key = groupKey(g);
                    const blocked = isBlocked(g);
                    const ignored = ignoredKeys.has(key);
                    const expanded = expandedKeys.has(key);
                    const totalRows = g.valid.length + g.invalid.length;

                    return (
                      <div
                        key={key}
                        className={cn(
                          'rounded-2xl border overflow-hidden transition-all duration-200',
                          blocked && !ignored
                            ? 'border-amber-500/40 bg-amber-500/5'
                            : blocked && ignored
                              ? 'border-border/30 bg-muted/10 opacity-60'
                              : 'border-border/50 bg-card/50',
                        )}
                      >
                        {/* Accordion header */}
                        <button
                          type="button"
                          onClick={() => toggleExpanded(key)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
                        >
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
                              expanded && 'rotate-180',
                            )}
                          />

                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                              <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
                              {formatGroupDate(g.date)}
                            </div>
                            <span className="text-muted-foreground/40">·</span>
                            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                              <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              {g.vanPlateNumber}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Row count pill */}
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border',
                              blocked
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                : g.invalid.length > 0
                                  ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
                            )}>
                              {g.valid.length}/{totalRows} valid
                            </span>

                            {/* Status badge */}
                            {blocked ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {ignored ? 'SKIPPED' : 'BLOCKED'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                READY
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Accordion body */}
                        <div className={cn(
                          'grid transition-all duration-200 ease-in-out',
                          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                        )}>
                          <div className="overflow-hidden">
                            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/30">

                              {/* Blocked group banner */}
                              {blocked && (
                                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-3 space-y-2.5">
                                  <div className="flex items-start gap-2">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 leading-relaxed">
                                      {g.blockReason ??
                                        (!g.sheetFound
                                          ? 'No open daily sheet exists for this van on this date.'
                                          : 'This sheet is closed and cannot accept new deliveries.')}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 pl-5">
                                    {!g.sheetFound && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onOpenSheetGenerate(); }}
                                        className="text-xs font-bold text-primary underline underline-offset-2 hover:no-underline"
                                      >
                                        Generate sheet for this date →
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); toggleIgnored(key); }}
                                      className={cn(
                                        'text-xs font-bold px-3 py-1 rounded-lg border transition-colors',
                                        ignored
                                          ? 'border-border/50 text-muted-foreground hover:border-amber-500/40 hover:text-amber-600'
                                          : 'border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10',
                                      )}
                                    >
                                      {ignored ? '← Undo skip' : 'Skip this group'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Invalid rows */}
                              {g.invalid.length > 0 && (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-bold uppercase text-destructive">
                                    {g.invalid.length} invalid row{g.invalid.length !== 1 ? 's' : ''} — will be skipped
                                  </p>
                                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 max-h-32 overflow-y-auto divide-y divide-destructive/10">
                                    {g.invalid.map((row) => (
                                      <div key={row.rowIndex} className="px-3 py-2 grid grid-cols-[auto_1fr] gap-2 items-start">
                                        <span className="text-[9px] font-mono text-muted-foreground mt-0.5">r{row.rowIndex}</span>
                                        <div>
                                          <p className="text-xs font-bold truncate">
                                            {row.customerName || row.customerCode}
                                          </p>
                                          {row.errors.map((err, i) => (
                                            <p key={i} className="text-[10px] text-destructive leading-snug">↳ {err}</p>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Valid rows */}
                              {g.valid.length > 0 ? (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-bold uppercase text-emerald-600">
                                    {g.valid.length} valid row{g.valid.length !== 1 ? 's' : ''}
                                  </p>
                                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
                                    <div className="max-h-48 overflow-y-auto">
                                      <table className="w-full text-xs">
                                        <thead className="sticky top-0">
                                          <tr className="border-b border-emerald-500/20 bg-emerald-500/10">
                                            <th className="text-left px-3 py-1.5 text-[9px] font-bold uppercase text-muted-foreground">Customer</th>
                                            <th className="text-center px-3 py-1.5 text-[9px] font-bold uppercase text-muted-foreground">Status</th>
                                            <th className="text-right px-3 py-1.5 text-[9px] font-bold uppercase text-muted-foreground">Filled</th>
                                            <th className="text-right px-3 py-1.5 text-[9px] font-bold uppercase text-muted-foreground">Cash</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-emerald-500/10">
                                          {g.valid.map((row) => (
                                            <tr key={row.rowIndex} className="hover:bg-emerald-500/5 transition-colors">
                                              <td className="px-3 py-1.5 font-semibold max-w-[180px] truncate">
                                                {row.customerName || row.customerCode}
                                              </td>
                                              <td className="px-3 py-1.5 text-center">
                                                <span className="font-mono text-[9px] font-bold text-emerald-600">
                                                  {row.importStatus}
                                                </span>
                                              </td>
                                              <td className="px-3 py-1.5 text-right font-mono font-bold">{row.filledDropped}</td>
                                              <td className="px-3 py-1.5 text-right font-mono text-emerald-600">
                                                {row.cashCollected > 0 ? `₨${row.cashCollected.toLocaleString()}` : '—'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                !blocked && (
                                  <div className="rounded-xl border border-muted/30 bg-muted/10 px-3 py-4 text-center">
                                    <p className="text-xs text-muted-foreground">No valid rows in this group.</p>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Overwrite warning */}
                {canConfirm && (
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 leading-relaxed">
                      This operation runs as the dispatch authority. Any manual delivery entries made to these sheets since this preview was loaded will be overwritten. This action cannot be undone and will affect {importableSheets} sheet{importableSheets !== 1 ? 's' : ''}.
                    </p>
                  </div>
                )}

                {confirmMutation.isError && (
                  <div className="flex items-center gap-2 text-sm text-destructive font-semibold px-1">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {(confirmMutation.error as any)?.response?.data?.message ??
                      'Import failed. Please try again.'}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Step: Done ─────────────────────────────────────── */}
            {step === 'done' && confirmResult && (
              <motion.div
                key="done"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18 }}
                className="py-6 space-y-5"
              >
                {/* Success header */}
                <div className="flex flex-col items-center gap-3 text-center py-4">
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
                    className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600"
                  >
                    <CheckCircle2 className="h-8 w-8" />
                  </motion.div>
                  <div>
                    <p className="text-lg font-black">Global Import Complete</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {confirmResult.totalProcessed} deliver{confirmResult.totalProcessed !== 1 ? 'ies' : 'y'} recorded across {confirmResult.results.filter((r) => r.success).length} sheet{confirmResult.results.filter((r) => r.success).length !== 1 ? 's' : ''}.
                    </p>
                    {confirmResult.failedGroups > 0 && (
                      <p className="text-xs text-destructive font-semibold mt-1">
                        {confirmResult.failedGroups} group{confirmResult.failedGroups !== 1 ? 's' : ''} failed — see details below.
                      </p>
                    )}
                  </div>
                </div>

                {/* Results matrix */}
                <div className="rounded-2xl border border-border/50 overflow-hidden">
                  <div className="px-4 py-2 border-b border-border/30 bg-muted/20">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Commit Results</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-border/30">
                    {confirmResult.results.map((r) => (
                      <div key={r.sheetId} className="flex items-center gap-3 px-4 py-2.5">
                        <div className={cn(
                          'h-5 w-5 rounded-full flex items-center justify-center shrink-0',
                          r.success
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-destructive/10 text-destructive',
                        )}>
                          {r.success
                            ? <CheckCircle2 className="h-3 w-3" />
                            : <XCircle className="h-3 w-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">
                              {formatGroupDate(r.date)}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {r.vanPlateNumber}
                            </span>
                          </div>
                          {r.error && (
                            <p className="text-[10px] text-destructive mt-0.5 leading-snug">{r.error}</p>
                          )}
                        </div>
                        {r.success && (
                          <span className="text-[10px] font-mono font-bold text-emerald-600 shrink-0">
                            {r.processed} rows
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter className="shrink-0 pt-2 border-t border-border/40 mt-2">
          {step === 'upload' && (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                disabled={!file || !date || previewMutation.isPending}
                onClick={handlePreview}
                className="rounded-xl font-bold min-w-[150px]"
              >
                {previewMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Parsing…</>
                ) : (
                  'Preview Import'
                )}
              </Button>
            </>
          )}

          {step === 'preview' && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep('upload');
                  setPreview(null);
                  setExpandedKeys(new Set());
                  setIgnoredKeys(new Set());
                  previewMutation.reset();
                  confirmMutation.reset();
                }}
                disabled={confirmMutation.isPending}
              >
                ← Re-upload
              </Button>
              <Button
                disabled={!canConfirm || confirmMutation.isPending}
                onClick={handleConfirm}
                className="rounded-xl font-bold min-w-[200px]"
              >
                {confirmMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Importing…</>
                ) : (
                  `Import ${importableRows} Row${importableRows !== 1 ? 's' : ''} → ${importableSheets} Sheet${importableSheets !== 1 ? 's' : ''}`
                )}
              </Button>
            </>
          )}

          {step === 'done' && (
            <Button onClick={handleClose} className="rounded-xl font-bold">Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
