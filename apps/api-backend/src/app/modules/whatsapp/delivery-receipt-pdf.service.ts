import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { drawShadowShape, brandGradient, drawWatermark } from '../../common/pdf/pdf-theme.util';

export interface DeliveryReceiptData {
  customerName: string;
  customerCode: string;
  productName: string;
  filledDropped: number;
  emptyReceived: number;
  cashCollected: number;
  pricePerBottle: number;
  financialBalanceAfter: number;
  bottleBalanceAfter: number;
  deliveryDate: string; // YYYY-MM-DD
  deliveryTime: string; // HH:MM
  vendorName: string;
  /** MONTHLY customers only — balance carried in from before this month. */
  previousMonthOutstanding?: number;
}

// Blue Ice brand logo — same asset used by the customer statement PDF.
const LOGO_PATH = path.join(__dirname, 'assets', 'blue-ice-logo.png');

// Company identity — same detail shown in the customer statement's header (single vendor for now).
const COMPANY_ADDRESS = 'B-145 Block 13 D/1 Gulshan-e-Iqbal, Korangi Creek Korangi';
const COMPANY_PHONES  = 'Cell# 0316-2677954, 0345-2364698';

const C = {
  navy:     '#0f172a',
  navyText: '#111827',
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
const BANNER_H  = 76;
const ROW_H     = 22;

interface DetailRow {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
}

@Injectable()
export class DeliveryReceiptPdfService {
  async generate(data: DeliveryReceiptData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: MARGIN });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawWatermark(doc, LOGO_PATH, PAGE_W, PAGE_H);

      this.drawBanner(doc, data);

      const deliveryAmount = data.filledDropped * data.pricePerBottle;
      const rows: DetailRow[] = [
        { label: 'Date / Time',       value: `${data.deliveryDate}  ·  ${data.deliveryTime}` },
        { label: 'Customer',          value: data.customerName },
        { label: 'Customer Code',     value: data.customerCode },
        { label: 'Product',           value: data.productName },
        { label: 'Bottles Delivered', value: `${data.filledDropped}` },
        { label: 'Empty Received',    value: `${data.emptyReceived}` },
        { label: 'Price / Bottle',    value: `Rs. ${data.pricePerBottle.toFixed(2)}` },
        { label: 'Delivery Amount',   value: `Rs. ${deliveryAmount.toFixed(2)}`, emphasize: true },
        { label: 'Cash Collected',    value: `Rs. ${data.cashCollected.toFixed(2)}` },
        { label: 'Bottle Balance',    value: `${data.bottleBalanceAfter} bottles` },
      ];
      this.drawDetailCard(doc, rows);

      if (data.previousMonthOutstanding != null) {
        doc.y += 14;
        this.drawBalanceBar(doc, 'PREVIOUS MONTH OUTSTANDING', data.previousMonthOutstanding);
      }

      doc.y += 14;
      this.drawBalanceBar(doc, 'OUTSTANDING BALANCE', data.financialBalanceAfter);

      doc.y += 16;
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
        .text(
          'Shukriya! Is receipt ke baray mein koi sawaal ho toh apne vendor se rabta karein.',
          MARGIN, doc.y, { width: CONTENT_W, align: 'center' },
        );

      doc.end();
    });
  }

  // ── Brand banner: gradient card with logo chip (left) + vendor identity (right) ─
  private drawBanner(doc: PDFKit.PDFDocument, data: DeliveryReceiptData): void {
    const y = MARGIN;

    drawShadowShape(doc, MARGIN, y, CONTENT_W, BANNER_H, RADIUS, brandGradient(doc, MARGIN, y, CONTENT_W, BANNER_H), {
      shadowColor: C.navy,
      shadowOpacity: 0.13,
    });

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
      .text(data.vendorName, MARGIN, y + 16, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(7.5)
      .text(COMPANY_ADDRESS, MARGIN, y + 35, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(7.5)
      .text(COMPANY_PHONES, MARGIN, y + 47, { width: CONTENT_W - 14, align: 'right', lineBreak: false });

    doc.y = y + BANNER_H + 3;
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
      const ty = ry + 6.5;
      doc.fillColor(row.emphasize ? C.navyText : C.muted).font(row.emphasize ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(row.label, MARGIN + 12, ty, { width: CONTENT_W * 0.55, lineBreak: false });
      doc.fillColor(row.valueColor ?? C.text).font('Helvetica-Bold').fontSize(8.5)
        .text(row.value, MARGIN, ty, { width: CONTENT_W - 12, align: 'right', lineBreak: false });
    });

    doc.y = y + h;
  }

  // ── Balance summary bar (reused for both outstanding-balance and
  //    previous-month-outstanding, same box design) ───────────────────────────
  private drawBalanceBar(doc: PDFKit.PDFDocument, label: string, amount: number): void {
    const y = doc.y;
    const color = amount < 0 ? C.closeRed : C.closeGrn;
    doc.roundedRect(MARGIN, y, CONTENT_W, 32, RADIUS).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9.5)
      .text(label, MARGIN + 14, y + 11, { width: CONTENT_W * 0.55, lineBreak: false });
    doc.fillColor(color).font('Helvetica-Bold').fontSize(12)
      .text(`Rs. ${Math.abs(amount).toFixed(2)}`, MARGIN, y + 9, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.y = y + 32;
  }
}
