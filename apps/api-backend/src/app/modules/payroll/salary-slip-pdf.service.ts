import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatRupees, type SalarySlipData } from './payroll-slip.util';

const C = {
  navy: '#0f172a',
  text: '#1e293b',
  muted: '#6b7280',
  border: '#e5e7eb',
  surface: '#f8fafc',
  green: '#059669',
  red: '#dc2626',
  cyan: '#0891b2',
};

const MARGIN = 48;

/** `2026-09-01` style day for the PDF (UTC calendar day — period dates are stored as UTC midnights). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function signedRupees(amount: number): string {
  return `${amount < 0 ? '-' : ''}Rs. ${formatRupees(Math.abs(amount))}`;
}

/** One employee's salary slip as a single-page PDF. Contains ONLY that employee's own figures. */
@Injectable()
export class SalarySlipPdfService {
  generate(slip: SalarySlipData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const width = doc.page.width - MARGIN * 2;
      const right = MARGIN + width;

      // Header
      doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(18).text(slip.vendorName, MARGIN, MARGIN);
      doc.fillColor(C.cyan).fontSize(13).text('SALARY SLIP', MARGIN, MARGIN + 2, { width, align: 'right' });
      doc.moveDown(0.3);
      doc.strokeColor(C.border).moveTo(MARGIN, doc.y + 4).lineTo(right, doc.y + 4).stroke();
      doc.moveDown(1);

      // Employee block
      const infoY = doc.y;
      doc.fillColor(C.muted).font('Helvetica').fontSize(9).text('EMPLOYEE', MARGIN, infoY);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text(slip.employeeName, MARGIN, infoY + 12);
      doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(slip.role.replace(/_/g, ' '), MARGIN, infoY + 30);
      doc.fillColor(C.muted).fontSize(9).text('PERIOD', MARGIN, infoY, { width, align: 'right' });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text(slip.periodLabel, MARGIN, infoY + 12, { width, align: 'right' });
      doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(`${ymd(slip.periodStart)} to ${ymd(slip.periodEnd)}`, MARGIN, infoY + 30, { width, align: 'right' });
      doc.y = infoY + 56;

      // Money lines
      const headY = doc.y;
      doc.fillColor(C.surface).rect(MARGIN, headY, width, 22).fill();
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(9).text('DESCRIPTION', MARGIN + 8, headY + 7);
      doc.text('AMOUNT', MARGIN, headY + 7, { width: width - 8, align: 'right' });
      doc.y = headY + 30;
      for (const line of slip.lines) {
        const y = doc.y;
        doc.fillColor(C.text).font('Helvetica').fontSize(10).text(line.label, MARGIN + 8, y, { width: width * 0.62 });
        doc
          .fillColor(line.amount < 0 ? C.red : C.text)
          .text(signedRupees(line.amount), MARGIN, y, { width: width - 8, align: 'right' });
        if (line.note) {
          doc.fillColor(C.muted).fontSize(8).text(line.note, MARGIN + 8, doc.y + 1, { width: width * 0.8 });
        }
        doc.y += 5;
        doc.strokeColor(C.border).moveTo(MARGIN, doc.y).lineTo(right, doc.y).stroke();
        doc.y += 5;
      }

      // Final payable
      doc.y += 4;
      const boxY = doc.y;
      doc.fillColor(C.navy).rect(MARGIN, boxY, width, 34).fill();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('NET PAYABLE', MARGIN + 12, boxY + 11);
      doc.fontSize(14).text(`Rs. ${formatRupees(slip.finalPayable)}`, MARGIN, boxY + 9, { width: width - 12, align: 'right' });
      doc.y = boxY + 50;

      // Attendance + unpaid absence
      const a = slip.absence;
      doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11).text('Attendance & absences', MARGIN, doc.y);
      doc.moveDown(0.4);
      doc.fillColor(C.text).font('Helvetica').fontSize(10);
      const att = slip.attendance;
      doc.text(
        `Present: ${att.presentDays}   Absent: ${att.absentDays}   Half days: ${att.halfDays}   Leave: ${att.leaveDays}   (period: ${att.periodDayCount} days)`,
        MARGIN,
        doc.y,
        { width },
      );
      doc.moveDown(0.4);
      if (a.absentDays + a.halfDays === 0) {
        doc.fillColor(C.muted).text('No absent or half days in this period.', MARGIN, doc.y, { width });
      } else if (!a.decisionsApply) {
        doc.fillColor(C.muted).text(
          'Absent / half days are already reflected in your base pay (pay is calculated from attended days).',
          MARGIN,
          doc.y,
          { width },
        );
      } else {
        doc.fillColor(C.text).text(
          `Deducted for absence this month: ${a.deductedDays} day(s)  -  Rs. ${formatRupees(a.deductedAmount)}`,
          MARGIN,
          doc.y,
          { width },
        );
        if (a.deferredDays > 0) {
          doc.text(`Absence deduction charged next month: ${a.deferredDays} day(s)  -  Rs. ${formatRupees(a.deferredAmount)}`, MARGIN, doc.y, { width });
        }
        if (a.waivedDays > 0) doc.text(`Absent but paid (not deducted): ${a.waivedDays} day(s)`, MARGIN, doc.y, { width });
        if (a.pendingDays > 0) doc.fillColor(C.muted).text(`Still undecided: ${a.pendingDays} day(s)`, MARGIN, doc.y, { width });
      }

      // Footer
      doc
        .fillColor(C.muted)
        .font('Helvetica')
        .fontSize(8)
        .text(`System-generated on ${ymd(new Date())}. For any query please contact the office.`, MARGIN, doc.page.height - MARGIN - 20, {
          width,
          align: 'center',
        });

      doc.end();
    });
  }
}
