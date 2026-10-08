import * as fs from 'fs';
import { drawShadowShape } from './pdf-theme.util';
import { BrandImage, DocBranding, PaymentAccount, lightenHex } from './doc-branding';

/** Banner gradient for a branding (null = default Blue Ice gradient). */
export function bannerColors(branding: DocBranding): { light: string; dark: string } | null {
  return branding.gradient ?? null;
}

/**
 * Draw the logo inside its white chip.
 * 'builtin' (Dasani's bundled asset) keeps the original width-only call so Blue Ice's documents are
 * pixel-for-pixel what they always were; vendor-uploaded logos are fitted + centred in the chip
 * because their aspect ratio is unknown.
 */
export function drawLogoInChip(
  doc: PDFKit.PDFDocument,
  logo: BrandImage,
  builtinPath: string,
  chip: { x: number; y: number; w: number; h: number; padX: number; padY: number },
): void {
  try {
    if (logo === 'builtin') {
      if (fs.existsSync(builtinPath)) doc.image(builtinPath, chip.x + chip.padX, chip.y + chip.padY, { width: chip.w - chip.padX * 2 });
    } else if (logo) {
      doc.image(logo, chip.x + chip.padX, chip.y + chip.padY / 2, {
        fit: [chip.w - chip.padX * 2, chip.h - chip.padY],
        align: 'center',
        valign: 'center',
      });
    }
  } catch {
    // logo missing/unreadable — the chip still reads fine as a blank white box
  }
}

/** Contact lines printed in the footer, in order; missing values are simply skipped. */
export function contactLines(b: DocBranding): { text: string; bold: boolean }[] {
  const lines: { text: string; bold: boolean }[] = [];
  if (b.website) lines.push({ text: b.website, bold: true });
  if (b.email) lines.push({ text: b.email, bold: false });
  if (b.phones) lines.push({ text: b.phones, bold: false });
  if (b.taxLine) lines.push({ text: b.taxLine, bold: false });
  return lines;
}

/** Two-line variant for the compact receipt / salary slip: website, then "email · phones". */
export function compactContactLines(b: DocBranding): { text: string; bold: boolean }[] {
  const lines: { text: string; bold: boolean }[] = [];
  if (b.website) lines.push({ text: b.website, bold: true });
  const second = [b.email, b.phones].filter(Boolean).join('  ·  ');
  if (second) lines.push({ text: second, bold: false });
  if (b.taxLine) lines.push({ text: b.taxLine, bold: false });
  return lines;
}

// ── Payment cards ───────────────────────────────────────────────────────────────

export interface PaymentBlockStyle {
  gap: number;
  cardH: number;
  /** Extra height when a BANK account prints a 4th row (IBAN). */
  extraRowH: number;
  /** Print the IBAN row? (off on the compact A5 receipt, which has no vertical room for it). */
  includeIban: boolean;
  iconSize: number;
  iconX: number;
  iconY: number;
  iconRadius: number;
  iconFont: number;
  iconTextY: number;
  titleFont: number;
  titleY: number;
  /** Title x offset from the card, and how much narrower than the card its box is. */
  titleDx: number;
  titleWSub: number;
  bodyDx: number;
  bodyDy: number;
  rowStep: number;
  labelFont: number;
  valueFont: number;
  labelDy: number;
  valueDy: number;
  walletLabelFont: number;
  walletLabelDy: number;
  walletNumFont: number;
  walletNumDy: number;
}

export interface PaymentBlockPalette {
  navy: string;
  navyText: string;
  muted: string;
  white: string;
  border: string;
  cyan: string;
  green: string;
  amber: string;
  purple: string;
  radius: number;
}

const KIND_META: Record<PaymentAccount['kind'], { icon: string; title: string }> = {
  BANK: { icon: 'B', title: 'BANK TRANSFER' },
  EASYPAISA: { icon: 'E', title: 'EASYPAISA' },
  JAZZCASH: { icon: 'J', title: 'JAZZCASH' },
  RAAST: { icon: 'R', title: 'RAAST' },
};

function bankRows(a: PaymentAccount, includeIban: boolean): [string, string][] {
  const rows: [string, string][] = [
    ['Acc Title', a.accountTitle],
    ['Acc No', a.accountNumber],
    ['Bank', [a.bankName, a.branch].filter(Boolean).join(' - ') || '-'],
  ];
  if (includeIban && a.iban) rows.push(['IBAN', a.iban]);
  return rows;
}

/** Height of the cards area for a list of accounts (rows of two). */
export function paymentBlockHeight(accounts: PaymentAccount[], s: PaymentBlockStyle): number {
  if (!accounts.length) return 0;
  let total = 0;
  for (let i = 0; i < accounts.length; i += 2) {
    const pair = accounts.slice(i, i + 2);
    const rowH = s.cardH + (s.includeIban && pair.some((a) => a.kind === 'BANK' && a.iban) ? s.extraRowH : 0);
    total += rowH + (i + 2 < accounts.length ? s.gap : 0);
  }
  return total;
}

/**
 * Draws up to N payment cards, two per row, starting at `startY`. Returns the bottom y of the block.
 * With the legacy Dasani accounts (1 BANK without IBAN + 1 EASYPAISA) every coordinate equals the
 * original hand-written layout.
 */
export function drawPaymentCards(
  doc: PDFKit.PDFDocument,
  accounts: PaymentAccount[],
  startY: number,
  margin: number,
  contentW: number,
  s: PaymentBlockStyle,
  p: PaymentBlockPalette,
): number {
  const cardW = (contentW - s.gap) / 2;
  const color: Record<PaymentAccount['kind'], string> = { BANK: p.cyan, EASYPAISA: p.green, JAZZCASH: p.amber, RAAST: p.purple };
  let y = startY;
  for (let i = 0; i < accounts.length; i += 2) {
    const pair = accounts.slice(i, i + 2);
    const rowH = s.cardH + (s.includeIban && pair.some((a) => a.kind === 'BANK' && a.iban) ? s.extraRowH : 0);
    pair.forEach((a, col) => {
      const x = margin + col * (cardW + s.gap);
      const meta = KIND_META[a.kind];
      drawShadowShape(doc, x, y, cardW, rowH, p.radius, p.white, { shadowColor: p.navy, borderColor: p.border, shadowOpacity: 0.08 });
      doc.roundedRect(x + s.iconX, y + s.iconY, s.iconSize, s.iconSize, s.iconRadius).fill(color[a.kind]);
      doc.fillColor(p.white).font('Helvetica-Bold').fontSize(s.iconFont)
        .text(meta.icon, x + s.iconX, y + s.iconTextY, { width: s.iconSize, align: 'center', lineBreak: false });
      doc.fillColor(p.navyText).font('Helvetica-Bold').fontSize(s.titleFont)
        .text(meta.title, x + s.titleDx, y + s.titleY, { width: cardW - s.titleWSub, lineBreak: false });

      const bx = x + s.bodyDx;
      const by = y + s.bodyDy;
      const bw = cardW - s.bodyDx * 2;
      if (a.kind === 'BANK') {
        bankRows(a, s.includeIban).forEach(([lbl, val], r) => {
          const ry = by + r * s.rowStep;
          doc.fillColor(p.muted).font('Helvetica-Bold').fontSize(s.labelFont)
            .text(lbl.toUpperCase(), bx, ry + s.labelDy, { width: bw * 0.32, lineBreak: false });
          doc.fillColor(p.navyText).font('Helvetica-Bold').fontSize(s.valueFont)
            .text(val, bx + bw * 0.32, ry + s.valueDy, { width: bw - bw * 0.32, lineBreak: false });
        });
      } else {
        doc.fillColor(p.muted).font('Helvetica-Bold').fontSize(s.walletLabelFont)
          .text('ACCOUNT NUMBER', bx, by + s.walletLabelDy, { width: bw, lineBreak: false });
        doc.fillColor(p.navyText).font('Helvetica-Bold').fontSize(s.walletNumFont)
          .text(a.accountNumber, bx, by + s.walletNumDy, { width: bw, lineBreak: false });
      }
    });
    y += rowH + (i + 2 < accounts.length ? s.gap : 0);
  }
  return y;
}

/** Re-export so renderers need a single import. */
export { lightenHex };
