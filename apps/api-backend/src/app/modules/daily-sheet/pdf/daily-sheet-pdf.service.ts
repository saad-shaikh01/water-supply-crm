import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { drawShadowShape, brandGradient, drawClippedWatermark } from '../../../common/pdf/pdf-theme.util';

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
// Small icon mark (not the full wordmark logo) — used only for the faint
// clipped watermark on the Info Card, same asset CustomerStatementPdfService
// uses for its Delivery Card watermark.
const ICON_PATH = path.join(__dirname, 'assets', 'blue-ice-icon.png');

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

const DISCREPANCY_TYPE_META: Record<string, { label: string; bg: string; text: string }> = {
  BOTTLE: { label: 'BOTTLE', bg: '#dbeafe', text: '#1d4ed8' },
  EMPTY: { label: 'EMPTY', bg: '#fef9c3', text: '#a16207' },
  CASH: { label: 'CASH', bg: '#fee2e2', text: '#b91c1c' },
};
const DISCREPANCY_STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  REPORTED: { label: 'PENDING REVIEW', bg: '#ffedd5', text: '#c2410c' },
  RESOLVED: { label: 'RESOLVED', bg: '#dcfce7', text: '#15803d' },
};
const RESOLUTION_TYPE_LABEL: Record<string, string> = {
  CHARGED_TO_DRIVER: 'Charged to Driver',
  COMPANY_LOSS: 'Company Loss',
  WAIVED: 'Waived',
};

// LUNCH_EXPENSE_EMPLOYEE/ADVANCE_SALARY_EMPLOYEE/FUEL_EXPENSE kept here
// (retired from the add-expense dropdown 2026-08-21, see vendor-dashboard's
// expense-form.tsx) so historical sheet PDFs still render a proper label.
const EXPENSE_META: Record<string, { label: string; bg: string; text: string }> = {
  LUNCH_EXPENSE_EMPLOYEE: { label: 'LUNCH EXP EMPLOYEE', bg: '#fef9c3', text: '#a16207' },
  ADVANCE_SALARY_EMPLOYEE: { label: 'ADV SALARY EMPLOYEE', bg: '#f3e8ff', text: '#7e22ce' },
  VEHICLE_MAINTENANCE: { label: 'VEHICLE MAINTENANCE', bg: '#dbeafe', text: '#1d4ed8' },
  FUEL_EXPENSE: { label: 'FUEL EXP', bg: '#ffedd5', text: '#c2410c' },
  ICE_PURCHASED: { label: 'ICE PURCHASED', bg: '#cffafe', text: '#0e7490' },
  EXTRA_LOADER: { label: 'EXTRA LOADER', bg: '#ede9fe', text: '#6d28d9' },
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
// STATUS cell gets the full remaining width — an "edited" delivery is
// flagged via a colored left-edge accent bar on the whole row instead of a
// dedicated tag column, so no space sits reserved-but-empty on every
// non-edited row (see drawDeliveryTableLine).
// CONS% (consumptionRate) column removed (owner request) — its 28pt width
// was folded into STATUS so the row still sums to CONTENT_W. The backing
// DailySheetService.getConsumptionRatesForSheet() computation was also
// dropped from both controller PDF routes since it had no other caller.
// F.RCV (filledReceived) and BILL (bill amount owed for today's delivery —
// filledDropped × pricePerBottle, the exact same figure the driver's
// delivery-record-form shows as "Amount" above Cash Collected) both follow
// the same fold-into-STATUS convention: each is only drawn when at least one
// item on the sheet has a non-zero value, otherwise its width is folded into
// STATUS, same as CONS% was.
function getDeliveryCols(showFilledRecv: boolean, showBillAmount: boolean) {
  const filledRecv = showFilledRecv ? 28 : 0;
  const billAmount = showBillAmount ? 40 : 0;
  return {
    seq: 14, code: 32, customer: 60, time: 32, delivered: 28, filledRecv,
    emptyRecv: 28, balBottles: 30, billAmount, cash: 40, payMode: 28, balRs: 40,
    status: 115.28 + (28 - filledRecv) + (40 - billAmount),
  };
}
type DeliveryCols = ReturnType<typeof getDeliveryCols>;

// Trip Summary mini-table column geometry (10 cols, sums to CONTENT_W) — each
// trip renders its own stacked block (title + this header + one data row),
// so there is no separate "trip #" column here (the block title carries it).
// FILLED RECV (filledReceived — filled bottles taken back from customers) is
// only drawn when at least one trip on the sheet has a non-zero value; when
// hidden its 55pt is spread evenly across the 9 remaining columns so the row
// still sums to CONTENT_W (same fold convention as getDeliveryCols's F.RCV).
function getTripCols(showFilledRecv: boolean) {
  const base = {
    filledOut: 50, filledReturned: 55, filledReceived: 55, sold: 42,
    emptyReceive: 55, cashCollected: 58, expense: 52, cashInHand: 60,
    timeOut: 44, timeIn: 44.28,
  };
  if (showFilledRecv) return base;
  const spread = base.filledReceived / 9;
  return {
    filledOut: base.filledOut + spread,
    filledReturned: base.filledReturned + spread,
    filledReceived: 0,
    sold: base.sold + spread,
    emptyReceive: base.emptyReceive + spread,
    cashCollected: base.cashCollected + spread,
    expense: base.expense + spread,
    cashInHand: base.cashInHand + spread,
    timeOut: base.timeOut + spread,
    timeIn: base.timeIn + spread,
  };
}
type TripCols = ReturnType<typeof getTripCols>;

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

@Injectable()
export class DailySheetPdfService {
  /**
   * Generates a PDF buffer for a daily sheet.
   * @param sheet - Full sheet object from dailySheet.service.findOne(), with
   *                `vehicleDailyChecks`/`fuelLogs` (DailySheetService.getVehicleLogForSheet)
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

    // Discrepancy Details — the actual SheetDiscrepancyCase rows (only ever
    // exist on closed sheets, created at close time), one level more detail
    // than the verdict banner's plain +/- numbers above: per-case status and,
    // once reviewed, how it was resolved.
    if (sheet.isClosed && sheet.discrepancyCaseDetails?.length) {
      this.drawSectionTitle(doc, `Discrepancy Details (${sheet.discrepancyCaseDetails.length})`, true);
      this.drawDiscrepancyDetails(doc, sheet.discrepancyCaseDetails);
    }

    // Vehicle & Fuel Log — printed right above Trip Summary (odometer/fuel is
    // day-level context for the trips that follow it). Only rendered when the
    // controller actually attached vehicleDailyChecks/fuelLogs (both PDF
    // export routes do; nothing else calls generate() with a bare sheet).
    if (sheet.vehicleDailyChecks?.length || sheet.fuelLogs?.length) {
      this.drawSectionTitle(doc, 'Vehicle & Fuel Log', true);
      this.drawVehicleLog(doc, sheet);
    }

    if ((sheet.loads ?? []).length > 0) {
      const tripStats = this.computeTripStats(sheet.loads ?? [], sheet.items ?? [], sheet.expenses ?? [], sheet.crewCashDistributions ?? []);
      this.drawSectionTitle(doc, `Trip Summary (${sheet.loads.length})`);
      this.drawTripSummary(doc, tripStats);
    }

    if (sheet.expenses?.length) {
      this.drawSectionTitle(doc, `Trip Expenses (${sheet.expenses.length})`, true);
      this.drawExpenses(doc, sheet.expenses);
    }

    if (sheet.crewCashDistributions?.length) {
      this.drawSectionTitle(doc, `Crew Cash Distribution (${sheet.crewCashDistributions.length})`, true);
      this.drawCrewCash(doc, sheet.crewCashDistributions);
    }

    // Delivery Items is kept as the last itemized section (right before
    // Signatures) — deliberately printed after Crew Cash Distribution. Voided
    // deliveries are struck from the operational record — excluded from the
    // table, its TOTAL/AVG reducers and the stop count entirely.
    const visibleItems = (sheet.items ?? []).filter((i: any) => i.status !== 'VOIDED');
    this.drawSectionTitle(doc, `Delivery Items (${visibleItems.length} stops)`, true);
    this.drawDeliveryTable(doc, visibleItems);

    if (sheet.isClosed) this.drawSignatures(doc);
  }

  // ─── Soft-shadow rounded card background (matches CustomerStatementPdfService) ─
  private shadowCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
    drawShadowShape(doc, x, y, w, h, RADIUS, C.white, { shadowColor: C.navy, borderColor: C.border });
  }

  /**
   * Generic paginated card-table — copied line-for-line from
   * CustomerStatementPdfService.drawCardTable so every itemized table in
   * this system shares one card/pagination language: one shadow card per
   * page, un-filled muted-label header (border line under it, no navy bar),
   * fixed row height, optional clipped watermark on the first card only.
   */
  private drawCardTable<T>(
    doc: PDFKit.PDFDocument,
    lines: T[],
    headerH: number,
    rowH: number,
    drawHeader: (x: number, y: number, w: number) => void,
    drawLine: (line: T, x: number, y: number, index: number) => void,
    opts: { watermark?: boolean } = {},
  ): void {
    let drawn = 0;
    while (drawn < lines.length) {
      const availH = PAGE_H - FOOTER_ZONE - 16 - doc.y;
      const maxLines = Math.max(1, Math.floor((availH - headerH) / rowH));
      const linesThisCard = Math.min(maxLines, lines.length - drawn);
      const cardH = headerH + linesThisCard * rowH + 6;
      const cardY = doc.y;

      this.shadowCard(doc, MARGIN, cardY, CONTENT_W, cardH);
      if (opts.watermark && drawn === 0) {
        drawClippedWatermark(doc, ICON_PATH, MARGIN, cardY, CONTENT_W, cardH);
      }
      drawHeader(MARGIN, cardY + 6, CONTENT_W);
      for (let li = 0; li < linesThisCard; li++) {
        drawLine(lines[drawn + li], MARGIN, cardY + 6 + headerH + li * rowH, drawn + li);
      }

      drawn += linesThisCard;
      doc.y = cardY + cardH;
      if (drawn < lines.length) {
        doc.addPage();
        doc.y = 50;
      }
    }
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
    // timeZone must be explicit — the 'en-PK' locale only controls
    // formatting conventions (date order, etc.), NOT the timezone. Without
    // it Node falls back to the server's own system timezone (UTC on the
    // VPS), not Pakistan time.
    const date = new Date(sheet.date).toLocaleDateString('en-PK', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Karachi',
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
    // Faint centered icon watermark, clipped to the card — same treatment
    // (asset, size formula, opacity) as CustomerStatementPdfService's
    // Delivery Card watermark, applied here to this document's own hero card.
    drawClippedWatermark(doc, ICON_PATH, MARGIN, y, CONTENT_W, boxH);
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

    // COL 2 — Sheet #, Stops, Trips, Sold, Empty. Voided deliveries are struck
    // from the record — not counted as stops, and their stale cashCollected is
    // excluded from GROSS CASH COLLECTED below.
    const nonVoidItems = (sheet.items ?? []).filter((i: any) => i.status !== 'VOIDED');
    const activeItems = nonVoidItems.filter((i: any) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY');
    const sold = activeItems.reduce((s: number, i: any) => s + (i.filledDropped ?? 0), 0);
    const tripCount = sheet.loads?.length ?? 0;
    const rows: [string, string][] = [
      ['Sheet #', sheet.id.slice(0, 8).toUpperCase()],
      ['Stops', String(nonVoidItems.length)],
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

    // COL 3 — three stacked highlight boxes, sourced exactly like
    // DailySheetService.buildReconciliation() (the same numbers the
    // close-sheet review screen uses) — NOT independently recomputed:
    //  - Gross Cash Collected = totalCashRecorded — sum of every item's
    //    cashCollected, i.e. cash actually taken from customers during
    //    deliveries.
    //  - Total Expense = only cash-paid expenses (card/bank-paid ones are
    //    excluded — they never touched the driver's cash-in-hand).
    //  - Net Cash In Hand = sheet.cashCollected — NOT a computed "expected"
    //    figure. This field is the driver/salesman's ACTUAL physical
    //    hand-in, captured once as a single figure when the sheet is closed
    //    (closeSheet()/requestClose()) — no longer accumulated per-trip at
    //    check-in. It can legitimately differ from
    //    Gross − Expense − Crew Cash — that gap is the discrepancy the
    //    "Bottle & Cash Summary" verdict banner below reports once the
    //    sheet is closed (sheet.cashExpected holds that computed figure).
    const totalItemCash = nonVoidItems.reduce((s: number, i: any) => s + (i.cashCollected ?? 0), 0);
    const totalExpenses = (sheet.expenses ?? [])
      .filter((e: any) => e.paidFromCash !== false)
      .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    // Crew Cash has no paidFromCash toggle — unconditionally physical van
    // cash (same reasoning as computeTripStats above), so it belongs in this
    // chip too. Without it, TOTAL DEDUCTIONS understates what actually left
    // the driver's hand whenever crew cash was given but no regular expense
    // was logged (mirrors the same fix applied to reconcile-dialog.tsx's
    // Driver Handover summary tile on the vendor-dashboard side).
    const totalCrewCash = (sheet.crewCashDistributions ?? [])
      .reduce((s: number, cc: any) => s + (cc.amount ?? 0), 0);

    const chips: [string, string, string][] = [
      ['GROSS CASH COLLECTED', this.rs(totalItemCash), C.navy],
      ['TOTAL DEDUCTIONS', this.rs(totalExpenses + totalCrewCash), C.textSoft],
      ['NET CASH IN HAND', this.rs(sheet.cashCollected), C.accent],
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

  // ─── Section title with accent bar — styling matched exactly to
  // CustomerStatementPdfService.drawSectionTitle (fontSize 13, no uppercase/
  // characterSpacing, 16pt bar) so every printed document reads as one
  // family. checkPageBreak is this file's own addition (statement paginates
  // its sections differently via drawCardTable) — kept, purely functional. ──
  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string, checkPageBreak = false): void {
    if (checkPageBreak && doc.y + 60 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      doc.y = 50;
    }
    const y = doc.y + 8;
    doc.roundedRect(MARGIN, y, 4, 16, 2).fill(C.accent);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(13)
      .text(title, MARGIN + 12, y + 1, { lineBreak: false });
    doc.y = y + 24;
  }

  // ─── Summary cards + reconciliation verdict ──────────────────────────────
  private drawSummary(doc: PDFKit.PDFDocument, sheet: any): void {
    const activeItems = (sheet.items ?? []).filter(
      (i: any) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY',
    );
    const delivered = activeItems.reduce((s: number, i: any) => s + (i.filledDropped ?? 0), 0);
    const filledReceived = activeItems.reduce((s: number, i: any) => s + (i.filledReceived ?? 0), 0);
    // Filled bottles taken back from customers (account close / excess-stock
    // return) physically re-enter the van's filled stock, so they belong on
    // the supply side of the balance — must mirror
    // DailySheetService.buildReconciliation() exactly, or the printed verdict
    // shows a phantom shortage equal to filledReceived on any sheet that had
    // one (was: filledOutCount - (filledInCount + delivered)).
    const bottleDiscrepancy =
      (sheet.filledOutCount + filledReceived) - (sheet.filledInCount + delivered);
    const emptyCollected = activeItems.reduce((s: number, i: any) => s + (i.emptyReceived ?? 0), 0);
    const emptyDiscrepancy = emptyCollected - sheet.emptyInCount;
    const cashDiscrepancy = (sheet.cashCollected ?? 0) - (sheet.cashExpected ?? 0);

    // Cash Collected card dropped — now shown as its own highlighted box in
    // the Info Card above, so this row stays to just the bottle-flow numbers.
    // SOLD BOTTLES mirrors the frontend load-trips "Sold" stat: bottles
    // actually dropped at customers (filledDropped sum) = `delivered`.
    // FILLED RECEIVED is only shown when a customer handed filled bottles
    // back this day — otherwise its card is dropped and the row re-flows to
    // the remaining cards (cardW is derived from cards.length).
    const cards = [
      { label: 'FILLED OUT', value: String(sheet.filledOutCount), accent: '#3b82f6' },
      { label: 'FILLED RETURNED', value: String(sheet.filledInCount), accent: '#10b981' },
      ...(filledReceived !== 0
        ? [{ label: 'FILLED RECEIVED', value: String(filledReceived), accent: '#7c3aed' }]
        : []),
      { label: 'SOLD BOTTLES', value: String(delivered), accent: '#f59e0b' },
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

  // ─── Discrepancy Details — one row per SheetDiscrepancyCase (BOTTLE/EMPTY/
  // CASH), showing the reported gap, review status, and — once resolved —
  // how it was closed out (charged to driver / company loss / waived). ─────
  private drawDiscrepancyDetails(doc: PDFKit.PDFDocument, cases: any[]): void {
    const rowH = 30;
    let y = doc.y;

    cases.forEach((kase, index) => {
      if (y + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        y = 50;
      }
      if (index % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.surface);

      const typeMeta = DISCREPANCY_TYPE_META[kase.type] ?? { label: kase.type, bg: '#f1f5f9', text: '#475569' };
      const statusMeta = DISCREPANCY_STATUS_META[kase.status] ?? { label: kase.status, bg: '#f1f5f9', text: '#475569' };

      let x = MARGIN + 4;
      this.drawPill(doc, typeMeta, x, 70, y, 16); x += 76;

      const gapLabel = kase.type === 'CASH'
        ? this.rs(Math.abs(kase.reportedAmount ?? 0))
        : `${Math.abs(kase.reportedQuantity ?? 0)} bottles`;
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(8)
        .text(`Gap: ${gapLabel}`, x, y + 3, { width: 150, height: 11, lineBreak: false });
      x += 158;

      this.drawPill(doc, statusMeta, x, 110, y, 16);

      // Line 2 — resolution detail, or a plain "awaiting review" note.
      let detail: string;
      if (kase.status === 'RESOLVED') {
        const resLabel = RESOLUTION_TYPE_LABEL[kase.resolutionType as string] ?? kase.resolutionType ?? '—';
        const amountPart = kase.resolutionAmount != null ? `  ·  ${this.rs(kase.resolutionAmount)}` : '';
        const resolvedDate = kase.resolvedAt
          ? new Date(kase.resolvedAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' })
          : null;
        const byPart = kase.resolvedBy?.name ? `  ·  by ${kase.resolvedBy.name}${resolvedDate ? ` on ${resolvedDate}` : ''}` : '';
        const notePart = kase.resolutionNote ? `  ·  "${kase.resolutionNote}"` : '';
        detail = `Resolved: ${resLabel}${amountPart}${byPart}${notePart}`;
      } else {
        detail = 'Awaiting staff/admin review.';
      }
      doc.fillColor(C.muted).font('Helvetica').fontSize(7)
        .text(detail, MARGIN + 4, y + 19, { width: CONTENT_W - 8, height: 9, ellipsis: true, lineBreak: false });

      y += rowH;
    });

    doc.y = y + 10;
  }

  // ─── Vehicle & Fuel Log — start/end odometer + km traveled (same
  // start/end-check pair and delta formula as sheet-detail.tsx's "Km
  // Traveled Today" stat card), followed by an itemized fuel-fill list (only
  // when any exist). Fuel amounts here are NOT a new total to add to cash
  // math — every FuelLog already spawned a linked FUEL_EXPENSE Expense row
  // (see FuelLogService), which is already counted in the Trip Expenses
  // section and the Info Card's TOTAL DEDUCTIONS chip. This table only adds
  // fuel-specific detail (odometer at fill, liters, station, full/partial
  // tank) that the Expense row alone doesn't carry. ─────────────────────────
  private drawVehicleLog(doc: PDFKit.PDFDocument, sheet: any): void {
    const checks: any[] = sheet.vehicleDailyChecks ?? [];
    const startCheck = checks.find((c) => c.checkType === 'START') ?? null;
    const endCheck = checks.find((c) => c.checkType === 'END') ?? null;
    const kmTraveled = startCheck && endCheck ? endCheck.odometerReading - startCheck.odometerReading : null;
    const kmIsAnomaly = kmTraveled !== null && kmTraveled < 0;
    const kmValue = kmTraveled === null
      ? (startCheck ? 'In Progress' : 'Not Recorded')
      : kmIsAnomaly ? 'Check Entry' : `${kmTraveled.toLocaleString()} km`;

    const cards: [string, string, string][] = [
      ['START ODOMETER', startCheck ? `${startCheck.odometerReading.toLocaleString()} km` : 'Not Recorded', C.navy],
      ['END ODOMETER', endCheck ? `${endCheck.odometerReading.toLocaleString()} km` : 'Not Recorded', C.textSoft],
      ['KM TRAVELED TODAY', kmValue, kmIsAnomaly ? C.red : C.accent],
    ];

    const y = doc.y;
    const gap = 8;
    const cardW = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
    const cardH = 44;
    cards.forEach(([label, value, bg], i) => {
      const x = MARGIN + i * (cardW + gap);
      doc.roundedRect(x, y, cardW, cardH, 7).fill(bg);
      doc.fillColor('#ffffff', 0.8).font('Helvetica-Bold').fontSize(6.5)
        .text(label, x + 10, y + 10, { width: cardW - 20, characterSpacing: 0.3, lineBreak: false });
      const valueSize = value.length > 14 ? 9.5 : 12;
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(valueSize)
        .text(value, x + 10, y + 24, { width: cardW - 20, lineBreak: false });
    });
    doc.y = y + cardH + 12;

    const fuelLogs: any[] = sheet.fuelLogs ?? [];
    if (!fuelLogs.length) return;

    const FUEL_COLS = { time: 55, odometer: 85, liters: 70, amount: 90, station: 130, tank: 85.28 };
    const rowH = 20;
    let ry = doc.y;

    doc.moveTo(MARGIN + 10, ry + 16).lineTo(MARGIN + CONTENT_W - 10, ry + 16).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.2);
    let hx = MARGIN;
    doc.text('TIME', hx + 4, ry + 4, { width: FUEL_COLS.time - 4, lineBreak: false }); hx += FUEL_COLS.time;
    doc.text('ODOMETER', hx, ry + 4, { width: FUEL_COLS.odometer - 4, align: 'right', lineBreak: false }); hx += FUEL_COLS.odometer;
    doc.text('LITERS', hx, ry + 4, { width: FUEL_COLS.liters - 4, align: 'right', lineBreak: false }); hx += FUEL_COLS.liters;
    doc.text('AMOUNT', hx, ry + 4, { width: FUEL_COLS.amount - 4, align: 'right', lineBreak: false }); hx += FUEL_COLS.amount;
    doc.text('STATION', hx + 4, ry + 4, { width: FUEL_COLS.station - 4, lineBreak: false }); hx += FUEL_COLS.station;
    doc.text('TANK', hx, ry + 4, { width: FUEL_COLS.tank - 4, align: 'center', lineBreak: false });
    ry += 22;

    fuelLogs.forEach((log, index) => {
      if (ry + rowH > PAGE_H - FOOTER_ZONE) {
        doc.addPage();
        ry = 50;
      }
      if (index % 2 === 1) doc.rect(MARGIN, ry, CONTENT_W, rowH).fill(C.surface);

      let cx = MARGIN;
      doc.fillColor(C.textSoft).fontSize(7).font('Helvetica')
        .text(this.hm(log.date), cx + 4, ry + 6, { width: FUEL_COLS.time - 4, lineBreak: false });
      cx += FUEL_COLS.time;
      doc.fillColor(C.muted)
        .text(`${(log.odometerAtFill ?? 0).toLocaleString()} km`, cx, ry + 6, { width: FUEL_COLS.odometer - 4, align: 'right', lineBreak: false });
      cx += FUEL_COLS.odometer;
      doc.text(`${log.litersFilled ?? 0}L`, cx, ry + 6, { width: FUEL_COLS.liters - 4, align: 'right', lineBreak: false });
      cx += FUEL_COLS.liters;

      const isNonCash = log.paidFromCash === false;
      doc.fillColor(isNonCash ? C.cyan : C.navyText).font('Helvetica-Bold')
        .text(this.rs(log.amountPaid), cx, ry + 6, { width: FUEL_COLS.amount - 4, align: 'right', lineBreak: false });
      cx += FUEL_COLS.amount;

      doc.fillColor(C.muted).font('Helvetica').fontSize(7)
        .text(log.fuelStation || '—', cx + 4, ry + 6, { width: FUEL_COLS.station - 8, height: 9, ellipsis: true, lineBreak: false });
      cx += FUEL_COLS.station;

      doc.fillColor(log.isFullTank ? C.green : C.amber).font('Helvetica-Bold').fontSize(6.3)
        .text(log.isFullTank ? 'FULL' : 'PARTIAL', cx, ry + 7, { width: FUEL_COLS.tank - 4, align: 'center', lineBreak: false });

      ry += rowH;
    });

    if (ry + 24 > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      ry = 50;
    }
    const totalLiters = fuelLogs.reduce((s, l) => s + (l.litersFilled ?? 0), 0);
    const totalAmount = fuelLogs.reduce((s, l) => s + (l.amountPaid ?? 0), 0);
    doc.rect(MARGIN, ry, CONTENT_W, 24).fill(C.navy);
    doc.fillColor(C.white).fontSize(7.5).font('Helvetica-Bold')
      .text(`TOTAL FUEL — ${totalLiters}L (already counted in Trip Expenses)`, MARGIN + 4, ry + 8, { characterSpacing: 0.3, lineBreak: false });
    doc.fontSize(8)
      .text(this.rs(totalAmount), MARGIN, ry + 8, { width: CONTENT_W - 6, align: 'right', lineBreak: false });
    ry += 24;

    doc.y = ry + 8;
  }

  // ─── Trip bucketing — pure function, no DB access. Buckets already-fetched
  // items/expenses into the trip they're actually linked to via
  // DailySheetItem.dailySheetLoadId / Expense.dailySheetLoadId — the same FK
  // the sheet-detail page's Trip Cards use (sheet-detail.tsx's `tripStats`
  // useMemo), so this PDF and the on-screen cards always agree. Previously
  // this inferred ownership from a [startedAt, endedAt ?? open) timestamp
  // window (deliveredAt / expense.createdAt) — that heuristic could
  // legitimately disagree with the FK (e.g. a resubmitted item keeps its
  // original trip link but gets a new deliveredAt) and has been removed.
  // Items/expenses/crew cash with no dailySheetLoadId (recorded while no
  // trip was active) are simply left unassigned: they still appear fully in
  // the flat Delivery Items table / itemized Expenses list, they just don't
  // contribute to any trip's numbers here (can legitimately happen for
  // isCorrection items or expenses logged with no active trip). ───────────
  private computeTripStats(loads: any[], items: any[], expenses: any[], crewCash: any[]): TripStats {
    const trips = [...loads].sort((a, b) => a.tripNumber - b.tripNumber);

    const filledRecvByTrip = new Map<string, number>();
    const cashByTrip = new Map<string, number>();
    const expenseByTrip = new Map<string, number>();

    // Same terminal-status filter as the frontend's tripStats (COMPLETED |
    // EMPTY_ONLY) — a delivery only counts toward a trip's cash once it's
    // actually final.
    for (const item of items) {
      if (item.status !== 'COMPLETED' && item.status !== 'EMPTY_ONLY') continue;
      if (!item.dailySheetLoadId) continue; // no active trip at record time — unassigned
      filledRecvByTrip.set(item.dailySheetLoadId, (filledRecvByTrip.get(item.dailySheetLoadId) ?? 0) + (item.filledReceived ?? 0));
      cashByTrip.set(item.dailySheetLoadId, (cashByTrip.get(item.dailySheetLoadId) ?? 0) + (item.cashCollected ?? 0));
    }

    // Only cash-paid expenses are deducted — same convention as the net-cash
    // chip and the Trip Expenses totals band below.
    const cashExpenses = expenses.filter((e) => e.paidFromCash !== false);
    for (const exp of cashExpenses) {
      if (!exp.dailySheetLoadId) continue; // no active trip at record time — unassigned
      expenseByTrip.set(exp.dailySheetLoadId, (expenseByTrip.get(exp.dailySheetLoadId) ?? 0) + (exp.amount ?? 0));
    }

    // Crew Cash has no paidFromCash toggle — it's unconditionally physical
    // van cash (see the schema comment on CrewCashDistribution.dailySheetLoadId),
    // so every row here is deductible, same bucket as cash-paid expenses.
    for (const cc of crewCash) {
      if (!cc.dailySheetLoadId) continue; // no active trip at record time — unassigned
      expenseByTrip.set(cc.dailySheetLoadId, (expenseByTrip.get(cc.dailySheetLoadId) ?? 0) + (cc.amount ?? 0));
    }

    // cashInHand is a RUNNING total through each trip, not that trip's
    // isolated net — same reasoning as sheet-detail.tsx's tripStats useMemo:
    // cash no longer hands over per-trip (one day-end entry now, see the
    // Reconcile dialog), so the driver just keeps carrying it forward, and
    // "Cash In Hand" on trip N must reflect everything through trip N. Only
    // this column accumulates — Cash Collected/Expense stay per-trip (what
    // happened THIS trip).
    let runningCashInHand = 0;
    const perTrip: TripStat[] = trips.map((t) => {
      const filledReceived = filledRecvByTrip.get(t.id) ?? 0;
      const cashCollected = cashByTrip.get(t.id) ?? 0;
      const expense = expenseByTrip.get(t.id) ?? 0;
      runningCashInHand += cashCollected - expense;
      return {
        load: t,
        filledOut: t.loadedFilled ?? 0,
        filledReturned: t.returnedFilled ?? 0,
        filledReceived,
        // Physical balance: loadedFilled + filledReceived (taken back from
        // customers, re-enters van stock) = sold + returnedFilled. So
        // sold = loadedFilled - returnedFilled + filledReceived — same
        // supply-side treatment of filledReceived as the sheet-level
        // DailySheetService.buildReconciliation(). The reference sheet's
        // worked examples (100-5-0=95, 50-10-0=40, 50-5-0=45) all had
        // filledReceived=0, so they never pinned down its sign; a sheet
        // with a real customer return exposed it as a phantom shortfall in
        // the TOTAL row (was: `- filledReceived`).
        sold: (t.loadedFilled ?? 0) - (t.returnedFilled ?? 0) + filledReceived,
        emptyReceive: t.collectedEmpty ?? 0,
        cashCollected,
        expense,
        cashInHand: runningCashInHand,
        timeOut: t.startedAt,
        timeIn: t.endedAt,
      };
    });

    // cashInHand's total is the LAST trip's running figure (already the
    // grand total by construction) — summing every row here the way the
    // other columns do would multiply-count every trip but the first.
    const totals = perTrip.reduce(
      (acc, t) => ({
        filledOut: acc.filledOut + t.filledOut,
        filledReturned: acc.filledReturned + t.filledReturned,
        filledReceived: acc.filledReceived + t.filledReceived,
        sold: acc.sold + t.sold,
        emptyReceive: acc.emptyReceive + t.emptyReceive,
        cashCollected: acc.cashCollected + t.cashCollected,
        expense: acc.expense + t.expense,
        cashInHand: runningCashInHand,
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
    // Same explicit-timeZone requirement as drawTitleRow's date — without it
    // this renders in the server's own timezone, not Pakistan time.
    return new Date(dt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  }

  private fmtTripTime(dt: Date | string | null, openLabel: string): string {
    return dt ? this.hm(dt) : openLabel;
  }

  // ─── Trip Summary — one shadow card (watermarked, same as the Delivery
  // Card) holding: one un-filled/muted-label header (border line, no navy
  // bar — matches CustomerStatementPdfService.drawDeliveryTableHeader
  // exactly), a "TRIP N" label + data row per trip, and a border-top TOTAL
  // row (no fill — matches CustomerStatementPdfService's TOTAL row exactly),
  // instead of the old per-trip navy-filled mini-tables. ───────────────────
  private drawTripHeaderRow(doc: PDFKit.PDFDocument, x: number, y: number, w: number, cols: TripCols): number {
    const rowH = 22;
    doc.moveTo(x + 10, y + rowH).lineTo(x + w - 10, y + rowH).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.2);
    let cx = x;
    const cells: [string, number][] = [
      ['FILLED OUT', cols.filledOut],
      ['FILLED RET.', cols.filledReturned],
      ...(cols.filledReceived > 0 ? [['FILLED RECV', cols.filledReceived] as [string, number]] : []),
      ['SOLD', cols.sold],
      ['EMPTY RECV', cols.emptyReceive],
      ['CASH COLL.', cols.cashCollected],
      ['EXPENSE', cols.expense],
      ['CASH IN HAND', cols.cashInHand],
      ['TIME OUT', cols.timeOut],
      ['TIME IN', cols.timeIn],
    ];
    cells.forEach(([label, w2]) => {
      doc.text(label, cx, y + 8, { width: w2 - 6, align: 'right', lineBreak: false });
      cx += w2;
    });
    return y + rowH;
  }

  private drawTripDataRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    row: {
      filledOut: number; filledReturned: number; filledReceived: number; sold: number;
      emptyReceive: number; cashCollected: number; expense: number; cashInHand: number;
      timeOutLabel: string; timeInLabel: string;
    },
    opts?: { bold?: boolean },
    cols: TripCols = getTripCols(true),
  ): number {
    const rowH = 20;
    doc.fillColor(opts?.bold ? C.navyText : C.textSoft).fontSize(7.5).font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica');
    let cx = x;
    const vals: [string, number][] = [
      [String(row.filledOut), cols.filledOut],
      [String(row.filledReturned), cols.filledReturned],
      ...(cols.filledReceived > 0 ? [[String(row.filledReceived), cols.filledReceived] as [string, number]] : []),
      [String(row.sold), cols.sold],
      [String(row.emptyReceive), cols.emptyReceive],
      [this.rs(row.cashCollected), cols.cashCollected],
      [this.rs(row.expense), cols.expense],
      [this.rs(row.cashInHand), cols.cashInHand],
      [row.timeOutLabel, cols.timeOut],
      [row.timeInLabel, cols.timeIn],
    ];
    vals.forEach(([val, w]) => {
      doc.text(val, cx, y + 6, { width: w - 6, align: 'right', lineBreak: false });
      cx += w;
    });
    return y + rowH;
  }

  private drawTripSummary(doc: PDFKit.PDFDocument, stats: TripStats): void {
    // FILLED RECV column only appears when a trip actually took filled bottles
    // back from a customer this day — otherwise it's dropped and its width is
    // folded into the other columns (see getTripCols).
    const showFilledRecv =
      stats.totals.filledReceived !== 0 || stats.perTrip.some((t) => t.filledReceived !== 0);
    const cols = getTripCols(showFilledRecv);

    const TOP_PAD = 6;
    const HEADER_H = 22;
    const LABEL_H = 16;
    const ROW_H = 20;
    const GAP = 6;
    const BOTTOM_PAD = 10;
    // Precise sum of every increment the drawing loop below actually uses,
    // so the card is never taller/shorter than its real content.
    const cardH = TOP_PAD + HEADER_H + stats.perTrip.length * (LABEL_H + ROW_H + GAP) + LABEL_H + ROW_H + BOTTOM_PAD;

    // Trip counts are always small (1-4 per day) — a single card comfortably
    // fits one page in every realistic case, so this just starts a fresh
    // page for the whole section rather than a full multi-card paginator.
    if (doc.y + cardH > PAGE_H - FOOTER_ZONE) {
      doc.addPage();
      doc.y = 50;
    }

    const cardY = doc.y;
    this.shadowCard(doc, MARGIN, cardY, CONTENT_W, cardH);
    drawClippedWatermark(doc, ICON_PATH, MARGIN, cardY, CONTENT_W, cardH);

    let y = cardY + TOP_PAD;
    y = this.drawTripHeaderRow(doc, MARGIN, y, CONTENT_W, cols);

    stats.perTrip.forEach((t) => {
      doc.fillColor(C.mutedLt).font('Helvetica-Bold').fontSize(6.5)
        .text(`TRIP ${t.load.tripNumber}`, MARGIN + 10, y + 4, { characterSpacing: 0.4, lineBreak: false });
      y += LABEL_H;
      y = this.drawTripDataRow(doc, MARGIN, y, {
        filledOut: t.filledOut, filledReturned: t.filledReturned, filledReceived: t.filledReceived,
        sold: t.sold, emptyReceive: t.emptyReceive, cashCollected: t.cashCollected, expense: t.expense,
        cashInHand: t.cashInHand,
        timeOutLabel: this.fmtTripTime(t.timeOut, '—'),
        timeInLabel: this.fmtTripTime(t.timeIn, '(open)'),
      }, undefined, cols);
      y += GAP;
    });

    // TOTAL row — border-top line + bold text, no fill (matches
    // CustomerStatementPdfService's own TOTAL row exactly).
    doc.moveTo(MARGIN + 10, y).lineTo(MARGIN + CONTENT_W - 10, y).strokeColor(C.navyText).lineWidth(1).stroke();
    doc.fillColor(C.mutedLt).font('Helvetica-Bold').fontSize(6.5)
      .text('TOTAL', MARGIN + 10, y + 4, { characterSpacing: 0.4, lineBreak: false });
    y += LABEL_H;
    y = this.drawTripDataRow(doc, MARGIN, y, {
      filledOut: stats.totals.filledOut, filledReturned: stats.totals.filledReturned,
      filledReceived: stats.totals.filledReceived, sold: stats.totals.sold,
      emptyReceive: stats.totals.emptyReceive, cashCollected: stats.totals.cashCollected,
      expense: stats.totals.expense, cashInHand: stats.totals.cashInHand,
      timeOutLabel: this.fmtTripTime(stats.totals.startingTime, '—'),
      timeInLabel: this.fmtTripTime(stats.totals.closingTime, 'In Progress'),
    }, { bold: true }, cols);

    doc.y = cardY + cardH;
  }

  // ─── Delivery items table — card-table styling matched exactly to
  // CustomerStatementPdfService.drawDeliveryTableHeader/drawDeliveryLine: an
  // un-filled header (muted labels + border line, no navy bar), uniform
  // 22pt rows, and a border-top TOTAL row (no fill). ────────────────────────
  private drawDeliveryTableHeader(doc: PDFKit.PDFDocument, x: number, y: number, w: number, cols: DeliveryCols): void {
    const rowH = 22;
    doc.moveTo(x + 10, y + rowH).lineTo(x + w - 10, y + rowH).strokeColor(C.border).lineWidth(0.75).stroke();
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.2);

    let cx = x;
    const hy = y + 8;
    doc.text('#', cx + 6, hy, { width: cols.seq - 4, lineBreak: false }); cx += cols.seq;
    doc.text('CODE', cx + 3, hy, { width: cols.code - 4, lineBreak: false }); cx += cols.code;
    doc.text('CUSTOMER', cx + 3, hy, { width: cols.customer - 4, characterSpacing: 0.2, lineBreak: false }); cx += cols.customer;
    doc.text('TIME', cx, hy, { width: cols.time - 4, align: 'right', lineBreak: false }); cx += cols.time;
    doc.text('DELIV', cx, hy, { width: cols.delivered - 4, align: 'right', lineBreak: false }); cx += cols.delivered;
    if (cols.filledRecv > 0) {
      doc.text('F.RCV', cx, hy, { width: cols.filledRecv - 4, align: 'right', lineBreak: false });
    }
    cx += cols.filledRecv;
    doc.text('E.RCV', cx, hy, { width: cols.emptyRecv - 4, align: 'right', lineBreak: false }); cx += cols.emptyRecv;
    doc.text('BAL BTL', cx, hy, { width: cols.balBottles - 4, align: 'right', lineBreak: false }); cx += cols.balBottles;
    if (cols.billAmount > 0) {
      doc.text('BILL', cx, hy, { width: cols.billAmount - 4, align: 'right', lineBreak: false });
    }
    cx += cols.billAmount;
    doc.text('CASH', cx, hy, { width: cols.cash - 4, align: 'right', lineBreak: false }); cx += cols.cash;
    doc.text('PAY', cx, hy, { width: cols.payMode - 4, align: 'center', lineBreak: false }); cx += cols.payMode;
    doc.text('BAL RS', cx, hy, { width: cols.balRs - 4, align: 'right', lineBreak: false }); cx += cols.balRs;
    doc.text('STATUS', cx, hy, { width: cols.status, align: 'center', characterSpacing: 0.2, lineBreak: false });
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

  private drawStatusPill(doc: PDFKit.PDFDocument, status: string, colX: number, rowY: number, rowH: number, cols: DeliveryCols): void {
    const meta = STATUS_META[status] ?? { label: status, bg: '#f1f5f9', text: '#475569' };
    this.drawPill(doc, meta, colX, cols.status, rowY, rowH);
  }

  private drawDeliveryTableLine(
    doc: PDFKit.PDFDocument,
    line: { kind: 'item'; item: any } | { kind: 'total'; items: any[] } | { kind: 'average'; items: any[] },
    x: number,
    y: number,
    index: number,
    cols: DeliveryCols,
  ): void {
    const rowH = 22;

    if (line.kind === 'total') {
      const items = line.items;
      const totalDelivered = items.reduce((s, i) => s + (i.filledDropped ?? 0), 0);
      const totalFilledRecv = items.reduce((s, i) => s + (i.filledReceived ?? 0), 0);
      const totalEmptyRecv = items.reduce((s, i) => s + (i.emptyReceived ?? 0), 0);
      const totalBillAmount = items.reduce((s, i) => s + (i.filledDropped ?? 0) * (i.pricePerBottle ?? 0), 0);
      const totalCash = items.reduce((s, i) => s + (i.cashCollected ?? 0), 0);
      // Same bottleBalanceAfter → live-wallet fallback as each row (see
      // drawDeliveryTableLine's item branch) so the sum lines up with what's
      // actually printed per stop, not just the delivered ones.
      const totalBalBottles = items.reduce((s, i) => {
        const matchedWallet = i.customer?.wallets?.find((w: any) => w.productId === i.productId) ?? i.customer?.wallets?.[0];
        return s + (i.bottleBalanceAfter ?? matchedWallet?.balance ?? 0);
      }, 0);
      const doneCount = items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY').length;
      const editedCount = items.filter((i) => (i.editCount ?? 0) > 0).length;

      // Border-top line + bold text, no fill — matches CustomerStatementPdfService's TOTAL row exactly.
      doc.moveTo(x + 10, y).lineTo(x + CONTENT_W - 10, y).strokeColor(C.navyText).lineWidth(1).stroke();
      const ty = y + 7;
      let cx = x;
      doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
        .text('TOTAL', cx + 6, ty, { width: cols.seq + cols.code + cols.customer + cols.time - 6, lineBreak: false });
      cx += cols.seq + cols.code + cols.customer + cols.time;
      doc.text(String(totalDelivered), cx, ty, { width: cols.delivered - 4, align: 'right', lineBreak: false });
      cx += cols.delivered;
      if (cols.filledRecv > 0) {
        doc.text(String(totalFilledRecv), cx, ty, { width: cols.filledRecv - 4, align: 'right', lineBreak: false });
      }
      cx += cols.filledRecv;
      doc.text(String(totalEmptyRecv), cx, ty, { width: cols.emptyRecv - 4, align: 'right', lineBreak: false });
      cx += cols.emptyRecv;
      doc.text(String(totalBalBottles), cx, ty, { width: cols.balBottles - 4, align: 'right', lineBreak: false });
      cx += cols.balBottles;
      if (cols.billAmount > 0) {
        doc.text(this.rs(totalBillAmount), cx, ty, { width: cols.billAmount - 4, align: 'right', lineBreak: false });
      }
      cx += cols.billAmount;
      doc.text(this.rs(totalCash), cx, ty, { width: cols.cash - 4, align: 'right', lineBreak: false });
      cx += cols.cash + cols.payMode + cols.balRs;
      doc.fontSize(6.3).text(`${doneCount}/${items.length} done · ${editedCount} edited`, cx, ty + 1, { width: cols.status, align: 'center', lineBreak: false });
      return;
    }

    if (line.kind === 'average') {
      // Weighted average selling price per bottle — NOT a per-stop average.
      // Different customers can be on different rates (e.g. 220/200/190 per
      // bottle); a plain average-of-rates would misrepresent the day's true
      // per-bottle realization when stops carry different quantities. So this
      // is sum(pricePerBottle * bottlesDelivered) / sum(bottlesDelivered) —
      // i.e. total bottle revenue divided by total bottles actually
      // delivered, across every stop. Muted/italic styling (thin border, no
      // fill) so it reads as a secondary stat directly under the bold TOTAL
      // row, not a second total.
      const items = line.items;
      const totalBottles = items.reduce((s, i) => s + (i.filledDropped ?? 0), 0);
      const totalBottleRevenue = items.reduce((s, i) => s + (i.filledDropped ?? 0) * (i.pricePerBottle ?? 0), 0);
      const avgPricePerBottle = totalBottles > 0 ? totalBottleRevenue / totalBottles : 0;

      doc.moveTo(x + 10, y).lineTo(x + CONTENT_W - 10, y).strokeColor(C.border).lineWidth(0.5).stroke();
      const ty = y + 7;
      let cx = x;
      doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(6.8)
        .text('AVG PRICE / BOTTLE', cx + 6, ty, { width: cols.seq + cols.code + cols.customer + cols.time - 6, lineBreak: false });
      cx += cols.seq + cols.code + cols.customer + cols.time + cols.delivered + cols.filledRecv + cols.emptyRecv + cols.balBottles + cols.billAmount;
      doc.fillColor(C.textSoft).font('Helvetica-Bold').fontSize(7)
        .text(totalBottles > 0 ? `Rs ${avgPricePerBottle.toFixed(2)}` : '—', cx, ty, { width: cols.cash - 4, align: 'right', lineBreak: false });
      return;
    }

    const { item } = line;
    if (index % 2 === 1) doc.rect(x + 1, y, CONTENT_W - 2, rowH).fill(C.surface);

    // Edited delivery — flagged with a colored left-edge accent bar on the
    // whole row (same accent-bar language as drawSectionTitle/drawTitleRow)
    // instead of a dedicated tag column, so the STATUS cell keeps its full
    // width on every other row instead of reserving empty space for this.
    const isEdited = (item.editCount ?? 0) > 0;
    if (isEdited) {
      doc.roundedRect(x + 1, y + 2, 3, rowH - 4, 1.5).fill(EDITED_META.text);
    }

    const reason: string | null = item.reason || null;
    const textY = reason ? y + 3 : y + 6;
    let cx = x;

    doc.fillColor(C.textSoft).fontSize(6.5).font('Helvetica')
      .text(String(item.sequence ?? index + 1), cx + 6, textY, { lineBreak: false });
    cx += cols.seq;

    doc.fillColor(C.mutedLt).fontSize(6)
      .text(item.customer?.customerCode ?? '—', cx + 3, textY + 1, { width: cols.code - 4, lineBreak: false });
    cx += cols.code;

    doc.fillColor(C.navyText).fontSize(6.8).font('Helvetica-Bold')
      .text(item.customer?.name ?? '—', cx + 3, textY, { width: cols.customer - 6, height: 9, ellipsis: true, lineBreak: false });
    if (reason) {
      // Compact secondary line, same row height — no more separate taller
      // reason-row (card-table pagination needs a uniform row height).
      doc.fillColor(C.mutedLt).fontSize(5.3).font('Helvetica-Oblique')
        .text(reason, cx + 3, textY + 10, { width: cols.customer - 6, height: 7, ellipsis: true, lineBreak: false });
    }
    cx += cols.customer;

    // Falls back to recordedAt so a failed visit (NOT_AVAILABLE / RESCHEDULED —
    // no deliveredAt) still prints the time it was recorded, matching the
    // recordedAt-based row order.
    const rowTime = item.deliveredAt ?? item.recordedAt;
    doc.fillColor(C.muted).fontSize(6.3).font('Helvetica')
      .text(rowTime ? this.hm(rowTime) : '—', cx, textY, { width: cols.time - 4, align: 'right', lineBreak: false });
    cx += cols.time;

    doc.fillColor(C.text).fontSize(6.8)
      .text(String(item.filledDropped ?? 0), cx, textY, { width: cols.delivered - 4, align: 'right', lineBreak: false });
    cx += cols.delivered;

    // Conditionally rendered — see getDeliveryCols: column only exists
    // (width > 0) when at least one item on the sheet has filledReceived > 0.
    if (cols.filledRecv > 0) {
      doc.text(String(item.filledReceived ?? 0), cx, textY, { width: cols.filledRecv - 4, align: 'right', lineBreak: false });
    }
    cx += cols.filledRecv;

    doc.text(String(item.emptyReceived ?? 0), cx, textY, { width: cols.emptyRecv - 4, align: 'right', lineBreak: false });
    cx += cols.emptyRecv;

    // Frozen post-delivery bottle-wallet snapshot — no live query needed.
    // Items with no recorded delivery (NOT_AVAILABLE etc.) never got a
    // snapshot written, so bottleBalanceAfter stays null — fall back to the
    // customer's current wallet balance for this item's product, defaulting
    // to 0 (never a bare dash — every row must show a number, regardless of
    // delivery status). Mirrors delivery-items-list.tsx's matchedWallet
    // fallback, which uses the same `?? 0` default.
    const matchedWallet = item.customer?.wallets?.find((w: any) => w.productId === item.productId) ?? item.customer?.wallets?.[0];
    const balBottles = item.bottleBalanceAfter ?? matchedWallet?.balance ?? 0;
    doc.fillColor(C.muted)
      .text(String(balBottles), cx, textY, { width: cols.balBottles - 4, align: 'right', lineBreak: false });
    cx += cols.balBottles;

    // Bill amount owed for today's delivery — filledDropped × pricePerBottle,
    // the exact same value/calculation delivery-record-form.tsx shows as
    // "Amount" above Cash Collected (no separate billing logic here).
    // Conditionally rendered — see getDeliveryCols: column only exists
    // (width > 0) when at least one item on the sheet has a bill amount > 0.
    if (cols.billAmount > 0) {
      const billAmount = (item.filledDropped ?? 0) * (item.pricePerBottle ?? 0);
      doc.fillColor(C.text).font('Helvetica-Bold')
        .text(this.rs(billAmount), cx, textY, { width: cols.billAmount - 4, align: 'right', lineBreak: false });
    }
    cx += cols.billAmount;

    doc.fillColor(C.navyText).font('Helvetica-Bold')
      .text(this.rs(item.cashCollected), cx, textY, { width: cols.cash - 4, align: 'right', lineBreak: false });
    cx += cols.cash;

    const isMonthly = item.customer?.paymentType === 'MONTHLY';
    doc.fillColor(isMonthly ? '#1d4ed8' : C.green).font('Helvetica-Bold').fontSize(6)
      .text(isMonthly ? 'MO' : 'CA', cx, textY, { width: cols.payMode - 2, align: 'center', lineBreak: false });
    cx += cols.payMode;

    // Same live-balance convention as delivery-items-list.tsx: MONTHLY shows
    // last month's remaining outstanding, CASH shows current wallet due.
    const balRs = isMonthly ? (item.customer?.previousMonthOutstanding ?? 0) : (item.customer?.financialBalance ?? 0);
    doc.fillColor(balRs > 0 ? C.red : C.green).font('Helvetica-Bold').fontSize(6.5)
      .text(this.rs(balRs), cx, textY, { width: cols.balRs - 4, align: 'right', lineBreak: false });
    cx += cols.balRs;

    // CONS% column removed (owner request) — see getDeliveryCols comment above.
    this.drawStatusPill(doc, item.status, cx, y + 1, rowH - 2, cols);
  }

  private drawDeliveryTable(doc: PDFKit.PDFDocument, items: any[]): void {
    const lines: Array<{ kind: 'item'; item: any } | { kind: 'total'; items: any[] } | { kind: 'average'; items: any[] }> =
      items.map((item) => ({ kind: 'item' as const, item }));
    lines.push({ kind: 'total', items });
    if (items.length > 0) lines.push({ kind: 'average', items });

    // Whole-sheet decision, not per-row: the F.RCV and BILL columns only earn
    // their place when at least one delivery on the sheet actually has a
    // non-zero value — otherwise it's an empty column on every row.
    const showFilledRecv = items.some((i) => (i.filledReceived ?? 0) > 0);
    const showBillAmount = items.some((i) => (i.filledDropped ?? 0) * (i.pricePerBottle ?? 0) > 0);
    const cols = getDeliveryCols(showFilledRecv, showBillAmount);

    this.drawCardTable(
      doc,
      lines,
      22,
      22,
      (x, y, w) => this.drawDeliveryTableHeader(doc, x, y, w, cols),
      (line, x, y, index) => this.drawDeliveryTableLine(doc, line, x, y, index, cols),
      { watermark: true },
    );

    if (!items.length) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
        .text('No delivery items found.', MARGIN, doc.y + 8, { width: CONTENT_W, align: 'center' });
      doc.y += 24;
    }
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
