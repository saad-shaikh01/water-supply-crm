import { create } from 'zustand';
import { usePrinterSettings } from './printer-settings';

/** `itemId: null` = printer setup / test print. */
export type PrintTarget = { itemId: string | null };

interface ReceiptPrintState {
  target: PrintTarget | null;
  openReceipt: (itemId: string) => void;
  openSetup: () => void;
  close: () => void;
}

export const useReceiptPrintStore = create<ReceiptPrintState>()((set) => ({
  target: null,
  openReceipt: (itemId) => set({ target: { itemId } }),
  openSetup: () => set({ target: { itemId: null } }),
  close: () => set({ target: null }),
}));

/**
 * Call with the saved item after a delivery is recorded. Opens the print dialog only when this
 * device asked for it and the delivery actually has a receipt (COMPLETED).
 */
export function offerReceiptAfterDelivery(item: unknown): void {
  const saved = item as { id?: unknown; status?: unknown } | null | undefined;
  if (!usePrinterSettings.getState().openAfterDelivery) return;
  if (typeof saved?.id !== 'string' || saved.status !== 'COMPLETED') return;
  useReceiptPrintStore.getState().openReceipt(saved.id);
}
