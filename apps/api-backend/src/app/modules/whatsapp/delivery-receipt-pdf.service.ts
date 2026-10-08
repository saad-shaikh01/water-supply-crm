import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { drawShadowShape, brandGradient, drawWatermark } from '../../common/pdf/pdf-theme.util';
import { DocBranding, LEGACY_DOC_BRANDING } from '../../common/pdf/doc-branding';

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

// Company identity — same detail shown in the customer statement's header (single vendor for now).
export const COMPANY_NAME = 'DASANI ENTERPRISES';
export const COMPANY_ADDRESS = 'B-145 block 13 D/1 Gulshan e Iqbal, Karachi.';
export const COMPANY_PHONES  = 'Cell# 0316-2677954, 0345-2364698';
export const COMPANY_WEBSITE = 'blueice.com.pk';
export const COMPANY_EMAIL   = 'info@blueice.com.pk';

// Online payment details — same as the customer statement's footer.
const BANK_TITLE      = 'DASANI ENTERPRISES';
const BANK_NAME       = 'Meezan Bank';
const BANK_ACCOUNT_NO = '9933-0104414597';
const EASYPAISA_NO    = '03162677954';

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

      if (branding.legacy) drawWatermark(doc, LOGO_PATH, PAGE_W, PAGE_H);

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

    drawShadowShape(doc, MARGIN, y, CONTENT_W, BANNER_H, RADIUS, brandGradient(doc, MARGIN, y, CONTENT_W, BANNER_H), {
      shadowColor: C.navy,
      shadowOpacity: 0.13,
    });

    if (!branding.legacy) {
      // Vendor-neutral banner: the vendor's own name (+ address when set) only — no Dasani logo/phones.
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
        .text(branding.name, MARGIN + 12, y + 12, { width: CONTENT_W - 26, align: 'right', lineBreak: false });
      if (branding.address) {
        doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(7.5)
          .text(branding.address, MARGIN + 12, y + 30, { width: CONTENT_W - 26, align: 'right', lineBreak: false });
      }
      doc.y = y + BANNER_H + 3;
      return;
    }

    const chipW = 72;
    const chipH = 32;
    const chipX = MARGIN + 12;
    const chipY = y + (BANNER_H - chipH) / 2;
    doc.roundedRect(chipX, chipY, chipW, chipH, 7).fill(C.white);
    try {
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, chipX + 5, chipY + 7, { width: chipW - 10 });
      }
    } catch {
      // logo missing/unreadable — chip still reads fine as a blank white box
    }

    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
      .text(COMPANY_NAME, MARGIN, y + 12, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(7.5)
      .text(COMPANY_ADDRESS, MARGIN, y + 30, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(7.5)
      .text(COMPANY_PHONES, MARGIN, y + 42, { width: CONTENT_W - 14, align: 'right', lineBreak: false });

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

    if (!branding.legacy) {
      // No payment block for non-legacy vendors until they supply their own details (P1).
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(9)
        .text('Thank you for your business with us!', MARGIN, y, { width: CONTENT_W, align: 'center', lineBreak: false });
      doc.y = y + 14;
      return;
    }

    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(9)
      .text('Thank you for your business with us!', MARGIN, y, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7)
      .text(`Please make all payments to ${BANK_TITLE}`, MARGIN, y + 12, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text('FOR ONLINE PAYMENTS', MARGIN, y + 27, { width: CONTENT_W, align: 'center', lineBreak: false });

    const cardsY = y + 40;
    const gap    = 10;
    const cardW  = (CONTENT_W - gap) / 2;
    const cardH  = 56;

    this.drawPaymentCard(doc, MARGIN, cardsY, cardW, cardH, 'B', C.cyan, 'BANK TRANSFER', (bx, by, bw) => {
      const rows: [string, string][] = [
        ['Acc Title', BANK_TITLE],
        ['Acc No',    BANK_ACCOUNT_NO],
        ['Bank',      BANK_NAME],
      ];
      rows.forEach(([lbl, val], i) => {
        const ry = by + i * 9;
        doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(5.5)
          .text(lbl.toUpperCase(), bx, ry + 0.5, { width: bw * 0.32, lineBreak: false });
        doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(6.5)
          .text(val, bx + bw * 0.32, ry, { width: bw - bw * 0.32, lineBreak: false });
      });
    });

    this.drawPaymentCard(doc, MARGIN + cardW + gap, cardsY, cardW, cardH, 'E', C.green, 'EASYPAISA', (bx, by, bw) => {
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(5.5)
        .text('ACCOUNT NUMBER', bx, by + 0.5, { width: bw, lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(12)
        .text(EASYPAISA_NO, bx, by + 9, { width: bw, lineBreak: false });
    });

    const cy = cardsY + cardH + 8;
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7)
      .text(COMPANY_WEBSITE, MARGIN, cy, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7)
      .text(`${COMPANY_EMAIL}  ·  ${COMPANY_PHONES}`, MARGIN, cy + 9, { width: CONTENT_W, align: 'right', lineBreak: false });

    doc.y = cy + 18;
  }

  // ── Payment method card: shadow card + colored icon chip + title + custom body ─
  private drawPaymentCard(
    doc: PDFKit.PDFDocument,
    x: number, y: number, w: number, h: number,
    icon: string, iconColor: string, title: string,
    drawBody: (bodyX: number, bodyY: number, bodyW: number) => void,
  ): void {
    drawShadowShape(doc, x, y, w, h, RADIUS, C.white, { shadowColor: C.navy, borderColor: C.border, shadowOpacity: 0.08 });

    const iconSize = 16;
    doc.roundedRect(x + 8, y + 7, iconSize, iconSize, 4).fill(iconColor);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8)
      .text(icon, x + 8, y + 11, { width: iconSize, align: 'center', lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(title, x + 8 + iconSize + 6, y + 12, { width: w - iconSize - 22, lineBreak: false });

    drawBody(x + 8, y + 29, w - 16);
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
