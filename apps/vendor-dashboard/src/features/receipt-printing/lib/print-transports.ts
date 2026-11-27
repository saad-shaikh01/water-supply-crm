/** The three ways a rendered receipt leaves the browser. Each must be started from a user tap. */
import type { PaperWidth } from './printer-settings';

// ── RawBT (Android) ──────────────────────────────────────────────────────────

const RAWBT_PACKAGE = 'ru.a402d.rawbtprinter';

/**
 * Android intent URL handing raw ESC/POS bytes to the RawBT app; Chrome offers the Play Store
 * when it is not installed. Format as emitted by escpos-php's RawbtPrintConnector.
 */
export function rawbtUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `intent:base64,${btoa(binary)}#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};end;`;
}

export function openRawbt(bytes: Uint8Array): void {
  window.location.href = rawbtUrl(bytes);
}

// ── Browser print dialog ─────────────────────────────────────────────────────

const ROOT_ID = 'thermal-print-root';
const STYLE_ID = 'thermal-print-style';
const PRINTABLE_MM: Record<PaperWidth, number> = { 58: 48, 80: 72 };
const MARGIN_MM = 3;

export function printStylesheet(paperWidth: PaperWidth, imageWidth: number, imageHeight: number): string {
  const printable = PRINTABLE_MM[paperWidth];
  const pageHeight = Math.ceil((printable * imageHeight) / imageWidth) + MARGIN_MM * 2;
  return `
@media screen { #${ROOT_ID} { display: none !important; } }
@media print {
  @page { size: ${paperWidth}mm ${pageHeight}mm; margin: 0; }
  html, body {
    margin: 0 !important; padding: 0 !important; width: auto !important; height: auto !important;
    min-height: 0 !important; overflow: visible !important; background: #fff !important;
  }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block !important; }
  #${ROOT_ID} img {
    display: block; width: 100%; max-width: ${printable}mm; margin: 0 auto; padding: ${MARGIN_MM}mm 0 0;
    image-rendering: pixelated;
  }
}`;
}

/** Removes what `printViaSystem` mounted. Safe to call when nothing is mounted. */
export function cleanupSystemPrint(): void {
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}

/**
 * Prints only the receipt image through the browser's dialog. The nodes stay mounted (invisible on
 * screen) until `cleanupSystemPrint`: mobile browsers take their print snapshot after
 * `window.print()` has already returned.
 */
export async function printViaSystem(
  canvas: HTMLCanvasElement,
  paperWidth: PaperWidth,
): Promise<void> {
  cleanupSystemPrint();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = printStylesheet(paperWidth, canvas.width, canvas.height);
  const root = document.createElement('div');
  root.id = ROOT_ID;
  const image = document.createElement('img');
  image.alt = 'Receipt';
  image.src = canvas.toDataURL('image/png');
  root.appendChild(image);
  document.head.appendChild(style);
  document.body.appendChild(root);
  await image.decode?.().catch(() => undefined);
  window.print();
}

// ── Share / download ─────────────────────────────────────────────────────────

export function canvasToPngFile(canvas: HTMLCanvasElement, filename: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(new File([blob], filename, { type: 'image/png' }));
      else reject(new Error('Could not create the receipt image'));
    }, 'image/png');
  });
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  // Revoking in the same tick cancels the download in some mobile browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** Share sheet where the browser can share files, otherwise a download. */
export async function shareReceipt(file: File): Promise<ShareOutcome> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'cancelled';
    }
  }
  download(file);
  return 'downloaded';
}
