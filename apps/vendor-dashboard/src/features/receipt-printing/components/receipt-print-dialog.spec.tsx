import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ReceiptPrintBranding, ReceiptPrintData } from '@water-supply-crm/types';
import { receiptPrintingApi } from '../api/receipt-printing.api';
import { renderReceipt } from '../lib/receipt-canvas';
import * as transports from '../lib/print-transports';
import { usePrinterSettings } from '../lib/printer-settings';
import { useReceiptPrintStore } from '../lib/receipt-print.store';
import { dailySheetsApi } from '../../daily-sheets/api/daily-sheets.api';
import {
  useAddAdhocItem, useRecordWalkInDelivery, useUpdateDeliveryItem,
} from '../../daily-sheets/hooks/use-daily-sheets';
import { ReceiptPrintDialog } from './receipt-print-dialog';

jest.mock('../api/receipt-printing.api', () => ({
  receiptPrintingApi: { getData: jest.fn(), getBranding: jest.fn() },
}));
jest.mock('../../daily-sheets/api/daily-sheets.api', () => ({
  dailySheetsApi: { updateDeliveryItem: jest.fn(), addAdhocItem: jest.fn(), recordWalkIn: jest.fn() },
}));
// jsdom has no canvas: the renderer is exercised in a real browser, here only what the dialog does with it.
jest.mock('../lib/receipt-canvas', () => ({ renderReceipt: jest.fn() }));
jest.mock('../lib/print-transports', () => ({
  canvasToPngFile: jest.fn(),
  cleanupSystemPrint: jest.fn(),
  openRawbt: jest.fn(),
  printViaSystem: jest.fn(),
  shareReceipt: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// ESM-only URL-state library pulled in by the daily-sheet hooks; irrelevant to these tests.
jest.mock('nuqs', () => ({ useQueryState: jest.fn(), parseAsInteger: {}, parseAsString: {} }));

const getData = receiptPrintingApi.getData as jest.Mock;
const getBranding = receiptPrintingApi.getBranding as jest.Mock;
const render_ = renderReceipt as jest.Mock;

const branding: ReceiptPrintBranding = {
  name: 'LOREM WATER', payTo: 'LOREM', address: null, phones: null, email: null, website: null, taxLine: null,
  footerNote: null, paymentAccounts: [], logoDataUrl: null, profileConfigured: true,
};
const data = (name: string): ReceiptPrintData => ({
  customerName: name, customerCode: 'B1', productName: '19L', filledDropped: 1, emptyReceived: 1, filledReceived: 0,
  cashCollected: 0, pricePerBottle: 100, deliveryAmount: 100, financialBalanceAfter: 100, bottleBalanceAfter: 1,
  deliveryDate: '2026-11-20', deliveryTime: '10:00', depositCash: 0, depositBottles: 0,
});
const rendered = {
  canvas: { toDataURL: () => 'data:image/png;base64,AAAA' },
  bitmap: { width: 8, height: 1, data: new Uint8Array([0xff]) },
  logoFailed: false,
};

const setUserAgent = (value: string) =>
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const mount = () => render(<ReceiptPrintDialog />, { wrapper: wrapper() });
const openReceipt = (id = 'item-1') => act(() => useReceiptPrintStore.getState().openReceipt(id));
const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const ready = async (name: RegExp) => {
  await screen.findByAltText('Receipt preview');
  return button(name);
};
const printedText = () =>
  (render_.mock.calls.at(-1)?.[0] as { text?: string; value?: string }[]).map((b) => b.text ?? b.value ?? '').join('|');

beforeEach(() => {
  jest.clearAllMocks();
  setUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome');
  usePrinterSettings.setState({ method: null, paperWidth: 58, openAfterDelivery: false });
  useReceiptPrintStore.setState({ target: null });
  getBranding.mockResolvedValue(branding);
  getData.mockImplementation(async (id: string) => data(id === 'item-1' ? 'First Customer' : 'Second Customer'));
  render_.mockResolvedValue(rendered);
  (transports.canvasToPngFile as jest.Mock).mockResolvedValue(new File(['x'], 'r.png'));
});

describe('ReceiptPrintDialog', () => {
  it('renders nothing and calls no API until opened', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getBranding).not.toHaveBeenCalled();
  });

  it('keeps Print disabled until the receipt is ready, then sends ESC/POS to RawBT on Android', async () => {
    mount();
    openReceipt();
    expect(button(/print with rawbt/i).disabled).toBe(true);

    const print = await ready(/print with rawbt/i);
    await waitFor(() => expect(print.disabled).toBe(false));
    expect(getData).toHaveBeenCalledWith('item-1');
    expect(printedText()).toContain('First Customer');

    fireEvent.click(print);
    await waitFor(() => expect(transports.openRawbt).toHaveBeenCalledTimes(1));
    const job = (transports.openRawbt as jest.Mock).mock.calls[0][0] as Uint8Array;
    expect(Array.from(job.subarray(0, 2))).toEqual([0x1b, 0x40]);
  });

  it('uses the system dialog off Android and disables RawBT there', async () => {
    setUserAgent('Mozilla/5.0 (iPhone) Safari');
    mount();
    openReceipt();
    const print = await ready(/^print$/i);
    expect(button(/^rawbt$/i).disabled).toBe(true);
    fireEvent.click(print);
    await waitFor(() => expect(transports.printViaSystem).toHaveBeenCalledWith(rendered.canvas, 58));
    expect(transports.openRawbt).not.toHaveBeenCalled();
  });

  it('remembers the method and paper width, re-rendering for the new width', async () => {
    (transports.shareReceipt as jest.Mock).mockResolvedValue('shared');
    mount();
    openReceipt();
    await ready(/print with rawbt/i);

    fireEvent.click(button(/^share image$/i));
    fireEvent.click(button(/^80 mm$/i));

    await waitFor(() => expect(render_).toHaveBeenLastCalledWith(expect.anything(), 80, null));
    expect(usePrinterSettings.getState()).toMatchObject({ method: 'share', paperWidth: 80 });

    const share = await ready(/share receipt image/i);
    await waitFor(() => expect(share.disabled).toBe(false));
    fireEvent.click(share);
    await waitFor(() => expect(transports.shareReceipt).toHaveBeenCalled());
  });

  it('turns on "open after every delivery" only when ticked', async () => {
    mount();
    openReceipt();
    await ready(/print with rawbt/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /after every delivery/i }));
    expect(usePrinterSettings.getState()).toMatchObject({ openAfterDelivery: true, method: 'rawbt' });
  });

  it('shows the server message and retries', async () => {
    getData.mockRejectedValueOnce({ response: { data: { message: 'Receipt is only available for completed deliveries' } } });
    mount();
    openReceipt();
    await screen.findByText('Receipt is only available for completed deliveries');
    expect(button(/print with rawbt/i).disabled).toBe(true);

    fireEvent.click(button(/try again/i));
    await screen.findByAltText('Receipt preview');
  });

  it('offers a retry instead of an endless spinner when the phone is offline', async () => {
    onlineManager.setOnline(false);
    try {
      getBranding.mockRejectedValueOnce(new Error('Network Error'));
      getData.mockRejectedValueOnce(new Error('Network Error'));
      mount();
      openReceipt();
      await screen.findByText(/could not prepare the receipt/i);
      fireEvent.click(button(/try again/i));
      await screen.findByAltText('Receipt preview');
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('shows an error when the receipt cannot be drawn', async () => {
    render_.mockRejectedValue(new Error('no canvas'));
    mount();
    openReceipt();
    await screen.findByText(/could not prepare the receipt/i);
    expect(button(/print with rawbt/i).disabled).toBe(true);
  });

  it('warns about a missing company profile and a logo that failed', async () => {
    getBranding.mockResolvedValue({ ...branding, profileConfigured: false });
    render_.mockResolvedValue({ ...rendered, logoFailed: true });
    mount();
    openReceipt();
    await screen.findByText(/company profile is not set up/i);
    await screen.findByText(/logo could not be drawn/i);
  });

  it("never offers the previous customer's receipt while the next one loads", async () => {
    mount();
    openReceipt('item-1');
    await ready(/print with rawbt/i);

    let release: (v: ReceiptPrintData) => void = () => undefined;
    getData.mockImplementation(() => new Promise<ReceiptPrintData>((r) => (release = r)));
    openReceipt('item-2');

    expect(screen.queryByAltText('Receipt preview')).toBeNull();
    expect(button(/print with rawbt/i).disabled).toBe(true);

    await act(async () => release(data('Second Customer')));
    await screen.findByAltText('Receipt preview');
    expect(printedText()).toContain('Second Customer');
    expect(printedText()).not.toContain('First Customer');
  });

  it('refetches the figures when the same delivery is opened again', async () => {
    mount();
    openReceipt();
    await ready(/print with rawbt/i);
    act(() => useReceiptPrintStore.getState().close());
    openReceipt();
    await ready(/print with rawbt/i);
    expect(getData).toHaveBeenCalledTimes(2);
  });

  it('printer setup runs a test print without asking for any delivery', async () => {
    mount();
    act(() => useReceiptPrintStore.getState().openSetup());
    const test = await ready(/test: print with rawbt/i);
    await waitFor(() => expect(test.disabled).toBe(false));
    expect(printedText()).toContain('TEST PRINT');
    expect(getData).not.toHaveBeenCalled();
    fireEvent.click(test);
    await waitFor(() => expect(transports.openRawbt).toHaveBeenCalled());
  });
});

describe('recording flows offer the receipt', () => {
  const completed = { id: 'saved-1', status: 'COMPLETED' };
  beforeEach(() => usePrinterSettings.setState({ openAfterDelivery: true }));

  const run = async <T,>(hook: () => { mutateAsync: (v: T) => Promise<unknown> }, variables: T) => {
    const { result } = renderHook(hook, { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync(variables).catch(() => undefined);
    });
    return useReceiptPrintStore.getState().target;
  };

  it('after recording a route delivery', async () => {
    (dailySheetsApi.updateDeliveryItem as jest.Mock).mockResolvedValue({ data: completed });
    await expect(run(() => useUpdateDeliveryItem('s1'), { itemId: 'saved-1', data: {} })).resolves.toEqual({ itemId: 'saved-1' });
  });

  it('after an ad-hoc delivery', async () => {
    (dailySheetsApi.addAdhocItem as jest.Mock).mockResolvedValue({ data: completed });
    await expect(run(() => useAddAdhocItem('s1'), {} as never)).resolves.toEqual({ itemId: 'saved-1' });
  });

  it('after a walk-in delivery', async () => {
    (dailySheetsApi.recordWalkIn as jest.Mock).mockResolvedValue(completed);
    await expect(run(() => useRecordWalkInDelivery(), {} as never)).resolves.toEqual({ itemId: 'saved-1' });
  });

  it('never when saving failed', async () => {
    (dailySheetsApi.updateDeliveryItem as jest.Mock).mockRejectedValue({ response: { data: { code: 'STOCK_EXCEEDED' } } });
    const { result } = renderHook(() => useAddAdhocItem('s1'), { wrapper: wrapper() });
    (dailySheetsApi.addAdhocItem as jest.Mock).mockRejectedValue(new Error('offline'));
    await act(async () => {
      await result.current.mutateAsync({} as never).catch(() => undefined);
    });
    expect(useReceiptPrintStore.getState().target).toBeNull();
  });
});
