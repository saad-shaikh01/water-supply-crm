import { Injectable } from '@nestjs/common';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { drawShadowShape, brandGradient, drawWatermark } from '../../common/pdf/pdf-theme.util';
import { DocBranding, imageSource } from '../../common/pdf/doc-branding';
import { LEGACY_DOC_BRANDING } from '../../common/pdf/legacy-dasani-branding';
import {
  PaymentBlockStyle,
  bannerColors,
  compactContactLines,
  drawLogoInChip,
  drawPaymentCards,
} from '../../common/pdf/brand-draw';

export interface DeliveryReceiptData {
  customerName: string;
  customerCode: string;
  productName: string;
  /** Plate number / code of the van that made this delivery (e.g. "V1"). */
  van?: string;
  filledDropped: number;
  emptyReceived: number;
  /** Already-filled bottles received back from the customer (account closing, excess stock return). */
  filledReceived?: number;
  cashCollected: number;
  pricePerBottle: number;
  financialBalanceAfter: number;
  bottleBalanceAfter: number;
  deliveryDate: string; // YYYY-MM-DD
  deliveryTime: string; // HH:MM
  vendorName: string;
  /** MONTHLY customers only — balance carried in from before this month. */
  previousMonthOutstanding?: number;
  /** Cash deposit (Rs.) the vendor holds for this customer — shown as 0 when absent. */
  depositCash?: number;
  /** Bottle deposit (bottle count, all products) the vendor holds — shown as 0 when absent. */
  depositBottles?: number;
}

// Blue Ice brand logo — same asset used by the customer statement PDF.
export const LOGO_PATH = path.join(__dirname, 'assets', 'blue-ice-logo.png');

// Company identity, logo and payment accounts come from the vendor's DocBranding
// (VendorBrandingService.resolveForDocs) — nothing vendor-specific is hardcoded here.

export const C = {
  cyan:     '#0891b2',
  navy:     '#0f172a',
  navyText: '#111827',
  accent:   '#b91c1c',
  muted:    '#6b7280',
  mutedLt:  '#9ca3af',
  border:   '#e5e7eb',
  surface:  '#f8fafc',
  text:     '#1e293b',
  white:    '#ffffff',
  red:      '#dc2626',
  green:    '#059669',
  amber:    '#d97706',
  purple:   '#7c3aed',
  closeRed: '#fca5a5',
  closeGrn: '#86efac',
};

const MARGIN    = 36;
const PAGE_W    = 419.53; // A5
const PAGE_H    = 595.28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RADIUS    = 10;
const BANNER_H  = 66;
const ROW_H     = 16;

const PAY_STYLE: PaymentBlockStyle = {
  gap: 10, cardH: 56, extraRowH: 0, includeIban: false,
  iconSize: 16, iconX: 8, iconY: 7, iconRadius: 4, iconFont: 8, iconTextY: 11,
  titleFont: 7.5, titleY: 12, titleDx: 30, titleWSub: 38,
  bodyDx: 8, bodyDy: 29, rowStep: 9,
  labelFont: 5.5, valueFont: 6.5, labelDy: 0.5, valueDy: 0,
  walletLabelFont: 5.5, walletLabelDy: 0.5, walletNumFont: 12, walletNumDy: 9,
};

interface DetailRow {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
}

@Injectable()
export class DeliveryReceiptPdfService {
  /** `branding` omitted = legacy Dasani/Blue Ice identity (see DocBranding). */
  async generate(data: DeliveryReceiptData, branding: DocBranding = LEGACY_DOC_BRANDING): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: MARGIN });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawWatermark(doc, imageSource(branding.logo, LOGO_PATH), PAGE_W, PAGE_H);

      this.drawBanner(doc, branding);

      doc.y += 10;
      this.drawSectionTitle(doc, 'INVOICE');
      doc.y += 8;

      // Net of any filled bottles taken back — credited at the same per-bottle rate.
      const deliveryAmount = (data.filledDropped - (data.filledReceived ?? 0)) * data.pricePerBottle;
      const rows: DetailRow[] = [
        { label: 'Date / Time',       value: `${data.deliveryDate}  ·  ${data.deliveryTime}` },
        { label: 'Customer',          value: data.customerName },
        { label: 'Customer Code',     value: data.customerCode },
        ...this.depositRow(data),
        { label: 'Product',           value: data.productName },
        { label: 'Price / Bottle',    value: `Rs. ${data.pricePerBottle.toFixed(2)}` },
        ...(data.van ? [{ label: 'Van', value: data.van }] : []),
        { label: 'Bottles Delivered', value: `${data.filledDropped}` },
        { label: 'Empty Received',    value: `${data.emptyReceived}` },
        ...(data.filledReceived ? [{ label: 'Filled Received', value: `${data.filledReceived}` }] : []),
        { label: 'Balance Bottles',   value: `${data.bottleBalanceAfter} bottles` },
        { label: 'Delivery Amount',   value: `Rs. ${deliveryAmount.toFixed(2)}`, emphasize: true },
        { label: 'Cash Collected',    value: `Rs. ${data.cashCollected.toFixed(2)}` },
      ];
      this.drawDetailCard(doc, rows);

      if (data.previousMonthOutstanding != null) {
        doc.y += 8;
        this.drawBalanceBar(doc, 'PREVIOUS MONTH OUTSTANDING', data.previousMonthOutstanding);
      }

      doc.y += 8;
      // financialBalanceAfter < 0 means the customer has overpaid / is in
      // advance credit (e.g. bill Rs.440, paid Rs.500 → balance -60) — the
      // bar must say so instead of always reading "outstanding balance",
      // which told fully-paid/advance customers they still owed money.
      const totalLabel =
        data.financialBalanceAfter < 0
          ? 'ADVANCE / CREDIT BALANCE'
          : data.financialBalanceAfter === 0
            ? 'NO OUTSTANDING BALANCE'
            : 'TOTAL OUTSTANDING BALANCE';
      this.drawBalanceBar(doc, totalLabel, data.financialBalanceAfter);

      doc.y += 10;
      this.drawThankYouFooter(doc, branding);

      doc.end();
    });
  }

  // "Deposit" row — always shown for every customer: "Rs. <cash> / <n> bottles" (0 when none held).
  private depositRow(data: DeliveryReceiptData): DetailRow[] {
    const cash = data.depositCash ?? 0;
    const bottles = data.depositBottles ?? 0;
    return [{
      label: 'Deposit',
      value: `Rs. ${cash.toLocaleString('en-PK', { maximumFractionDigits: 2 })} / ${bottles} ${bottles === 1 ? 'bottle' : 'bottles'}`,
    }];
  }

  // ── Brand banner: gradient card with logo chip (left) + vendor identity (right) ─
  private drawBanner(doc: PDFKit.PDFDocument, branding: DocBranding): void {
    const y = MARGIN;

    drawShadowShape(doc, MARGIN, y, CONTENT_W, BANNER_H, RADIUS, brandGradient(doc, MARGIN, y, CONTENT_W, BANNER_H, bannerColors(branding)), {
      shadowColor: C.navy,
      shadowOpacity: 0.13,
    });

    if (branding.logo) {
      const chipW = 72;
      const chipH = 32;
      const chipX = MARGIN + 12;
      const chipY = y + (BANNER_H - chipH) / 2;
      doc.roundedRect(chipX, chipY, chipW, chipH, 7).fill(C.white);
      drawLogoInChip(doc, branding.logo, LOGO_PATH, { x: chipX, y: chipY, w: chipW, h: chipH, padX: 5, padY: 7 });
    }

    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
      .text(branding.name, MARGIN, y + 12, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    if (branding.address) {
      doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(7.5)
        .text(branding.address, MARGIN, y + 30, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    }
    if (branding.phones) {
      doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(7.5)
        .text(branding.phones, MARGIN, y + 42, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    }

    doc.y = y + BANNER_H + 3;
  }

  // ── Document heading: accent bar + label (same treatment as the statement PDF) ─
  private drawSectionTitle(doc: PDFKit.PDFDocument, label: string): void {
    const y = doc.y;
    doc.roundedRect(MARGIN, y, 3.5, 13, 2).fill(C.accent);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11)
      .text(label, MARGIN + 10, y + 1, { lineBreak: false });
    doc.y = y + 13;
  }

  // ── Zebra-striped detail card ────────────────────────────────────────────────
  private drawDetailCard(doc: PDFKit.PDFDocument, rows: DetailRow[]): void {
    const y = doc.y;
    const h = rows.length * ROW_H + 8;

    drawShadowShape(doc, MARGIN, y, CONTENT_W, h, RADIUS, C.white, { shadowColor: C.navy, borderColor: C.border });

    rows.forEach((row, i) => {
      const ry = y + 4 + i * ROW_H;
      if (i % 2 !== 0) {
        doc.rect(MARGIN + 1, ry, CONTENT_W - 2, ROW_H).fill(C.surface);
      }
      if (row.emphasize) {
        doc.moveTo(MARGIN + 10, ry).lineTo(MARGIN + CONTENT_W - 10, ry).strokeColor(C.border).lineWidth(0.75).stroke();
      }
      const ty = ry + 3.5;
      doc.fillColor(row.emphasize ? C.navyText : C.muted).font(row.emphasize ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(row.label, MARGIN + 12, ty, { width: CONTENT_W * 0.55, lineBreak: false });
      doc.fillColor(row.valueColor ?? C.text).font('Helvetica-Bold').fontSize(8.5)
        .text(row.value, MARGIN, ty, { width: CONTENT_W - 12, align: 'right', lineBreak: false });
    });

    doc.y = y + h;
  }

  // ── Thank-you / payment footer (same design as the customer statement, compacted for A5) ─
  private drawThankYouFooter(doc: PDFKit.PDFDocument, branding: DocBranding): void {
    const y = doc.y;
    // The A5 receipt has room for ONE row of two cards (the layout Dasani has always had); a vendor with
    // more accounts gets the first two here and all of them (with IBAN) on the monthly statement.
    const accounts = branding.paymentAccounts.slice(0, 2);
    const hasMore = branding.paymentAccounts.length > accounts.length;
    const contacts = compactContactLines(branding);
    const pageLimit = PAGE_H - MARGIN;

    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(9)
      .text('Thank you for your business with us!', MARGIN, y, { width: CONTENT_W, align: 'center', lineBreak: false });

    let cy: number;
    if (accounts.length) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(7)
        .text(`Please make all payments to ${branding.payTo}`, MARGIN, y + 12, { width: CONTENT_W, align: 'center', lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
        .text(hasMore ? 'FOR ONLINE PAYMENTS  (more options on your statement)' : 'FOR ONLINE PAYMENTS', MARGIN, y + 27, { width: CONTENT_W, align: 'center', lineBreak: false });

      const bottom = drawPaymentCards(doc, accounts, y + 40, MARGIN, CONTENT_W, PAY_STYLE, {
        navy: C.navy, navyText: C.navyText, muted: C.muted, white: C.white, border: C.border,
        cyan: C.cyan, green: C.green, amber: C.amber, purple: C.purple, radius: RADIUS,
      });
      cy = bottom + 8;
    } else {
      cy = y + 18;
    }

    // The first two lines (website, email · phones) are the original layout and always print; extra
    // lines (tax numbers) only if they still fit on the page — an overflow would spawn a second page.
    let printed = 0;
    contacts.forEach((line, i) => {
      if (i >= 2 && cy + i * 9 + 9 > pageLimit) return;
      doc.fillColor(line.bold ? C.navyText : C.muted).font(line.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
        .text(line.text, MARGIN, cy + i * 9, { width: CONTENT_W, align: 'right', lineBreak: false });
      printed = i + 1;
    });
    let end = cy + Math.max(0, printed - 1) * 9 + 9;
    if (branding.footerNote && end + 1 + 8 <= pageLimit) {
      doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(6.5)
        .text(branding.footerNote, MARGIN, end + 1, { width: CONTENT_W, align: 'center', lineBreak: false });
      end += 10;
    }
    doc.y = end;
  }

  // ── Balance summary bar (reused for both outstanding-balance and
  //    previous-month-outstanding, same box design) ───────────────────────────
  private drawBalanceBar(doc: PDFKit.PDFDocument, label: string, amount: number): void {
    const y = doc.y;
    // Negative = customer overpaid (advance credit, good news) → green.
    // Positive = customer still owes money → red.
    const color = amount > 0 ? C.closeRed : C.closeGrn;
    doc.roundedRect(MARGIN, y, CONTENT_W, 32, RADIUS).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9.5)
      .text(label, MARGIN + 14, y + 11, { width: CONTENT_W * 0.55, lineBreak: false });
    doc.fillColor(color).font('Helvetica-Bold').fontSize(12)
      .text(`Rs. ${Math.abs(amount).toFixed(2)}`, MARGIN, y + 9, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.y = y + 32;
  }
}
