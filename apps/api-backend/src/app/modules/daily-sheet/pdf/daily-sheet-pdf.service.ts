import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');

// Status display labels
const STATUS_LABEL: Record<string, string> = {
  DELIVERED: 'Delivered',
  PENDING: 'Pending',
  CANCELLED: 'Cancelled',
  RESCHEDULED: 'Rescheduled',
  NOT_AVAILABLE: 'Not Available',
};

const STATUS_COLOR: Record<string, string> = {
  DELIVERED: '#16a34a',
  PENDING: '#d97706',
  CANCELLED: '#dc2626',
  RESCHEDULED: '#2563eb',
  NOT_AVAILABLE: '#6b7280',
};

@Injectable()
export class DailySheetPdfService {
  /**
   * Generates a PDF buffer for a daily sheet.
   * @param sheet - Full sheet object from dailySheet.service.findOne()
   * @returns Buffer — pipe directly to response
   */
  async generate(sheet: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawDocument(doc, sheet);
      doc.end();
    });
  }

  private drawDocument(doc: PDFKit.PDFDocument, sheet: any): void {
    const pageWidth = doc.page.width - 80; // content width (margins = 40 each)
    const date = new Date(sheet.date).toLocaleDateString('en-PK', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // ─── Header ────────────────────────────────────────────────────────────────
    doc.rect(40, 40, pageWidth, 70).fill('#0ea5e9');

    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
      .text('💧 Water Supply CRM', 55, 52);

    doc.fontSize(11).font('Helvetica')
      .text('Daily Delivery Sheet', 55, 76);

    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
      .text(`Status: ${sheet.isClosed ? 'CLOSED' : 'OPEN'}`, pageWidth - 60, 55, { align: 'right', width: 100 });

    doc.moveDown(0.5);

    // ─── Sheet Info ─────────────────────────────────────────────────────────────
    doc.y = 125;
    this.drawSectionTitle(doc, 'Sheet Information');

    const infoY = doc.y + 4;
    const col1 = 40;
    const col2 = 300;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151');
    doc.text('Date:', col1, infoY);
    doc.text('Driver:', col1, infoY + 18);
    doc.text('Van:', col1, infoY + 36);
    doc.text('Route:', col1, infoY + 54);

    doc.font('Helvetica').fillColor('#1f2937');
    doc.text(date, col1 + 80, infoY);
    doc.text(sheet.driver?.name ?? '—', col1 + 80, infoY + 18);
    doc.text(sheet.van?.plateNumber ?? '—', col1 + 80, infoY + 36);
    doc.text(sheet.route?.name ?? '—', col1 + 80, infoY + 54);

    // Right column
    doc.font('Helvetica-Bold').fillColor('#374151');
    doc.text('Sheet ID:', col2, infoY);
    doc.text('Driver Phone:', col2, infoY + 18);
    doc.text('Total Stops:', col2, infoY + 36);
    doc.text('Generated:', col2, infoY + 54);

    doc.font('Helvetica').fillColor('#1f2937');
    doc.text(sheet.id.slice(0, 8).toUpperCase(), col2 + 90, infoY);
    doc.text(sheet.driver?.phoneNumber ?? '—', col2 + 90, infoY + 18);
    doc.text(String(sheet.items?.length ?? 0), col2 + 90, infoY + 36);
    doc.text(new Date(sheet.createdAt).toLocaleDateString('en-PK'), col2 + 90, infoY + 54);

    doc.y = infoY + 80;

    // ─── Reconciliation Summary ─────────────────────────────────────────────────
    this.drawSectionTitle(doc, 'Bottle & Cash Summary');

    const summaryY = doc.y + 4;
    const boxW = (pageWidth - 12) / 4;

    const summaryBoxes = [
      { label: 'Filled Out', value: sheet.filledOutCount, color: '#dbeafe', textColor: '#1d4ed8' },
      { label: 'Filled Returned', value: sheet.filledInCount, color: '#dcfce7', textColor: '#15803d' },
      { label: 'Empty Received', value: sheet.emptyInCount, color: '#fef9c3', textColor: '#a16207' },
      { label: 'Cash Collected', value: `Rs. ${(sheet.cashCollected ?? 0).toFixed(0)}`, color: '#f0fdf4', textColor: '#166534' },
    ];

    summaryBoxes.forEach((box, i) => {
      const x = 40 + i * (boxW + 4);
      doc.rect(x, summaryY, boxW, 52).fill(box.color);
      doc.fillColor(box.textColor).fontSize(9).font('Helvetica-Bold')
        .text(box.label, x + 6, summaryY + 8, { width: boxW - 12, align: 'center' });
      doc.fontSize(16).font('Helvetica-Bold')
        .text(String(box.value), x + 6, summaryY + 24, { width: boxW - 12, align: 'center' });
    });

    // Discrepancy row
    const delivered = sheet.items?.filter((i: any) => i.status === 'DELIVERED').length ?? 0;
    const bottleDiscrepancy = sheet.filledOutCount - (sheet.filledInCount + sheet.emptyInCount) - delivered;
    const cashDiscrepancy = (sheet.cashCollected ?? 0) - (sheet.cashExpected ?? 0);

    doc.y = summaryY + 60;

    if (sheet.isClosed) {
      const discColor = (bottleDiscrepancy !== 0 || cashDiscrepancy !== 0) ? '#fef2f2' : '#f0fdf4';
      doc.rect(40, doc.y, pageWidth, 28).fill(discColor);
      doc.fillColor('#374151').fontSize(9).font('Helvetica-Bold')
        .text(`Bottle Discrepancy: ${bottleDiscrepancy > 0 ? '+' : ''}${bottleDiscrepancy}`, 50, doc.y + 8);
      doc.text(
        `Cash Discrepancy: Rs. ${cashDiscrepancy >= 0 ? '+' : ''}${cashDiscrepancy.toFixed(2)}`,
        280, doc.y + 8,
      );
      doc.moveDown(0.8);
    }

    doc.moveDown(0.5);

    // ─── Delivery Items Table ───────────────────────────────────────────────────
    this.drawSectionTitle(doc, `Delivery Items (${sheet.items?.length ?? 0} stops)`);
    this.drawDeliveryTable(doc, sheet.items ?? [], pageWidth);

    // ─── Footer ─────────────────────────────────────────────────────────────────
    const pageBottom = doc.page.height - 40;
    doc.fontSize(8).fillColor('#9ca3af').font('Helvetica')
      .text(
        `Generated by Water Supply CRM • ${new Date().toLocaleString('en-PK')} • Sheet ${sheet.id}`,
        40,
        pageBottom - 15,
        { width: pageWidth, align: 'center' },
      );
  }

  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    doc.rect(40, doc.y, doc.page.width - 80, 22).fill('#f1f5f9');
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold')
      .text(title, 48, doc.y + 5);
    doc.moveDown(1.4);
  }

  private drawDeliveryTable(
    doc: PDFKit.PDFDocument,
    items: any[],
    pageWidth: number,
  ): void {
    // Column widths
    const cols = {
      seq: 28,
      customer: 140,
      product: 90,
      filled: 46,
      empty: 46,
      cash: 60,
      status: 76,
    };

    const headerY = doc.y;

    // Header row
    doc.rect(40, headerY, pageWidth, 20).fill('#0f172a');
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');

    let x = 40;
    doc.text('#', x + 2, headerY + 5, { width: cols.seq }); x += cols.seq;
    doc.text('Customer', x + 2, headerY + 5, { width: cols.customer }); x += cols.customer;
    doc.text('Product', x + 2, headerY + 5, { width: cols.product }); x += cols.product;
    doc.text('Filled', x + 2, headerY + 5, { width: cols.filled, align: 'center' }); x += cols.filled;
    doc.text('Empty', x + 2, headerY + 5, { width: cols.empty, align: 'center' }); x += cols.empty;
    doc.text('Cash', x + 2, headerY + 5, { width: cols.cash, align: 'right' }); x += cols.cash;
    doc.text('Status', x + 2, headerY + 5, { width: cols.status, align: 'center' });

    doc.y = headerY + 22;

    if (!items.length) {
      doc.fillColor('#6b7280').fontSize(9).font('Helvetica')
        .text('No delivery items found.', 40, doc.y + 8, { width: pageWidth, align: 'center' });
      return;
    }

    items.forEach((item, index) => {
      // Auto page break
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
        doc.y = 50;
      }

      const rowY = doc.y;
      const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      const rowH = 20;

      doc.rect(40, rowY, pageWidth, rowH).fill(rowBg);

      doc.fillColor('#1f2937').fontSize(8).font('Helvetica');
      x = 40;

      doc.text(String(item.sequence ?? index + 1), x + 2, rowY + 5, { width: cols.seq }); x += cols.seq;
      doc.text(item.customer?.name ?? '—', x + 2, rowY + 5, { width: cols.customer - 4 }); x += cols.customer;
      doc.text(item.product?.name ?? '—', x + 2, rowY + 5, { width: cols.product - 4 }); x += cols.product;
      doc.text(String(item.filledDropped ?? 0), x + 2, rowY + 5, { width: cols.filled, align: 'center' }); x += cols.filled;
      doc.text(String(item.emptyReceived ?? 0), x + 2, rowY + 5, { width: cols.empty, align: 'center' }); x += cols.empty;
      doc.text(`Rs.${(item.cashCollected ?? 0).toFixed(0)}`, x + 2, rowY + 5, { width: cols.cash, align: 'right' }); x += cols.cash;

      // Status badge
      const statusColor = STATUS_COLOR[item.status] ?? '#6b7280';
      const statusLabel = STATUS_LABEL[item.status] ?? item.status;
      doc.fillColor(statusColor).fontSize(7).font('Helvetica-Bold')
        .text(statusLabel, x + 2, rowY + 6, { width: cols.status, align: 'center' });

      doc.y = rowY + rowH;
    });

    // Totals row
    const totalsY = doc.y + 2;
    const totalFilled = items.reduce((s, i) => s + (i.filledDropped ?? 0), 0);
    const totalEmpty = items.reduce((s, i) => s + (i.emptyReceived ?? 0), 0);
    const totalCash = items.reduce((s, i) => s + (i.cashCollected ?? 0), 0);
    const deliveredCount = items.filter((i) => i.status === 'DELIVERED').length;

    doc.rect(40, totalsY, pageWidth, 22).fill('#0f172a');

    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    x = 40;
    doc.text('TOTALS', x + 2, totalsY + 6, { width: cols.seq + cols.customer + cols.product - 4 }); x += cols.seq + cols.customer + cols.product;
    doc.text(String(totalFilled), x + 2, totalsY + 6, { width: cols.filled, align: 'center' }); x += cols.filled;
    doc.text(String(totalEmpty), x + 2, totalsY + 6, { width: cols.empty, align: 'center' }); x += cols.empty;
    doc.text(`Rs.${totalCash.toFixed(0)}`, x + 2, totalsY + 6, { width: cols.cash, align: 'right' }); x += cols.cash;
    doc.text(`${deliveredCount}/${items.length} done`, x + 2, totalsY + 6, { width: cols.status, align: 'center' });

    doc.y = totalsY + 28;
  }
}
