import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PrintMethod = 'rawbt' | 'system' | 'share';
export type PaperWidth = 58 | 80;

interface PrinterSettingsState {
  /** null = not chosen yet; see `effectiveMethod`. */
  method: PrintMethod | null;
  paperWidth: PaperWidth;
  openAfterDelivery: boolean;
  setMethod: (method: PrintMethod) => void;
  setPaperWidth: (paperWidth: PaperWidth) => void;
  setOpenAfterDelivery: (openAfterDelivery: boolean) => void;
}

/** Per device (localStorage): every driver's phone is paired with its own printer. */
export const usePrinterSettings = create<PrinterSettingsState>()(
  persist(
    (set) => ({
      method: null,
      paperWidth: 58,
      openAfterDelivery: false,
      setMethod: (method) => set({ method }),
      setPaperWidth: (paperWidth) => set({ paperWidth }),
      setOpenAfterDelivery: (openAfterDelivery) => set({ openAfterDelivery }),
    }),
    { name: 'ws-receipt-printer' },
  ),
);

export const isAndroid = (): boolean =>
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/** RawBT exists only on Android, so it is never effective anywhere else. */
export function effectiveMethod(method: PrintMethod | null, android: boolean): PrintMethod {
  if (method === null) return android ? 'rawbt' : 'system';
  if (method === 'rawbt' && !android) return 'system';
  return method;
}
