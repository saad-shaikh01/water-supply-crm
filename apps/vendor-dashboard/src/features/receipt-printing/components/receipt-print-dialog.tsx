'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Printer, RotateCcw, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, cn,
} from '@water-supply-crm/ui';
import { useAuthStore } from '../../../store/auth.store';
import { receiptPrintingApi } from '../api/receipt-printing.api';
import { effectiveMethod, isAndroid, usePrinterSettings, type PrintMethod } from '../lib/printer-settings';
import { useReceiptPrintStore, type PrintTarget } from '../lib/receipt-print.store';
import { buildReceiptBlocks, buildTestBlocks } from '../lib/receipt-layout';
import { renderReceipt, type RenderedReceipt } from '../lib/receipt-canvas';
import { encodeEscPos } from '../lib/escpos';
import {
  canvasToPngFile, cleanupSystemPrint, openRawbt, printViaSystem, shareReceipt,
} from '../lib/print-transports';

const METHODS: { value: PrintMethod; label: string; action: string; help: string }[] = [
  {
    value: 'rawbt',
    label: 'RawBT',
    action: 'Print with RawBT',
    help: 'Android only. Pair the printer in Bluetooth settings, install the RawBT app and select the printer inside it.',
  },
  {
    value: 'system',
    label: 'System print',
    action: 'Print',
    help: "Opens this device's print dialog. The printer needs a driver or print service installed on this device.",
  },
  {
    value: 'share',
    label: 'Share image',
    action: 'Share receipt image',
    help: "Send the receipt picture to your printer's own app. Downloads it where sharing is not supported.",
  },
];

interface Prepared extends RenderedReceipt {
  previewUrl: string;
  file: File;
}

/** Mounted once in the dashboard layout; opened through `useReceiptPrintStore`. */
export function ReceiptPrintDialog() {
  const target = useReceiptPrintStore((s) => s.target);
  const close = useReceiptPrintStore((s) => s.close);

  // Leaving the dashboard (logout, impersonation switch) must not leave a receipt queued.
  useEffect(() => () => useReceiptPrintStore.getState().close(), []);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      {target && (
        <DialogContent className="sm:max-w-md">
          <PrintPanel key={target.itemId ?? 'setup'} target={target} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PrintPanel({ target }: { target: PrintTarget }) {
  const vendorId = useAuthStore((s) => s.user?.vendorId);
  const { method: savedMethod, paperWidth, openAfterDelivery, setMethod, setPaperWidth, setOpenAfterDelivery } =
    usePrinterSettings();
  const android = isAndroid();
  const method = effectiveMethod(savedMethod, android);
  const active = METHODS.find((m) => m.value === method) ?? METHODS[1];

  const [testMode, setTestMode] = useState(target.itemId === null);
  const [showSettings, setShowSettings] = useState(target.itemId === null || savedMethod === null);

  const branding = useQuery({
    queryKey: ['receipt-print', 'branding', vendorId],
    queryFn: receiptPrintingApi.getBranding,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    // Fail (with "Try again") instead of pausing on a spinner when the signal drops.
    networkMode: 'always',
  });
  // Always fetched fresh: the delivery may have been edited since it was last printed.
  const data = useQuery({
    queryKey: ['receipt-print', 'data', target.itemId],
    queryFn: () => receiptPrintingApi.getData(target.itemId as string),
    enabled: !testMode && target.itemId !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    networkMode: 'always',
  });

  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [busy, setBusy] = useState(false);

  const brandingData = branding.data;
  const receiptData = testMode ? undefined : data.data;

  useEffect(() => {
    // Drop the previous image at once, so a tap can never print an outdated receipt.
    setPrepared(null);
    setRenderError(false);
    cleanupSystemPrint();
    if (!brandingData || (!testMode && !receiptData)) return;
    let cancelled = false;
    (async () => {
      try {
        const blocks = receiptData ? buildReceiptBlocks(receiptData, brandingData) : buildTestBlocks(brandingData);
        const rendered = await renderReceipt(blocks, paperWidth, brandingData.logoDataUrl);
        const file = await canvasToPngFile(
          rendered.canvas,
          `receipt-${receiptData ? `${receiptData.customerCode}-${receiptData.deliveryDate}` : 'test'}.png`.replace(/[^\w.-]+/g, '_'),
        );
        if (!cancelled) setPrepared({ ...rendered, file, previewUrl: rendered.canvas.toDataURL('image/png') });
      } catch {
        if (!cancelled) setRenderError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandingData, receiptData, testMode, paperWidth]);

  useEffect(() => () => cleanupSystemPrint(), []);

  const failed = branding.isError || (!testMode && data.isError) || renderError;
  const errorMessage =
    ((testMode ? branding.error : data.error ?? branding.error) as { response?: { data?: { message?: string } } } | null)
      ?.response?.data?.message ?? 'Could not prepare the receipt. Check your connection and try again.';

  const retry = () => {
    void branding.refetch();
    if (!testMode) void data.refetch();
  };

  const print = async () => {
    if (!prepared) return;
    setBusy(true);
    try {
      if (method === 'rawbt') {
        openRawbt(encodeEscPos(prepared.bitmap));
      } else if (method === 'system') {
        await printViaSystem(prepared.canvas, paperWidth);
      } else if ((await shareReceipt(prepared.file)) === 'downloaded') {
        toast.success('Receipt image downloaded');
      }
    } catch {
      toast.error('Printing failed. The delivery is saved; try again or choose another print method.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 min-w-0">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5 text-primary" />
          {testMode ? 'Printer setup' : 'Print receipt'}
        </DialogTitle>
        <DialogDescription>
          {testMode
            ? 'Choose how this device prints, then run a test print.'
            : 'The delivery is saved. Check the preview, then print.'}
        </DialogDescription>
      </DialogHeader>

      {brandingData && !brandingData.profileConfigured && (
        <div role="alert" className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            The company profile is not set up, so default details are used. Check the name, logo and account numbers
            below, and complete the Company Profile before giving receipts to customers.
          </span>
        </div>
      )}
      {prepared?.logoFailed && (
        <p role="alert" className="text-xs font-semibold text-amber-600">
          The company logo could not be drawn, so this receipt prints without it.
        </p>
      )}

      <div className="rounded-xl border border-border/50 bg-muted/30 p-3 max-h-[42dvh] overflow-y-auto">
        {failed ? (
          <div role="alert" className="py-6 text-center space-y-3">
            <p className="text-sm font-semibold text-destructive">{errorMessage}</p>
            <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={retry}>
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        ) : prepared ? (
          <img
            src={prepared.previewUrl}
            alt="Receipt preview"
            className="mx-auto block h-auto w-full bg-white"
            style={{ maxWidth: paperWidth === 58 ? 260 : 340 }}
          />
        ) : (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing receipt…
          </div>
        )}
      </div>

      <Button className="w-full h-12 rounded-xl font-bold gap-2" disabled={!prepared || failed || busy} onClick={print}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : method === 'share' ? (
          <Share2 className="h-4 w-4" />
        ) : (
          <Printer className="h-4 w-4" />
        )}
        {testMode ? `Test: ${active.action}` : active.action}
      </Button>

      <div className="space-y-3 border-t border-border/40 pt-3">
        <button
          type="button"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((v) => !v)}
          className="text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          {showSettings ? 'Hide printer settings' : 'Printer settings'}
        </button>

        {showSettings && (
          <div className="space-y-4">
            <Choice
              label="Print method"
              options={METHODS.map((m) => ({ value: m.value, label: m.label, disabled: m.value === 'rawbt' && !android }))}
              selected={method}
              onSelect={setMethod}
            />
            <p className="text-[11px] text-muted-foreground">{active.help}</p>
            <Choice
              label="Paper width"
              options={[{ value: 58, label: '58 mm' }, { value: 80, label: '80 mm' }]}
              selected={paperWidth}
              onSelect={setPaperWidth}
            />
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={openAfterDelivery}
                onChange={(e) => {
                  setOpenAfterDelivery(e.target.checked);
                  // Pin the shown method, so this device counts as set up.
                  setMethod(method);
                }}
              />
              Open this screen after every delivery on this device
            </label>
            {target.itemId !== null && (
              <Button size="sm" variant="outline" className="rounded-full text-xs font-bold" onClick={() => setTestMode((v) => !v)}>
                {testMode ? 'Back to receipt' : 'Test print'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Choice<T extends string | number>({
  label, options, selected, onSelect,
}: {
  label: string;
  options: { value: T; label: string; disabled?: boolean }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-bold">{label}</legend>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={option.value === selected}
            onClick={() => onSelect(option.value)}
            className={cn(
              'flex-1 rounded-xl border-2 px-2 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              option.value === selected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/50 text-muted-foreground hover:border-primary/30',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
