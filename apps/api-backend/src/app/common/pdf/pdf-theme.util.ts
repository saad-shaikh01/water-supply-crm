import * as fs from 'fs';

/** Blue Ice brand gradient — light water-blue fading into the logo's deep navy ink. */
export const BRAND_GRADIENT = {
  light: '#5fc7ee',
  dark: '#0d0d5e',
};

/**
 * Fills a rounded rect with a soft drop-shadow behind it, then an optional border on top.
 * `fill` accepts a plain color string or a PDFKit gradient (from doc.linearGradient(...)).
 */
export function drawShadowShape(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string | PDFKit.PDFGradient,
  opts: { shadowColor?: string; shadowOpacity?: number; borderColor?: string; borderWidth?: number } = {},
): void {
  const { shadowColor = '#0f172a', shadowOpacity = 0.1, borderColor, borderWidth = 0.75 } = opts;

  // Layered, progressively larger + fainter offsets approximate a soft blurred
  // drop-shadow (PDFKit has no blur filter) instead of one hard-edged rectangle.
  const layers = [
    { grow: 4, dy: 4, opacity: shadowOpacity * 0.35 },
    { grow: 2, dy: 2.5, opacity: shadowOpacity * 0.55 },
    { grow: 0.5, dy: 1, opacity: shadowOpacity * 0.7 },
  ];
  for (const layer of layers) {
    doc.fillOpacity(layer.opacity);
    doc.roundedRect(x - layer.grow / 2, y + layer.dy - layer.grow / 2, w + layer.grow, h + layer.grow, radius + layer.grow / 2).fill(shadowColor);
  }
  doc.fillOpacity(1);

  doc.roundedRect(x, y, w, h, radius).fill(fill);

  if (borderColor) {
    doc.roundedRect(x, y, w, h, radius).lineWidth(borderWidth).strokeColor(borderColor).stroke();
  }
}

/** Builds the brand's diagonal "water" gradient anchored to a given rect. */
export function brandGradient(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): PDFKit.PDFGradient {
  return doc.linearGradient(x, y, x + w, y + h).stop(0, BRAND_GRADIENT.light).stop(1, BRAND_GRADIENT.dark);
}

/** Draws a faint icon watermark clipped to a given rect (e.g. a table card), centered within it. */
export function drawClippedWatermark(
  doc: PDFKit.PDFDocument,
  logoPath: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { width?: number; opacity?: number; radius?: number } = {},
): void {
  const { width = Math.min(w * 0.42, 190), opacity = 0.05, radius = 10 } = opts;
  try {
    if (!fs.existsSync(logoPath)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img = (doc as any).openImage(logoPath);
    const height = (img.height / img.width) * width;
    const lx = x + (w - width) / 2;
    const ly = y + (h - height) / 2;

    doc.save();
    doc.roundedRect(x, y, w, h, radius).clip();
    doc.opacity(opacity);
    doc.image(logoPath, lx, ly, { width });
    doc.restore();
  } catch {
    // watermark is decorative only — card still reads fine without it
  }
}

/** Draws a large, very faint, centered logo watermark on the current page. */
export function drawWatermark(
  doc: PDFKit.PDFDocument,
  logoPath: string,
  pageW: number,
  pageH: number,
  opts: { width?: number; opacity?: number } = {},
): void {
  const { width = pageW * 0.62, opacity = 0.06 } = opts;
  try {
    if (!fs.existsSync(logoPath)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img = (doc as any).openImage(logoPath);
    const height = (img.height / img.width) * width;
    const x = (pageW - width) / 2;
    const y = (pageH - height) / 2;

    doc.save();
    doc.opacity(opacity);
    doc.image(logoPath, x, y, { width });
    doc.restore();
  } catch {
    // watermark is decorative only — page still reads fine without it
  }
}
