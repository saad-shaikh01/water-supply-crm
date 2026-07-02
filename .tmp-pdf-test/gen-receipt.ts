import 'reflect-metadata';
import * as fs from 'fs';
import { DeliveryReceiptPdfService } from '../apps/api-backend/src/app/modules/whatsapp/delivery-receipt-pdf.service';

async function main() {
  const svc = new DeliveryReceiptPdfService();

  const buffer = await svc.generate({
    customerName: 'SentraCore Systems Kashif',
    productName: 'Blue Ice 19L',
    filledDropped: 5,
    emptyReceived: 4,
    cashCollected: 500,
    pricePerBottle: 140,
    financialBalanceAfter: -200,
    bottleBalanceAfter: 16,
    deliveryDate: '02-Jul-2026',
    deliveryTime: '02:15 PM',
    vendorName: 'DASANI ENTERPRISES',
  });

  fs.writeFileSync(__dirname + '/receipt-test.pdf', buffer);
  console.log('written', buffer.length, 'bytes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
