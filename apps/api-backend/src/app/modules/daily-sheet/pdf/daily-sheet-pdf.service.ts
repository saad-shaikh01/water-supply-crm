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

// Secondary tag shown next to the status pill when a delivery item has been
// force-resubmitted at least once (item.editCount > 0) — surfaces the recent
// delivery-item-edit-history feature on the printed sheet, not just on-screen.
const EDITED_META = { label: 'EDITED', bg: '#ede9fe', text: '#6d28d9' };

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

// Delivery-items table column geometry (13 cols, sums to CONTENT_W). The
// STATUS cell carries both the status pill and a secondary EDITED tag, hence
// the two named sub-widths that together make up the combined status cell.
const COLS = {
  seq: 14, code: 32, customer: 60, time: 32, delivered: 28, filledRecv: 28,
  emptyRecv: 28, balBottles: 30, cash: 40, payMode: 28, balRs: 40, consPct: 28,
  statusPill: 75, editedTag: 52.28,
};
const COLS_STATUS_W = COLS.statusPill + COLS.editedTag; // 127.28 — combined status cell width

// Trip Summary mini-table column geometry (10 cols, sums to CONTENT_W) — each
// trip renders its own stacked block (title + this header + one data row),
// so there is no separate "trip #" column here (the block title carries it).
const TRIPCOLS = {
  filledOut: 50, filledReturned: 55, filledReceived: 55, sold: 42,
  emptyReceive: 55, cashCollected: 58, expense: 52, cashInHand: 60,
  timeOut: 44, timeIn: 44.28,
};

interface TripStat {
  load: any;
  filledOut: number;
  filledReturned: number;
  filledReceived: number;
  sold: number;
  emptyReceive: number;
  cashCollected: number;
  expense: number;
  cashInHand: number;
  timeOut: Date;
  timeIn: Date | null;
}

interface TripStats {
  perTrip: TripStat[];
  totals: {
    filledOut: number; filledReturned: number; filledReceived: number; sold: number;
    emptyReceive: number; cashCollected: number; expense: number; cashInHand: number;
    startingTime: Date | null; closingTime: Date | null;
  };
}

type ConsumptionRateRow = {
  customerId: string;
  productId: string;
  consumptionRate: string;
  rateStatus: 'ON_TARGET' | 'ATTENTION' | 'ACTION' | null;
};

@Injectable()
export class DailySheetPdfService {
  /**
   * Generates a PDF buffer for a daily sheet.
   * @param sheet - Full sheet object from dailySheet.service.findOne(), with
   *                `consumptionRates` (DailySheetService.getConsumptionRatesForSheet)
   *                attached by the controller before calling this.
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

    this.drawSectionTitle(doc, 'Bottle & Cash Summary');
    this.drawSummary(doc, sheet);

    if ((sheet.loads ?? []).length > 0) {
      const tripStats = this.computeTripStats(sheet.loads ?? [], sheet.items ?? [], sheet.expenses ?? []);
      this.drawSectionTitle(doc, `Trip Summary (${sheet.loads.length})`);
      this.drawTripSummary(doc, tripStats);
    }

    if (sheet.expenses?.length) {
      this.drawSectionTitle(doc, `Trip Expenses (${sheet.expenses.length})`, true);
      this.drawExpenses(doc, sheet.expenses);
    }

    this.drawSectionTitle(doc, `Delivery Items (${sheet.items?.length ?? 0} stops)`, true);
    this.drawDeliveryTable(doc, sheet.items ?? [], sheet.consumptionRates ?? []);

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
  // UNCHANGED — kept exactly as-is per explicit instruction not to touch it.
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

  // ─── Document title + OPEN/CLOSED status pill + Start/End trip times ─────
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

    // Start/End trip times — earliest load-out to latest check-in across all
    // trips, or "In Progress" while the last trip hasn't checked in yet.
    const loads: any[] = sheet.loads ?? [];
    let timeLine = '';
    if (loads.length > 0) {
      const starts = loads.map((l) => new Date(l.startedAt).getTime());
      const endedTimes = loads.filter((l) => l.endedAt).map((l) => new Date(l.endedAt).getTime());
      const start = this.hm(new Date(Math.min(...starts)));
      const end = endedTimes.length === loads.length ? this.hm(new Date(Math.max(...endedTimes))) : 'In Progress';
      timeLine = `Start: ${start}   ·   End: ${end}`;
    }
    if (timeLine) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
        .text(timeLine, MARGIN + 12, y + 29, { lineBreak: false });
    }

    const closed = !!sheet.isClosed;
    const pillW = 64;
    const pillH = 20;
    const pillX = MARGIN + CONTENT_W - pillW;
    doc.roundedRect(pillX, y - 1, pillW, pillH, 10).fill(closed ? '#16a34a' : '#d97706');
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8)
      .text(closed ? 'CLOSED' : 'OPEN', pillX, y + 5, { width: pillW, align: 'center', lineBreak: false });

    doc.y = y + (timeLine ? 46 : 34);
  }

  // ─── Info card: Van + full Team Members list | sheet stats | 3 cash boxes ─
  // Redesigned — absorbs the old separate Crew Strip line so the whole crew
  // (driver + salesman + loaders) is listed with role labels in one place.
  private drawInfoCard(doc: PDFKit.PDFDocument, sheet: any): void {
    const y = doc.y;
    const boxH = 118;
    const col1W = 158;
    const col3W = 168;
    const col2W = CONTENT_W - col1W - col3W;
    const x1 = MARGIN;
    const x2 = MARGIN + col1W;
    const x3 = MARGIN + col1W + col2W;

    this.shadowCard(doc, MARGIN, y, CONTENT_W, boxH);
    doc.moveTo(x2, y + 12).lineTo(x2, y + boxH - 12).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.moveTo(x3, y + 12).lineTo(x3, y + boxH - 12).strokeColor(C.border).lineWidth(0.75).stroke();

    // COL 1 — Van + Team Members (driver + every crew member, own role-labeled line)
    const col1TextW = col1W - 24;
    doc.fillColor(C.muted).font('Helvetica').fontSize(7)
      .text('VAN', x1 + 14, y + 9, { characterSpacing: 0.5, lineBreak: false });
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(11)
      .text(sheet.van?.plateNumber ?? '—', x1 + 14, y + 19, { width: col1TextW, height: 13, ellipsis: true });

    const crewConfirmed = !!sheet.crewConfirmed;
    doc.fillColor(C.muted).font('Helvetica').fontSize(6.5)
      .text(`TEAM MEMBERS  ·  ${crewConfirmed ? 'Confirmed' : 'Not Confirmed'}`, x1 + 14, y + 36, {
        characterSpacing: 0.3, width: col1TextW, lineBreak: false,
      });

    const teamRows: [string, string][] = [['Driver', sheet.driver?.name ?? '—']];
    for (const c of (sheet.crew ?? []) as any[]) {
      teamRows.push([c.role === 'SALESMAN' ? 'Salesman' : 'Loader', c.user?.name ?? '—']);
    }
    const MAX_TEAM_ROWS = 5;
    const visibleTeamRows = teamRows.slice(0, MAX_TEAM_ROWS);
    const hiddenTeamCount = teamRows.length - visibleTeamRows.length;
    visibleTeamRows.forEach(([role, name], i) => {
      const ry = y + 47 + i * 11;
      doc.fillColor(C.mutedLt).font('Helvetica-Bold').fontSize(6.3)
        .text(role, x1 + 14, ry, { width: 40, lineBreak: false });
      doc.fillColor(C.textSoft).font('Helvetica').fontSize(7.5)
        .text(name, x1 + 54, ry, { width: col1TextW - 40, height: 9, ellipsis: true, lineBreak: false });
    });
    if (hiddenTeamCount > 0) {
      doc.fillColor(C.mutedLt).font('Helvetica-Oblique').fontSize(6.3)
        .text(`+${hiddenTeamCount} more`, x1 + 14, y + 47 + visibleTeamRows.length * 11, { lineBreak: false });
    }

    // COL 2 — Sheet #, Stops, Trips, Sold, Empty
    const activeItems = (sheet.items ?? []).filter((i: any) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY');
    const sold = activeItems.reduce((s: number, i: any) => s + (i.filledDropped ?? 0), 0);
    const tripCount = sheet.loads?.length ?? 0;
    const rows: [string, string][] = [
      ['Sheet #', sheet.id.slice(0, 8).toUpperCase()],
      ['Stops', String(sheet.items?.length ?? 0)],
      ['Trips', String(tripCount)],
      ['Sold', String(sold)],
      ['Empty', String(sheet.emptyInCount ?? 0)],
    ];
    const rowH = (boxH - 16) / rows.length;
    rows.forEach(([lbl, val], i) => {
      const ry = y + 8 + i * rowH;
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
        .text(lbl, x2 + 12, ry + rowH / 2 - 4, { width: col2W * 0.48, lineBreak: false });
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(8.5)
        .text(val, x2, ry + rowH / 2 - 4, { width: col2W - 14, align: 'right', lineBreak: false });
    });

    // COL 3 — three stacked highlight boxes: Gross Cash / Total Expense / Net Cash.
    // Same underlying formula DailySheetService.buildReconciliation() uses (and
    // the old single net-cash chip used) so this always agrees with the
    // eventual closed-sheet reconciliation.
    const totalItemCash = (sheet.items ?? []).reduce((s: number, i: any) => s + (i.cashCollected ?? 0), 0);
    const totalExpenses = (sheet.expenses ?? [])
      .filter((e: any) => e.paidFromCash !== false)
      .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const totalCrewCash = (sheet.crewCashDistributions ?? []).reduce((s: number, c: any) => s + (c.amount ?? 0), 0);
    const netCash = Math.max(0, totalItemCash - totalExpenses - totalCrewCash);

    const chips: [string, string, string][] = [
      ['GROSS CASH COLLECTED', this.rs(sheet.cashCollected), C.navy],
      ['TOTAL EXPENSE', this.rs(totalExpenses), C.textSoft],
      ['NET CASH IN HAND', this.rs(netCash), C.accent],
    ];
    const chipPad = 8;
    const chipGap = 6;
    const chipH = (boxH - chipPad * 2 - chipGap * 2) / 3;
    chips.forEach(([label, value, bg], i) => {
      const cy = y + chipPad + i * (chipH + chipGap);
      const cx = x3 + chipPad;
      const cw = col3W - chipPad * 2;
      doc.roundedRect(cx, cy, cw, chipH, 7).fill(bg);
      doc.fillColor('#ffffff', 0.8).font('Helvetica-Bold').fontSize(6.3)
        .text(label, cx + 10, cy + chipH / 2 - 9, { width: cw - 20, characterSpacing: 0.3, lineBreak: false });
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11.5)
        .text(value, cx + 10, cy + chipH / 2 + 1, { width: cw - 20, lineBreak: false });
    });

    doc.y = y + boxH;
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

    // Cash Collected card dropped — now shown as its own highlighted box in
    // the Info Card above, so this row stays to just the bottle-flow numbers.
    const cards = [
      { label: 'FILLED OUT', value: String(sheet.filledOutCount), accent: '#3b82f6' },
      { label: 'FILLED RETURNED', value: String(sheet.filledInCount), accent: '#10b981' },
      { label: 'FILLED RECEIVED', value: String(filledReceived), accent: '#7c3aed' },
      { label: 'EMPTY RECEIVED', value: String(sheet.emptyInCount), accent: '#eab308' },
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

  // ─── Trip bucketing — pure function, no DB access. Buckets already-fetched
  // items/expenses into whichever trip's [startedAt, endedAt ?? open) window
  // contains their timestamp (Option A "time-window inference" — no schema
  // change). Items/expenses outside every window are simply left unassigned:
  // they still appear fully in the flat Delivery Items table / itemized
  // Expenses list, they just don't contribute to any trip's numbers here
  // (can legitimately happen for isCorrection items or backdated expenses). ─
  private computeTripStats(loads: any[], items: any[], expenses: any[]): TripStats {
    const trips = [...loads].sort((a, b) => a.tripNumber - b.tripNumber);

    const inWindow = (ts: number, start: Date, end: Date | null) =>
      ts >= start.getTime() && (end === null || ts <= end.getTime());

    const filledRecvByTrip = new Map<string, number>();
    const cashByTrip = new Map<string, number>();
    const expenseByTrip = new Map<string, number>();

    for (const item of items) {
      if (!item.deliveredAt) continue; // PENDING items excluded from bucketing
      const ts = new Date(item.deliveredAt).getTime();
      const trip = trips.find((t) => inWindow(ts, new Date(t.startedAt), t.endedAt ? new Date(t.endedAt) : null));
      if (!trip) continue;
      filledRecvByTrip.set(trip.id, (filledRecvByTrip.get(trip.id) ?? 0) + (item.filledReceived ?? 0));
      cashByTrip.set(trip.id, (cashByTrip.get(trip.id) ?? 0) + (item.cashCollected ?? 0));
    }

    // Only cash-paid expenses are deducted — same convention as the net-cash
    // chip and the Trip Expenses totals band below.
    const cashExpenses = expenses.filter((e) => e.paidFromCash !== false);
    for (const exp of cashExpenses) {
      // createdAt (true recording timestamp), not .date — staff can backdate
      // .date, which would make it an unreliable match against real trip windows.
      const ts = new Date(exp.createdAt).getTime();
      const trip = trips.find((t) => inWindow(ts, new Date(t.startedAt), t.endedAt ? new Date(t.endedAt) : null));
      if (!trip) continue;
      expenseByTrip.set(trip.id, (expenseByTrip.get(trip.id) ?? 0) + (exp.amount ?? 0));
    }

    const perTrip: TripStat[] = trips.map((t) => {
      const filledReceived = filledRecvByTrip.get(t.id) ?? 0;
      const cashCollected = cashByTrip.get(t.id) ?? 0;
      const expense = expenseByTrip.get(t.id) ?? 0;
      return {
        load: t,
        filledOut: t.loadedFilled ?? 0,
        filledReturned: t.returnedFilled ?? 0,
        filledReceived,
        // Verified against the reference sheet's own worked examples:
        // 100-5-0=95, 50-10-0=40, 50-5-0=45.
        sold: (t.loadedFilled ?? 0) - (t.returnedFilled ?? 0) - filledReceived,
        emptyReceive: t.collectedEmpty ?? 0,
        cashCollected,
        expense,
        cashInHand: cashCollected - expense,
        timeOut: t.startedAt,
        timeIn: t.endedAt,
      };
    });

    const totals = perTrip.reduce(
      (acc, t) => ({
        filledOut: acc.filledOut + t.filledOut,
        filledReturned: acc.filledReturned + t.filledReturned,
        filledReceived: acc.filledReceived + t.filledReceived,
        sold: acc.sold + t.sold,
        emptyReceive: acc.emptyReceive + t.emptyReceive,
        cashCollected: acc.cashCollected + t.cashCollected,
        expense: acc.expense + t.expense,
        cashInHand: acc.cashInHand + t.cashInHand,
      }),
      { filledOut: 0, filledReturned: 0, filledReceived: 0, sold: 0, emptyReceive: 0, cashCollected: 0, expense: 0, cashInHand: 0 },
    );

    return {
      perTrip,
      totals: {
        ...totals,
        startingTime: trips[0]?.startedAt ?? null,
        closingTime: trips.length ? trips[trips.length - 1].endedAt : null,
      },
    };
  }

  private hm(dt: string | Date): string {
    return new Date(dt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  }

  private fmtTripTime(dt: Date | string | null, openLabel: string): string {
    return dt ? this.hm(dt) : openLabel;
  }

  // ─── Trip Summary — per-trip stacked blocks (own header + one data row
  // each), followed by a combined Totals row. Replaces the old single
  // combined Load Trips table so the printed layout matches the reference. ──
  private drawTripHeaderRow(doc: PDFKit.PDFDocument, y: number): number {
    const rowH = 16;
    doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.navy);
    doc.fillColor(C.white).fontSize(6.2).font('Helvetica-Bold');
    let x = MARGIN;
    const cells: [string, number][] = [
      ['FILLED OUT', TRIPCOLS.filledOut],
      ['FILLED RET.', TRIPCOLS.filledReturned],
      ['FILLED RECV', TRIPCOLS.filledReceived],
      ['SOLD', TRIPCOLS.sold],
      ['EMPTY RECV', TRIPCOLS.emptyReceive],
      ['CASH COLL.', TRIPCOLS.cashCollected],
      ['EXPENSE', TRIPCOLS.expense],
      ['CASH IN HAND', TRIPCOLS.cashInHand],
      ['TIME OUT', TRIPCOLS.timeOut],
      ['TIME IN', TRIPCOLS.timeIn],
    ];
    cells.forEach(([label, w]) => {
      doc.text(label, x, y + 5, { width: w - 6, align: 'right', lineBreak: false });
      x += w;
    });
    return y + rowH;
  }

  private drawTripDataRow(
    doc: PDFKit.PDFDocument,
    y: number,
    row: {
      filledOut: number; filledReturned: number; filledReceived: number; sold: number;
      emptyReceive: number; cashCollected: number; expense: number; cashInHand: number;
      timeOutLabel: string; timeInLabel: string;
    },
    opts?: { bold?: boolean; bg?: string },
  ): number {
    const rowH = 20;
    if (opts?.bg) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(opts.bg);
    doc.fillColor(opts?.bold ? C.white : C.textSoft).fontSize(7.5).font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica');
    let x = MARGIN;
    const vals: [string, number][] = [
      [String(row.filledOut), TRIPCOLS.filledOut],
      [String(row.filledReturned), TRIPCOLS.filledReturned],
      [String(row.filledReceived), TRIPCOLS.filledReceived],
      [String(row.sold), TRIPCOLS.sold],
      [String(row.emptyReceive), TRIPCOLS.emptyReceive],
      [this.rs(row.cashCollected), TRIPCOLS.cashCollected],
      [this.rs(row.expense), TRIPCOLS.expense],
      [this.rs(row.cashInHand), TRIPCOLS.cashInHand],
      [row.timeOutLabel, TRIPCOLS.timeOut],
      [row.timeInLabel, TRIPCOLS.timeIn],
    ];
    vals.forEach(([val, w]) => {
      doc.text(val, x, y + 6, { width: w - 6, align: 'right', lineBreak: false });
      x += w;
    });
    return y + rowH;
  }

  private drawTripSummary(doc: PDFKit.PDFDocument, stats: TripStats): void {
    const BLOCK_H = 14 + 16 + 20 + 10; // title + header row + data row + gap

    stats.perTrip.forEach((t) => {
      let y = doc.y;
      if (y + BLOCK_H > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = 50;
      }
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(9)
        .text(`Trip ${t.load.tripNumber}:`, MARGIN, y, { lineBreak: false });
      y += 14;
      y = this.drawTripHeaderRow(doc, y);
      y = this.drawTripDataRow(doc, y, {
        filledOut: t.filledOut, filledReturned: t.filledReturned, filledReceived: t.filledReceived,
        sold: t.sold, emptyReceive: t.emptyReceive, cashCollected: t.cashCollected, expense: t.expense,
        cashInHand: t.cashInHand,
        timeOutLabel: this.fmtTripTime(t.timeOut, '—'),
        timeInLabel: this.fmtTripTime(t.timeIn, '(open)'),
      });
      doc.y = y + 10;
    });

    // Combined totals row
    let y = doc.y;
    if (y + 34 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      y = 50;
    }
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(9)
      .text('Totals', MARGIN, y, { lineBreak: false });
    y += 14;
    y = this.drawTripDataRow(doc, y, {
      filledOut: stats.totals.filledOut, filledReturned: stats.totals.filledReturned,
      filledReceived: stats.totals.filledReceived, sold: stats.totals.sold,
      emptyReceive: stats.totals.emptyReceive, cashCollected: stats.totals.cashCollected,
      expense: stats.totals.expense, cashInHand: stats.totals.cashInHand,
      timeOutLabel: this.fmtTripTime(stats.totals.startingTime, '—'),
      timeInLabel: this.fmtTripTime(stats.totals.closingTime, 'In Progress'),
    }, { bold: true, bg: C.navy });

    doc.y = y + 14;
  }

  // ─── Delivery items table ────────────────────────────────────────────────
  private drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
    const rowH = 20;
    doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.navy);
    doc.fillColor(C.white).fontSize(6.3).font('Helvetica-Bold');

    let x = MARGIN;
    const headerY = y + 6;
    doc.text('#', x + 3, headerY, { lineBreak: false }); x += COLS.seq;
    doc.text('CODE', x + 3, headerY, { lineBreak: false }); x += COLS.code;
    doc.text('CUSTOMER', x + 3, headerY, { characterSpacing: 0.2, lineBreak: false }); x += COLS.customer;
    doc.text('TIME', x, headerY, { width: COLS.time - 4, align: 'right', lineBreak: false }); x += COLS.time;
    doc.text('DELIV', x, headerY, { width: COLS.delivered - 4, align: 'right', lineBreak: false }); x += COLS.delivered;
    doc.text('F.RCV', x, headerY, { width: COLS.filledRecv - 4, align: 'right', lineBreak: false }); x += COLS.filledRecv;
    doc.text('E.RCV', x, headerY, { width: COLS.emptyRecv - 4, align: 'right', lineBreak: false }); x += COLS.emptyRecv;
    doc.text('BAL BTL', x, headerY, { width: COLS.balBottles - 4, align: 'right', lineBreak: false }); x += COLS.balBottles;
    doc.text('CASH', x, headerY, { width: COLS.cash - 4, align: 'right', lineBreak: false }); x += COLS.cash;
    doc.text('PAY', x, headerY, { width: COLS.payMode - 4, align: 'center', lineBreak: false }); x += COLS.payMode;
    doc.text('BAL RS', x, headerY, { width: COLS.balRs - 4, align: 'right', lineBreak: false }); x += COLS.balRs;
    doc.text('CONS%', x, headerY, { width: COLS.consPct - 4, align: 'right', lineBreak: false }); x += COLS.consPct;
    doc.text('STATUS', x, headerY, { width: COLS_STATUS_W, align: 'center', characterSpacing: 0.2, lineBreak: false });

    return y + rowH;
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
    this.drawPill(doc, meta, colX, COLS.statusPill, rowY, rowH);
  }

  private drawDeliveryTable(doc: PDFKit.PDFDocument, items: any[], consumptionRates: ConsumptionRateRow[]): void {
    const consMap = new Map(consumptionRates.map((r) => [`${r.customerId}:${r.productId}`, r]));
    let y = this.drawTableHeader(doc, doc.y);

    if (!items.length) {
      doc.fillColor(C.muted).fontSize(9).font('Helvetica')
        .text('No delivery items found.', MARGIN, y + 10, { width: CONTENT_W, align: 'center', lineBreak: false });
      doc.y = y + 30;
      return;
    }

    items.forEach((item, index) => {
      const reason: string | null = item.reason || null;
      const rowH = reason ? 32 : 20;

      // Page break — redraw table header on the new page
      if (y + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = this.drawTableHeader(doc, 50);
      }

      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.surface);

      const textY = y + 5;
      let x = MARGIN;

      doc.fillColor(C.textSoft).fontSize(6.5).font('Helvetica')
        .text(String(item.sequence ?? index + 1), x + 3, textY, { lineBreak: false });
      x += COLS.seq;

      doc.fillColor(C.mutedLt).fontSize(6)
        .text(item.customer?.customerCode ?? '—', x + 2, textY + 1, { width: COLS.code - 3, lineBreak: false });
      x += COLS.code;

      doc.fillColor(C.navyText).fontSize(6.8).font('Helvetica-Bold')
        .text(item.customer?.name ?? '—', x + 3, textY, { width: COLS.customer - 6, height: 9, ellipsis: true, lineBreak: false });
      x += COLS.customer;

      doc.fillColor(C.muted).fontSize(6.3).font('Helvetica')
        .text(item.deliveredAt ? this.hm(item.deliveredAt) : '—', x, textY, { width: COLS.time - 4, align: 'right', lineBreak: false });
      x += COLS.time;

      doc.fillColor(C.text).fontSize(6.8)
        .text(String(item.filledDropped ?? 0), x, textY, { width: COLS.delivered - 4, align: 'right', lineBreak: false });
      x += COLS.delivered;

      doc.text(String(item.filledReceived ?? 0), x, textY, { width: COLS.filledRecv - 4, align: 'right', lineBreak: false });
      x += COLS.filledRecv;

      doc.text(String(item.emptyReceived ?? 0), x, textY, { width: COLS.emptyRecv - 4, align: 'right', lineBreak: false });
      x += COLS.emptyRecv;

      // Frozen post-delivery bottle-wallet snapshot — no live query needed.
      doc.fillColor(C.muted)
        .text(item.bottleBalanceAfter != null ? String(item.bottleBalanceAfter) : '—', x, textY, { width: COLS.balBottles - 4, align: 'right', lineBreak: false });
      x += COLS.balBottles;

      doc.fillColor(C.navyText).font('Helvetica-Bold')
        .text(this.rs(item.cashCollected), x, textY, { width: COLS.cash - 4, align: 'right', lineBreak: false });
      x += COLS.cash;

      const isMonthly = item.customer?.paymentType === 'MONTHLY';
      doc.fillColor(isMonthly ? '#1d4ed8' : C.green).font('Helvetica-Bold').fontSize(6)
        .text(isMonthly ? 'MO' : 'CA', x, textY, { width: COLS.payMode - 2, align: 'center', lineBreak: false });
      x += COLS.payMode;

      // Same live-balance convention as delivery-items-list.tsx: MONTHLY shows
      // last month's remaining outstanding, CASH shows current wallet due.
      const balRs = isMonthly ? (item.customer?.previousMonthOutstanding ?? 0) : (item.customer?.financialBalance ?? 0);
      doc.fillColor(balRs > 0 ? C.red : C.green).font('Helvetica-Bold').fontSize(6.5)
        .text(this.rs(balRs), x, textY, { width: COLS.balRs - 4, align: 'right', lineBreak: false });
      x += COLS.balRs;

      const cons = consMap.get(`${item.customerId}:${item.productId}`);
      const consColor = cons?.rateStatus === 'ON_TARGET' ? C.green
        : cons?.rateStatus === 'ATTENTION' ? C.amber
        : cons?.rateStatus === 'ACTION' ? C.red
        : C.mutedLt;
      doc.fillColor(consColor).font('Helvetica-Bold').fontSize(6.3)
        .text(cons?.consumptionRate ?? 'N/A', x, textY, { width: COLS.consPct - 4, align: 'right', lineBreak: false });
      x += COLS.consPct;

      this.drawStatusPill(doc, item.status, x, y, reason ? 20 : rowH);
      if ((item.editCount ?? 0) > 0) {
        this.drawPill(doc, EDITED_META, x + COLS.statusPill, COLS.editedTag, y, reason ? 20 : rowH);
      }

      if (reason) {
        doc.fillColor(C.mutedLt).fontSize(6).font('Helvetica-Oblique')
          .text(reason, MARGIN + COLS.seq + COLS.code + 3, y + 19, {
            width: COLS.customer + COLS.time + COLS.delivered + COLS.filledRecv + COLS.emptyRecv + COLS.balBottles + COLS.cash - 6,
            height: 8, ellipsis: true, lineBreak: false,
          });
      }

      y += rowH;
    });

    // Totals row
    if (y + 24 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      y = 50;
    }
    const totalDelivered = items.reduce((s, i) => s + (i.filledDropped ?? 0), 0);
    const totalFilledRecv = items.reduce((s, i) => s + (i.filledReceived ?? 0), 0);
    const totalEmptyRecv = items.reduce((s, i) => s + (i.emptyReceived ?? 0), 0);
    const totalCash = items.reduce((s, i) => s + (i.cashCollected ?? 0), 0);
    const doneCount = items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY').length;
    const editedCount = items.filter((i) => (i.editCount ?? 0) > 0).length;

    doc.rect(MARGIN, y, CONTENT_W, 22).fill(C.navy);
    doc.fillColor(C.white).fontSize(6.8).font('Helvetica-Bold');
    let x = MARGIN;
    doc.text('TOTALS', x + 3, y + 7, { characterSpacing: 0.3, lineBreak: false });
    x += COLS.seq + COLS.code + COLS.customer + COLS.time;
    doc.text(String(totalDelivered), x, y + 7, { width: COLS.delivered - 4, align: 'right', lineBreak: false });
    x += COLS.delivered;
    doc.text(String(totalFilledRecv), x, y + 7, { width: COLS.filledRecv - 4, align: 'right', lineBreak: false });
    x += COLS.filledRecv;
    doc.text(String(totalEmptyRecv), x, y + 7, { width: COLS.emptyRecv - 4, align: 'right', lineBreak: false });
    x += COLS.emptyRecv + COLS.balBottles;
    doc.text(this.rs(totalCash), x, y + 7, { width: COLS.cash - 4, align: 'right', lineBreak: false });
    x += COLS.cash + COLS.payMode + COLS.balRs + COLS.consPct;
    doc.fontSize(6).text(`${doneCount}/${items.length} done · ${editedCount} edited`, x, y + 8, { width: COLS_STATUS_W, align: 'center', lineBreak: false });

    doc.y = y + 30;
  }

  // ─── Trip Expenses (only when sheet has any) ─────────────────────────────
  // UNCHANGED content — only its position in drawDocument moved (now sits
  // directly under Trip Summary, both being trip/cash-flow related).
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

  // ─── Crew Cash Distribution (only when sheet has any) — UNCHANGED ────────
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

  // ─── Signature row (closed sheets only) — UNCHANGED ──────────────────────
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

  // ─── Footer on every page (page numbers need bufferPages) — UNCHANGED ────
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
