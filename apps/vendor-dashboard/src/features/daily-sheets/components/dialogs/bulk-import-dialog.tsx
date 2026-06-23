'use client';

import { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button,
} from '@water-supply-crm/ui';
import {
  Upload, FileSpreadsheet, AlertCircle, CheckCircle2,
  Loader2, Download, X, AlertTriangle,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { dailySheetsApi } from '../../api/daily-sheets.api';
import type { SheetImportPreviewResponse } from '../../api/daily-sheets.api';
import { usePreviewBulkImport, useConfirmBulkImport } from '../../hooks/use-daily-sheets';

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];
const ACCEPTED_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const MAX_BYTES = 10 * 1024 * 1024;

type Step = 'upload' | 'preview' | 'done';

const slideVariants = {
  enter: { x: 40, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -40, opacity: 0 },
};

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
}

export function BulkImportDialog({ open, onClose, sheetId }: BulkImportDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<SheetImportPreviewResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewMutation = usePreviewBulkImport(sheetId);
  const confirmMutation = useConfirmBulkImport(sheetId);

  const reset = () => {
    setStep('upload');
    setFile(null);
    setFileError(null);
    setIsDragging(false);
    setPreview(null);
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
      setFileError('File size must be under 10 MB.');
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
    // reset input so the same file can be re-selected after removal
    e.target.value = '';
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await dailySheetsApi.downloadBulkImportTemplate(sheetId);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-template-${sheetId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download template');
    }
  };

  const handlePreview = async () => {
    if (!file) return;
    try {
      const result = await previewMutation.mutateAsync(file);
      setPreview(result);
      setStep('preview');
    } catch {
      // onError in the hook fires the toast; step stays on 'upload'
    }
  };

  const handleConfirm = async () => {
    if (!preview || preview.valid.length === 0) return;
    const rows = preview.valid.map((r) => ({
      itemId: r.itemId!,
      status: r.importStatus as 'COMPLETED' | 'SKIPPED' | 'FAILED',
      filledDropped: r.filledDropped,
      emptyReturned: r.emptyReturned,
      cashCollected: r.cashCollected,
      failureReason: r.failureReason,
    }));
    try {
      await confirmMutation.mutateAsync(rows);
      setStep('done');
    } catch {
      // onError in the hook fires the toast; step stays on 'preview'
    }
  };

  const allWarnings = preview?.valid.flatMap((r) => r.warnings) ?? [];
  const uniqueWarnings = [...new Set(allWarnings)];
  const canImport = (preview?.valid.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Deliveries
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <AnimatePresence mode="wait" initial={false}>
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
                    Download the pre-filled template, enter delivery data in the unlocked columns, then upload it here.
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

                {/* Drop zone */}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                          setFileError(null);
                        }}
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
                        <p className="text-sm font-semibold">Drop your Excel file here</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          or click to browse — .xlsx, .xls, max 10 MB
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
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Rows', value: preview.summary.total, color: 'text-foreground' },
                    { label: 'Valid', value: preview.summary.valid, color: 'text-emerald-600' },
                    {
                      label: 'Invalid',
                      value: preview.summary.invalid,
                      color: preview.summary.invalid > 0 ? 'text-destructive' : 'text-muted-foreground',
                    },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-2xl border border-border/50 bg-muted/20 p-3 text-center"
                    >
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.label}</p>
                      <p className={cn('text-2xl font-black font-mono', s.color)}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Sanitization warnings */}
                {uniqueWarnings.length > 0 && (
                  <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 space-y-1.5">
                    <p className="text-xs font-black text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Data sanitization warnings — values were auto-corrected
                    </p>
                    <ul className="space-y-0.5 pl-1">
                      {uniqueWarnings.slice(0, 6).map((w, i) => (
                        <li key={i} className="text-[11px] text-amber-700 dark:text-amber-500">• {w}</li>
                      ))}
                      {uniqueWarnings.length > 6 && (
                        <li className="text-[11px] text-amber-700 dark:text-amber-500">
                          • …and {uniqueWarnings.length - 6} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Invalid rows */}
                {preview.invalid.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-black uppercase text-destructive px-1">
                      {preview.invalid.length} invalid row{preview.invalid.length !== 1 ? 's' : ''} — will be skipped
                    </p>
                    <div className="rounded-2xl border border-destructive/20 bg-destructive/5 overflow-hidden">
                      <div className="max-h-44 overflow-y-auto divide-y divide-destructive/10">
                        {preview.invalid.map((row) => (
                          <div
                            key={row.rowIndex}
                            className="px-4 py-2.5 grid grid-cols-[auto_1fr] gap-3 items-start"
                          >
                            <span className="text-[10px] font-mono text-muted-foreground mt-0.5">
                              row {row.rowIndex}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-foreground truncate">
                                {row.customerName || row.customerCode}
                                {row.productName ? ` — ${row.productName}` : ''}
                              </p>
                              {row.errors.map((err, i) => (
                                <p key={i} className="text-[11px] text-destructive mt-0.5 leading-snug">
                                  ↳ {err}
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Valid rows */}
                {preview.valid.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-black uppercase text-emerald-600 px-1">
                      {preview.valid.length} valid row{preview.valid.length !== 1 ? 's' : ''} ready to import
                    </p>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
                      <div className="max-h-56 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0">
                            <tr className="border-b border-emerald-500/20 bg-emerald-500/10">
                              <th className="text-left px-3 py-2 font-bold text-[10px] uppercase text-muted-foreground">
                                Customer
                              </th>
                              <th className="text-left px-3 py-2 font-bold text-[10px] uppercase text-muted-foreground hidden sm:table-cell">
                                Product
                              </th>
                              <th className="text-center px-3 py-2 font-bold text-[10px] uppercase text-muted-foreground">
                                Now
                              </th>
                              <th className="text-center px-3 py-2 font-bold text-[10px] uppercase text-muted-foreground">
                                → Import
                              </th>
                              <th className="text-right px-3 py-2 font-bold text-[10px] uppercase text-muted-foreground">
                                Filled
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-500/10">
                            {preview.valid.map((row) => (
                              <tr key={row.rowIndex} className="hover:bg-emerald-500/5 transition-colors">
                                <td className="px-3 py-2 font-semibold max-w-[140px] truncate">
                                  {row.customerName || row.customerCode}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground max-w-[100px] truncate hidden sm:table-cell">
                                  {row.productName}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {row.currentDbStatus}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className="font-mono text-[10px] font-bold text-emerald-600">
                                    {row.importStatus}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono font-bold">
                                  {row.filledDropped}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-8 flex flex-col items-center gap-3 text-center">
                    <AlertCircle className="h-8 w-8 text-destructive" />
                    <div>
                      <p className="text-sm font-bold">No valid rows to import</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Fix all errors in the Excel file and re-upload.
                      </p>
                    </div>
                  </div>
                )}

                {/* Overwrite warning */}
                {canImport && (
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 leading-relaxed">
                      Any manual delivery entries made to this sheet since this preview was loaded will be overwritten by this import. This action cannot be undone.
                    </p>
                  </div>
                )}

                {/* Confirm error */}
                {confirmMutation.isError && (
                  <div className="flex items-center gap-2 text-sm text-destructive font-semibold px-1">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {(confirmMutation.error as any)?.response?.data?.message ??
                      'Import failed. Please try again.'}
                  </div>
                )}
              </motion.div>
            )}

            {step === 'done' && (
              <motion.div
                key="done"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18 }}
                className="py-14 flex flex-col items-center gap-4"
              >
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
                  className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600"
                >
                  <CheckCircle2 className="h-8 w-8" />
                </motion.div>
                <div className="text-center">
                  <p className="text-lg font-black">Import Complete</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {preview?.summary.valid ?? 0} deliver{(preview?.summary.valid ?? 0) !== 1 ? 'ies' : 'y'} recorded successfully.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter className="shrink-0 pt-2 border-t border-border/40 mt-2">
          {step === 'upload' && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                disabled={!file || previewMutation.isPending}
                onClick={handlePreview}
                className="rounded-xl font-bold min-w-[140px]"
              >
                {previewMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Parsing…
                  </>
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
                  previewMutation.reset();
                  confirmMutation.reset();
                }}
                disabled={confirmMutation.isPending}
              >
                ← Re-upload
              </Button>
              <Button
                disabled={!canImport || confirmMutation.isPending}
                onClick={handleConfirm}
                className="rounded-xl font-bold min-w-[180px]"
              >
                {confirmMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Importing…
                  </>
                ) : (
                  `Import ${preview?.summary.valid ?? 0} Row${(preview?.summary.valid ?? 0) !== 1 ? 's' : ''}`
                )}
              </Button>
            </>
          )}

          {step === 'done' && (
            <Button onClick={handleClose} className="rounded-xl font-bold">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
