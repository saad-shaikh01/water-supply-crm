/**
 * One-time historical data import for vendor "BLUE ICE".
 *
 * Reads two Excel-exported HTML files in the repo root:
 *   - Master_Data_complete.html  → customers (master record)
 *   - Tran_Data.html             → delivery/payment ledger (no header row)
 *
 * Builds: Vendor → Product → Vans + Drivers → Customers (+wallet, custom price,
 * delivery schedule, portal login) → DailySheets + DailySheetItems + Transactions.
 *
 * Idempotent: wipes everything under slug 'blue-ice' first, then re-imports.
 * Run:  node import-blue-ice.mjs            (real run)
 *       node import-blue-ice.mjs --dry      (parse + report only, no DB writes)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { PrismaClient, UserRole, PaymentType, TransactionType, DeliveryStatus, DeliveryType } from '@prisma/client';
import bcrypt from 'bcrypt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');

const VENDOR_NAME = 'BLUE ICE';
const VENDOR_SLUG = 'blue-ice';
const PRODUCT_NAME = '19 Ltr Bottle';
const PRODUCT_BASE_PRICE = 140;
const BCRYPT_ROUNDS = 10;
const BATCH = 1000;

// Vendors to fully wipe before import (old demo + any previous blue-ice run)
const WIPE_SLUGS = ['aquapure-karachi', VENDOR_SLUG];

// Login accounts — same style as prisma/seed.ts (admin + staff + drivers)
const SUPER_ADMIN = { email: 'super@watercrm.com', password: 'Super@123456', name: 'Platform Super Admin' };
const VENDOR_ADMIN = { email: 'admin@blueice.com', password: 'Admin@123456', name: 'BLUE ICE Admin' };
const STAFF = { email: 'staff@blueice.com', password: 'Staff@123456', name: 'BLUE ICE Staff' };
const DRIVER_PASS = 'Driver@123';
const CUSTOMER_DEFAULT_PASS = null; // null → password = each customer's own code

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

// ── HTML helpers ────────────────────────────────────────────────────────────
function dec(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
}
function strip(s) { return dec(s.replace(/<[^>]*>/g, '').trim()); }

// Tran date is M/D/YYYY
function parseTranDate(s) {
  const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(s);
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

// ── Parse Master_Data ───────────────────────────────────────────────────────
function parseMaster() {
  const raw = fs.readFileSync(path.join(__dirname, 'Master_Data_complete.html'), 'utf8');
  const headers = [...raw.matchAll(/<TH[^>]*>([\s\S]*?)<\/TH>/gi)].map((x) => strip(x[1]));
  const body = raw.split(/<TBODY>/i)[1];
  const rows = body.split(/<TR VALIGN=TOP>/i).slice(1)
    .map((b) => [...b.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((x) => strip(x[1])));
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // dayOfWeek 1..7
  return rows.filter((r) => r[idx.Cust_Code]).map((r) => {
    const g = (k) => (r[idx[k]] ?? '').trim();
    const addr = [g('House_No'), g('Address2'), g('Area'), g('Block')].filter(Boolean).join(', ');
    const schedule = [];
    days.forEach((d, i) => {
      const v = g(d);
      if (v && v !== '0') schedule.push({ dayOfWeek: i + 1, vanCode: v });
    });
    const bt = g('Billing_Type').toLowerCase();
    return {
      code: g('Cust_Code'),
      name: g('Name') || g('Cust_Code'),
      phone: g('Contact'),
      address: addr || g('Area') || '-',
      floor: g('Floor') || null,
      paymentType: bt === 'cash' ? PaymentType.CASH : PaymentType.MONTHLY, // Monthly + Billing → MONTHLY
      isActive: g('Cust_Status') === '0', // Cust_Status: 0 = ACTIVE, 1 = CLOSED
      rate: Number(g('Rate')) || 0,
      bottleBalance: Math.round(Number(g('Bottle_Balance')) || 0),
      outstanding: Number(g('Outstanding_Bal')) || 0,
      routeSeq: Number(g('Route_Seq')) || 0,
      schedule,
    };
  });
}

// ── Parse Tran_Data (no header) ─────────────────────────────────────────────
// cols: 0 code | 1 voucher | 2 date | 3 filled | 4 empty | 5 bottleBalAfter |
//       6 charge | 7 paid | 8 outstandingAfter | 9,10 skip | 11 desc | 12 blank
function parseTran() {
  const raw = fs.readFileSync(path.join(__dirname, 'Tran_Data.html'), 'utf8');
  const rows = raw.split(/<TR>/i).slice(1)
    .map((b) => [...b.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((x) => strip(x[1])))
    .filter((r) => r.length >= 9 && r[0]);
  return rows.map((r) => ({
    code: r[0],
    voucher: r[1],
    date: parseTranDate(r[2]),
    filled: Math.round(Number(r[3]) || 0),
    empty: Math.round(Number(r[4]) || 0),
    bottleBalAfter: Math.round(Number(r[5]) || 0),
    charge: Number(r[6]) || 0,
    paid: Number(r[7]) || 0,
    outstandingAfter: Number(r[8]) || 0,
    desc: r[11] || PRODUCT_NAME,
  })).filter((t) => t.date);
}

// Fully delete a vendor and ALL its data, in FK-safe order (children first).
async function wipeVendor(slug) {
  const v = await prisma.vendor.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!v) { console.log(`   (no vendor '${slug}' to wipe)`); return; }
  const w = { vendorId: v.id };
  const cw = { customer: { vendorId: v.id } };
  const dsw = { dailySheet: { vendorId: v.id } };
  const uw = { user: { vendorId: v.id } };

  await prisma.damageCaseAuditLog.deleteMany({ where: { damageCase: w } });
  await prisma.damageCase.deleteMany({ where: w });
  await prisma.deliveryIssue.deleteMany({ where: w });
  await prisma.deliveryItemNote.deleteMany({ where: w });
  await prisma.ticketMessage.deleteMany({ where: { ticket: w } });
  await prisma.customerTicket.deleteMany({ where: w });
  await prisma.customerOrder.deleteMany({ where: w });
  await prisma.paymentRequest.deleteMany({ where: w });
  await prisma.transaction.deleteMany({ where: w });
  await prisma.dailySheetItem.deleteMany({ where: dsw });
  await prisma.dailySheetLoad.deleteMany({ where: dsw });
  await prisma.expense.deleteMany({ where: w });
  await prisma.warehouseTransaction.deleteMany({ where: w });
  await prisma.repairBatch.deleteMany({ where: w });
  await prisma.warehouseStock.deleteMany({ where: w });
  await prisma.dailySheet.deleteMany({ where: w });
  await prisma.customerDeliverySchedule.deleteMany({ where: cw });
  await prisma.bottleWallet.deleteMany({ where: cw });
  await prisma.customerProductPrice.deleteMany({ where: cw });
  await prisma.customer.deleteMany({ where: w });
  await prisma.route.deleteMany({ where: w });
  await prisma.van.deleteMany({ where: w });
  await prisma.product.deleteMany({ where: w });
  await prisma.reminderScheduleConfig.deleteMany({ where: w });
  await prisma.reminderSendLog.deleteMany({ where: w });
  await prisma.driverLastLocation.deleteMany({ where: w });
  await prisma.inAppNotification.deleteMany({ where: uw });
  await prisma.notificationPreference.deleteMany({ where: uw });
  await prisma.fcmToken.deleteMany({ where: uw });
  await prisma.user.deleteMany({ where: w });
  await prisma.vendor.delete({ where: { id: v.id } });
  console.log(`   ✅ wiped vendor '${slug}' (${v.name})`);
}

async function wipeAll() {
  console.log('--- Wiping vendors ---');
  for (const slug of WIPE_SLUGS) await wipeVendor(slug);
  console.log('');
}

async function chunkCreate(model, data) {
  for (let i = 0; i < data.length; i += BATCH) {
    await prisma[model].createMany({ data: data.slice(i, i + BATCH), skipDuplicates: true });
    process.stdout.write(`\r   ${model}: ${Math.min(i + BATCH, data.length)}/${data.length}`);
  }
  if (data.length) process.stdout.write('\n');
}

async function main() {
  console.log(`\n🧊 BLUE ICE import ${DRY ? '(DRY RUN)' : ''}\n`);

  const customers = parseMaster();
  const trans = parseTran();
  console.log(`Parsed: ${customers.length} customers, ${trans.length} transactions`);

  // distinct van codes from schedules
  const vanCodes = [...new Set(customers.flatMap((c) => c.schedule.map((s) => s.vanCode)))].sort();
  console.log(`Van codes: ${vanCodes.join(', ') || '(none)'}`);

  // data-quality: which logins we can create (phone present + globally unique here)
  const phoneCount = {};
  for (const c of customers) if (c.phone) phoneCount[c.phone] = (phoneCount[c.phone] || 0) + 1;
  const loginable = customers.filter((c) => c.phone && phoneCount[c.phone] === 1);
  const noLogin = customers.length - loginable.length;

  // tran codes missing from master
  const masterCodes = new Set(customers.map((c) => c.code));
  const orphanTran = trans.filter((t) => !masterCodes.has(t.code));
  console.log(`Logins creatable: ${loginable.length} | skipped (blank/dup phone): ${noLogin}`);
  console.log(`Orphan transactions (code not in master, skipped): ${orphanTran.length}`);

  if (DRY) {
    const dates = trans.map((t) => t.date.getTime());
    console.log(`Date range: ${new Date(Math.min(...dates)).toISOString().slice(0, 10)} → ${new Date(Math.max(...dates)).toISOString().slice(0, 10)}`);
    console.log('\nDRY RUN complete — no DB writes.');
    return;
  }

  await wipeAll();

  // ── Vendor ──
  const vendor = await prisma.vendor.create({ data: { name: VENDOR_NAME, slug: VENDOR_SLUG, address: 'Karachi, Pakistan' } });
  // ── Product ──
  const product = await prisma.product.create({ data: { name: PRODUCT_NAME, basePrice: PRODUCT_BASE_PRICE, vendorId: vendor.id } });

  // ── Platform SUPER_ADMIN (upsert — platform-level, no vendor) ──
  const superPass = await bcrypt.hash(SUPER_ADMIN.password, BCRYPT_ROUNDS);
  await prisma.user.upsert({
    where: { email: SUPER_ADMIN.email },
    update: { password: superPass, role: UserRole.SUPER_ADMIN, name: SUPER_ADMIN.name },
    create: { email: SUPER_ADMIN.email, password: superPass, name: SUPER_ADMIN.name, role: UserRole.SUPER_ADMIN },
  });
  // ── VENDOR_ADMIN + STAFF for BLUE ICE ──
  await prisma.user.create({
    data: { email: VENDOR_ADMIN.email, password: await bcrypt.hash(VENDOR_ADMIN.password, BCRYPT_ROUNDS),
      name: VENDOR_ADMIN.name, role: UserRole.VENDOR_ADMIN, vendorId: vendor.id },
  });
  await prisma.user.create({
    data: { email: STAFF.email, password: await bcrypt.hash(STAFF.password, BCRYPT_ROUNDS),
      name: STAFF.name, role: UserRole.STAFF, vendorId: vendor.id },
  });

  // ── Vans + one placeholder driver each ──
  const driverPass = await bcrypt.hash(DRIVER_PASS, BCRYPT_ROUNDS);
  const vanByCode = {};
  for (const code of vanCodes) {
    const driver = await prisma.user.create({
      data: { email: `driver-${code.toLowerCase()}@${VENDOR_SLUG}.local`, password: driverPass,
        name: `Driver ${code}`, role: UserRole.DRIVER, vendorId: vendor.id },
    });
    vanByCode[code] = await prisma.van.create({
      data: { plateNumber: `${code}`, vendorId: vendor.id, defaultDriverId: driver.id },
    });
  }
  // fallback van for transactions whose customer has no schedule
  let fallbackVan = Object.values(vanByCode)[0];
  if (!fallbackVan) {
    const d = await prisma.user.create({ data: { email: `driver-default@${VENDOR_SLUG}.local`, password: driverPass, name: 'Driver', role: UserRole.DRIVER, vendorId: vendor.id } });
    fallbackVan = await prisma.van.create({ data: { plateNumber: 'BLUEICE-DEFAULT', vendorId: vendor.id, defaultDriverId: d.id } });
  }
  console.log(`✅ Vendor, product, ${Object.keys(vanByCode).length} vans + drivers\n`);

  // ── Customers ──
  const custIdByCode = {};
  const custVanByDay = {};   // code → { dayOfWeek → vanId }
  const custPrimaryVan = {}; // code → vanId (first scheduled van)
  console.log('--- Creating customers ---');
  let n = 0;
  for (const c of customers) {
    const customer = await prisma.customer.create({
      data: {
        customerCode: c.code, name: c.name, phoneNumber: c.phone || '-',
        address: c.address, floor: c.floor, vendorId: vendor.id,
        paymentType: c.paymentType, isActive: c.isActive, financialBalance: c.outstanding,
      },
    });
    custIdByCode[c.code] = customer.id;

    if (c.bottleBalance !== 0)
      await prisma.bottleWallet.create({ data: { customerId: customer.id, productId: product.id, balance: c.bottleBalance } });
    if (c.rate && c.rate !== PRODUCT_BASE_PRICE)
      await prisma.customerProductPrice.create({ data: { customerId: customer.id, productId: product.id, customPrice: c.rate } });

    const dayMap = {};
    if (c.schedule.length) {
      const sched = c.schedule.map((s) => {
        const vanId = vanByCode[s.vanCode]?.id ?? fallbackVan.id;
        dayMap[s.dayOfWeek] = vanId;
        return { customerId: customer.id, vanId, dayOfWeek: s.dayOfWeek, routeSequence: c.routeSeq || null };
      });
      await prisma.customerDeliverySchedule.createMany({ data: sched, skipDuplicates: true });
      custPrimaryVan[c.code] = sched[0].vanId;
    }
    custVanByDay[c.code] = dayMap;

    // portal login
    if (c.phone && phoneCount[c.phone] === 1) {
      const pwd = await bcrypt.hash(c.code, BCRYPT_ROUNDS);
      await prisma.user.create({
        data: { email: `${c.code.toLowerCase()}@${VENDOR_SLUG}.local`, password: pwd, name: c.name,
          phoneNumber: c.phone, role: UserRole.CUSTOMER, vendorId: vendor.id, customer: { connect: { id: customer.id } } },
      });
    }
    if (++n % 200 === 0) process.stdout.write(`\r   customers: ${n}/${customers.length}`);
  }
  process.stdout.write(`\r   customers: ${customers.length}/${customers.length}\n`);
  console.log('✅ Customers done\n');

  // ── DailySheets + Items + Transactions (pre-generated UUIDs, batched) ──
  console.log('--- Building sheets / items / transactions ---');
  const sheets = new Map(); // key date|van → sheet object
  const items = [];
  const txns = [];

  const isoDay = (d) => d.toISOString().slice(0, 10);
  for (const t of trans) {
    const custId = custIdByCode[t.code];
    if (!custId) continue; // orphan
    const dow = ((t.date.getUTCDay() + 6) % 7) + 1; // 1=Mon..7=Sun
    const vanId = custVanByDay[t.code]?.[dow] || custPrimaryVan[t.code] || fallbackVan.id;
    const key = `${isoDay(t.date)}|${vanId}`;
    let sheet = sheets.get(key);
    if (!sheet) {
      const van = Object.values(vanByCode).find((v) => v.id === vanId) || fallbackVan;
      sheet = { id: randomUUID(), date: t.date, vanId, driverId: van.defaultDriverId, seq: 0,
        filledOutCount: 0, filledInCount: 0, emptyInCount: 0, cashExpected: 0, cashCollected: 0 };
      sheets.set(key, sheet);
    }
    sheet.seq += 1;
    sheet.filledOutCount += t.filled;
    sheet.emptyInCount += t.empty;
    sheet.cashExpected += t.charge;
    sheet.cashCollected += t.paid;

    const itemId = randomUUID();
    const status = t.filled === 0 && t.empty > 0 ? DeliveryStatus.EMPTY_ONLY : DeliveryStatus.COMPLETED;
    items.push({
      id: itemId, dailySheetId: sheet.id, customerId: custId, productId: product.id,
      sequence: sheet.seq, status, deliveryType: DeliveryType.SCHEDULED,
      filledDropped: t.filled, emptyReceived: t.empty, cashCollected: t.paid,
      pricePerBottle: t.filled > 0 ? Math.round((t.charge / t.filled) * 100) / 100 : 0,
      bottleBalanceAfter: t.bottleBalAfter, financialBalanceAfter: t.outstandingAfter,
      deliveredAt: t.date, createdAt: t.date, updatedAt: t.date,
    });
    // DELIVERY transaction (charge)
    txns.push({
      id: randomUUID(), type: TransactionType.DELIVERY, vendorId: vendor.id, customerId: custId,
      productId: product.id, dailySheetId: sheet.id, dailySheetItemId: itemId,
      bottleCount: t.filled - t.empty, filledDropped: t.filled, emptyReceived: t.empty,
      amount: t.charge, description: t.desc, createdAt: t.date,
    });
    // PAYMENT transaction (if any)
    if (t.paid > 0) {
      txns.push({
        id: randomUUID(), type: TransactionType.PAYMENT, vendorId: vendor.id, customerId: custId,
        dailySheetId: sheet.id, dailySheetItemId: itemId, amount: -t.paid,
        description: 'Payment received', createdAt: t.date,
      });
    }
  }

  const sheetRows = [...sheets.values()].map((s) => ({
    id: s.id, date: s.date, vendorId: vendor.id, vanId: s.vanId, driverId: s.driverId, isClosed: true,
    filledOutCount: s.filledOutCount, filledInCount: s.filledInCount, emptyInCount: s.emptyInCount,
    cashExpected: s.cashExpected, cashCollected: s.cashCollected, createdAt: s.date, updatedAt: s.date,
  }));
  console.log(`   sheets=${sheetRows.length} items=${items.length} transactions=${txns.length}`);

  await chunkCreate('dailySheet', sheetRows);
  await chunkCreate('dailySheetItem', items);
  await chunkCreate('transaction', txns);

  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ BLUE ICE IMPORT COMPLETE');
  console.log('───────────────────────────────────────────');
  console.log(`  Vendor    : ${VENDOR_NAME} (${VENDOR_SLUG})`);
  console.log(`  Product   : ${PRODUCT_NAME} @ ₨${PRODUCT_BASE_PRICE}`);
  console.log(`  Vans      : ${Object.keys(vanByCode).join(', ')}`);
  console.log(`  Customers : ${customers.length}  (logins: ${loginable.length}, no-login: ${noLogin})`);
  console.log(`  Sheets    : ${sheetRows.length}`);
  console.log(`  Items     : ${items.length}`);
  console.log(`  Txns      : ${txns.length}`);
  console.log('───────────────────────────────────────────');
  console.log(`  SUPER_ADMIN  : ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`);
  console.log(`  VENDOR_ADMIN : ${VENDOR_ADMIN.email} / ${VENDOR_ADMIN.password}`);
  console.log(`  STAFF        : ${STAFF.email} / ${STAFF.password}`);
  console.log(`  DRIVERS      : driver-v1@${VENDOR_SLUG}.local … / ${DRIVER_PASS}`);
  console.log('  CUSTOMERS    : phone = username · password = customerCode');
  console.log('═══════════════════════════════════════════\n');
}

main().catch((e) => { console.error('❌ Import failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
