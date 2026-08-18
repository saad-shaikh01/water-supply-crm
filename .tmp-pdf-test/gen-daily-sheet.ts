import 'reflect-metadata';
import * as fs from 'fs';
import { DailySheetPdfService } from '../apps/api-backend/src/app/modules/daily-sheet/pdf/daily-sheet-pdf.service';

// Standalone mock — no DB, no Nest DI, mirrors gen-receipt.ts / gen-statement.ts.
// Bypasses DailySheetService.findOne()/getConsumptionRatesForSheet()/
// getDiscrepancyCaseDetails() entirely and hand-builds the exact shape the
// controller assembles before calling pdfService.generate(sheet).

const d = (t: string) => new Date(`2026-08-18T${t}:00`);

const P1 = { id: 'prod-19l', name: 'Blue Ice 19L' };
const P2 = { id: 'prod-12l', name: 'Blue Ice 12L' };

// ── Customers (mix of MONTHLY/CASH, various balances/wallets) ──────────────
const customers: Record<string, any> = {
  c1: { id: 'c1', name: 'Ahmed Traders', customerCode: 'L3491', paymentType: 'MONTHLY', financialBalance: 2400, previousMonthOutstanding: 2400, wallets: [{ productId: P1.id, balance: 16 }] },
  c2: { id: 'c2', name: 'Zainab Fatima', customerCode: 'B0201', paymentType: 'CASH', financialBalance: 500, previousMonthOutstanding: 0, wallets: [{ productId: P1.id, balance: 5 }] },
  c3: { id: 'c3', name: 'Hunar Foundation Welfare Trust', customerCode: 'H0403', paymentType: 'MONTHLY', financialBalance: 0, previousMonthOutstanding: 0, wallets: [{ productId: P1.id, balance: 22 }] },
  c4: { id: 'c4', name: 'Bilal Khan', customerCode: 'B0202', paymentType: 'CASH', financialBalance: -200, previousMonthOutstanding: 0, wallets: [{ productId: P2.id, balance: 3 }] }, // credit balance
  c5: { id: 'c5', name: 'SentraCore Systems', customerCode: 'L3492', paymentType: 'MONTHLY', financialBalance: 6800, previousMonthOutstanding: 6800, wallets: [{ productId: P1.id, balance: 40 }] },
  c6: { id: 'c6', name: 'Ayesha General Store', customerCode: 'B0305', paymentType: 'CASH', financialBalance: 150, previousMonthOutstanding: 0, wallets: [{ productId: P1.id, balance: 8 }] },
};

// item9's product deliberately has NO matching wallet on c1 — exercises the
// "no wallet for this product" -> Bal Bottles '—' / Cons% N/A path.

const items = [
  mkItem(1, 'c1', P1, { status: 'COMPLETED', filledDropped: 5, filledReceived: 0, emptyReceived: 4, cashCollected: 700, bottleBalanceAfter: 16, deliveredAt: d('09:25') }),
  mkItem(2, 'c2', P1, { status: 'COMPLETED', filledDropped: 3, filledReceived: 0, emptyReceived: 3, cashCollected: 500, bottleBalanceAfter: 5, deliveredAt: d('10:10') }),
  mkItem(3, 'c3', P1, { status: 'NOT_AVAILABLE', filledDropped: 0, filledReceived: 0, emptyReceived: 0, cashCollected: 0, bottleBalanceAfter: 22, deliveredAt: d('11:45'), reason: 'Shop was closed, gate locked — retry next visit.', failureCategory: 'CUSTOMER_NOT_HOME' }),
  mkItem(4, 'c4', P2, { status: 'COMPLETED', filledDropped: 2, filledReceived: 1, emptyReceived: 2, cashCollected: 260, bottleBalanceAfter: 3, deliveredAt: d('12:50'), editCount: 1, lastEditedAt: d('13:05') }),
  mkItem(5, 'c5', P1, { status: 'COMPLETED', filledDropped: 12, filledReceived: 0, emptyReceived: 10, cashCollected: 1680, bottleBalanceAfter: 40, deliveredAt: d('14:20') }),
  mkItem(6, 'c6', P1, { status: 'EMPTY_ONLY', filledDropped: 0, filledReceived: 0, emptyReceived: 8, cashCollected: 0, bottleBalanceAfter: 8, deliveredAt: d('15:40'), editCount: 2, lastEditedAt: d('16:00') }),
  mkItem(7, 'c1', P1, { status: 'COMPLETED', filledDropped: 4, filledReceived: 0, emptyReceived: 4, cashCollected: 560, bottleBalanceAfter: 16, deliveredAt: d('16:55') }),
  // delivered AFTER trip 2's endedAt (17:50) — exercises the "nearest
  // preceding trip start" bucketing fallback (should still land in Trip 2).
  mkItem(8, 'c3', P1, { status: 'COMPLETED', filledDropped: 6, filledReceived: 0, emptyReceived: 5, cashCollected: 840, bottleBalanceAfter: 22, deliveredAt: d('18:30') }),
  // still PENDING — never delivered. Product P2 has no wallet entry on c1.
  mkItem(9, 'c1', P2, { status: 'PENDING', filledDropped: 0, filledReceived: 0, emptyReceived: 0, cashCollected: 0, bottleBalanceAfter: null, deliveredAt: null }),
];

function mkItem(seq: number, custKey: string, product: any, f: any) {
  return {
    id: `item${seq}`,
    sequence: seq,
    status: f.status,
    customerId: custKey,
    productId: product.id,
    customer: customers[custKey],
    product,
    filledDropped: f.filledDropped,
    filledReceived: f.filledReceived,
    emptyReceived: f.emptyReceived,
    cashCollected: f.cashCollected,
    bottleBalanceAfter: f.bottleBalanceAfter,
    financialBalanceAfter: 0,
    deliveredAt: f.deliveredAt,
    editCount: f.editCount ?? 0,
    lastEditedAt: f.lastEditedAt ?? null,
    reason: f.reason ?? null,
    failureCategory: f.failureCategory ?? null,
  };
}

// ── Trips — Trip 2 deliberately left open (endedAt: null) to exercise the
// "In Progress"/"(open)" rendering paths even on an otherwise-closed sheet. ──
const loads = [
  { id: 'trip1', tripNumber: 1, loadedFilled: 100, returnedFilled: 5, collectedEmpty: 85, cashHandedIn: 1000, product: P1, damagedOnVan: 1, leakedOnVan: 0, startedAt: d('09:15'), endedAt: d('13:20') },
  { id: 'trip2', tripNumber: 2, loadedFilled: 80, returnedFilled: 8, collectedEmpty: 60, cashHandedIn: 700, product: P1, damagedOnVan: 0, leakedOnVan: 1, startedAt: d('13:55'), endedAt: d('17:50') },
];

// ── Expenses — one logged right after Trip 1 closes, one logged AFTER Trip 2
// closes (tests the "expense entered as end-of-day paperwork" robustness
// fix — should still land inside Trip 2, not fall through unassigned). ──────
const expenses = [
  { id: 'exp1', category: 'FUEL_EXPENSE', amount: 400, paidFromCash: true, description: 'Fuel top-up before Trip 2', date: d('13:25'), createdAt: d('13:25'), van: { id: 'v1', plateNumber: 'KHI-1234' }, createdBy: { id: 'u1', name: 'Ali Raza' } },
  { id: 'exp2', category: 'LUNCH_EXPENSE_EMPLOYEE', amount: 250, paidFromCash: true, description: 'Crew lunch, end of day', date: d('18:10'), createdAt: d('18:10'), van: { id: 'v1', plateNumber: 'KHI-1234' }, createdBy: { id: 'u1', name: 'Ali Raza' } },
  { id: 'exp3', category: 'VEHICLE_MAINTENANCE', amount: 1200, paidFromCash: false, description: 'Tyre puncture repair (paid via company card)', date: d('12:00'), createdAt: d('12:00'), van: { id: 'v1', plateNumber: 'KHI-1234' }, createdBy: { id: 'u1', name: 'Ali Raza' } },
];

const crewCashDistributions = [
  { id: 'cc1', category: 'MEAL', amount: 300, notes: 'Lunch for driver + loader', employee: { id: 'u2', name: 'Waseem Akram' } },
  { id: 'cc2', category: 'OPERATIONAL_CASH', amount: 150, notes: 'Rickshaw fare for empty pickup', employee: { id: 'u3', name: 'Hamid Sheikh' } },
];

// ── Discrepancy Details — one resolved (charged to driver), one still pending. ──
const discrepancyCaseDetails = [
  {
    id: 'disc1', type: 'CASH', reportedQuantity: null, reportedAmount: 350,
    status: 'RESOLVED', resolutionType: 'CHARGED_TO_DRIVER', resolutionAmount: 350,
    resolutionNote: 'Driver confirmed shortage, deducted from next payroll.',
    resolvedBy: { id: 'u9', name: 'Sana Malik' }, resolvedAt: d('19:00'),
  },
  {
    id: 'disc2', type: 'BOTTLE', reportedQuantity: 3, reportedAmount: null,
    status: 'REPORTED', resolutionType: null, resolutionAmount: null, resolutionNote: null,
    resolvedBy: null, resolvedAt: null,
  },
];

// ── Consumption Ratio (per customerId:productId) — one pair intentionally
// omitted (c3:P1 for item8's pair is present but let's drop c5:P1 instead)
// to exercise the "not in map -> N/A" default in the PDF service itself. ────
const consumptionRates = [
  { customerId: 'c1', productId: P1.id, consumptionRate: '82%', rateStatus: 'ON_TARGET' },
  { customerId: 'c2', productId: P1.id, consumptionRate: '96%', rateStatus: 'ATTENTION' },
  { customerId: 'c3', productId: P1.id, consumptionRate: '134%', rateStatus: 'ACTION' },
  { customerId: 'c4', productId: P2.id, consumptionRate: 'N/A', rateStatus: null },
  { customerId: 'c6', productId: P1.id, consumptionRate: '78%', rateStatus: 'ON_TARGET' },
  // c5:P1 and c1:P2 deliberately omitted.
];

const sheet = {
  id: 'sheet-94c5c10d-198f-4d9b-ae09-e4a23710fc28',
  date: d('00:00'),
  isClosed: true,
  van: { id: 'v1', plateNumber: 'KHI-1234' },
  route: { id: 'r1', name: 'Gulshan Route A' },
  driver: { id: 'u1', name: 'Ali Raza', phoneNumber: '0316-2677954' },
  crew: [
    { role: 'SALESMAN', user: { id: 'u2', name: 'Waseem Akram' } },
    { role: 'LOADER', user: { id: 'u3', name: 'Hamid Sheikh' } },
    { role: 'LOADER', user: { id: 'u4', name: 'Ashfaq Ahmed' } },
  ],
  crewConfirmed: true,
  crewConfirmedBy: { id: 'u9', name: 'Sana Malik' },
  filledOutCount: 180,
  filledInCount: 13,
  emptyInCount: 145,
  cashExpected: 4500,
  cashCollected: 4540,
  loads,
  items,
  expenses,
  crewCashDistributions,
  consumptionRates,
  discrepancyCaseDetails,
};

async function main() {
  const svc = new DailySheetPdfService();
  const buffer = await svc.generate(sheet);
  fs.writeFileSync(__dirname + '/daily-sheet-test.pdf', buffer);
  console.log('written', buffer.length, 'bytes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
