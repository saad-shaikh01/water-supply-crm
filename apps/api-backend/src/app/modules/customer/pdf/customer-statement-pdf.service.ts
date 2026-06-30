import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');

// ── Company identity (hardcoded — single vendor for now) ────────────────────
const COMPANY_NAME    = 'DASANI ENTERPRISES';
const COMPANY_ADDRESS = 'B-145 Block 13 D/1 Gulshan-e-Iqbal, Korangi Creek Korangi';
const COMPANY_PHONES  = 'Cell# 0316-2677954, 0345-2364698';

// Payment / footer details (hardcoded — single vendor for now)
const BANK_TITLE      = 'DASANI ENTERPRISES';
const BANK_NAME       = 'Meezan Bank';
const BANK_ACCOUNT_NO = '9933-0104414597';
const EASYPAISA_NO    = '03162677954';

// Drop the Blue Ice brand logo here — copied to dist alongside main.js via webpack `assets` config
const LOGO_PATH = path.join(__dirname, 'assets', 'blue-ice-logo.png');

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  navy:     '#0f172a',
  blue:     '#3b82f6',
  muted:    '#64748b',
  mutedLt:  '#94a3b8',
  border:   '#cbd5e1',
  surface:  '#f8fafc',
  surface2: '#eff6ff',
  text:     '#1e293b',
  textSoft: '#475569',
  white:    '#ffffff',
  red:      '#dc2626',
  green:    '#059669',
  amber:    '#d97706',
  purple:   '#7c3aed',
  cyan:     '#0891b2',
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
const ROW_H     = 20;
const FOOTER_H  = 26;
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

@Injectable()
export class CustomerStatementPdfService {
  async generate(data: {
    customer: any;
    transactions: any[];
    openingBalance: number;
    closingBalance: number;
    period: string;
    month?: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });
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
    const { deliveryRows, otherRows, ratePerBottle } = this.buildRows(transactions, openingBalance);

    this.drawBrandHeader(doc);
    this.drawTitleRow(doc, customer, period, month, openingBalance, closingBalance, ratePerBottle);

    doc.y += 10;
    this.drawSectionLabel(doc, 'Delivery History');
    this.drawDeliveryTableHeader(doc);
    this.drawDeliveryRows(doc, deliveryRows, openingBalance);
    this.drawDeliveryTotals(doc, deliveryRows, openingBalance);

    if (otherRows.length) {
      doc.y += 14;
      this.drawSectionLabel(doc, 'Other Transactions');
      this.drawOtherTableHeader(doc);
      this.drawOtherRows(doc, otherRows);
    }

    doc.y += 14;
    this.drawClosingBalanceBar(doc, closingBalance);
    doc.y += 14;
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

  // ── Brand header (logo + company identity) ─────────────────────────────────
  private drawBrandHeader(doc: PDFKit.PDFDocument): void {
    const y = MARGIN;
    let logoBottom = y;

    try {
      if (fs.existsSync(LOGO_PATH)) {
        const logoW = 60;
        doc.image(LOGO_PATH, MARGIN + CONTENT_W / 2 - logoW / 2, y, { width: logoW });
        logoBottom = y + logoW * 0.6;
      }
    } catch {
      // logo missing/unreadable — fall back to text-only header
    }

    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(18)
      .text(COMPANY_NAME, MARGIN, logoBottom + 6, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.fillColor(C.textSoft).font('Helvetica').fontSize(8.5)
      .text(COMPANY_ADDRESS, MARGIN, doc.y + 4, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.fillColor(C.textSoft).font('Helvetica').fontSize(8.5)
      .text(COMPANY_PHONES, MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center', lineBreak: false });

    const dividerY = doc.y + 10;
    doc.moveTo(MARGIN, dividerY).lineTo(MARGIN + CONTENT_W, dividerY)
      .strokeColor(C.blue).lineWidth(1.5).stroke();

    doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(16)
      .text('STATEMENT', MARGIN, dividerY + 10, { width: CONTENT_W, align: 'center', lineBreak: false });

    doc.y = dividerY + 34;
  }

  // ── Customer box + period/billing info box ──────────────────────────────────
  private drawTitleRow(
    doc: PDFKit.PDFDocument,
    customer: any,
    period: string,
    month: string | undefined,
    openingBalance: number,
    closingBalance: number,
    ratePerBottle: number,
  ): void {
    const y       = doc.y;
    const boxH    = 100;
    const gap     = 12;
    const rightW  = 190;
    const leftW   = CONTENT_W - rightW - gap;

    // LEFT — customer info box (rounded rect)
    doc.roundedRect(MARGIN, y, leftW, boxH, 8).strokeColor(C.border).lineWidth(1).stroke();
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(13)
      .text(customer.name ?? '—', MARGIN + 14, y + 16, { width: leftW - 28, align: 'center' });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
      .text(customer.address ?? '—', MARGIN + 14, y + 40, { width: leftW - 28, align: 'center' });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
      .text(customer.phoneNumber ?? '—', MARGIN + 14, y + 64, { width: leftW - 28, align: 'center' });

    // RIGHT — period / billing mini-table
    const rx = MARGIN + leftW + gap;
    const shortPeriod = month ? this.shortMonthLabel(month) : period;

    doc.rect(rx, y, rightW, 22).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(12)
      .text(shortPeriod, rx, y + 5, { width: rightW, align: 'center', lineBreak: false });

    const fromTo = month ? this.monthBounds(month) : null;
    const rows: [string, string][] = [
      ['From',         fromTo?.from ?? '—'],
      ['To',           fromTo?.to ?? '—'],
      ['Cust Code',    customer.customerCode ?? '—'],
      ['Pay Mode',     customer.paymentType === 'MONTHLY' ? 'Monthly' : 'Cash'],
      ['Rate Per Btl', ratePerBottle > 0 ? `Rs. ${ratePerBottle.toFixed(0)}` : '—'],
      ['Bill Amount',  `Rs. ${this.absFmt(closingBalance)}`],
    ];

    const rowH = (boxH - 22) / rows.length;
    rows.forEach(([lbl, val], i) => {
      const ry = y + 22 + i * rowH;
      const bg = i % 2 === 0 ? C.surface2 : C.white;
      doc.rect(rx, ry, rightW, rowH).fill(bg);
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
        .text(lbl, rx + 8, ry + rowH / 2 - 4, { width: rightW * 0.5, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8)
        .text(val, rx, ry + rowH / 2 - 4, { width: rightW - 8, align: 'right', lineBreak: false });
    });
    doc.rect(rx, y, rightW, boxH).strokeColor(C.border).lineWidth(1).stroke();

    doc.y = y + boxH;
  }

  // ── Section label ──────────────────────────────────────────────────────────
  private drawSectionLabel(doc: PDFKit.PDFDocument, title: string): void {
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 18).fill(C.surface2);
    doc.rect(MARGIN, y, 3, 18).fill(C.blue);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(8.5)
      .text(title, MARGIN + 10, y + 4, { width: CONTENT_W - 14, lineBreak: false });
    doc.y = y + 18;
  }

  // ── Delivery table ─────────────────────────────────────────────────────────
  private drawDeliveryTableHeader(doc: PDFKit.PDFDocument): void {
    if (doc.y + ROW_H > FOOTER_Y - 20) { doc.addPage(); doc.y = MARGIN; }
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(6.5);
    doc.text('DATE',         DCOL.date.x  + 3, y + 6, { width: DCOL.date.w  - 4, lineBreak: false });
    doc.text('TRANS#',       DCOL.trans.x + 3, y + 6, { width: DCOL.trans.w - 4, lineBreak: false });
    doc.text('BTL DEL',      DCOL.btl.x   + 3, y + 6, { width: DCOL.btl.w   - 4, align: 'right', lineBreak: false });
    doc.text('EMPTY PKUP',   DCOL.empty.x + 3, y + 6, { width: DCOL.empty.w - 4, align: 'right', lineBreak: false });
    doc.text('BAL BTL',      DCOL.bal.x   + 3, y + 6, { width: DCOL.bal.w   - 4, align: 'right', lineBreak: false });
    doc.text('AMOUNT DUE',   DCOL.due.x   + 3, y + 6, { width: DCOL.due.w   - 6, align: 'right', lineBreak: false });
    doc.text('AMOUNT RECV',  DCOL.recv.x  + 3, y + 6, { width: DCOL.recv.w  - 6, align: 'right', lineBreak: false });
    doc.text('BALANCE',      DCOL.amt.x   + 3, y + 6, { width: DCOL.amt.w   - 6, align: 'right', lineBreak: false });
    doc.y = y + ROW_H;
  }

  private drawDeliveryRows(doc: PDFKit.PDFDocument, rows: DeliveryRow[], openingBalance: number): void {
    // Previous month balance row
    this.ensureRowSpace(doc);
    let rowY = doc.y;
    doc.rect(MARGIN, rowY, CONTENT_W, ROW_H).fill(C.surface);
    doc.fillColor(C.text).font('Helvetica-Oblique').fontSize(7.5)
      .text('Previous Month Balance', DCOL.date.x + 3, rowY + 6, { width: DCOL.trans.x + DCOL.trans.w - DCOL.date.x - 6, lineBreak: false });
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(openingBalance), DCOL.due.x + 3, rowY + 6, { width: DCOL.due.w - 6, align: 'right', lineBreak: false });
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(openingBalance), DCOL.amt.x + 3, rowY + 6, { width: DCOL.amt.w - 6, align: 'right', lineBreak: false });
    doc.moveTo(MARGIN, rowY + ROW_H).lineTo(MARGIN + CONTENT_W, rowY + ROW_H).strokeColor(C.border).lineWidth(0.5).stroke();
    doc.y = rowY + ROW_H;

    if (!rows.length) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
        .text('No deliveries recorded for this period.', MARGIN, doc.y + 14, { width: CONTENT_W, align: 'center' });
      doc.y += 36;
      return;
    }

    rows.forEach((row, idx) => {
      this.ensureRowSpace(doc, () => this.drawDeliveryTableHeader(doc));
      rowY = doc.y;
      const bg = idx % 2 === 0 ? C.white : C.surface;
      doc.rect(MARGIN, rowY, CONTENT_W, ROW_H).fill(bg);
      doc.moveTo(MARGIN, rowY + ROW_H).lineTo(MARGIN + CONTENT_W, rowY + ROW_H)
        .strokeColor(C.surface2).lineWidth(0.5).stroke();

      const ty = rowY + 6;
      const dateStr = new Date(row.date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });

      doc.fillColor(C.textSoft).font('Helvetica').fontSize(7.5)
        .text(dateStr, DCOL.date.x + 3, ty, { width: DCOL.date.w - 4, lineBreak: false });
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
        .text(row.trans, DCOL.trans.x + 3, ty, { width: DCOL.trans.w - 4, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(`${row.btlDelivered}`, DCOL.btl.x + 3, ty, { width: DCOL.btl.w - 4, align: 'right', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(`${row.emptyPickup}`, DCOL.empty.x + 3, ty, { width: DCOL.empty.w - 4, align: 'right', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(row.bottleBalance != null ? `${row.bottleBalance}` : '—', DCOL.bal.x + 3, ty, { width: DCOL.bal.w - 4, align: 'right', lineBreak: false });
      doc.fillColor(C.red).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(row.amountDue), DCOL.due.x + 3, ty, { width: DCOL.due.w - 6, align: 'right', lineBreak: false });
      if (row.amountReceived > 0) {
        doc.fillColor(C.green).font('Helvetica-Bold').fontSize(7.5)
          .text(this.rs(row.amountReceived), DCOL.recv.x + 3, ty, { width: DCOL.recv.w - 6, align: 'right', lineBreak: false });
      }
      const balColor = row.runningBalance > 0 ? C.red : row.runningBalance < 0 ? C.green : C.text;
      doc.fillColor(balColor).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(Math.abs(row.runningBalance)), DCOL.amt.x + 3, ty, { width: DCOL.amt.w - 6, align: 'right', lineBreak: false });

      doc.y = rowY + ROW_H;
    });
  }

  private drawDeliveryTotals(doc: PDFKit.PDFDocument, rows: DeliveryRow[], openingBalance: number): void {
    this.ensureRowSpace(doc, () => this.drawDeliveryTableHeader(doc));
    const y = doc.y;
    const totalDue     = openingBalance + rows.reduce((s, r) => s + r.amountDue, 0);
    const totalRecv    = rows.reduce((s, r) => s + r.amountReceived, 0);
    const totalBtl     = rows.reduce((s, r) => s + r.btlDelivered, 0);
    const totalEmpty   = rows.reduce((s, r) => s + r.emptyPickup, 0);
    const finalBalance = rows.length ? rows[rows.length - 1].runningBalance : openingBalance;

    doc.rect(MARGIN, y, CONTENT_W, ROW_H + 2).fill(C.surface2);
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(C.border).lineWidth(0.75).stroke();

    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.5)
      .text('TOTAL', DCOL.date.x + 3, y + 7, { width: DCOL.date.w + DCOL.trans.w - 6, lineBreak: false });
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.5)
      .text(`${totalBtl}`, DCOL.btl.x + 3, y + 7, { width: DCOL.btl.w - 4, align: 'right', lineBreak: false });
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.5)
      .text(`${totalEmpty}`, DCOL.empty.x + 3, y + 7, { width: DCOL.empty.w - 4, align: 'right', lineBreak: false });
    doc.fillColor(C.red).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(totalDue), DCOL.due.x + 3, y + 7, { width: DCOL.due.w - 6, align: 'right', lineBreak: false });
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(totalRecv), DCOL.recv.x + 3, y + 7, { width: DCOL.recv.w - 6, align: 'right', lineBreak: false });
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.5)
      .text(this.rs(Math.abs(finalBalance)), DCOL.amt.x + 3, y + 7, { width: DCOL.amt.w - 6, align: 'right', lineBreak: false });

    doc.y = y + ROW_H + 2;
  }

  // ── Other transactions table ────────────────────────────────────────────────
  private drawOtherTableHeader(doc: PDFKit.PDFDocument): void {
    if (doc.y + ROW_H > FOOTER_Y - 20) { doc.addPage(); doc.y = MARGIN; }
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(C.surface2);
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.5);
    doc.text('DATE',        OCOL.date.x + 3, y + 6, { width: OCOL.date.w - 4, lineBreak: false });
    doc.text('TYPE',        OCOL.type.x + 3, y + 6, { width: OCOL.type.w - 4, lineBreak: false });
    doc.text('DESCRIPTION', OCOL.desc.x + 3, y + 6, { width: OCOL.desc.w - 4, lineBreak: false });
    doc.text('AMOUNT',      OCOL.amt.x  + 3, y + 6, { width: OCOL.amt.w  - 6, align: 'right', lineBreak: false });
    doc.text('BALANCE',     OCOL.bal.x  + 3, y + 6, { width: OCOL.bal.w  - 6, align: 'right', lineBreak: false });
    doc.y = y + ROW_H;
  }

  private drawOtherRows(doc: PDFKit.PDFDocument, rows: OtherRow[]): void {
    rows.forEach((row, idx) => {
      this.ensureRowSpace(doc, () => this.drawOtherTableHeader(doc));
      const rowY = doc.y;
      const bg = idx % 2 === 0 ? C.white : C.surface;
      doc.rect(MARGIN, rowY, CONTENT_W, ROW_H).fill(bg);
      doc.moveTo(MARGIN, rowY + ROW_H).lineTo(MARGIN + CONTENT_W, rowY + ROW_H)
        .strokeColor(C.surface2).lineWidth(0.5).stroke();

      const ty = rowY + 6;
      const dateStr = new Date(row.date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
      const typeColor = TYPE_COLOR[row.type] ?? C.muted;

      doc.fillColor(C.textSoft).font('Helvetica').fontSize(7.5)
        .text(dateStr, OCOL.date.x + 3, ty, { width: OCOL.date.w - 4, lineBreak: false });
      doc.fillColor(typeColor).font('Helvetica-Bold').fontSize(7.5)
        .text(row.type, OCOL.type.x + 3, ty, { width: OCOL.type.w - 4, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(row.description, OCOL.desc.x + 3, ty, { width: OCOL.desc.w - 4, lineBreak: false });

      const amtColor = row.amount > 0 ? C.red : C.green;
      doc.fillColor(amtColor).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(Math.abs(row.amount)), OCOL.amt.x + 3, ty, { width: OCOL.amt.w - 6, align: 'right', lineBreak: false });

      const balColor = row.runningBalance > 0 ? C.red : row.runningBalance < 0 ? C.green : C.text;
      doc.fillColor(balColor).font('Helvetica-Bold').fontSize(7.5)
        .text(this.rs(Math.abs(row.runningBalance)), OCOL.bal.x + 3, ty, { width: OCOL.bal.w - 6, align: 'right', lineBreak: false });

      doc.y = rowY + ROW_H;
    });
  }

  // ── Closing balance summary bar ─────────────────────────────────────────────
  private drawClosingBalanceBar(doc: PDFKit.PDFDocument, closingBalance: number): void {
    if (doc.y + 28 > FOOTER_Y - 20) { doc.addPage(); doc.y = MARGIN; }
    const y = doc.y;
    const color = closingBalance > 0 ? C.red : C.green;
    doc.rect(MARGIN, y, CONTENT_W, 28).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9)
      .text('CLOSING BALANCE', MARGIN + 14, y + 9, { lineBreak: false });
    doc.fillColor(color === C.red ? '#fca5a5' : '#86efac').font('Helvetica-Bold').fontSize(11)
      .text(`Rs. ${this.absFmt(closingBalance)}`, MARGIN, y + 7, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.y = y + 28;
  }

  // ── Thank-you / payment footer (appears once at end of document) ───────────
  private drawThankYouFooter(doc: PDFKit.PDFDocument): void {
    if (doc.y + 70 > FOOTER_Y - 10) { doc.addPage(); doc.y = MARGIN; }
    const y = doc.y;

    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(9)
      .text('Thank you for your business with us!', MARGIN, y, { width: CONTENT_W, align: 'center' });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
      .text(`Please make all payments to ${BANK_TITLE}`, MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });

    const py = doc.y + 12;
    doc.rect(MARGIN, py, CONTENT_W, 1).fill(C.border);

    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(7.5)
      .text('FOR ONLINE PAYMENTS', MARGIN, py + 8, { width: CONTENT_W, align: 'center' });

    const colW = CONTENT_W / 2;
    const rows: [string, string][] = [
      ['Acc Title', BANK_TITLE],
      ['Acc No',    BANK_ACCOUNT_NO],
      ['Bank',      BANK_NAME],
    ];
    rows.forEach(([lbl, val], i) => {
      const ry = py + 22 + i * 12;
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7)
        .text(lbl.toUpperCase(), MARGIN, ry, { width: colW * 0.4, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(val, MARGIN + colW * 0.4, ry, { width: colW * 0.6, lineBreak: false });
    });

    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7)
      .text('EASYPAISA ACC NO', MARGIN + colW, py + 22, { width: colW, lineBreak: false });
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8.5)
      .text(EASYPAISA_NO, MARGIN + colW, py + 34, { width: colW, lineBreak: false });

    doc.y = py + 22 + rows.length * 12 + 6;
  }

  // ── Per-page footer (page number + timestamp) ───────────────────────────────
  private drawPageFooter(doc: PDFKit.PDFDocument, pageNum: number, totalPages: number): void {
    const stamp = new Date().toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    doc.moveTo(MARGIN, FOOTER_Y).lineTo(PAGE_W - MARGIN, FOOTER_Y).strokeColor(C.border).lineWidth(0.5).stroke();
    doc.fillColor(C.mutedLt).font('Helvetica').fontSize(6.5)
      .text(`Generated ${stamp}`, MARGIN, FOOTER_Y + 8, { lineBreak: false });
    doc.fillColor(C.mutedLt).font('Helvetica-Bold').fontSize(6.5)
      .text(`Page ${pageNum} of ${totalPages}`, MARGIN, FOOTER_Y + 8, { width: CONTENT_W, align: 'right', lineBreak: false });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private ensureRowSpace(doc: PDFKit.PDFDocument, onBreak?: () => void): void {
    if (doc.y + ROW_H > FOOTER_Y - 20) {
      doc.addPage();
      doc.y = MARGIN;
      onBreak?.();
    }
  }

  private shortMonthLabel(month: string): string {
    const [year, mon] = month.split('-').map(Number);
    return new Date(year, mon - 1, 1).toLocaleString('en-PK', { month: 'short', year: '2-digit' });
  }

  private monthBounds(month: string): { from: string; to: string } {
    const [year, mon] = month.split('-').map(Number);
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 0);
    const fmt = (d: Date) => d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: '2-digit' });
    return { from: fmt(from), to: fmt(to) };
  }

  private rs(n: number): string {
    return `Rs.${Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  private absFmt(n: number): string {
    return Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
