/** Draws receipt blocks onto a canvas at the printer's native dot width. */
import type { PaperWidth } from './printer-settings';
import type { ReceiptBlock, TextSize } from './receipt-layout';
import { contentBounds, ditherInPlace, packBitmap, thresholdInPlace, type Bitmap } from './monochrome';

/** Printable dots at 203 dpi: 48mm on 58mm paper, 72mm on 80mm paper. */
export const DOT_WIDTH: Record<PaperWidth, number> = { 58: 384, 80: 576 };

const FONT_PX: Record<TextSize, number> = { sm: 20, md: 23, lg: 30, xl: 36 };
const ROW_PX = 22;
const PAD_X = 4;
const PAD_Y = 8;
const ROW_GAP = 12;
const DIVIDER_HEIGHT = 18;
const LOGO_MAX_HEIGHT = 150;
const LOGO_GAP = 18;

export const fontFor = (px: number, bold?: boolean) => `${bold ? 'bold ' : ''}${px}px Arial, Helvetica, sans-serif`;
const lineHeight = (px: number) => Math.round(px * 1.3);

export type Measure = (text: string, font: string) => number;

export type DrawOp =
  | { kind: 'text'; text: string; font: string; x: number; y: number; align: 'left' | 'center' | 'right' }
  | { kind: 'divider'; y: number }
  | { kind: 'logo'; x: number; y: number };

/** Greedy word wrap; a single word wider than the line is broken between characters. */
export function wrapText(text: string, font: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined, font) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const char of Array.from(word)) {
      if (line && measure(line + char, font) > maxWidth) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function layoutReceipt(
  blocks: ReceiptBlock[],
  width: number,
  measure: Measure,
  logo: { width: number; height: number } | null,
): { height: number; ops: DrawOp[] } {
  const ops: DrawOp[] = [];
  const inner = width - PAD_X * 2;
  let y = PAD_Y;

  const addLines = (lines: string[], font: string, px: number, align: 'left' | 'center' | 'right') => {
    const x = align === 'left' ? PAD_X : align === 'right' ? width - PAD_X : Math.round(width / 2);
    for (const text of lines) {
      ops.push({ kind: 'text', text, font, x, y, align });
      y += lineHeight(px);
    }
  };

  for (const block of blocks) {
    if (block.kind === 'logo') {
      if (!logo) continue;
      ops.push({ kind: 'logo', x: Math.round((width - logo.width) / 2), y });
      y += logo.height + LOGO_GAP;
    } else if (block.kind === 'divider') {
      ops.push({ kind: 'divider', y: y + DIVIDER_HEIGHT / 2 });
      y += DIVIDER_HEIGHT;
    } else if (block.kind === 'text') {
      const px = FONT_PX[block.size];
      const font = fontFor(px, block.bold);
      addLines(wrapText(block.text, font, inner, measure), font, px, block.align ?? 'left');
    } else {
      const labelFont = fontFor(ROW_PX);
      const valueFont = fontFor(ROW_PX, block.bold);
      if (measure(block.label, labelFont) + ROW_GAP + measure(block.value, valueFont) <= inner) {
        ops.push({ kind: 'text', text: block.label, font: labelFont, x: PAD_X, y, align: 'left' });
        addLines([block.value], valueFont, ROW_PX, 'right');
      } else {
        // Does not fit side by side (long name / address): value goes underneath, right-aligned.
        addLines(wrapText(block.label, labelFont, inner, measure), labelFont, ROW_PX, 'left');
        addLines(wrapText(block.value, valueFont, inner, measure), valueFont, ROW_PX, 'right');
      }
    }
  }

  return { height: y + PAD_Y, ops };
}

/** Largest size inside the logo box, never enlarging past 2×. */
export function fitLogo(natural: { width: number; height: number }, paperDots: number) {
  const scale = Math.min((paperDots * 0.7) / natural.width, LOGO_MAX_HEIGHT / natural.height, 2);
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw the receipt');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Logo could not be read'));
    image.src = src;
  });
}

/** The logo trimmed of blank margins, scaled to the paper and dithered. Null if it is blank. */
async function prepareLogo(src: string, paperDots: number): Promise<HTMLCanvasElement | null> {
  const image = await loadImage(src);
  // Scan at a bounded size: a 1 MB upload can still be thousands of pixels wide.
  const scan = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight));
  const full = createCanvas(
    Math.max(1, Math.round(image.naturalWidth * scan)),
    Math.max(1, Math.round(image.naturalHeight * scan)),
  );
  full.ctx.drawImage(image, 0, 0, full.canvas.width, full.canvas.height);
  const bounds = contentBounds(full.ctx.getImageData(0, 0, full.canvas.width, full.canvas.height).data, full.canvas.width);
  if (!bounds) return null;

  const size = fitLogo(bounds, paperDots);
  const out = createCanvas(size.width, size.height);
  out.ctx.drawImage(full.canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, size.width, size.height);
  const pixels = out.ctx.getImageData(0, 0, size.width, size.height);
  ditherInPlace(pixels.data, size.width);
  out.ctx.putImageData(pixels, 0, 0);
  return out.canvas;
}

export interface RenderedReceipt {
  canvas: HTMLCanvasElement;
  bitmap: Bitmap;
  /** The vendor has a logo but it could not be drawn. */
  logoFailed: boolean;
}

export async function renderReceipt(
  blocks: ReceiptBlock[],
  paperWidth: PaperWidth,
  logoDataUrl: string | null,
): Promise<RenderedReceipt> {
  const width = DOT_WIDTH[paperWidth];
  let logo: HTMLCanvasElement | null = null;
  let logoFailed = false;
  if (logoDataUrl) {
    try {
      logo = await prepareLogo(logoDataUrl, width);
      logoFailed = !logo;
    } catch {
      logoFailed = true;
    }
  }

  const scratch = createCanvas(1, 1).ctx;
  const measure: Measure = (text, font) => {
    scratch.font = font;
    return scratch.measureText(text).width;
  };
  const { height, ops } = layoutReceipt(blocks, width, measure, logo);

  const { canvas, ctx } = createCanvas(width, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  for (const op of ops) {
    if (op.kind === 'logo') {
      if (logo) ctx.drawImage(logo, op.x, op.y);
    } else if (op.kind === 'divider') {
      for (let x = PAD_X; x < width - PAD_X; x += 12) ctx.fillRect(x, op.y, 7, 2);
    } else {
      ctx.font = op.font;
      ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
    }
  }

  const pixels = ctx.getImageData(0, 0, width, height);
  thresholdInPlace(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  return { canvas, bitmap: packBitmap(pixels.data, width), logoFailed };
}
