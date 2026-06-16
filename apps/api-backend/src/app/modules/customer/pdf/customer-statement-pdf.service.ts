import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');

// ── Brand ──────────────────────────────────────────────────────────────────
const BRAND = 'Blue Ice';

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  navy:     '#0f172a',
  blue:     '#3b82f6',
  muted:    '#64748b',
  mutedLt:  '#94a3b8',
  border:   '#e2e8f0',
  surface:  '#f8fafc',
  surface2: '#f1f5f9',
  text:     '#1e293b',
  textSoft: '#475569',
  white:    '#ffffff',
  red:      '#dc2626',
  green:    '#059669',
  amber:    '#d97706',
  purple:   '#7c3aed',
  cyan:     '#0891b2',
};

// ── Transaction type metadata ───────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  PAYMENT:    'Payment',
  DELIVERY:   'Delivery',
  ADJUSTMENT: 'Adjustment',
  COLLECTION: 'Collection',
  LOAD_OUT:   'Load Out',
  CHECK_IN:   'Check In',
};

const TYPE_COLOR: Record<string, string> = {
  PAYMENT:    C.green,
  DELIVERY:   C.blue,
  ADJUSTMENT: C.amber,
  COLLECTION: C.purple,
  LOAD_OUT:   C.cyan,
  CHECK_IN:   C.cyan,
};

// ── Page geometry ───────────────────────────────────────────────────────────
const MARGIN    = 40;
const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;   // 515.28
const HEADER_H  = 88;
const ACCENT_H  = 3;
const ROW_H     = 22;
const FOOTER_H  = 58;
const FOOTER_Y  = PAGE_H - FOOTER_H;     // ~783

// ── Table column geometry (widths sum to 515 = CONTENT_W) ──────────────────
const COL = {
  date:  { x: MARGIN,       w: 68  },   // 68
  type:  { x: MARGIN + 68,  w: 74  },   // 74
  desc:  { x: MARGIN + 142, w: 160 },   // 160
  debit: { x: MARGIN + 302, w: 66  },   // 66
  cred:  { x: MARGIN + 368, w: 66  },   // 66
  bal:   { x: MARGIN + 434, w: 81  },   // 81  → total 515 ✓
};

// ── Service ─────────────────────────────────────────────────────────────────
@Injectable()
export class CustomerStatementPdfService {
  async generate(data: {
    customer: any;
    transactions: any[];
    openingBalance: number;
    closingBalance: number;
    period: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      this.drawContent(doc, data);

      // Stamp page-X-of-Y footer on every buffered page
      const { count } = doc.bufferedPageRange();
      for (let i = 0; i < count; i++) {
        doc.switchToPage(i);
        this.drawFooter(doc, i + 1, count);
      }

      doc.flushPages();
      doc.end();
    });
  }

  // ── Document flow ──────────────────────────────────────────────────────────
  private drawContent(doc: PDFKit.PDFDocument, data: any): void {
    const { customer, transactions, openingBalance, closingBalance, period } = data;
    this.drawHeader(doc, period);
    this.drawInfoStrip(doc, customer, period);
    this.drawBalanceCards(doc, openingBalance, closingBalance);
    doc.y += 12;
    this.drawSectionLabel(doc, `Transaction History  (${transactions.length} record${transactions.length !== 1 ? 's' : ''})`);
    doc.y += 6;
    this.drawTableHeader(doc);
    this.drawTableRows(doc, transactions, openingBalance);
    this.drawTotalsRow(doc, transactions);
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  private drawHeader(doc: PDFKit.PDFDocument, period: string): void {
    // Navy background — full bleed
    doc.rect(0, 0, PAGE_W, HEADER_H).fill(C.navy);

    // Brand (left)
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(26)
       .text(BRAND, MARGIN + 8, 18, { lineBreak: false });
    doc.fillColor(C.mutedLt).font('Helvetica').fontSize(9)
       .text('Customer Account Statement', MARGIN + 8, 52, { lineBreak: false });

    // Period (right)
    doc.fillColor(C.mutedLt).font('Helvetica').fontSize(7.5)
       .text('STATEMENT PERIOD', MARGIN, 20, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(14)
       .text(period, MARGIN, 36, { width: CONTENT_W, align: 'right', lineBreak: false });

    // Blue accent bar
    doc.rect(0, HEADER_H, PAGE_W, ACCENT_H).fill(C.blue);

    doc.y = HEADER_H + ACCENT_H + 16;
  }

  // ── Info strip ─────────────────────────────────────────────────────────────
  private drawInfoStrip(doc: PDFKit.PDFDocument, customer: any, period: string): void {
    const y     = doc.y;
    const h     = 98;
    const halfW = CONTENT_W / 2;
    const lx    = MARGIN + 14;
    const rx    = MARGIN + halfW + 14;
    const lblW  = 52;

    // Outer border
    doc.rect(MARGIN, y, CONTENT_W, h).strokeColor(C.border).lineWidth(0.75).stroke();

    // Vertical divider
    doc.moveTo(MARGIN + halfW, y).lineTo(MARGIN + halfW, y + h)
       .strokeColor(C.border).lineWidth(0.75).stroke();

    // LEFT — Customer details
    doc.fillColor(C.mutedLt).font('Helvetica-Bold').fontSize(6.5)
       .text('CUSTOMER DETAILS', lx, y + 10, { lineBreak: false });

    const leftRows: [string, string][] = [
      ['Name',    customer.name        ?? '—'],
      ['Code',    customer.customerCode ?? '—'],
      ['Phone',   customer.phoneNumber  ?? '—'],
      ['Address', customer.address      ?? '—'],
    ];
    leftRows.forEach(([lbl, val], i) => {
      const ry = y + 26 + i * 16;
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
         .text(lbl, lx, ry, { width: lblW, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8)
         .text(val, lx + lblW, ry, { width: halfW - lblW - 18, lineBreak: false });
    });

    // RIGHT — Statement details
    const refNo   = `BI-${(customer.customerCode ?? '0000').toUpperCase()}-${period.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;
    const genDate = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
    const status  = customer.isActive === false ? 'Inactive' : 'Active Account';

    doc.fillColor(C.mutedLt).font('Helvetica-Bold').fontSize(6.5)
       .text('STATEMENT DETAILS', rx, y + 10, { lineBreak: false });

    const rightRows: [string, string][] = [
      ['Period',    period],
      ['Generated', genDate],
      ['Reference', refNo],
      ['Status',    status],
    ];
    rightRows.forEach(([lbl, val], i) => {
      const ry = y + 26 + i * 16;
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
         .text(lbl, rx, ry, { width: lblW, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8)
         .text(val, rx + lblW, ry, { width: halfW - lblW - 16, lineBreak: false });
    });

    doc.y = y + h + 14;
  }

  // ── Balance cards ──────────────────────────────────────────────────────────
  private drawBalanceCards(doc: PDFKit.PDFDocument, opening: number, closing: number): void {
    const y       = doc.y;
    const gap     = 8;
    const cardW   = (CONTENT_W - gap * 2) / 3;
    const cardH   = 68;
    const barW    = 5;
    const activity = closing - opening;

    const cards = [
      { label: 'OPENING BALANCE', sub: 'Balance brought forward', amt: opening,  bar: C.blue                     },
      { label: 'PERIOD ACTIVITY',  sub: 'Net change this period',  amt: activity, bar: C.amber                    },
      { label: 'CLOSING BALANCE', sub: 'Balance carried forward',  amt: closing,  bar: closing > 0 ? C.red : C.green },
    ];

    cards.forEach((card, i) => {
      const cx = MARGIN + i * (cardW + gap);

      // White fill
      doc.rect(cx, y, cardW, cardH).fill(C.white);
      // Accent bar
      doc.rect(cx, y, barW, cardH).fill(card.bar);
      // Border (drawn last, on top)
      doc.rect(cx, y, cardW, cardH).lineWidth(0.75).strokeColor(C.border).stroke();

      const tx = cx + barW + 9;
      const tw = cardW - barW - 13;

      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7)
         .text(card.label, tx, y + 10, { width: tw, lineBreak: false });

      const sign   = card.amt < 0 ? '− ' : '';
      const amtStr = `Rs. ${sign}${Math.abs(card.amt).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13)
         .text(amtStr, tx, y + 25, { width: tw, lineBreak: false });

      doc.fillColor(C.mutedLt).font('Helvetica').fontSize(7)
         .text(card.sub, tx, y + 50, { width: tw, lineBreak: false });
    });

    doc.y = y + cardH + 14;
  }

  // ── Section label ──────────────────────────────────────────────────────────
  private drawSectionLabel(doc: PDFKit.PDFDocument, title: string): void {
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 20).fill(C.surface2);
    doc.rect(MARGIN, y, 3, 20).fill(C.blue);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8.5)
       .text(title, MARGIN + 10, y + 5, { width: CONTENT_W - 14, lineBreak: false });
    doc.y = y + 20;
  }

  // ── Table header ───────────────────────────────────────────────────────────
  private drawTableHeader(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(C.surface2);
    doc.moveTo(MARGIN, y + ROW_H).lineTo(MARGIN + CONTENT_W, y + ROW_H)
       .strokeColor(C.border).lineWidth(0.5).stroke();

    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7);
    doc.text('DATE',        COL.date.x  + 3, y + 7, { width: COL.date.w  - 4, lineBreak: false });
    doc.text('TYPE',        COL.type.x  + 3, y + 7, { width: COL.type.w  - 4, lineBreak: false });
    doc.text('DESCRIPTION', COL.desc.x  + 3, y + 7, { width: COL.desc.w  - 4, lineBreak: false });
    doc.text('DEBIT',       COL.debit.x + 3, y + 7, { width: COL.debit.w - 6, align: 'right', lineBreak: false });
    doc.text('CREDIT',      COL.cred.x  + 3, y + 7, { width: COL.cred.w  - 6, align: 'right', lineBreak: false });
    doc.text('BALANCE',     COL.bal.x   + 3, y + 7, { width: COL.bal.w   - 6, align: 'right', lineBreak: false });

    doc.y = y + ROW_H;
  }

  // ── Table rows ─────────────────────────────────────────────────────────────
  private drawTableRows(doc: PDFKit.PDFDocument, transactions: any[], openingBalance: number): void {
    if (!transactions.length) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(9)
         .text('No transactions recorded for this period.', MARGIN, doc.y + 18, { width: CONTENT_W, align: 'center' });
      doc.y += 46;
      return;
    }

    let running = openingBalance;

    transactions.forEach((tx, idx) => {
      // Overflow — leave room for footer
      if (doc.y + ROW_H > FOOTER_Y - 20) {
        doc.addPage();
        doc.y = MARGIN;
        this.drawTableHeader(doc);
      }

      const rowY  = doc.y;
      const rowBg = idx % 2 === 0 ? C.white : C.surface;
      doc.rect(MARGIN, rowY, CONTENT_W, ROW_H).fill(rowBg);
      doc.moveTo(MARGIN, rowY + ROW_H).lineTo(MARGIN + CONTENT_W, rowY + ROW_H)
         .strokeColor(C.surface2).lineWidth(0.5).stroke();

      const amount = tx.amount ?? 0;
      const debit  = amount > 0 ? amount : 0;
      const credit = amount < 0 ? Math.abs(amount) : 0;
      running     += amount;

      const typeColor = TYPE_COLOR[tx.type] ?? C.muted;
      const typeLabel = TYPE_LABEL[tx.type]  ?? tx.type;
      const desc      = tx.description ?? tx.product?.name ?? '—';
      const dateStr   = new Date(tx.createdAt).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' });
      const ty        = rowY + 6;

      // Date
      doc.fillColor(C.textSoft).font('Helvetica').fontSize(8)
         .text(dateStr, COL.date.x + 3, ty, { width: COL.date.w - 4, lineBreak: false });

      // Type — colored bold
      doc.fillColor(typeColor).font('Helvetica-Bold').fontSize(7.5)
         .text(typeLabel, COL.type.x + 3, ty, { width: COL.type.w - 4, lineBreak: false });

      // Description
      doc.fillColor(C.text).font('Helvetica').fontSize(8)
         .text(desc, COL.desc.x + 3, ty, { width: COL.desc.w - 4, lineBreak: false });

      // Debit (red)
      if (debit > 0) {
        doc.fillColor(C.red).font('Helvetica-Bold').fontSize(8)
           .text(this.rs(debit), COL.debit.x + 3, ty, { width: COL.debit.w - 6, align: 'right', lineBreak: false });
      }

      // Credit (green)
      if (credit > 0) {
        doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8)
           .text(this.rs(credit), COL.cred.x + 3, ty, { width: COL.cred.w - 6, align: 'right', lineBreak: false });
      }

      // Running balance
      const balColor = running > 0 ? C.red : running < 0 ? C.green : C.text;
      doc.fillColor(balColor).font('Helvetica-Bold').fontSize(8)
         .text(this.rs(Math.abs(running)), COL.bal.x + 3, ty, { width: COL.bal.w - 6, align: 'right', lineBreak: false });

      doc.y = rowY + ROW_H;
    });
  }

  // ── Totals row ─────────────────────────────────────────────────────────────
  private drawTotalsRow(doc: PDFKit.PDFDocument, transactions: any[]): void {
    if (!transactions.length) return;
    if (doc.y + 28 > FOOTER_Y - 20) { doc.addPage(); doc.y = MARGIN; }

    const totalDebit  = transactions.reduce((s, tx) => s + (tx.amount > 0 ? tx.amount        : 0), 0);
    const totalCredit = transactions.reduce((s, tx) => s + (tx.amount < 0 ? Math.abs(tx.amount) : 0), 0);

    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 26).fill(C.surface2);
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y)
       .strokeColor(C.border).lineWidth(0.75).stroke();

    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.5)
       .text('PERIOD TOTALS', COL.date.x + 3, y + 8,
         { width: COL.date.w + COL.type.w + COL.desc.w - 6, lineBreak: false });

    if (totalDebit > 0) {
      doc.fillColor(C.red).font('Helvetica-Bold').fontSize(8)
         .text(this.rs(totalDebit), COL.debit.x + 3, y + 8, { width: COL.debit.w - 6, align: 'right', lineBreak: false });
    }
    if (totalCredit > 0) {
      doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8)
         .text(this.rs(totalCredit), COL.cred.x + 3, y + 8, { width: COL.cred.w - 6, align: 'right', lineBreak: false });
    }

    doc.y = y + 26;
  }

  // ── Footer — stamped on every page after buffering ─────────────────────────
  private drawFooter(doc: PDFKit.PDFDocument, pageNum: number, totalPages: number): void {
    const stamp = new Date().toLocaleString('en-PK', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    // Separator
    doc.moveTo(MARGIN, FOOTER_Y + 8).lineTo(PAGE_W - MARGIN, FOOTER_Y + 8)
       .strokeColor(C.border).lineWidth(0.75).stroke();

    // Brand + timestamp (left)
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
       .text(`${BRAND}  •  Generated ${stamp}`, MARGIN, FOOTER_Y + 18, { lineBreak: false });

    // Page X of Y (right)
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7.5)
       .text(`Page ${pageNum} of ${totalPages}`, MARGIN, FOOTER_Y + 18,
         { width: CONTENT_W, align: 'right', lineBreak: false });

    // Confidentiality note
    doc.fillColor(C.mutedLt).font('Helvetica').fontSize(6.5)
       .text('This statement is confidential. For queries, contact your supplier.',
         MARGIN, FOOTER_Y + 34, { width: CONTENT_W, lineBreak: false });
  }

  // ── Helper: format rupee amount ────────────────────────────────────────────
  private rs(n: number): string {
    return `Rs.${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
