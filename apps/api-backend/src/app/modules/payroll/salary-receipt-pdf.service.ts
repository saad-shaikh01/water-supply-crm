import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { drawShadowShape, brandGradient, drawWatermark } from '../../common/pdf/pdf-theme.util';
import { C, LOGO_PATH } from '../whatsapp/delivery-receipt-pdf.service';
import { DocBranding, imageSource } from '../../common/pdf/doc-branding';
import { LEGACY_DOC_BRANDING } from '../../common/pdf/legacy-dasani-branding';
import { bannerColors, compactContactLines, drawLogoInChip } from '../../common/pdf/brand-draw';
import { formatRupees, isSlipEligibleStatus, type SalarySlipData } from './payroll-slip.util';

/**
 * Salary receipt PDF — the compact, one-page A5 sibling of the full salary slip, laid out exactly like the
 * delivery receipt (gradient banner + logo chip, accent-bar title, zebra detail card, navy total bar, thank-you
 * + contact footer). It carries the same summary the payroll entry dialog shows (base salary, each earning /
 * deduction group, paid leaves, final payable) plus a one-line attendance summary — no per-day tables, so it
 * always fits one page.
 */
const MARGIN = 36;
const PAGE_W = 419.53; // A5
const PAGE_H = 595.28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RADIUS = 10;
const BANNER_H = 66;
const ROW_H_MAX = 16;
const ROW_H_MIN = 12.5;
/** Everything on the page that is NOT a detail-card row: banner, title, gaps, card padding, net bar, footer. */
const FIXED_H = 250;

interface DetailRow {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
}

/** UTC calendar day `DD-Mon-YYYY` (period dates are stored as UTC midnights). */
function longDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function signedRupees(amount: number): string {
  return `${amount < 0 ? '-' : ''}Rs. ${formatRupees(Math.abs(amount))}`;
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

@Injectable()
export class SalaryReceiptPdfService {
  /** `branding` omitted = legacy Dasani/Blue Ice identity (see DocBranding). */
  generate(slip: SalarySlipData, branding: DocBranding = LEGACY_DOC_BRANDING): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        const employeeRows = this.employeeRows(slip);
        const moneyRows = this.moneyRows(slip);
        const attendanceRows = this.attendanceRows(slip);
        // Shrink the row height (never below a readable minimum) so even the longest slip stays on one page.
        const rowCount = employeeRows.length + moneyRows.length + attendanceRows.length;
        const rowH = Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, (PAGE_H - MARGIN * 2 - FIXED_H) / rowCount));

        drawWatermark(doc, imageSource(branding.logo, LOGO_PATH), PAGE_W, PAGE_H);
        this.drawBanner(doc, branding);

        doc.y += 10;
        this.drawSectionTitle(doc, 'SALARY RECEIPT');
        doc.y += 8;
        this.drawDetailCard(doc, employeeRows, rowH);

        doc.y += 8;
        this.drawDetailCard(doc, moneyRows, rowH);

        doc.y += 8;
        this.drawNetBar(doc, slip.finalPayable);

        doc.y += 8;
        this.drawDetailCard(doc, attendanceRows, rowH);

        doc.y += 10;
        this.drawFooter(doc, branding);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private employeeRows(slip: SalarySlipData): DetailRow[] {
    const rows: DetailRow[] = [
      { label: 'Employee', value: slip.employeeName },
      { label: 'Role', value: slip.role.replace(/_/g, ' ') },
      { label: 'Salary Period', value: `${slip.periodLabel}  ·  ${longDate(slip.periodStart)} to ${longDate(slip.periodEnd)}` },
    ];
    // A draft receipt must never be mistaken for a final one.
    if (!isSlipEligibleStatus(slip.status)) {
      rows.push({ label: 'Status', value: `${slip.status.replace(/_/g, ' ')} - NOT FINAL`, valueColor: C.red });
    }
    return rows;
  }

  /** Same lines as the slip (base salary first, deductions grouped), plus the paid-leave line the dialog shows. */
  private moneyRows(slip: SalarySlipData): DetailRow[] {
    const a = slip.absence;
    const rows: DetailRow[] = slip.lines.map((l, i) => {
      // The absence group gets its day count, like "Total Unpaid Deduction (1 day)" in the payroll dialog.
      const label = l.label === 'Absence deductions' && a.deductedDays > 0 ? `${l.label} (${days(a.deductedDays)})` : l.label;
      return { label, value: signedRupees(l.amount), valueColor: l.amount < 0 ? C.red : undefined, emphasize: i === 0 };
    });
    if (a.decisionsApply && a.waivedDays > 0) {
      rows.push({ label: 'Paid Leaves', value: `${days(a.waivedDays)} - no deduction` });
    }
    return rows;
  }

  private attendanceRows(slip: SalarySlipData): DetailRow[] {
    const att = slip.attendance;
    const rows: DetailRow[] = [
      {
        label: `Attendance (${att.periodDayCount} days)`,
        value: `Present ${att.presentDays}  ·  Absent ${att.absentDays}  ·  Half ${att.halfDays}  ·  Leave ${att.leaveDays}`,
      },
    ];
    if (slip.absence.decisionsApply && slip.absence.pendingDays > 0) {
      rows.push({ label: 'Absences Not Yet Decided', value: days(slip.absence.pendingDays), valueColor: C.amber });
    }
    return rows;
  }

  // ── Brand banner: gradient card with logo chip (left) + vendor identity (right) ──
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

  private drawSectionTitle(doc: PDFKit.PDFDocument, label: string): void {
    const y = doc.y;
    doc.roundedRect(MARGIN, y, 3.5, 13, 2).fill(C.accent);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11).text(label, MARGIN + 10, y + 1, { lineBreak: false });
    doc.y = y + 13;
  }

  // ── Zebra-striped detail card ──
  private drawDetailCard(doc: PDFKit.PDFDocument, rows: DetailRow[], rowH: number): void {
    const y = doc.y;
    const h = rows.length * rowH + 8;
    drawShadowShape(doc, MARGIN, y, CONTENT_W, h, RADIUS, C.white, { shadowColor: C.navy, borderColor: C.border });

    rows.forEach((row, i) => {
      const ry = y + 4 + i * rowH;
      if (i % 2 !== 0) doc.rect(MARGIN + 1, ry, CONTENT_W - 2, rowH).fill(C.surface);
      const ty = ry + (rowH - 8.5) / 2 - 0.5;
      doc.fillColor(row.emphasize ? C.navyText : C.muted).font(row.emphasize ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(row.label, MARGIN + 12, ty, { width: CONTENT_W * 0.5, lineBreak: false });
      doc.fillColor(row.valueColor ?? C.text).font('Helvetica-Bold').fontSize(8.5)
        .text(row.value, MARGIN, ty, { width: CONTENT_W - 12, align: 'right', lineBreak: false });
    });
    doc.y = y + h;
  }

  // ── Final payable bar (same box as the receipt's balance bar) ──
  private drawNetBar(doc: PDFKit.PDFDocument, amount: number): void {
    const y = doc.y;
    const color = amount < 0 ? C.closeRed : C.closeGrn;
    doc.roundedRect(MARGIN, y, CONTENT_W, 32, RADIUS).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9.5)
      .text('FINAL PAYABLE', MARGIN + 14, y + 11, { width: CONTENT_W * 0.5, lineBreak: false });
    doc.fillColor(color).font('Helvetica-Bold').fontSize(12)
      .text(signedRupees(amount), MARGIN, y + 9, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
    doc.y = y + 32;
  }

  // ── Thank-you + contact footer ──
  private drawFooter(doc: PDFKit.PDFDocument, branding: DocBranding): void {
    const y = doc.y;
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(9)
      .text('Thank you for your hard work with us!', MARGIN, y, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7)
      .text('For any query about this receipt, please contact the office.', MARGIN, y + 12, { width: CONTENT_W, align: 'center', lineBreak: false });

    const cy = y + 28;
    const pageLimit = PAGE_H - MARGIN;
    const contacts = compactContactLines(branding);
    let printed = 0;
    contacts.forEach((line, i) => {
      // An overflow would spawn a second page — drop trailing lines (tax numbers) rather than that.
      if (cy + i * 9 + 9 > pageLimit) return;
      doc.fillColor(line.bold ? C.navyText : C.muted).font(line.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
        .text(line.text, MARGIN, cy + i * 9, { width: CONTENT_W, align: 'right', lineBreak: false });
      printed = i + 1;
    });
    doc.y = cy + Math.max(0, printed - 1) * 9 + 9;
  }
}
