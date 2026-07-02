import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { drawShadowShape, brandGradient, drawClippedWatermark } from '../../../common/pdf/pdf-theme.util';

// ── Company identity (hardcoded — single vendor for now) ────────────────────
const COMPANY_NAME    = 'DASANI ENTERPRISES';
const COMPANY_ADDRESS = 'B-145 Block 13 D/1 Gulshan-e-Iqbal, Korangi Creek Korangi';
const COMPANY_PHONES  = 'Cell# 0316-2677954, 0345-2364698';
const COMPANY_WEBSITE = 'blueice.com.pk';
const COMPANY_EMAIL   = 'info@blueice.com.pk';

// Payment / footer details (hardcoded — single vendor for now)
const BANK_TITLE      = 'DASANI ENTERPRISES';
const BANK_NAME       = 'Meezan Bank';
const BANK_ACCOUNT_NO = '9933-0104414597';
const EASYPAISA_NO    = '03162677954';

// Blue Ice brand assets — copied from apps/vendor-dashboard/public,
// bundled to dist alongside main.js via webpack `assets` config
const LOGO_PATH = path.join(__dirname, 'assets', 'blue-ice-logo.png');
const ICON_PATH = path.join(__dirname, 'assets', 'blue-ice-icon.png');

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  navy:      '#0f172a',
  navyText:  '#111827',
  accent:    '#b91c1c',
  muted:     '#6b7280',
  mutedLt:   '#9ca3af',
  border:    '#e5e7eb',
  surface:   '#f8fafc',
  text:      '#1e293b',
  textSoft:  '#374151',
  white:     '#ffffff',
  red:       '#dc2626',
  green:     '#059669',
  amber:     '#d97706',
  purple:    '#7c3aed',
  cyan:      '#0891b2',
  closeRed:  '#fca5a5',
  closeGrn:  '#86efac',
};

const TYPE_LABEL: Record<string, string> = {
  PAYMENT:    'Payment',
  ADJUSTMENT: 'Adjustment',
  COLLECTION: 'Collection',
  LOAD_OUT:   'Load Out',
  CHECK_IN:   'Check In',
};

const TYPE_COLOR: Record<string, string> = {
  PAYMENT:    C.green,
  ADJUSTMENT: C.amber,
  COLLECTION: C.purple,
  LOAD_OUT:   C.cyan,
  CHECK_IN:   C.cyan,
};

// ── Page geometry ───────────────────────────────────────────────────────────
const MARGIN    = 40;
const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2; // 515.28
const ROW_H     = 22;
const RADIUS    = 10;
const BANNER_H  = 76;
const FOOTER_H  = 22;
const FOOTER_Y  = PAGE_H - FOOTER_H;

// ── Delivery table column geometry (sums to 515.28) ─────────────────────────
const DCOL = {
  date:  { x: MARGIN,       w: 95    },
  trans: { x: MARGIN + 95,  w: 55    },
  btl:   { x: MARGIN + 150, w: 50    },
  empty: { x: MARGIN + 200, w: 50    },
  bal:   { x: MARGIN + 250, w: 50    },
  due:   { x: MARGIN + 300, w: 70    },
  recv:  { x: MARGIN + 370, w: 75    },
  amt:   { x: MARGIN + 445, w: 70.28 },
};

// ── Other-transactions table column geometry (sums to 515.28) ──────────────
const OCOL = {
  date: { x: MARGIN,       w: 80     },
  type: { x: MARGIN + 80,  w: 80     },
  desc: { x: MARGIN + 160, w: 195.28 },
  amt:  { x: MARGIN + 355, w: 80     },
  bal:  { x: MARGIN + 435, w: 80.28  },
};

interface DeliveryRow {
  date: Date;
  trans: string;
  btlDelivered: number;
  emptyPickup: number;
  bottleBalance: number | null;
  amountDue: number;
  amountReceived: number;
  runningBalance: number;
}

interface OtherRow {
  date: Date;
  type: string;
  description: string;
  amount: number;
  runningBalance: number;
}

/** One renderable line in the delivery card: previous-balance / a delivery / the totals row */
type DeliveryLine =
  | { kind: 'prev'; openingBalance: number }
  | { kind: 'row'; row: DeliveryRow; index: number }
  | { kind: 'total'; rows: DeliveryRow[]; openingBalance: number };

@Injectable()
export class CustomerStatementPdfService {
  async generate(data: {
    customer: any;
    transactions: any[];
    openingBalance: number;
    closingBalance: number;
    period: string;
    month?: string;
    /** Customer's actual assigned rate (custom price if set, else product base price). */
    ratePerBottle?: number;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 6 },
        size: 'A4',
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      this.drawContent(doc, data);

      const { count } = doc.bufferedPageRange();
      for (let i = 0; i < count; i++) {
        doc.switchToPage(i);
        this.drawPageFooter(doc, i + 1, count);
      }

      doc.flushPages();
      doc.end();
    });
  }

  // ── Document flow ──────────────────────────────────────────────────────────
  private drawContent(doc: PDFKit.PDFDocument, data: any): void {
    const { customer, transactions, openingBalance, closingBalance, period, month } = data;
    const { deliveryRows, otherRows, ratePerBottle: computedRatePerBottle } = this.buildRows(transactions, openingBalance);
    const ratePerBottle = data.ratePerBottle ?? computedRatePerBottle;

    this.drawBrandBanner(doc);
    doc.y += 18;
    this.drawSectionTitle(doc, 'MONTHLY STATEMENT', period);
    doc.y += 12;
    this.drawInfoCards(doc, customer, month, closingBalance, ratePerBottle);

    doc.y += 18;
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(13)
      .text('Delivery History', MARGIN, doc.y, { lineBreak: false });
    doc.y += 20;
    this.drawDeliveryCard(doc, deliveryRows, openingBalance);

    if (otherRows.length) {
      doc.y += 18;
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(13)
        .text('Other Transactions', MARGIN, doc.y, { lineBreak: false });
      doc.y += 20;
      this.drawOtherCard(doc, otherRows);
    }

    doc.y += 18;
    this.drawThankYouFooter(doc);
  }

  // ── Row building / grouping ──────────────────────────────────────────────
  private buildRows(
    transactions: any[],
    openingBalance: number,
  ): { deliveryRows: DeliveryRow[]; otherRows: OtherRow[]; ratePerBottle: number } {
    const runningAfter = new Map<string, number>();
    let running = openingBalance;
    for (const t of transactions) {
      running += t.amount ?? 0;
      runningAfter.set(t.id, running);
    }

    const paymentByItemId = new Map<string, any>();
    for (const t of transactions) {
      if (t.type === 'PAYMENT' && t.dailySheetItemId) {
        paymentByItemId.set(t.dailySheetItemId, t);
      }
    }

    const consumedPaymentIds = new Set<string>();
    const deliveryRows: DeliveryRow[] = [];
    let totalBottleAmount = 0;
    let totalBottles = 0;

    for (const t of transactions) {
      if (t.type !== 'DELIVERY') continue;
      const paired = t.dailySheetItemId ? paymentByItemId.get(t.dailySheetItemId) : undefined;
      if (paired) consumedPaymentIds.add(paired.id);

      const amountDue = t.amount ?? 0;
      const filledDropped = t.filledDropped ?? 0;
      totalBottleAmount += amountDue;
      totalBottles += filledDropped;

      deliveryRows.push({
        date: t.createdAt,
        trans: t.id.slice(-6).toUpperCase(),
        btlDelivered: filledDropped,
        emptyPickup: t.emptyReceived ?? 0,
        bottleBalance: t.dailySheetItem?.bottleBalanceAfter ?? null,
        amountDue,
        amountReceived: paired ? Math.abs(paired.amount ?? 0) : 0,
        runningBalance: runningAfter.get(paired ? paired.id : t.id) ?? running,
      });
    }

    const otherRows: OtherRow[] = transactions
      .filter((t) => t.type !== 'DELIVERY' && !consumedPaymentIds.has(t.id))
      .map((t) => ({
        date: t.createdAt,
        type: TYPE_LABEL[t.type] ?? t.type,
        description: t.description ?? t.product?.name ?? '—',
        amount: t.amount ?? 0,
        runningBalance: runningAfter.get(t.id) ?? running,
      }));

    const ratePerBottle = totalBottles > 0 ? totalBottleAmount / totalBottles : 0;

    return { deliveryRows, otherRows, ratePerBottle };
  }

  // ── Soft-shadow rounded card background ─────────────────────────────────────
  private shadowCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
    drawShadowShape(doc, x, y, w, h, RADIUS, C.white, { shadowColor: C.navy, borderColor: C.border });
  }

  // ── Brand banner: gradient card with logo box (left) + company identity (right) ─
  private drawBrandBanner(doc: PDFKit.PDFDocument): void {
    const y = MARGIN;
    const h = BANNER_H;

    drawShadowShape(doc, MARGIN, y, CONTENT_W, h, RADIUS, brandGradient(doc, MARGIN, y, CONTENT_W, h), {
      shadowColor: C.navy,
      shadowOpacity: 0.13,
    });

    // White logo chip
    const chipW = 118;
    const chipH = 48;
    const chipX = MARGIN + 14;
    const chipY = y + (h - chipH) / 2;
    doc.roundedRect(chipX, chipY, chipW, chipH, 8).fill(C.white);
    try {
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, chipX + 8, chipY + 10, { width: chipW - 16 });
      }
    } catch {
      // logo missing/unreadable — chip still reads fine as a blank white box
    }

    // Company identity — right-aligned
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(15)
      .text(COMPANY_NAME, MARGIN, y + 16, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(8)
      .text(COMPANY_ADDRESS, MARGIN, y + 35, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(8)
      .text(COMPANY_PHONES, MARGIN, y + 47, { width: CONTENT_W - 14, align: 'right', lineBreak: false });

    doc.y = y + h + 3;
  }

  // ── Document heading: accent bar + label (left), period (right) ────────────
  private drawSectionTitle(doc: PDFKit.PDFDocument, label: string, period: string): void {
    const y = doc.y;
    doc.roundedRect(MARGIN, y, 4, 16, 2).fill(C.accent);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(13)
      .text(label, MARGIN + 12, y + 1, { lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(9)
      .text(period, MARGIN, y + 2, { width: CONTENT_W - 4, align: 'right', lineBreak: false });
    doc.y = y + 16;
  }

  // ── Single info card: customer | period/billing details | due-amount chip ──
  private drawInfoCards(
    doc: PDFKit.PDFDocument,
    customer: any,
    month: string | undefined,
    closingBalance: number,
    ratePerBottle: number,
  ): void {
    const y     = doc.y;
    const boxH  = 92;
    const col1W = 185;
    const col3W = 145;
    const col2W = CONTENT_W - col1W - col3W;
    const x1 = MARGIN;
    const x2 = MARGIN + col1W;
    const x3 = MARGIN + col1W + col2W;

    this.shadowCard(doc, MARGIN, y, CONTENT_W, boxH);
    doc.moveTo(x2, y + 12).lineTo(x2, y + boxH - 12).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.moveTo(x3, y + 12).lineTo(x3, y + boxH - 12).strokeColor(C.border).lineWidth(0.75).stroke();

    // COL 1 — customer identity (bounded + ellipsis so long names/addresses never
    // overflow into the divider or the phone line below)
    const col1TextW = col1W - 24;

    // Customer code — plain label/value line above the name, same bold treatment as the name
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text('Customer Code: ', x1 + 14, y + 10, { continued: true, lineBreak: false })
      .fillColor(C.navyText).font('Helvetica-Bold')
      .text(customer.customerCode ?? '—', { lineBreak: false });

    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(11.5)
      .text(customer.name ?? '—', x1 + 14, y + 24, { width: col1TextW, height: 14, ellipsis: true });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text(customer.address ?? '—', x1 + 14, y + 44, { width: col1TextW, height: 18, ellipsis: true });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text(customer.phoneNumber ?? '—', x1 + 14, y + 66, { width: col1TextW, height: 10, ellipsis: true });

    // COL 2 — period + billing details
    const fromTo = month ? this.monthBounds(month) : null;
    const rows: [string, string][] = [
      ['From',         fromTo?.from ?? '—'],
      ['To',           fromTo?.to ?? '—'],
      ['Pay Mode',     customer.paymentType === 'MONTHLY' ? 'Monthly' : 'Cash'],
      ['Rate Per Btl', ratePerBottle > 0 ? `Rs. ${ratePerBottle.toFixed(0)}` : '—'],
    ];
    const rowH = (boxH - 16) / rows.length;
    rows.forEach(([lbl, val], i) => {
      const ry = y + 8 + i * rowH;
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
        .text(lbl, x2 + 12, ry + rowH / 2 - 4, { width: col2W * 0.48, lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(8.5)
        .text(val, x2, ry + rowH / 2 - 4, { width: col2W - 14, align: 'right', lineBreak: false });
    });

    // COL 3 — bold due-amount chip
    const chipPad = 8;
    const chipX = x3 + chipPad;
    const chipY = y + chipPad;
    const chipW = col3W - chipPad * 2;
    const chipH = boxH - chipPad * 2;
    doc.roundedRect(chipX, chipY, chipW, chipH, 8).fill(C.navy);
    doc.fillColor('#ffffff', 0.75).font('Helvetica').fontSize(7)
      .text('BALANCE DUE', chipX, chipY + chipH / 2 - 14, { width: chipW, align: 'center', lineBreak: false });
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(16)
      .text(`Rs. ${this.absFmt(closingBalance)}`, chipX, chipY + chipH / 2 + 4, { width: chipW, align: 'center', lineBreak: false });

    doc.y = y + boxH;
  }

  // ── Delivery card (paginates with its own shadow card per page) ────────────
  private drawDeliveryCard(doc: PDFKit.PDFDocument, rows: DeliveryRow[], openingBalance: number): void {
    const lines: DeliveryLine[] = [{ kind: 'prev', openingBalance }];
    rows.forEach((row, index) => lines.push({ kind: 'row', row, index }));
    lines.push({ kind: 'total', rows, openingBalance });

    this.drawCardTable<DeliveryLine>(
      doc,
      lines,
      ROW_H,
      (x, y, w) => this.drawDeliveryTableHeader(doc, x, y, w),
      (line, x, y) => this.drawDeliveryLine(doc, line, x, y),
      { watermark: true },
    );

    if (!rows.length) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
        .text('No deliveries recorded for this period.', MARGIN, doc.y + 8, { width: CONTENT_W, align: 'center' });
      doc.y += 24;
    }
  }

  private drawDeliveryTableHeader(doc: PDFKit.PDFDocument, x: number, y: number, w: number): void {
    doc.moveTo(x + 10, y + ROW_H).lineTo(x + w - 10, y + ROW_H).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.5);
    doc.text('DATE',        DCOL.date.x  + 6, y + 7, { width: DCOL.date.w  - 4, lineBreak: false });
    doc.text('TRANS#',      DCOL.trans.x + 3, y + 7, { width: DCOL.trans.w - 4, lineBreak: false });
    doc.text('BTL DEL',     DCOL.btl.x   + 3, y + 7, { width: DCOL.btl.w   - 4, align: 'right', lineBreak: false });
    doc.text('EMPTY PKUP',  DCOL.empty.x + 3, y + 7, { width: DCOL.empty.w - 4, align: 'right', lineBreak: false });
    doc.text('BAL BTL',     DCOL.bal.x   + 3, y + 7, { width: DCOL.bal.w   - 4, align: 'right', lineBreak: false });
    doc.text('AMOUNT DUE',  DCOL.due.x   + 3, y + 7, { width: DCOL.due.w   - 6, align: 'right', lineBreak: false });
    doc.text('AMOUNT RECV', DCOL.recv.x  + 3, y + 7, { width: DCOL.recv.w  - 6, align: 'right', lineBreak: false });
    doc.text('BALANCE',     DCOL.amt.x   + 3, y + 7, { width: DCOL.amt.w   - 10, align: 'right', lineBreak: false });
  }

  private drawDeliveryLine(doc: PDFKit.PDFDocument, line: DeliveryLine, x: number, y: number): void {
    if (line.kind === 'prev') {
      doc.fillColor(C.textSoft).font('Helvetica-Oblique').fontSize(7.5)
        .text('Previous Month Balance', DCOL.date.x + 6, y + 7, { width: DCOL.trans.x + DCOL.trans.w - DCOL.date.x - 6, lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(line.openingBalance), DCOL.due.x + 3, y + 7, { width: DCOL.due.w - 6, align: 'right', lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(line.openingBalance), DCOL.amt.x + 3, y + 7, { width: DCOL.amt.w - 10, align: 'right', lineBreak: false });
      doc.moveTo(x + 10, y + ROW_H).lineTo(x + CONTENT_W - 10, y + ROW_H)
        .strokeColor(C.border).lineWidth(0.5).stroke();
      return;
    }

    if (line.kind === 'row') {
      const { row, index } = line;
      if (index % 2 !== 0) {
        doc.rect(x + 1, y, (DCOL.amt.x + DCOL.amt.w) - MARGIN - 2, ROW_H).fill(C.surface);
      }
      const ty = y + 7;
      const dateStr = new Date(row.date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });

      doc.fillColor(C.textSoft).font('Helvetica').fontSize(7.5)
        .text(dateStr, DCOL.date.x + 6, ty, { width: DCOL.date.w - 4, lineBreak: false });
      doc.fillColor(C.mutedLt).font('Helvetica').fontSize(7.5)
        .text(row.trans, DCOL.trans.x + 3, ty, { width: DCOL.trans.w - 4, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(`${row.btlDelivered}`, DCOL.btl.x + 3, ty, { width: DCOL.btl.w - 4, align: 'right', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(`${row.emptyPickup}`, DCOL.empty.x + 3, ty, { width: DCOL.empty.w - 4, align: 'right', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(row.bottleBalance != null ? `${row.bottleBalance}` : '—', DCOL.bal.x + 3, ty, { width: DCOL.bal.w - 4, align: 'right', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(row.amountDue), DCOL.due.x + 3, ty, { width: DCOL.due.w - 6, align: 'right', lineBreak: false });
      if (row.amountReceived > 0) {
        doc.fillColor(C.green).font('Helvetica-Bold').fontSize(7.5)
          .text(this.rs(row.amountReceived), DCOL.recv.x + 3, ty, { width: DCOL.recv.w - 6, align: 'right', lineBreak: false });
      }
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(row.runningBalance), DCOL.amt.x + 3, ty, { width: DCOL.amt.w - 10, align: 'right', lineBreak: false });
      return;
    }

    // totals row
    const { rows, openingBalance } = line;
    const totalDue     = openingBalance + rows.reduce((s, r) => s + r.amountDue, 0);
    const totalRecv    = rows.reduce((s, r) => s + r.amountReceived, 0);
    const totalBtl     = rows.reduce((s, r) => s + r.btlDelivered, 0);
    const totalEmpty   = rows.reduce((s, r) => s + r.emptyPickup, 0);
    const finalBalance = rows.length ? rows[rows.length - 1].runningBalance : openingBalance;

    doc.moveTo(x + 10, y).lineTo(x + CONTENT_W - 10, y).strokeColor(C.navyText).lineWidth(1).stroke();
    const ty = y + 7;
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text('TOTAL', DCOL.date.x + 6, ty, { width: DCOL.date.w + DCOL.trans.w - 6, lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(`${totalBtl}`, DCOL.btl.x + 3, ty, { width: DCOL.btl.w - 4, align: 'right', lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(`${totalEmpty}`, DCOL.empty.x + 3, ty, { width: DCOL.empty.w - 4, align: 'right', lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(totalDue), DCOL.due.x + 3, ty, { width: DCOL.due.w - 6, align: 'right', lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(totalRecv), DCOL.recv.x + 3, ty, { width: DCOL.recv.w - 6, align: 'right', lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(finalBalance), DCOL.amt.x + 3, ty, { width: DCOL.amt.w - 10, align: 'right', lineBreak: false });
  }

  // ── Other transactions card ─────────────────────────────────────────────────
  private drawOtherCard(doc: PDFKit.PDFDocument, rows: OtherRow[]): void {
    this.drawCardTable<OtherRow>(
      doc,
      rows,
      ROW_H,
      (x, y, w) => this.drawOtherTableHeader(doc, x, y, w),
      (row, x, y, index) => this.drawOtherLine(doc, row, x, y, index),
    );
  }

  private drawOtherTableHeader(doc: PDFKit.PDFDocument, x: number, y: number, w: number): void {
    doc.moveTo(x + 10, y + ROW_H).lineTo(x + w - 10, y + ROW_H).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.5);
    doc.text('DATE',        OCOL.date.x + 6, y + 7, { width: OCOL.date.w - 4, lineBreak: false });
    doc.text('TYPE',        OCOL.type.x + 3, y + 7, { width: OCOL.type.w - 4, lineBreak: false });
    doc.text('DESCRIPTION', OCOL.desc.x + 3, y + 7, { width: OCOL.desc.w - 4, lineBreak: false });
    doc.text('AMOUNT',      OCOL.amt.x  + 3, y + 7, { width: OCOL.amt.w  - 6, align: 'right', lineBreak: false });
    doc.text('BALANCE',     OCOL.bal.x  + 3, y + 7, { width: OCOL.bal.w  - 10, align: 'right', lineBreak: false });
  }

  private drawOtherLine(doc: PDFKit.PDFDocument, row: OtherRow, x: number, y: number, index: number): void {
    if (index % 2 !== 0) {
      doc.rect(x + 1, y, (OCOL.bal.x + OCOL.bal.w) - MARGIN - 2, ROW_H).fill(C.surface);
    }
    const ty = y + 7;
    const dateStr = new Date(row.date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
    const typeColor = TYPE_COLOR[row.type] ?? C.muted;

    doc.fillColor(C.textSoft).font('Helvetica').fontSize(7.5)
      .text(dateStr, OCOL.date.x + 6, ty, { width: OCOL.date.w - 4, lineBreak: false });
    doc.fillColor(typeColor).font('Helvetica-Bold').fontSize(7.5)
      .text(row.type, OCOL.type.x + 3, ty, { width: OCOL.type.w - 4, lineBreak: false });
    doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
      .text(row.description, OCOL.desc.x + 3, ty, { width: OCOL.desc.w - 4, lineBreak: false });

    const amtColor = row.amount > 0 ? C.red : C.green;
    doc.fillColor(amtColor).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(Math.abs(row.amount)), OCOL.amt.x + 3, ty, { width: OCOL.amt.w - 6, align: 'right', lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(row.runningBalance), OCOL.bal.x + 3, ty, { width: OCOL.bal.w - 10, align: 'right', lineBreak: false });
  }

  /** Generic paginated card-table: draws a shadow card per page, fitting as many lines as remain. */
  private drawCardTable<T>(
    doc: PDFKit.PDFDocument,
    lines: T[],
    headerH: number,
    drawHeader: (x: number, y: number, w: number) => void,
    drawLine: (line: T, x: number, y: number, index: number) => void,
    opts: { watermark?: boolean } = {},
  ): void {
    let drawn = 0;
    while (drawn < lines.length) {
      const availH = FOOTER_Y - 16 - doc.y;
      const maxLines = Math.max(1, Math.floor((availH - headerH) / ROW_H));
      const linesThisCard = Math.min(maxLines, lines.length - drawn);
      const cardH = headerH + linesThisCard * ROW_H + 6;
      const cardY = doc.y;

      this.shadowCard(doc, MARGIN, cardY, CONTENT_W, cardH);
      if (opts.watermark && drawn === 0) {
        drawClippedWatermark(doc, ICON_PATH, MARGIN, cardY, CONTENT_W, cardH);
      }
      drawHeader(MARGIN, cardY + 6, CONTENT_W);
      for (let li = 0; li < linesThisCard; li++) {
        drawLine(lines[drawn + li], MARGIN, cardY + 6 + headerH + li * ROW_H, drawn + li);
      }

      drawn += linesThisCard;
      doc.y = cardY + cardH;
      if (drawn < lines.length) {
        doc.addPage();
        doc.y = MARGIN;
      }
    }
  }

  // ── Thank-you / payment footer (appears once at end of document) ───────────
  private drawThankYouFooter(doc: PDFKit.PDFDocument): void {
    if (doc.y + 110 > FOOTER_Y - 10) { doc.addPage(); doc.y = MARGIN; }
    const y = doc.y;

    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(10)
      .text('Thank you for your business with us!', MARGIN, y, { width: CONTENT_W, align: 'center' });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text(`Please make all payments to ${BANK_TITLE}`, MARGIN, doc.y + 3, { width: CONTENT_W, align: 'center' });

    const py = doc.y + 14;
    doc.moveTo(MARGIN, py).lineTo(MARGIN + CONTENT_W, py).strokeColor(C.border).lineWidth(0.75).stroke();

    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(8)
      .text('FOR ONLINE PAYMENTS', MARGIN, py + 10, { width: CONTENT_W, align: 'center' });

    const dividerX = MARGIN + CONTENT_W * 0.6;
    const rows: [string, string][] = [
      ['Acc Title', BANK_TITLE],
      ['Acc No',    BANK_ACCOUNT_NO],
      ['Bank',      BANK_NAME],
    ];
    rows.forEach(([lbl, val], i) => {
      const ry = py + 26 + i * 13;
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7)
        .text(lbl.toUpperCase(), MARGIN, ry, { width: 60, lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica').fontSize(8)
        .text(val, MARGIN + 64, ry, { width: dividerX - MARGIN - 78, lineBreak: false });
    });

    doc.moveTo(dividerX, py + 24).lineTo(dividerX, py + 24 + rows.length * 13)
      .strokeColor(C.border).lineWidth(0.75).stroke();

    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7)
      .text('EASYPAISA ACC NO', dividerX + 14, py + 26, { width: CONTENT_W - (dividerX - MARGIN) - 14, lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(9)
      .text(EASYPAISA_NO, dividerX + 14, py + 38, { width: CONTENT_W - (dividerX - MARGIN) - 14, lineBreak: false });

    const cy = py + 26 + rows.length * 13 + 10;
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(COMPANY_WEBSITE, MARGIN, cy, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
      .text(COMPANY_EMAIL, MARGIN, cy + 11, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
      .text(COMPANY_PHONES, MARGIN, cy + 22, { width: CONTENT_W, align: 'right', lineBreak: false });

    doc.y = cy + 22 + 10;
  }

  // ── Per-page footer (page number + timestamp) ───────────────────────────────
  private drawPageFooter(doc: PDFKit.PDFDocument, pageNum: number, totalPages: number): void {
    const stamp = new Date().toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    doc.fillColor(C.mutedLt).font('Helvetica').fontSize(6.5)
      .text(`Generated ${stamp}`, MARGIN, FOOTER_Y + 6, { lineBreak: false });
    doc.fillColor(C.mutedLt).font('Helvetica-Bold').fontSize(6.5)
      .text(`Page ${pageNum} of ${totalPages}`, MARGIN, FOOTER_Y + 6, { width: CONTENT_W, align: 'right', lineBreak: false });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private monthBounds(month: string): { from: string; to: string } {
    const [year, mon] = month.split('-').map(Number);
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 0);
    const fmt = (d: Date) => d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: '2-digit' });
    return { from: fmt(from), to: fmt(to) };
  }

  private rs(n: number): string {
    const sign = n < 0 ? '-' : '';
    return `${sign}Rs.${Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  private absFmt(n: number): string {
    return Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
