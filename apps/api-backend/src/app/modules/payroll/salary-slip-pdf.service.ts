import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import PDFDocument from 'pdfkit';
import { drawShadowShape, brandGradient, drawWatermark } from '../../common/pdf/pdf-theme.util';
import {
  C,
  COMPANY_ADDRESS,
  COMPANY_EMAIL,
  COMPANY_NAME,
  COMPANY_PHONES,
  COMPANY_WEBSITE,
  LOGO_PATH,
} from '../whatsapp/delivery-receipt-pdf.service';
import { formatRupees, isSlipEligibleStatus, type SalarySlipData } from './payroll-slip.util';

/**
 * Salary slip PDF — same look as the delivery receipt / customer statement (gradient brand banner with the
 * logo chip, accent-bar section titles, zebra detail cards, navy total bar, thank-you + contact footer), on
 * A4. Contains ONLY the one employee's own figures. Shared colours / company identity come from the receipt
 * PDF so a rebrand changes every document at once.
 */
const MARGIN = 40;
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RADIUS = 10;
const BANNER_H = 72;
// Sized so the WORST case (every optional line + notes + every absence row) still fits one A4 page.
const ROW_H = 17;
const NOTE_H = 10;

interface DetailRow {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
  /** Small explanatory line under the label. */
  note?: string;
}

/** UTC calendar day `DD-Mon-YYYY` (period dates are stored as UTC midnights). */
function longDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function signedRupees(amount: number): string {
  return `${amount < 0 ? '-' : ''}Rs. ${formatRupees(Math.abs(amount))}`;
}

@Injectable()
export class SalarySlipPdfService {
  generate(slip: SalarySlipData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        drawWatermark(doc, LOGO_PATH, PAGE_W, PAGE_H);
        this.drawBanner(doc);

        doc.y += 12;
        this.drawSectionTitle(doc, 'SALARY SLIP');
        doc.y += 8;
        this.drawDetailCard(doc, this.employeeRows(slip));

        doc.y += 14;
        this.drawSectionTitle(doc, 'EARNINGS & DEDUCTIONS');
        doc.y += 8;
        this.drawDetailCard(
          doc,
          slip.lines.map((l, i) => ({
            label: l.label,
            value: signedRupees(l.amount),
            valueColor: l.amount < 0 ? C.red : undefined,
            emphasize: i === 0,
            note: l.note,
          })),
        );

        doc.y += 8;
        this.drawNetBar(doc, slip.finalPayable);

        doc.y += 14;
        this.drawSectionTitle(doc, 'ATTENDANCE & ABSENCES');
        doc.y += 8;
        this.drawDetailCard(doc, this.attendanceRows(slip));

        doc.y += 16;
        this.drawFooter(doc);
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
      { label: 'Salary Period', value: slip.periodLabel },
      { label: 'Period Dates', value: `${longDate(slip.periodStart)}  to  ${longDate(slip.periodEnd)}` },
    ];
    // A downloaded draft must never be mistaken for a final slip.
    if (!isSlipEligibleStatus(slip.status)) {
      rows.push({ label: 'Status', value: `${slip.status.replace(/_/g, ' ')} - NOT FINAL`, valueColor: C.red });
    }
    return rows;
  }

  private attendanceRows(slip: SalarySlipData): DetailRow[] {
    const att = slip.attendance;
    const a = slip.absence;
    const rows: DetailRow[] = [
      {
        label: 'Attendance Summary',
        value: `Present ${att.presentDays}  ·  Absent ${att.absentDays}  ·  Half ${att.halfDays}  ·  Leave ${att.leaveDays}  (of ${att.periodDayCount} days)`,
      },
    ];
    if (a.absentDays + a.halfDays === 0) return rows;

    if (!a.decisionsApply) {
      rows.push({
        label: 'Absences',
        value: 'Included in base pay',
        note: 'Pay is calculated from attended days, so absences are already reflected.',
      });
      return rows;
    }
    rows.push({
      label: 'Deducted for Absence',
      value: `${a.deductedDays} day(s)  -  Rs. ${formatRupees(a.deductedAmount)}`,
      emphasize: true,
      valueColor: a.deductedDays > 0 ? C.red : undefined,
    });
    if (a.deferredDays > 0) {
      rows.push({ label: 'Charged Next Month', value: `${a.deferredDays} day(s)  -  Rs. ${formatRupees(a.deferredAmount)}` });
    }
    if (a.waivedDays > 0) rows.push({ label: 'Absent but Paid', value: `${a.waivedDays} day(s)` });
    if (a.pendingDays > 0) rows.push({ label: 'Not Yet Decided', value: `${a.pendingDays} day(s)` });
    return rows;
  }

  // ── Brand banner: gradient card with logo chip (left) + company identity (right) ──
  private drawBanner(doc: PDFKit.PDFDocument): void {
    const y = MARGIN;
    drawShadowShape(doc, MARGIN, y, CONTENT_W, BANNER_H, RADIUS, brandGradient(doc, MARGIN, y, CONTENT_W, BANNER_H), {
      shadowColor: C.navy,
      shadowOpacity: 0.13,
    });

    const chipW = 84;
    const chipH = 38;
    const chipX = MARGIN + 14;
    const chipY = y + (BANNER_H - chipH) / 2;
    doc.roundedRect(chipX, chipY, chipW, chipH, 8).fill(C.white);
    try {
      if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, chipX + 6, chipY + 8, { width: chipW - 12 });
    } catch {
      // logo missing/unreadable — the chip still reads fine as a blank white box
    }

    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(15)
      .text(COMPANY_NAME, MARGIN, y + 13, { width: CONTENT_W - 16, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(8.5)
      .text(COMPANY_ADDRESS, MARGIN, y + 33, { width: CONTENT_W - 16, align: 'right', lineBreak: false });
    doc.fillColor('#ffffff', 0.82).font('Helvetica').fontSize(8.5)
      .text(COMPANY_PHONES, MARGIN, y + 47, { width: CONTENT_W - 16, align: 'right', lineBreak: false });

    doc.y = y + BANNER_H + 3;
  }

  // ── Section heading: accent bar + label (same treatment as the receipt / statement) ──
  private drawSectionTitle(doc: PDFKit.PDFDocument, label: string): void {
    const y = doc.y;
    doc.roundedRect(MARGIN, y, 3.5, 14, 2).fill(C.accent);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11.5).text(label, MARGIN + 10, y + 1, { lineBreak: false });
    doc.y = y + 14;
  }

  // ── Zebra-striped detail card (rows with a note are taller) ──
  private drawDetailCard(doc: PDFKit.PDFDocument, rows: DetailRow[]): void {
    const y = doc.y;
    const heights = rows.map((r) => ROW_H + (r.note ? NOTE_H : 0));
    const h = heights.reduce((s, x) => s + x, 0) + 8;

    drawShadowShape(doc, MARGIN, y, CONTENT_W, h, RADIUS, C.white, { shadowColor: C.navy, borderColor: C.border });

    let ry = y + 4;
    rows.forEach((row, i) => {
      const rh = heights[i];
      if (i % 2 !== 0) doc.rect(MARGIN + 1, ry, CONTENT_W - 2, rh).fill(C.surface);
      if (row.emphasize && i > 0) {
        doc.moveTo(MARGIN + 10, ry).lineTo(MARGIN + CONTENT_W - 10, ry).strokeColor(C.border).lineWidth(0.75).stroke();
      }
      const ty = ry + 4.5;
      doc.fillColor(row.emphasize ? C.navyText : C.muted).font(row.emphasize ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
        .text(row.label, MARGIN + 14, ty, { width: CONTENT_W * 0.5, lineBreak: false });
      doc.fillColor(row.valueColor ?? C.text).font('Helvetica-Bold').fontSize(9.5)
        .text(row.value, MARGIN, ty, { width: CONTENT_W - 14, align: 'right', lineBreak: false });
      if (row.note) {
        doc.fillColor(C.mutedLt).font('Helvetica').fontSize(7)
          .text(row.note, MARGIN + 14, ty + 11, { width: CONTENT_W - 28, lineBreak: false });
      }
      ry += rh;
    });
    doc.y = y + h;
  }

  // ── Net payable bar (same box as the receipt's balance bar) ──
  private drawNetBar(doc: PDFKit.PDFDocument, amount: number): void {
    const y = doc.y;
    const color = amount < 0 ? C.closeRed : C.closeGrn;
    doc.roundedRect(MARGIN, y, CONTENT_W, 38, RADIUS).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11)
      .text('NET PAYABLE', MARGIN + 16, y + 13, { width: CONTENT_W * 0.5, lineBreak: false });
    doc.fillColor(color).font('Helvetica-Bold').fontSize(14)
      .text(signedRupees(amount), MARGIN, y + 11, { width: CONTENT_W - 16, align: 'right', lineBreak: false });
    doc.y = y + 38;
  }

  // ── Thank-you + contact footer (same design as the receipt / statement) ──
  private drawFooter(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(10)
      .text('Thank you for your hard work with us!', MARGIN, y, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
      .text('For any query about this slip, please contact the office.', MARGIN, y + 14, { width: CONTENT_W, align: 'center', lineBreak: false });

    const cy = y + 34;
    doc.fillColor(C.navyText).font('Helvetica-Bold').fontSize(7.5)
      .text(COMPANY_WEBSITE, MARGIN, cy, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
      .text(`${COMPANY_EMAIL}  ·  ${COMPANY_PHONES}`, MARGIN, cy + 10, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.y = cy + 20;
  }
}
