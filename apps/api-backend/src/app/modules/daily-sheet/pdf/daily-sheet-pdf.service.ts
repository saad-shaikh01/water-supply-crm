import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');

// NOTE: standard PDF fonts (Helvetica) only support WinAnsi characters —
// no emoji, no ✓/⚠ glyphs. Stick to ASCII + · × — for decorations.

const PALETTE = {
  ink: '#0f172a',
  slate: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  bgSoft: '#f8fafc',
  accent: '#0284c7',
  accentLight: '#0ea5e9',
  white: '#ffffff',
};

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  COMPLETED: { label: 'DONE', bg: '#dcfce7', text: '#15803d' },
  EMPTY_ONLY: { label: 'EMPTY ONLY', bg: '#dbeafe', text: '#1d4ed8' },
  PENDING: { label: 'PENDING', bg: '#ffedd5', text: '#c2410c' },
  NOT_AVAILABLE: { label: 'NOT AVAILABLE', bg: '#f1f5f9', text: '#475569' },
  RESCHEDULED: { label: 'RESCHEDULED', bg: '#fef9c3', text: '#a16207' },
  CANCELLED: { label: 'CANCELLED', bg: '#fee2e2', text: '#b91c1c' },
};

const EXPENSE_META: Record<string, { label: string; bg: string; text: string }> = {
  FUEL: { label: 'FUEL', bg: '#fef9c3', text: '#a16207' },
  MAINTENANCE: { label: 'MAINTENANCE', bg: '#dbeafe', text: '#1d4ed8' },
  REPAIR: { label: 'REPAIR', bg: '#ffedd5', text: '#c2410c' },
  SALARY: { label: 'SALARY', bg: '#f3e8ff', text: '#7e22ce' },
  OTHER: { label: 'OTHER', bg: '#f1f5f9', text: '#475569' },
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2; // 515
const FOOTER_ZONE = 70; // reserved at page bottom

// Table column widths (sum = CONTENT_W)
const COLS = { seq: 24, customer: 148, product: 90, filled: 44, empty: 44, cash: 68, status: 97 };

@Injectable()
export class DailySheetPdfService {
  /**
   * Generates a PDF buffer for a daily sheet.
   * @param sheet - Full sheet object from dailySheet.service.findOne()
   * @returns Buffer — pipe directly to response
   */
  async generate(sheet: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawDocument(doc, sheet);
      this.drawFooters(doc, sheet);
      doc.end();
    });
  }

  private rs(n: number): string {
    return `Rs ${Math.round(n ?? 0).toLocaleString('en-PK')}`;
  }

  private drawDocument(doc: PDFKit.PDFDocument, sheet: any): void {
    this.drawHeader(doc, sheet);
    this.drawMetaStrip(doc, sheet);
    this.drawSummary(doc, sheet);
    this.drawSectionTitle(doc, `Delivery Items (${sheet.items?.length ?? 0} stops)`);
    this.drawDeliveryTable(doc, sheet.items ?? []);
    if (sheet.expenses?.length) this.drawExpenses(doc, sheet.expenses);
    if (sheet.isClosed) this.drawSignatures(doc);
  }

  // ─── Header band ─────────────────────────────────────────────────────────
  private drawHeader(doc: PDFKit.PDFDocument, sheet: any): void {
    const date = new Date(sheet.date).toLocaleDateString('en-PK', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const vendorName = sheet.vendor?.name ?? 'Water Supply CRM';

    doc.roundedRect(MARGIN, 40, CONTENT_W, 78, 8).fill(PALETTE.ink);

    // Water-drop monogram (drawn — standard fonts can't render emoji)
    const cx = 68, cy = 79;
    doc.circle(cx, cy, 16).fill(PALETTE.accentLight);
    doc.moveTo(cx, cy - 8)
      .bezierCurveTo(cx + 7.5, cy + 1, cx + 6, cy + 8, cx, cy + 8)
      .bezierCurveTo(cx - 6, cy + 8, cx - 7.5, cy + 1, cx, cy - 8)
      .fill(PALETTE.white);

    doc.fillColor(PALETTE.white).fontSize(17).font('Helvetica-Bold')
      .text(vendorName, 94, 56, { width: 350, height: 20, ellipsis: true, lineBreak: false });
    doc.fillColor(PALETTE.faint).fontSize(9).font('Helvetica')
      .text('Daily Delivery Sheet', 94, 78, { lineBreak: false });
    doc.fillColor('#cbd5e1').fontSize(8.5)
      .text(date, 94, 92, { lineBreak: false });

    // Status pill
    const closed = !!sheet.isClosed;
    const pillW = 64, pillH = 20;
    const pillX = MARGIN + CONTENT_W - pillW - 14;
    doc.roundedRect(pillX, 52, pillW, pillH, 10).fill(closed ? '#16a34a' : '#d97706');
    doc.fillColor(PALETTE.white).fontSize(8).font('Helvetica-Bold')
      .text(closed ? 'CLOSED' : 'OPEN', pillX, 58, { width: pillW, align: 'center', lineBreak: false });

    doc.y = 130;
  }

  // ─── Meta strip (driver / van / route / sheet) ───────────────────────────
  private drawMetaStrip(doc: PDFKit.PDFDocument, sheet: any): void {
    const y = doc.y;
    const h = 50;
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 6).fillAndStroke(PALETTE.bgSoft, PALETTE.border);

    const tripCount = sheet.loads?.length ?? 0;
    const cells = [
      { label: 'DRIVER', value: sheet.driver?.name ?? '—', sub: sheet.driver?.phoneNumber ?? '' },
      { label: 'VAN', value: sheet.van?.plateNumber ?? '—', sub: tripCount > 0 ? `${tripCount} trip${tripCount > 1 ? 's' : ''}` : '' },
      { label: 'ROUTE', value: sheet.route?.name ?? '—', sub: `${sheet.items?.length ?? 0} stops` },
      { label: 'SHEET #', value: sheet.id.slice(0, 8).toUpperCase(), sub: sheet.createdAt ? new Date(sheet.createdAt).toLocaleDateString('en-PK') : '' },
    ];

    const cellW = CONTENT_W / 4;
    cells.forEach((cell, i) => {
      const x = MARGIN + i * cellW + 14;
      const w = cellW - 20;
      if (i > 0) {
        doc.moveTo(MARGIN + i * cellW, y + 10).lineTo(MARGIN + i * cellW, y + h - 10)
          .lineWidth(0.5).stroke(PALETTE.border);
      }
      doc.fillColor(PALETTE.muted).fontSize(6.5).font('Helvetica-Bold')
        .text(cell.label, x, y + 9, { characterSpacing: 0.8, lineBreak: false });
      doc.fillColor(PALETTE.ink).fontSize(10).font('Helvetica-Bold')
        .text(cell.value, x, y + 20, { width: w, height: 12, ellipsis: true, lineBreak: false });
      if (cell.sub) {
        doc.fillColor(PALETTE.muted).fontSize(7.5).font('Helvetica')
          .text(cell.sub, x, y + 34, { width: w, height: 9, ellipsis: true, lineBreak: false });
      }
    });

    doc.y = y + h + 16;
    this.drawCrewStrip(doc, sheet);
  }

  // ─── Crew strip (salesman / loaders + confirmation) ──────────────────────
  private drawCrewStrip(doc: PDFKit.PDFDocument, sheet: any): void {
    const crew: any[] = sheet.crew ?? [];
    if (crew.length === 0) return;

    const salesman = crew.find((c) => c.role === 'SALESMAN');
    const loaders = crew.filter((c) => c.role === 'LOADER');
    const parts: string[] = [];
    if (salesman) parts.push(`Salesman: ${salesman.user?.name ?? '—'}`);
    if (loaders.length > 0) {
      parts.push(`Loader${loaders.length > 1 ? 's' : ''}: ${loaders.map((l) => l.user?.name ?? '—').join(', ')}`);
    }
    const confirmed = sheet.crewConfirmed
      ? `  •  Crew confirmed${sheet.crewConfirmedBy?.name ? ` by ${sheet.crewConfirmedBy.name}` : ''}`
      : '  •  Crew not confirmed';

    const y = doc.y - 8;
    doc.fillColor(PALETTE.muted).fontSize(6.5).font('Helvetica-Bold')
      .text('CREW', MARGIN, y, { characterSpacing: 0.8, lineBreak: false });
    doc.fillColor(PALETTE.slate).fontSize(8).font('Helvetica')
      .text(parts.join('  •  ') + confirmed, MARGIN + 34, y - 1, {
        width: CONTENT_W - 34, height: 10, ellipsis: true, lineBreak: false,
      });
    doc.y = y + 18;
  }

  // ─── Section title with accent bar ───────────────────────────────────────
  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    const y = doc.y;
    doc.rect(MARGIN, y, 3, 10).fill(PALETTE.accent);
    doc.fillColor(PALETTE.slate).fontSize(8.5).font('Helvetica-Bold')
      .text(title.toUpperCase(), MARGIN + 10, y + 1, { characterSpacing: 0.6, lineBreak: false });
    doc.y = y + 20;
  }

  // ─── Summary cards + reconciliation verdict ──────────────────────────────
  private drawSummary(doc: PDFKit.PDFDocument, sheet: any): void {
    this.drawSectionTitle(doc, 'Bottle & Cash Summary');

    const activeItems = (sheet.items ?? []).filter(
      (i: any) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY',
    );
    const delivered = activeItems.reduce((s: number, i: any) => s + (i.filledDropped ?? 0), 0);
    const bottleDiscrepancy = sheet.filledOutCount - (sheet.filledInCount + delivered);
    const emptyCollected = activeItems.reduce((s: number, i: any) => s + (i.emptyReceived ?? 0), 0);
    const emptyDiscrepancy = emptyCollected - sheet.emptyInCount;
    const cashDiscrepancy = (sheet.cashCollected ?? 0) - (sheet.cashExpected ?? 0);

    const cards = [
      { label: 'FILLED OUT', value: String(sheet.filledOutCount), accent: '#3b82f6' },
      { label: 'FILLED RETURNED', value: String(sheet.filledInCount), accent: '#10b981' },
      { label: 'EMPTY RECEIVED', value: String(sheet.emptyInCount), accent: '#eab308' },
      { label: 'CASH COLLECTED', value: this.rs(sheet.cashCollected), accent: '#22c55e' },
    ];

    const y = doc.y;
    const gap = 8;
    const cardW = (CONTENT_W - gap * 3) / 4;
    const cardH = 54;

    cards.forEach((card, i) => {
      const x = MARGIN + i * (cardW + gap);
      doc.roundedRect(x, y, cardW, cardH, 6).fillAndStroke(PALETTE.white, PALETTE.border);
      doc.rect(x + 1, y, cardW - 2, 2.5).fill(card.accent);
      doc.fillColor(PALETTE.muted).fontSize(6.5).font('Helvetica-Bold')
        .text(card.label, x + 4, y + 12, { width: cardW - 8, align: 'center', characterSpacing: 0.5, lineBreak: false });
      const valueSize = card.value.length > 8 ? 12 : 15;
      doc.fillColor(PALETTE.ink).fontSize(valueSize).font('Helvetica-Bold')
        .text(card.value, x + 4, y + 27, { width: cardW - 8, align: 'center', lineBreak: false });
    });

    doc.y = y + cardH + 10;

    // Verdict banner
    const bannerY = doc.y;
    const bannerH = 26;
    if (sheet.isClosed) {
      const clean = bottleDiscrepancy === 0 && emptyDiscrepancy === 0 && cashDiscrepancy === 0;
      const bg = clean ? '#f0fdf4' : '#fef2f2';
      const border = clean ? '#bbf7d0' : '#fecaca';
      const fg = clean ? '#15803d' : '#b91c1c';
      doc.roundedRect(MARGIN, bannerY, CONTENT_W, bannerH, 6).fillAndStroke(bg, border);
      doc.fillColor(fg).fontSize(8).font('Helvetica-Bold')
        .text(clean ? 'FULLY RECONCILED' : 'DISCREPANCY FOUND', MARGIN + 12, bannerY + 9, { characterSpacing: 0.6, lineBreak: false });
      const sign = (n: number) => `${n > 0 ? '+' : ''}${n}`;
      const cashSign = cashDiscrepancy > 0 ? '+' : cashDiscrepancy < 0 ? '-' : '';
      const detail = `Bottles ${sign(bottleDiscrepancy)}   ·   Empties ${sign(emptyDiscrepancy)}   ·   Cash ${cashSign}${this.rs(Math.abs(cashDiscrepancy))}`;
      doc.fillColor(clean ? '#166534' : '#991b1b').fontSize(8).font('Helvetica')
        .text(detail, MARGIN, bannerY + 9, { width: CONTENT_W - 12, align: 'right', lineBreak: false });
    } else {
      doc.roundedRect(MARGIN, bannerY, CONTENT_W, bannerH, 6).fillAndStroke(PALETTE.bgSoft, PALETTE.border);
      doc.fillColor(PALETTE.muted).fontSize(8).font('Helvetica')
        .text('Sheet is still open — reconciliation pending until close.', MARGIN + 12, bannerY + 9, { lineBreak: false });
    }

    doc.y = bannerY + bannerH + 18;
  }

  // ─── Delivery items table ────────────────────────────────────────────────
  private drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
    doc.rect(MARGIN, y, CONTENT_W, 22).fill(PALETTE.ink);
    doc.fillColor(PALETTE.white).fontSize(7.5).font('Helvetica-Bold');

    let x = MARGIN;
    doc.text('#', x + 4, y + 7, { lineBreak: false }); x += COLS.seq;
    doc.text('CUSTOMER', x + 4, y + 7, { characterSpacing: 0.5, lineBreak: false }); x += COLS.customer;
    doc.text('PRODUCT', x + 4, y + 7, { characterSpacing: 0.5, lineBreak: false }); x += COLS.product;
    doc.text('FILLED', x, y + 7, { width: COLS.filled - 6, align: 'right', lineBreak: false }); x += COLS.filled;
    doc.text('EMPTY', x, y + 7, { width: COLS.empty - 6, align: 'right', lineBreak: false }); x += COLS.empty;
    doc.text('CASH', x, y + 7, { width: COLS.cash - 6, align: 'right', lineBreak: false }); x += COLS.cash;
    doc.text('STATUS', x, y + 7, { width: COLS.status, align: 'center', characterSpacing: 0.5, lineBreak: false });

    return y + 22;
  }

  private drawPill(
    doc: PDFKit.PDFDocument,
    meta: { label: string; bg: string; text: string },
    colX: number, colW: number, rowY: number, rowH: number,
  ): void {
    doc.fontSize(6.5).font('Helvetica-Bold');
    const w = Math.min(doc.widthOfString(meta.label) + 14, colW - 6);
    const x = colX + (colW - w) / 2;
    const y = rowY + (rowH - 13) / 2;
    doc.roundedRect(x, y, w, 13, 6.5).fill(meta.bg);
    doc.fillColor(meta.text)
      .text(meta.label, x, y + 4, { width: w, align: 'center', lineBreak: false });
  }

  private drawStatusPill(doc: PDFKit.PDFDocument, status: string, colX: number, rowY: number, rowH: number): void {
    const meta = STATUS_META[status] ?? { label: status, bg: '#f1f5f9', text: '#475569' };
    this.drawPill(doc, meta, colX, COLS.status, rowY, rowH);
  }

  private drawDeliveryTable(doc: PDFKit.PDFDocument, items: any[]): void {
    let y = this.drawTableHeader(doc, doc.y);

    if (!items.length) {
      doc.fillColor(PALETTE.muted).fontSize(9).font('Helvetica')
        .text('No delivery items found.', MARGIN, y + 10, { width: CONTENT_W, align: 'center', lineBreak: false });
      doc.y = y + 30;
      return;
    }

    items.forEach((item, index) => {
      const reason: string | null = item.reason || null;
      const rowH = reason ? 32 : 21;

      // Page break — redraw table header on the new page
      if (y + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = this.drawTableHeader(doc, 50);
      }

      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(PALETTE.bgSoft);

      const textY = y + 6;
      doc.fillColor(PALETTE.slate).fontSize(8).font('Helvetica');
      let x = MARGIN;
      doc.text(String(item.sequence ?? index + 1), x + 4, textY, { lineBreak: false }); x += COLS.seq;
      doc.fillColor(PALETTE.ink).font('Helvetica-Bold')
        .text(item.customer?.name ?? '—', x + 4, textY, { width: COLS.customer - 8, height: 10, ellipsis: true, lineBreak: false });
      x += COLS.customer;
      doc.fillColor(PALETTE.slate).font('Helvetica')
        .text(item.product?.name ?? '—', x + 4, textY, { width: COLS.product - 8, height: 10, ellipsis: true, lineBreak: false });
      x += COLS.product;
      doc.text(String(item.filledDropped ?? 0), x, textY, { width: COLS.filled - 6, align: 'right', lineBreak: false }); x += COLS.filled;
      doc.text(String(item.emptyReceived ?? 0), x, textY, { width: COLS.empty - 6, align: 'right', lineBreak: false }); x += COLS.empty;
      doc.text(this.rs(item.cashCollected), x, textY, { width: COLS.cash - 6, align: 'right', lineBreak: false }); x += COLS.cash;

      this.drawStatusPill(doc, item.status, x, y, reason ? 21 : rowH);

      if (reason) {
        doc.fillColor(PALETTE.faint).fontSize(7).font('Helvetica-Oblique')
          .text(reason, MARGIN + COLS.seq + 4, y + 20, {
            width: COLS.customer + COLS.product + COLS.filled + COLS.empty + COLS.cash - 8,
            height: 9, ellipsis: true, lineBreak: false,
          });
      }

      y += rowH;
    });

    // Totals row
    if (y + 24 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      y = 50;
    }
    const totalFilled = items.reduce((s, i) => s + (i.filledDropped ?? 0), 0);
    const totalEmpty = items.reduce((s, i) => s + (i.emptyReceived ?? 0), 0);
    const totalCash = items.reduce((s, i) => s + (i.cashCollected ?? 0), 0);
    const doneCount = items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY').length;

    doc.rect(MARGIN, y, CONTENT_W, 24).fill(PALETTE.ink);
    doc.fillColor(PALETTE.white).fontSize(8).font('Helvetica-Bold');
    let x = MARGIN;
    doc.text('TOTALS', x + 4, y + 8, { characterSpacing: 0.5, lineBreak: false });
    x += COLS.seq + COLS.customer + COLS.product;
    doc.text(String(totalFilled), x, y + 8, { width: COLS.filled - 6, align: 'right', lineBreak: false }); x += COLS.filled;
    doc.text(String(totalEmpty), x, y + 8, { width: COLS.empty - 6, align: 'right', lineBreak: false }); x += COLS.empty;
    doc.text(this.rs(totalCash), x, y + 8, { width: COLS.cash - 6, align: 'right', lineBreak: false }); x += COLS.cash;
    doc.text(`${doneCount}/${items.length} done`, x, y + 8, { width: COLS.status, align: 'center', lineBreak: false });

    doc.y = y + 32;
  }

  // ─── Expenses (only when sheet has any) ──────────────────────────────────
  private drawExpenses(doc: PDFKit.PDFDocument, expenses: any[]): void {
    const rowH = 20;
    // Keep the whole section together when it fits on the remaining page space
    const sectionH = 20 + expenses.length * rowH + 24;
    if (doc.y + Math.min(sectionH, 220) > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      doc.y = 50;
    }
    this.drawSectionTitle(doc, `Expenses (${expenses.length})`);

    const EXP_COLS = { category: 90, description: 230, recordedBy: 110, amount: 85 };
    let y = doc.y;

    expenses.forEach((exp, index) => {
      if (y + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = 50;
      }
      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(PALETTE.bgSoft);

      const meta = EXPENSE_META[exp.category] ?? EXPENSE_META.OTHER;
      let x = MARGIN;
      this.drawPill(doc, meta, x, EXP_COLS.category, y, rowH); x += EXP_COLS.category;
      doc.fillColor(PALETTE.ink).fontSize(8).font('Helvetica')
        .text(exp.description || '—', x + 4, y + 6, { width: EXP_COLS.description - 8, height: 10, ellipsis: true, lineBreak: false });
      x += EXP_COLS.description;
      doc.fillColor(PALETTE.muted).fontSize(7.5)
        .text(exp.createdBy?.name ?? '—', x + 4, y + 6, { width: EXP_COLS.recordedBy - 8, height: 9, ellipsis: true, lineBreak: false });
      x += EXP_COLS.recordedBy;
      doc.fillColor(PALETTE.ink).fontSize(8).font('Helvetica-Bold')
        .text(this.rs(exp.amount), x, y + 6, { width: EXP_COLS.amount - 6, align: 'right', lineBreak: false });

      y += rowH;
    });

    // Totals band — explains why driver's cash hand-in is lower than collected
    if (y + 24 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      y = 50;
    }
    const total = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    doc.rect(MARGIN, y, CONTENT_W, 24).fill(PALETTE.ink);
    doc.fillColor(PALETTE.white).fontSize(7.5).font('Helvetica-Bold')
      .text('TOTAL EXPENSES — DEDUCTED FROM CASH HAND-IN', MARGIN + 4, y + 8, { characterSpacing: 0.5, lineBreak: false });
    doc.fontSize(8)
      .text(this.rs(total), MARGIN, y + 8, { width: CONTENT_W - 6, align: 'right', lineBreak: false });

    doc.y = y + 32;
  }

  // ─── Signature row (closed sheets only) ──────────────────────────────────
  private drawSignatures(doc: PDFKit.PDFDocument): void {
    if (doc.y + 80 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      doc.y = 50;
    }
    const y = doc.y + 36;
    const labels = ['DRIVER SIGNATURE', 'WAREHOUSE MANAGER', 'ADMIN / SUPERVISOR'];
    const cellW = CONTENT_W / 3;

    labels.forEach((label, i) => {
      const x = MARGIN + i * cellW + 10;
      const lineW = cellW - 40;
      doc.moveTo(x, y).lineTo(x + lineW, y).lineWidth(0.75).stroke('#cbd5e1');
      doc.fillColor(PALETTE.muted).fontSize(6.5).font('Helvetica-Bold')
        .text(label, x, y + 5, { width: lineW, align: 'center', characterSpacing: 0.6, lineBreak: false });
    });

    doc.y = y + 24;
  }

  // ─── Footer on every page (page numbers need bufferPages) ────────────────
  private drawFooters(doc: PDFKit.PDFDocument, sheet: any): void {
    const vendorName = sheet.vendor?.name ?? 'Water Supply CRM';
    const generated = new Date().toLocaleString('en-PK');
    const range = doc.bufferedPageRange();

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would trigger auto-pagination — disable it
      doc.page.margins.bottom = 0;

      const lineY = PAGE_H - 36;
      doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_W, lineY).lineWidth(0.5).stroke(PALETTE.border);
      doc.fillColor(PALETTE.faint).fontSize(7).font('Helvetica')
        .text(`${vendorName} · Generated ${generated} · Sheet ${sheet.id.slice(0, 8).toUpperCase()}`, MARGIN, lineY + 7, { lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN, lineY + 7, { width: CONTENT_W, align: 'right', lineBreak: false });

      doc.page.margins.bottom = MARGIN;
    }
  }
}
