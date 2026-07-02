import 'reflect-metadata';
import * as fs from 'fs';
import { CustomerStatementPdfService } from '../apps/api-backend/src/app/modules/customer/pdf/customer-statement-pdf.service';

async function main() {
  const svc = new CustomerStatementPdfService();

  const customer = {
    name: 'Muhammad Abdullah Bin Sohail Khan Trading & General Stores',
    address: 'Shop No. 14-B, Ground Floor, Al-Rehman Plaza, Near Baitussalam Masjid, Gulistan-e-Johar Block 15, Karachi',
    phoneNumber: '+92 316 2677954 / +92 345 2364698',
    customerCode: 'L3491',
    paymentType: 'CASH',
  };

  const mkTx = (id: string, date: string, filledDropped: number, emptyReceived: number, price: number, dailySheetItemId: string, bottleBalanceAfter: number) => ({
    id,
    type: 'DELIVERY',
    createdAt: new Date(date),
    filledDropped,
    emptyReceived,
    amount: filledDropped * price,
    dailySheetItemId,
    dailySheetItem: { bottleBalanceAfter },
    product: { name: 'Blue Ice 19L' },
  });

  const transactions = [
    mkTx('tx-aaaaaa1086ff', '2026-06-06', 3, 3, 0, 'item1', 16),
    mkTx('tx-aaaaaa57fa36', '2026-06-13', 10, 10, 0, 'item2', 16),
    mkTx('tx-aaaaaa372f22', '2026-06-20', 9, 9, 0, 'item3', 16),
    mkTx('tx-aaaaaaeb20a3', '2026-06-30', 5, 5, 140, 'item4', 16),
  ];

  const openingBalance = 0;
  const periodActivity = transactions.reduce((s, t) => s + t.amount, 0);
  const closingBalance = openingBalance + periodActivity;

  const buffer = await svc.generate({
    customer,
    transactions,
    openingBalance,
    closingBalance,
    period: 'June 2026',
    month: '2026-06',
    ratePerBottle: 150, // simulates the customer's actual custom/base price, not a transaction average
  });

  fs.writeFileSync(__dirname + '/statement-test.pdf', buffer);
  console.log('written', buffer.length, 'bytes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
