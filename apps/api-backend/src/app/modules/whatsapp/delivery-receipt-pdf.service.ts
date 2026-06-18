import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface DeliveryReceiptData {
  customerName: string;
  productName: string;
  filledDropped: number;
  emptyReceived: number;
  cashCollected: number;
  pricePerBottle: number;
  financialBalanceAfter: number;
  bottleBalanceAfter: number;
  deliveryDate: string; // YYYY-MM-DD
  deliveryTime: string; // HH:MM
  vendorName: string;
}

@Injectable()
export class DeliveryReceiptPdfService {
  async generate(data: DeliveryReceiptData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 40 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - 80; // usable width

      // ── Header ──────────────────────────────────────────────────────────
      doc.fillColor('#1a56db').fontSize(18).font('Helvetica-Bold')
        .text(data.vendorName, 40, 40, { width: W, align: 'center' });

      doc.fillColor('#374151').fontSize(10).font('Helvetica')
        .text('Delivery Receipt', 40, doc.y + 4, { width: W, align: 'center' });

      // Divider
      const y1 = doc.y + 10;
      doc.moveTo(40, y1).lineTo(40 + W, y1).strokeColor('#1a56db').lineWidth(1.5).stroke();

      // ── Date / Time ──────────────────────────────────────────────────────
      doc.moveDown(0.6);
      this.row(doc, 40, W, 'Date', data.deliveryDate);
      this.row(doc, 40, W, 'Time', data.deliveryTime);

      // ── Customer ──────────────────────────────────────────────────────────
      doc.moveDown(0.4);
      this.sectionTitle(doc, 40, W, 'Customer');
      this.row(doc, 40, W, 'Name', data.customerName);

      // ── Delivery Details ──────────────────────────────────────────────────
      doc.moveDown(0.4);
      this.sectionTitle(doc, 40, W, 'Delivery Details');
      this.row(doc, 40, W, 'Product', data.productName);
      this.row(doc, 40, W, 'Bottles Delivered', `${data.filledDropped}`);
      this.row(doc, 40, W, 'Empty Received', `${data.emptyReceived}`);
      this.row(doc, 40, W, 'Price / Bottle', `Rs. ${data.pricePerBottle.toFixed(2)}`);

      const deliveryAmount = data.filledDropped * data.pricePerBottle;
      this.row(doc, 40, W, 'Delivery Amount', `Rs. ${deliveryAmount.toFixed(2)}`);

      // ── Payment ──────────────────────────────────────────────────────────
      doc.moveDown(0.4);
      this.sectionTitle(doc, 40, W, 'Payment');
      this.row(doc, 40, W, 'Cash Collected', `Rs. ${data.cashCollected.toFixed(2)}`);

      // Highlight outstanding balance
      const balanceColor = data.financialBalanceAfter < 0 ? '#dc2626' : '#16a34a';
      this.row(doc, 40, W, 'Outstanding Balance', `Rs. ${Math.abs(data.financialBalanceAfter).toFixed(2)}`, balanceColor);

      this.row(doc, 40, W, 'Bottle Balance', `${data.bottleBalanceAfter} bottles`);

      // ── Footer ──────────────────────────────────────────────────────────
      const y2 = doc.y + 16;
      doc.moveTo(40, y2).lineTo(40 + W, y2).strokeColor('#d1d5db').lineWidth(0.8).stroke();

      doc.fillColor('#6b7280').fontSize(8).font('Helvetica')
        .text(
          'Shukriya! Is receipt ke baray mein koi sawaal ho toh apne vendor se rabta karein.',
          40, y2 + 8,
          { width: W, align: 'center' },
        );

      doc.end();
    });
  }

  private sectionTitle(doc: PDFKit.PDFDocument, x: number, w: number, title: string) {
    doc.fillColor('#1a56db').fontSize(9).font('Helvetica-Bold')
      .text(title.toUpperCase(), x, doc.y, { width: w });
    doc.moveDown(0.15);
  }

  private row(
    doc: PDFKit.PDFDocument,
    x: number,
    w: number,
    label: string,
    value: string,
    valueColor = '#111827',
  ) {
    const y = doc.y;
    doc.fillColor('#6b7280').fontSize(9).font('Helvetica')
      .text(label, x, y, { width: w / 2 });
    doc.fillColor(valueColor).fontSize(9).font('Helvetica-Bold')
      .text(value, x + w / 2, y, { width: w / 2, align: 'right' });
    doc.moveDown(0.35);
  }
}
