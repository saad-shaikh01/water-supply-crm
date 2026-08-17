import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { drawShadowShape, brandGradient } from '../../../common/pdf/pdf-theme.util';

// NOTE: standard PDF fonts (Helvetica) only support WinAnsi characters —
// no emoji, no check/warning glyphs. Stick to ASCII + · × — for decorations.

// ── Company identity (hardcoded — single vendor for now) — same convention
// and same values as CustomerStatementPdfService / DeliveryReceiptPdfService,
// so every PDF this system prints reads as one consistent brand. ─────────────
const COMPANY_NAME    = 'DASANI ENTERPRISES';
const COMPANY_ADDRESS = 'B-145 Block 13 D/1 Gulshan-e-Iqbal, Korangi Creek Korangi';
const COMPANY_PHONES  = 'Cell# 0316-2677954, 0345-2364698';

// Blue Ice brand assets — local copy alongside this service (mirrors the
// customer/pdf and whatsapp module convention), bundled to dist via webpack.
const LOGO_PATH = path.join(__dirname, 'assets', 'blue-ice-logo.png');

// ── Palette — identical to CustomerStatementPdfService's `C`, so the two
// document types share one visual language (same navy/accent/muted tones). ──
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
  closeGrn:  '#86efac',
};

const RADIUS = 10;

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  COMPLETED: { label: 'DONE', bg: '#dcfce7', text: '#15803d' },
  EMPTY_ONLY: { label: 'EMPTY ONLY', bg: '#dbeafe', text: '#1d4ed8' },
  PENDING: { label: 'PENDING', bg: '#ffedd5', text: '#c2410c' },
  NOT_AVAILABLE: { label: 'NOT AVAILABLE', bg: '#f1f5f9', text: '#475569' },
  RESCHEDULED: { label: 'RESCHEDULED', bg: '#fef9c3', text: '#a16207' },
  CANCELLED: { label: 'CANCELLED', bg: '#fee2e2', text: '#b91c1c' },
};

const EXPENSE_META: Record<string, { label: string; bg: string; text: string }> = {
  LUNCH_EXPENSE_EMPLOYEE: { label: 'LUNCH EXP EMPLOYEE', bg: '#fef9c3', text: '#a16207' },
  ADVANCE_SALARY_EMPLOYEE: { label: 'ADV SALARY EMPLOYEE', bg: '#f3e8ff', text: '#7e22ce' },
  VEHICLE_MAINTENANCE: { label: 'VEHICLE MAINTENANCE', bg: '#dbeafe', text: '#1d4ed8' },
  FUEL_EXPENSE: { label: 'FUEL EXP', bg: '#ffedd5', text: '#c2410c' },
  OTHER: { label: 'OTHER', bg: '#f1f5f9', text: '#475569' },
};

// Crew Cash Distribution categories — labels mirror
// features/crew-cash/constants.ts (CREW_CASH_CATEGORY_CONFIG) so the printed
// sheet and the dashboard never disagree on what a category is called.
const CREW_CASH_META: Record<string, { label: string; bg: string; text: string }> = {
  MEAL: { label: 'MEAL', bg: '#fef3c7', text: '#92400e' },
  TEA: { label: 'TEA', bg: '#ffedd5', text: '#c2410c' },
  WATER: { label: 'WATER', bg: '#e0f2fe', text: '#0369a1' },
  SNACKS: { label: 'SNACKS', bg: '#fef9c3', text: '#a16207' },
  OPERATIONAL_CASH: { label: 'OPERATIONAL CASH', bg: '#dbeafe', text: '#1d4ed8' },
  EMERGENCY_CASH: { label: 'EMERGENCY CASH', bg: '#fee2e2', text: '#b91c1c' },
  OTHER: { label: 'OTHER', bg: '#f1f5f9', text: '#475569' },
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2; // 515.28
const FOOTER_ZONE = 70; // reserved at page bottom
const BANNER_H = 76;

// Delivery-items table column geometry (sums to CONTENT_W)
const COLS = { seq: 18, code: 46, customer: 118, product: 72, filled: 38, recv: 38, empty: 38, cash: 60, status: 87.28 };

// Load-trips table column geometry (sums to CONTENT_W)
const TCOLS = { trip: 34, product: 90, loaded: 58, returned: 58, empty: 58, damaged: 52, leaked: 48, cash: 62, time: 55.28 };

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
    this.drawBrandBanner(doc);
    this.drawTitleRow(doc, sheet);
    this.drawInfoCard(doc, sheet);
    this.drawCrewStrip(doc, sheet);

    this.drawSectionTitle(doc, 'Bottle & Cash Summary');
    this.drawSummary(doc, sheet);

    if ((sheet.loads ?? []).length > 0) {
      this.drawSectionTitle(doc, `Load Trips (${sheet.loads.length})`);
      this.drawLoadTrips(doc, sheet.loads);
    }

    this.drawSectionTitle(doc, `Delivery Items (${sheet.items?.length ?? 0} stops)`);
    this.drawDeliveryTable(doc, sheet.items ?? []);

    if (sheet.expenses?.length) {
      this.drawSectionTitle(doc, `Trip Expenses (${sheet.expenses.length})`, true);
      this.drawExpenses(doc, sheet.expenses);
    }

    if (sheet.crewCashDistributions?.length) {
      this.drawSectionTitle(doc, `Crew Cash Distribution (${sheet.crewCashDistributions.length})`, true);
      this.drawCrewCash(doc, sheet.crewCashDistributions);
    }

    if (sheet.isClosed) this.drawSignatures(doc);
  }

  // ─── Soft-shadow rounded card background (matches CustomerStatementPdfService) ─
  private shadowCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
    drawShadowShape(doc, x, y, w, h, RADIUS, C.white, { shadowColor: C.navy, borderColor: C.border });
  }

  // ─── Brand banner: gradient card with logo chip (left) + company identity (right) ─
  private drawBrandBanner(doc: PDFKit.PDFDocument): void {
    const y = MARGIN;
    const h = BANNER_H;

    drawShadowShape(doc, MARGIN, y, CONTENT_W, h, RADIUS, brandGradient(doc, MARGIN, y, CONTENT_W, h), {
      shadowColor: C.navy,
      shadowOpacity: 0.13,
    });

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

    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(15)
      .text(COMPANY_NAME, MARGIN, y + 16, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(8)
      .text(COMPANY_ADDRESS, MARGIN, y + 35, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(8)
      .text(COMPANY_PHONES, MARGIN, y + 47, { width: CONTENT_W - 14, align: 'right', lineBreak: false });

    doc.y = y + h + 3;
  }

  // ─── Document title + OPEN/CLOSED status pill ────────────────────────────
  private drawTitleRow(doc: PDFKit.PDFDocument, sheet: any): void {
    const y = doc.y + 18;
    const date = new Date(sheet.date).toLocaleDateString('en-PK', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    doc.roundedRect(MARGIN, y, 4, 16, 2).fill(C.accent);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(13)
      .text('DAILY DELIVERY SHEET', MARGIN + 12, y + 1, { lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
      .text(date, MARGIN + 12, y + 17, { lineBreak: false });

    const closed = !!sheet.isClosed;
    const pillW = 64;
    const pillH = 20;
    const pillX = MARGIN + CONTENT_W - pillW;
    doc.roundedRect(pillX, y - 1, pillW, pillH, 10).fill(closed ? '#16a34a' : '#d97706');
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8)
      .text(closed ? 'CLOSED' : 'OPEN', pillX, y + 5, { width: pillW, align: 'center', lineBreak: false });

    doc.y = y + 34;
  }

  // ─── Info card: driver identity | sheet details | net-cash chip ──────────
  private drawInfoCard(doc: PDFKit.PDFDocument, sheet: any): void {
    const y = doc.y;
    const boxH = 92;
    const col1W = 175;
    const col3W = 150;
    const col2W = CONTENT_W - col1W - col3W;
    const x1 = MARGIN;
    const x2 = MARGIN + col1W;
    const x3 = MARGIN + col1W + col2W;

    this.shadowCard(doc, MARGIN, y, CONTENT_W, boxH);
    doc.moveTo(x2, y + 12).lineTo(x2, y + boxH - 12).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.moveTo(x3, y + 12).lineTo(x3, y + boxH - 12).strokeColor(C.border).lineWidth(0.75).stroke();

    // COL 1 — driver identity
    const col1TextW = col1W - 24;
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text('Driver', x1 + 14, y + 10, { lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(11.5)
      .text(sheet.driver?.name ?? '—', x1 + 14, y + 24, { width: col1TextW, height: 14, ellipsis: true });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text(sheet.driver?.phoneNumber ?? '—', x1 + 14, y + 44, { width: col1TextW, height: 10, ellipsis: true });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text(`Van: ${sheet.van?.plateNumber ?? '—'}`, x1 + 14, y + 60, { width: col1TextW, height: 10, ellipsis: true });

    // COL 2 — sheet details
    const tripCount = sheet.loads?.length ?? 0;
    const rows: [string, string][] = [
      ['Route', sheet.route?.name ?? '—'],
      ['Sheet #', sheet.id.slice(0, 8).toUpperCase()],
      ['Stops', String(sheet.items?.length ?? 0)],
      ['Trips', String(tripCount)],
    ];
    const rowH = (boxH - 16) / rows.length;
    rows.forEach(([lbl, val], i) => {
      const ry = y + 8 + i * rowH;
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
        .text(lbl, x2 + 12, ry + rowH / 2 - 4, { width: col2W * 0.48, lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(8.5)
        .text(val, x2, ry + rowH / 2 - 4, { width: col2W - 14, align: 'right', lineBreak: false });
    });

    // COL 3 — net cash to hand in, computed live the same way
    // DailySheetService.buildReconciliation() does (collected − expenses −
    // crew cash, floored at 0) so an open sheet's PDF and the eventual
    // closed-sheet reconciliation always agree.
    const totalItemCash = (sheet.items ?? []).reduce((s: number, i: any) => s + (i.cashCollected ?? 0), 0);
    // Only expenses actually paid from the driver's van cash (paidFromCash,
    // default true) are deducted — a fuel fill or expense paid by
    // card/bank/company account never touched that cash (see
    // DailySheetService.buildReconciliation, same split).
    const totalExpenses = (sheet.expenses ?? [])
      .filter((e: any) => e.paidFromCash !== false)
      .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const totalCrewCash = (sheet.crewCashDistributions ?? []).reduce((s: number, c: any) => s + (c.amount ?? 0), 0);
    const netCash = Math.max(0, totalItemCash - totalExpenses - totalCrewCash);

    const chipPad = 8;
    const chipX = x3 + chipPad;
    const chipY = y + chipPad;
    const chipW = col3W - chipPad * 2;
    const chipH = boxH - chipPad * 2;
    doc.roundedRect(chipX, chipY, chipW, chipH, 8).fill(C.navy);
    doc.fillColor('#ffffff', 0.75).font('Helvetica').fontSize(7)
      .text('NET CASH TO HAND IN', chipX, chipY + chipH / 2 - 14, { width: chipW, align: 'center', lineBreak: false });
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(15)
      .text(this.rs(netCash), chipX, chipY + chipH / 2 + 4, { width: chipW, align: 'center', lineBreak: false });

    doc.y = y + boxH;
  }

  // ─── Crew strip (salesman / loaders + confirmation) ──────────────────────
  private drawCrewStrip(doc: PDFKit.PDFDocument, sheet: any): void {
    const crew: any[] = sheet.crew ?? [];
    if (crew.length === 0) { doc.y += 16; return; }

    const salesmen = crew.filter((c) => c.role === 'SALESMAN');
    const loaders = crew.filter((c) => c.role === 'LOADER');
    const parts: string[] = [];
    if (salesmen.length > 0) {
      parts.push(`Salesm${salesmen.length > 1 ? 'en' : 'an'}: ${salesmen.map((s) => s.user?.name ?? '—').join(', ')}`);
    }
    if (loaders.length > 0) {
      parts.push(`Loader${loaders.length > 1 ? 's' : ''}: ${loaders.map((l) => l.user?.name ?? '—').join(', ')}`);
    }
    const confirmed = sheet.crewConfirmed
      ? `  ·  Crew confirmed${sheet.crewConfirmedBy?.name ? ` by ${sheet.crewConfirmedBy.name}` : ''}`
      : '  ·  Crew not confirmed';

    const y = doc.y + 10;
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.5)
      .text('CREW', MARGIN, y, { characterSpacing: 0.8, lineBreak: false });
    doc.fillColor(C.textSoft).font('Helvetica').fontSize(8)
      .text(parts.join('  ·  ') + confirmed, MARGIN + 34, y - 1, {
        width: CONTENT_W - 34, height: 10, ellipsis: true, lineBreak: false,
      });
    doc.y = y + 18;
  }

  // ─── Section title with accent bar ───────────────────────────────────────
  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string, checkPageBreak = false): void {
    if (checkPageBreak && doc.y + 60 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      doc.y = 50;
    }
    const y = doc.y + 8;
    doc.roundedRect(MARGIN, y, 4, 14, 2).fill(C.accent);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11)
      .text(title.toUpperCase(), MARGIN + 12, y, { characterSpacing: 0.5, lineBreak: false });
    doc.y = y + 22;
  }

  // ─── Summary cards + reconciliation verdict ──────────────────────────────
  private drawSummary(doc: PDFKit.PDFDocument, sheet: any): void {
    const activeItems = (sheet.items ?? []).filter(
      (i: any) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY',
    );
    const delivered = activeItems.reduce((s: number, i: any) => s + (i.filledDropped ?? 0), 0);
    const filledReceived = activeItems.reduce((s: number, i: any) => s + (i.filledReceived ?? 0), 0);
    const bottleDiscrepancy = sheet.filledOutCount - (sheet.filledInCount + delivered);
    const emptyCollected = activeItems.reduce((s: number, i: any) => s + (i.emptyReceived ?? 0), 0);
    const emptyDiscrepancy = emptyCollected - sheet.emptyInCount;
    const cashDiscrepancy = (sheet.cashCollected ?? 0) - (sheet.cashExpected ?? 0);

    const cards = [
      { label: 'FILLED OUT', value: String(sheet.filledOutCount), accent: '#3b82f6' },
      { label: 'FILLED RETURNED', value: String(sheet.filledInCount), accent: '#10b981' },
      { label: 'FILLED RECEIVED', value: String(filledReceived), accent: '#7c3aed' },
      { label: 'EMPTY RECEIVED', value: String(sheet.emptyInCount), accent: '#eab308' },
      { label: 'CASH COLLECTED', value: this.rs(sheet.cashCollected), accent: '#22c55e' },
    ];

    const y = doc.y;
    const gap = 8;
    const cardW = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
    const cardH = 54;

    cards.forEach((card, i) => {
      const x = MARGIN + i * (cardW + gap);
      this.shadowCard(doc, x, y, cardW, cardH);
      doc.roundedRect(x + 1, y, cardW - 2, 2.5).fill(card.accent);
      doc.fillColor(C.muted).fontSize(6.3).font('Helvetica-Bold')
        .text(card.label, x + 4, y + 12, { width: cardW - 8, align: 'center', characterSpacing: 0.3, lineBreak: false });
      const valueSize = card.value.length > 8 ? 11 : 14;
      doc.fillColor(C.navyText).fontSize(valueSize).font('Helvetica-Bold')
        .text(card.value, x + 4, y + 28, { width: cardW - 8, align: 'center', lineBreak: false });
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
      doc.roundedRect(MARGIN, bannerY, CONTENT_W, bannerH, 6).fillAndStroke(C.surface, C.border);
      doc.fillColor(C.muted).fontSize(8).font('Helvetica')
        .text('Sheet is still open — reconciliation pending until close.', MARGIN + 12, bannerY + 9, { lineBreak: false });
    }

    doc.y = bannerY + bannerH + 18;
  }

  // ─── Load Trips table (loadout / check-in history per trip) ─────────────
  private drawLoadTrips(doc: PDFKit.PDFDocument, loads: any[]): void {
    const rowH = 20;
    doc.rect(MARGIN, doc.y, CONTENT_W, rowH).fill(C.navy);
    doc.fillColor(C.white).fontSize(7).font('Helvetica-Bold');
    let x = MARGIN;
    let y = doc.y;
    doc.text('TRIP', x + 4, y + 6, { width: TCOLS.trip - 4, lineBreak: false }); x += TCOLS.trip;
    doc.text('PRODUCT', x + 4, y + 6, { width: TCOLS.product - 4, lineBreak: false }); x += TCOLS.product;
    doc.text('LOADED', x, y + 6, { width: TCOLS.loaded - 6, align: 'right', lineBreak: false }); x += TCOLS.loaded;
    doc.text('RETURNED', x, y + 6, { width: TCOLS.returned - 6, align: 'right', lineBreak: false }); x += TCOLS.returned;
    doc.text('EMPTY IN', x, y + 6, { width: TCOLS.empty - 6, align: 'right', lineBreak: false }); x += TCOLS.empty;
    doc.text('DAMAGED', x, y + 6, { width: TCOLS.damaged - 6, align: 'right', lineBreak: false }); x += TCOLS.damaged;
    doc.text('LEAKED', x, y + 6, { width: TCOLS.leaked - 6, align: 'right', lineBreak: false }); x += TCOLS.leaked;
    doc.text('CASH IN', x, y + 6, { width: TCOLS.cash - 6, align: 'right', lineBreak: false }); x += TCOLS.cash;
    doc.text('TIME', x, y + 6, { width: TCOLS.time - 6, align: 'right', lineBreak: false });
    y += rowH;

    loads.forEach((trip, index) => {
      if (y + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = 50;
      }
      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.surface);

      const ty = y + 6;
      const timeStr = trip.endedAt
        ? `${this.hm(trip.startedAt)}-${this.hm(trip.endedAt)}`
        : `${this.hm(trip.startedAt)} (open)`;

      x = MARGIN;
      doc.fillColor(C.textSoft).font('Helvetica-Bold').fontSize(7.5)
        .text(`#${trip.tripNumber}`, x + 4, ty, { width: TCOLS.trip - 4, lineBreak: false }); x += TCOLS.trip;
      doc.fillColor(C.text).font('Helvetica').fontSize(7.5)
        .text(trip.product?.name ?? '—', x + 4, ty, { width: TCOLS.product - 8, height: 10, ellipsis: true, lineBreak: false }); x += TCOLS.product;
      doc.text(String(trip.loadedFilled ?? 0), x, ty, { width: TCOLS.loaded - 6, align: 'right', lineBreak: false }); x += TCOLS.loaded;
      doc.text(String(trip.returnedFilled ?? 0), x, ty, { width: TCOLS.returned - 6, align: 'right', lineBreak: false }); x += TCOLS.returned;
      doc.text(String(trip.collectedEmpty ?? 0), x, ty, { width: TCOLS.empty - 6, align: 'right', lineBreak: false }); x += TCOLS.empty;
      doc.fillColor((trip.damagedOnVan ?? 0) > 0 ? C.amber : C.text).font('Helvetica-Bold')
        .text(String(trip.damagedOnVan ?? 0), x, ty, { width: TCOLS.damaged - 6, align: 'right', lineBreak: false }); x += TCOLS.damaged;
      doc.fillColor((trip.leakedOnVan ?? 0) > 0 ? C.red : C.text)
        .text(String(trip.leakedOnVan ?? 0), x, ty, { width: TCOLS.leaked - 6, align: 'right', lineBreak: false }); x += TCOLS.leaked;
      doc.fillColor(C.navyText).font('Helvetica-Bold')
        .text(this.rs(trip.cashHandedIn), x, ty, { width: TCOLS.cash - 6, align: 'right', lineBreak: false }); x += TCOLS.cash;
      doc.fillColor(C.muted).font('Helvetica').fontSize(6.5)
        .text(timeStr, x, ty + 1, { width: TCOLS.time - 4, align: 'right', lineBreak: false });

      y += rowH;
    });

    doc.y = y + 14;
  }

  private hm(dt: string | Date): string {
    return new Date(dt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  }

  // ─── Delivery items table ────────────────────────────────────────────────
  private drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
    doc.rect(MARGIN, y, CONTENT_W, 22).fill(C.navy);
    doc.fillColor(C.white).fontSize(7).font('Helvetica-Bold');

    let x = MARGIN;
    doc.text('#', x + 4, y + 7, { lineBreak: false }); x += COLS.seq;
    doc.text('CODE', x + 4, y + 7, { lineBreak: false }); x += COLS.code;
    doc.text('CUSTOMER', x + 4, y + 7, { characterSpacing: 0.3, lineBreak: false }); x += COLS.customer;
    doc.text('PRODUCT', x + 4, y + 7, { characterSpacing: 0.3, lineBreak: false }); x += COLS.product;
    doc.text('FILLED', x, y + 7, { width: COLS.filled - 6, align: 'right', lineBreak: false }); x += COLS.filled;
    doc.text('RECV', x, y + 7, { width: COLS.recv - 6, align: 'right', lineBreak: false }); x += COLS.recv;
    doc.text('EMPTY', x, y + 7, { width: COLS.empty - 6, align: 'right', lineBreak: false }); x += COLS.empty;
    doc.text('CASH', x, y + 7, { width: COLS.cash - 6, align: 'right', lineBreak: false }); x += COLS.cash;
    doc.text('STATUS', x, y + 7, { width: COLS.status, align: 'center', characterSpacing: 0.3, lineBreak: false });

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
      doc.fillColor(C.muted).fontSize(9).font('Helvetica')
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

      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.surface);

      const textY = y + 6;
      doc.fillColor(C.textSoft).fontSize(7.5).font('Helvetica');
      let x = MARGIN;
      doc.text(String(item.sequence ?? index + 1), x + 4, textY, { lineBreak: false }); x += COLS.seq;
      doc.fillColor(C.mutedLt).fontSize(6.5)
        .text(item.customer?.customerCode ?? '—', x + 3, textY + 1, { width: COLS.code - 4, lineBreak: false }); x += COLS.code;
      doc.fillColor(C.navyText).fontSize(7.5).font('Helvetica-Bold')
        .text(item.customer?.name ?? '—', x + 4, textY, { width: COLS.customer - 8, height: 10, ellipsis: true, lineBreak: false });
      x += COLS.customer;
      doc.fillColor(C.textSoft).font('Helvetica')
        .text(item.product?.name ?? '—', x + 4, textY, { width: COLS.product - 8, height: 10, ellipsis: true, lineBreak: false });
      x += COLS.product;
      doc.fillColor(C.text)
        .text(String(item.filledDropped ?? 0), x, textY, { width: COLS.filled - 6, align: 'right', lineBreak: false }); x += COLS.filled;
      doc.text(String(item.filledReceived ?? 0), x, textY, { width: COLS.recv - 6, align: 'right', lineBreak: false }); x += COLS.recv;
      doc.text(String(item.emptyReceived ?? 0), x, textY, { width: COLS.empty - 6, align: 'right', lineBreak: false }); x += COLS.empty;
      doc.text(this.rs(item.cashCollected), x, textY, { width: COLS.cash - 6, align: 'right', lineBreak: false }); x += COLS.cash;

      this.drawStatusPill(doc, item.status, x, y, reason ? 21 : rowH);

      if (reason) {
        doc.fillColor(C.mutedLt).fontSize(6.5).font('Helvetica-Oblique')
          .text(reason, MARGIN + COLS.seq + COLS.code + 4, y + 20, {
            width: COLS.customer + COLS.product + COLS.filled + COLS.recv + COLS.empty + COLS.cash - 8,
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
    const totalRecv = items.reduce((s, i) => s + (i.filledReceived ?? 0), 0);
    const totalEmpty = items.reduce((s, i) => s + (i.emptyReceived ?? 0), 0);
    const totalCash = items.reduce((s, i) => s + (i.cashCollected ?? 0), 0);
    const doneCount = items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY').length;

    doc.rect(MARGIN, y, CONTENT_W, 24).fill(C.navy);
    doc.fillColor(C.white).fontSize(7.5).font('Helvetica-Bold');
    let x = MARGIN;
    doc.text('TOTALS', x + 4, y + 8, { characterSpacing: 0.5, lineBreak: false });
    x += COLS.seq + COLS.code + COLS.customer + COLS.product;
    doc.text(String(totalFilled), x, y + 8, { width: COLS.filled - 6, align: 'right', lineBreak: false }); x += COLS.filled;
    doc.text(String(totalRecv), x, y + 8, { width: COLS.recv - 6, align: 'right', lineBreak: false }); x += COLS.recv;
    doc.text(String(totalEmpty), x, y + 8, { width: COLS.empty - 6, align: 'right', lineBreak: false }); x += COLS.empty;
    doc.text(this.rs(totalCash), x, y + 8, { width: COLS.cash - 6, align: 'right', lineBreak: false }); x += COLS.cash;
    doc.fontSize(6.5).text(`${doneCount}/${items.length} done`, x, y + 9, { width: COLS.status, align: 'center', lineBreak: false });

    doc.y = y + 32;
  }

  // ─── Trip Expenses (only when sheet has any) ─────────────────────────────
  private drawExpenses(doc: PDFKit.PDFDocument, expenses: any[]): void {
    const rowH = 20;
    const EXP_COLS = { category: 90, description: 230, recordedBy: 110, amount: 85.28 };
    let y = doc.y;

    expenses.forEach((exp, index) => {
      if (y + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = 50;
      }
      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.surface);

      const meta = EXPENSE_META[exp.category] ?? EXPENSE_META.OTHER;
      const isNonCash = exp.paidFromCash === false;
      let x = MARGIN;
      this.drawPill(doc, meta, x, EXP_COLS.category, y, rowH); x += EXP_COLS.category;
      // Paid by card/bank/company account, not the driver's cash — tagged
      // inline so the printed sheet explains why it's excluded from the
      // "DEDUCTED FROM CASH HAND-IN" total below (no emoji — see file header).
      const description = (exp.description || '—') + (isNonCash ? '  [CARD — NOT FROM CASH]' : '');
      doc.fillColor(isNonCash ? C.cyan : C.navyText).fontSize(8).font('Helvetica')
        .text(description, x + 4, y + 6, { width: EXP_COLS.description - 8, height: 10, ellipsis: true, lineBreak: false });
      x += EXP_COLS.description;
      doc.fillColor(C.muted).fontSize(7.5)
        .text(exp.createdBy?.name ?? '—', x + 4, y + 6, { width: EXP_COLS.recordedBy - 8, height: 9, ellipsis: true, lineBreak: false });
      x += EXP_COLS.recordedBy;
      doc.fillColor(isNonCash ? C.cyan : C.navyText).fontSize(8).font('Helvetica-Bold')
        .text(this.rs(exp.amount), x, y + 6, { width: EXP_COLS.amount - 6, align: 'right', lineBreak: false });

      y += rowH;
    });

    // Totals band — explains why driver's cash hand-in is lower than collected.
    // Only cash-paid expenses (paidFromCash !== false) are deducted; card/other
    // expenses are real cost but never touched the driver's cash (same split
    // as DailySheetService.buildReconciliation).
    if (y + 24 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      y = 50;
    }
    const cashTotal = expenses.filter((e) => e.paidFromCash !== false).reduce((s, e) => s + (e.amount ?? 0), 0);
    const nonCashTotal = expenses.filter((e) => e.paidFromCash === false).reduce((s, e) => s + (e.amount ?? 0), 0);
    doc.rect(MARGIN, y, CONTENT_W, 24).fill(C.navy);
    doc.fillColor(C.white).fontSize(7.5).font('Helvetica-Bold')
      .text('TOTAL EXPENSES — DEDUCTED FROM CASH HAND-IN', MARGIN + 4, y + 8, { characterSpacing: 0.3, lineBreak: false });
    doc.fontSize(8)
      .text(this.rs(cashTotal), MARGIN, y + 8, { width: CONTENT_W - 6, align: 'right', lineBreak: false });
    y += 24;

    if (nonCashTotal > 0) {
      if (y + 20 > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = 50;
      }
      doc.rect(MARGIN, y, CONTENT_W, 20).fill(C.surface);
      doc.fillColor(C.cyan).fontSize(7).font('Helvetica-Bold')
        .text('OF WHICH PAID BY CARD/OTHER — NOT DEDUCTED', MARGIN + 4, y + 6, { characterSpacing: 0.3, lineBreak: false });
      doc.fontSize(7.5)
        .text(this.rs(nonCashTotal), MARGIN, y + 6, { width: CONTENT_W - 6, align: 'right', lineBreak: false });
      y += 20;
    }

    doc.y = y + 8;
  }

  // ─── Crew Cash Distribution (only when sheet has any) ────────────────────
  private drawCrewCash(doc: PDFKit.PDFDocument, entries: any[]): void {
    const rowH = 20;
    const CC_COLS = { category: 108, employee: 100, notes: 220, amount: 87.28 };
    let y = doc.y;

    entries.forEach((entry, index) => {
      if (y + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = 50;
      }
      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.surface);

      const meta = CREW_CASH_META[entry.category] ?? CREW_CASH_META.OTHER;
      let x = MARGIN;
      this.drawPill(doc, meta, x, CC_COLS.category, y, rowH); x += CC_COLS.category;
      doc.fillColor(C.navyText).fontSize(8).font('Helvetica-Bold')
        .text(entry.employee?.name ?? '—', x + 4, y + 6, { width: CC_COLS.employee - 8, height: 10, ellipsis: true, lineBreak: false });
      x += CC_COLS.employee;
      doc.fillColor(C.muted).fontSize(7.5).font('Helvetica')
        .text(entry.notes || '—', x + 4, y + 6, { width: CC_COLS.notes - 8, height: 10, ellipsis: true, lineBreak: false });
      x += CC_COLS.notes;
      doc.fillColor(C.navyText).fontSize(8).font('Helvetica-Bold')
        .text(this.rs(entry.amount), x, y + 6, { width: CC_COLS.amount - 6, align: 'right', lineBreak: false });

      y += rowH;
    });

    // Totals band — same "deducted from cash hand-in" framing as Expenses
    if (y + 24 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      y = 50;
    }
    const total = entries.reduce((s, e) => s + (e.amount ?? 0), 0);
    doc.rect(MARGIN, y, CONTENT_W, 24).fill(C.navy);
    doc.fillColor(C.white).fontSize(7.5).font('Helvetica-Bold')
      .text('TOTAL CREW CASH — DEDUCTED FROM CASH HAND-IN', MARGIN + 4, y + 8, { characterSpacing: 0.3, lineBreak: false });
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
      doc.moveTo(x, y).lineTo(x + lineW, y).lineWidth(0.75).stroke(C.border);
      doc.fillColor(C.muted).fontSize(6.5).font('Helvetica-Bold')
        .text(label, x, y + 5, { width: lineW, align: 'center', characterSpacing: 0.6, lineBreak: false });
    });

    doc.y = y + 24;
  }

  // ─── Footer on every page (page numbers need bufferPages) ────────────────
  private drawFooters(doc: PDFKit.PDFDocument, sheet: any): void {
    const generated = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    const range = doc.bufferedPageRange();

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would trigger auto-pagination — disable it
      doc.page.margins.bottom = 0;

      const lineY = PAGE_H - 36;
      doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_W, lineY).lineWidth(0.5).stroke(C.border);
      doc.fillColor(C.mutedLt).fontSize(6.5).font('Helvetica')
        .text(`${COMPANY_NAME} · Generated ${generated} · Sheet ${sheet.id.slice(0, 8).toUpperCase()}`, MARGIN, lineY + 7, { lineBreak: false });
      doc.fillColor(C.mutedLt).font('Helvetica-Bold')
        .text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN, lineY + 7, { width: CONTENT_W, align: 'right', lineBreak: false });

      doc.page.margins.bottom = MARGIN;
    }
  }
}
