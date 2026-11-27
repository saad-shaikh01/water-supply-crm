import {
  cleanupSystemPrint, printStylesheet, printViaSystem, rawbtUrl, shareReceipt,
} from './print-transports';
import { effectiveMethod, usePrinterSettings } from './printer-settings';
import { offerReceiptAfterDelivery, useReceiptPrintStore } from './receipt-print.store';

describe('rawbtUrl', () => {
  it('wraps the raw bytes as a base64 intent for the RawBT app', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    const url = rawbtUrl(bytes);
    const match = /^intent:base64,([A-Za-z0-9+/=]+)#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/.exec(url);
    expect(match).not.toBeNull();
    const decoded = Uint8Array.from(atob((match as RegExpExecArray)[1]), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});

describe('system print', () => {
  const canvas = { width: 384, height: 800, toDataURL: () => 'data:image/png;base64,AAAA' } as unknown as HTMLCanvasElement;
  afterEach(cleanupSystemPrint);

  it('sizes the page to the paper and the receipt', () => {
    expect(printStylesheet(58, 384, 800)).toContain('size: 58mm 106mm');
    expect(printStylesheet(80, 576, 800)).toContain('size: 80mm 106mm');
    expect(printStylesheet(80, 576, 800)).toContain('max-width: 72mm');
  });

  it('mounts only one print root, calls print, and cleans up on request', async () => {
    const print = jest.fn();
    window.print = print;

    await printViaSystem(canvas, 58);
    await printViaSystem(canvas, 58);

    expect(print).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('#thermal-print-root img')).toHaveLength(1);
    expect(document.querySelectorAll('#thermal-print-style')).toHaveLength(1);

    cleanupSystemPrint();
    expect(document.getElementById('thermal-print-root')).toBeNull();
    expect(document.getElementById('thermal-print-style')).toBeNull();
  });
});

describe('shareReceipt', () => {
  const file = new File(['x'], 'receipt.png', { type: 'image/png' });
  const nav = navigator as unknown as { share?: jest.Mock; canShare?: jest.Mock };
  let click: jest.SpyInstance;

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
    click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => {
    delete nav.share;
    delete nav.canShare;
    click.mockRestore();
  });

  it('uses the share sheet when files can be shared', async () => {
    nav.canShare = jest.fn(() => true);
    nav.share = jest.fn().mockResolvedValue(undefined);
    await expect(shareReceipt(file)).resolves.toBe('shared');
    expect(nav.share).toHaveBeenCalledWith({ files: [file] });
    expect(click).not.toHaveBeenCalled();
  });

  it('reports a dismissed share sheet without downloading', async () => {
    nav.canShare = jest.fn(() => true);
    nav.share = jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    await expect(shareReceipt(file)).resolves.toBe('cancelled');
    expect(click).not.toHaveBeenCalled();
  });

  it('downloads where sharing is unsupported or fails', async () => {
    await expect(shareReceipt(file)).resolves.toBe('downloaded');
    nav.canShare = jest.fn(() => true);
    nav.share = jest.fn().mockRejectedValue(new Error('NotAllowed'));
    await expect(shareReceipt(file)).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe('printer settings and the after-delivery offer', () => {
  beforeEach(() => {
    usePrinterSettings.setState({ method: null, paperWidth: 58, openAfterDelivery: false });
    useReceiptPrintStore.setState({ target: null });
  });

  it('defaults to RawBT on Android and system print elsewhere; RawBT never applies off Android', () => {
    expect(effectiveMethod(null, true)).toBe('rawbt');
    expect(effectiveMethod(null, false)).toBe('system');
    expect(effectiveMethod('rawbt', false)).toBe('system');
    expect(effectiveMethod('share', true)).toBe('share');
  });

  it('persists the choices on this device', () => {
    usePrinterSettings.getState().setPaperWidth(80);
    usePrinterSettings.getState().setMethod('share');
    expect(JSON.parse(localStorage.getItem('ws-receipt-printer') as string).state).toMatchObject({
      method: 'share', paperWidth: 80, openAfterDelivery: false,
    });
  });

  it('stays silent unless this device asked for it (default off)', () => {
    offerReceiptAfterDelivery({ id: 'i1', status: 'COMPLETED' });
    expect(useReceiptPrintStore.getState().target).toBeNull();
  });

  it('opens only for a completed delivery', () => {
    usePrinterSettings.getState().setOpenAfterDelivery(true);
    for (const item of [undefined, null, {}, { id: 'i1', status: 'NOT_AVAILABLE' }, { id: 'i1', status: 'EMPTY_ONLY' }, { status: 'COMPLETED' }]) {
      offerReceiptAfterDelivery(item);
    }
    expect(useReceiptPrintStore.getState().target).toBeNull();

    offerReceiptAfterDelivery({ id: 'i2', status: 'COMPLETED' });
    expect(useReceiptPrintStore.getState().target).toEqual({ itemId: 'i2' });
  });
});
