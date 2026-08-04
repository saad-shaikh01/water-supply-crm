/**
 * Repeatable historical-data import/refresh for vendor "BLUE ICE".
 *
 * Reads two Excel-exported HTML files in the repo root:
 *   - Master_Data_complete.html  → customers (master record)
 *   - Tran_Data.html             → delivery/payment ledger (no header row)
 *
 * Builds: Vendor → Product → Vans + Drivers → Customers (+wallet, custom price,
 * delivery schedule, portal login) → DailySheets + DailySheetItems + Transactions.
 *
 * Accounts-preserving re-run model: the vendor, its Users (VENDOR_ADMIN/STAFF/
 * drivers/SUPER_ADMIN), RBAC (Role/RolePermission/UserPermissionOverride), Vans,
 * and Product are found-or-created — NEVER deleted or recreated on a re-run, so
 * real login credentials, custom roles/permissions, and van/driver assignments
 * made in the live CRM survive every re-import. Only the DATA LAYER that this
 * script itself derives from the HTML exports (Customer, BottleWallet,
 * CustomerProductPrice, CustomerDeliverySchedule, Route, DailySheet,
 * DailySheetItem, Transaction) is wiped and rebuilt fresh each run — see
 * wipeVendorDataOnly(). Note: this still means anything tied to a Customer row
 * that this script does NOT generate (damage cases, delivery issues, tickets,
 * orders, payment requests, conversations, expenses, warehouse ops) is lost on
 * re-run too, since customers get fresh ids — flagged, not solved here.
 *
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
const PRODUCT_BASE_PRICE = 240;
const BCRYPT_ROUNDS = 10;
const BATCH = 1000;

// Old demo vendor(s) to fully wipe on every run — unrelated to BLUE ICE production
// accounts, safe to nuke. BLUE ICE itself is NEVER in this list anymore — see
// wipeVendorDataOnly() and the find-or-create flow in main().
const WIPE_SLUGS = ['aquapure-karachi'];

// Login accounts — same style as prisma/seed.ts (admin + staff + drivers)
const SUPER_ADMIN = { email: 'super@watercrm.com', password: 'Super@123456', name: 'Platform Super Admin' };
const VENDOR_ADMIN = { email: 'admin@blueice.com', password: 'Admin@123456', name: 'BLUE ICE Admin' };
const STAFF = { email: 'staff@blueice.com', password: 'Staff@123456', name: 'BLUE ICE Staff' };
const DRIVER_PASS = 'Driver@123';
// Customer portal logins are NOT created by default — customers self-register.
// Flip to true to auto-create a CUSTOMER User per customer (login = phone, password = code).
const CREATE_CUSTOMER_LOGINS = false;

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

// Opening_Date is "25-Jun-25" (D-Mon-YY). Returns null if blank/unparseable.
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseOpening(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec((s || '').trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  let yr = +m[3]; if (yr < 100) yr += 2000;
  return new Date(Date.UTC(yr, mon, +m[1]));
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
      area: g('Area'),
      openingDate: parseOpening(g('Opening_Date')),
      primaryVanCode: schedule.length ? schedule[0].vanCode : null,
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
  // Communication Center (ex-DeliveryItemNote → Conversation/ConversationMessage)
  await prisma.conversationRead.deleteMany({ where: { conversation: w } });
  await prisma.conversationMessage.deleteMany({ where: w });
  await prisma.conversation.deleteMany({ where: w });
  await prisma.ticketMessage.deleteMany({ where: { ticket: w } });
  await prisma.customerTicket.deleteMany({ where: w });
  await prisma.customerOrder.deleteMany({ where: w });
  await prisma.paymentRequest.deleteMany({ where: w });
  await prisma.transaction.deleteMany({ where: w });
  await prisma.dailySheetItem.deleteMany({ where: dsw });
  await prisma.dailySheetLoad.deleteMany({ where: dsw });
  await prisma.dailySheetCrew.deleteMany({ where: dsw });
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
  await prisma.vanDefaultCrew.deleteMany({ where: { van: w } });
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
  console.log('--- Wiping old demo vendor(s) ---');
  for (const slug of WIPE_SLUGS) await wipeVendor(slug);
  console.log('');
}

// Wipes only the DATA LAYER this script itself derives from the HTML exports,
// for an EXISTING vendor — never the Vendor row, never Users, never RBAC
// (Role/RolePermission/UserPermissionOverride), never Van/VanDefaultCrew, never
// Product. This is what makes re-running the import safe against a live vendor:
// real login accounts, custom roles/permissions, and van/driver assignments
// made through the CRM survive every re-import untouched.
async function wipeVendorDataOnly(vendorId) {
  const w = { vendorId };
  const cw = { customer: { vendorId } };
  const dsw = { dailySheet: { vendorId } };

  await prisma.damageCaseAuditLog.deleteMany({ where: { damageCase: w } });
  await prisma.damageCase.deleteMany({ where: w });
  await prisma.deliveryIssue.deleteMany({ where: w });
  await prisma.conversationRead.deleteMany({ where: { conversation: w } });
  await prisma.conversationMessage.deleteMany({ where: w });
  await prisma.conversation.deleteMany({ where: w });
  await prisma.ticketMessage.deleteMany({ where: { ticket: w } });
  await prisma.customerTicket.deleteMany({ where: w });
  await prisma.customerOrder.deleteMany({ where: w });
  await prisma.paymentRequest.deleteMany({ where: w });
  await prisma.transaction.deleteMany({ where: w });
  await prisma.dailySheetItem.deleteMany({ where: dsw });
  await prisma.dailySheetLoad.deleteMany({ where: dsw });
  await prisma.dailySheetCrew.deleteMany({ where: dsw });
  await prisma.expense.deleteMany({ where: w });
  await prisma.warehouseTransaction.deleteMany({ where: w });
  await prisma.repairBatch.deleteMany({ where: w });
  await prisma.warehouseStock.deleteMany({ where: w });
  await prisma.dailySheet.deleteMany({ where: w });
  await prisma.customerDeliverySchedule.deleteMany({ where: cw });
  await prisma.bottleWallet.deleteMany({ where: cw });
  await prisma.customerProductPrice.deleteMany({ where: cw });
  await prisma.customer.deleteMany({ where: w });
  await prisma.route.deleteMany({ where: w }); // derived purely from customer Area data — safe to rebuild
  console.log(`   ✅ cleared data layer for existing vendor (accounts, RBAC, vans, product untouched)`);
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

  await wipeAll(); // demo vendor(s) only — never blue-ice

  // ── Vendor: find-or-create. On a re-run this is an EXISTING vendor — we wipe
  //    only its data layer (wipeVendorDataOnly), never the vendor row itself, so
  //    everything account/RBAC-shaped below survives untouched. ──
  let vendor = await prisma.vendor.findUnique({ where: { slug: VENDOR_SLUG } });
  if (!vendor) {
    vendor = await prisma.vendor.create({ data: { name: VENDOR_NAME, slug: VENDOR_SLUG, address: 'Karachi, Pakistan' } });
    console.log(`✅ Created vendor '${VENDOR_NAME}' (first run)\n`);
  } else {
    console.log(`--- Refreshing data for existing vendor '${VENDOR_NAME}' (accounts + RBAC preserved) ---`);
    await wipeVendorDataOnly(vendor.id);
    console.log('');
  }

  // ── Product: find-or-create — static config, never recreated ──
  let product = await prisma.product.findFirst({ where: { vendorId: vendor.id, name: PRODUCT_NAME } });
  if (!product) {
    product = await prisma.product.create({ data: { name: PRODUCT_NAME, basePrice: PRODUCT_BASE_PRICE, vendorId: vendor.id } });
  }

  // ── Platform SUPER_ADMIN — created once; NEVER touched again (no password reset
  //    on re-run, so a real password change in the live app survives) ──
  if (!(await prisma.user.findUnique({ where: { email: SUPER_ADMIN.email } }))) {
    await prisma.user.create({
      data: { email: SUPER_ADMIN.email, password: await bcrypt.hash(SUPER_ADMIN.password, BCRYPT_ROUNDS),
        name: SUPER_ADMIN.name, role: UserRole.SUPER_ADMIN },
    });
  }
  // ── VENDOR_ADMIN + STAFF for BLUE ICE — same create-once-only rule ──
  if (!(await prisma.user.findUnique({ where: { email: VENDOR_ADMIN.email } }))) {
    await prisma.user.create({
      data: { email: VENDOR_ADMIN.email, password: await bcrypt.hash(VENDOR_ADMIN.password, BCRYPT_ROUNDS),
        name: VENDOR_ADMIN.name, role: UserRole.VENDOR_ADMIN, vendorId: vendor.id },
    });
  }
  if (!(await prisma.user.findUnique({ where: { email: STAFF.email } }))) {
    await prisma.user.create({
      data: { email: STAFF.email, password: await bcrypt.hash(STAFF.password, BCRYPT_ROUNDS),
        name: STAFF.name, role: UserRole.STAFF, vendorId: vendor.id },
    });
  }

  // ── Vans + drivers: find-or-create by plateNumber (= van code). Existing vans/
  //    drivers/passwords/default-crew assignments are never touched. ──
  const driverPass = await bcrypt.hash(DRIVER_PASS, BCRYPT_ROUNDS);
  const existingVans = await prisma.van.findMany({ where: { vendorId: vendor.id } });
  const vanByPlate = new Map(existingVans.map((v) => [v.plateNumber, v]));
  const vanByCode = {};
  let newVanCount = 0;
  for (const code of vanCodes) {
    let van = vanByPlate.get(code);
    if (!van) {
      const driverEmail = `driver-${code.toLowerCase()}@${VENDOR_SLUG}.local`;
      let driver = await prisma.user.findUnique({ where: { email: driverEmail } });
      if (!driver) {
        driver = await prisma.user.create({
          data: { email: driverEmail, password: driverPass, name: `Driver ${code}`, role: UserRole.DRIVER, vendorId: vendor.id },
        });
      }
      van = await prisma.van.create({ data: { plateNumber: code, vendorId: vendor.id, defaultDriverId: driver.id } });
      newVanCount++;
    }
    vanByCode[code] = van;
  }
  // fallback van for transactions whose customer has no schedule
  let fallbackVan = Object.values(vanByCode)[0] ?? existingVans[0];
  if (!fallbackVan) {
    const driverEmail = `driver-default@${VENDOR_SLUG}.local`;
    let d = await prisma.user.findUnique({ where: { email: driverEmail } });
    if (!d) d = await prisma.user.create({ data: { email: driverEmail, password: driverPass, name: 'Driver', role: UserRole.DRIVER, vendorId: vendor.id } });
    fallbackVan = await prisma.van.create({ data: { plateNumber: 'BLUEICE-DEFAULT', vendorId: vendor.id, defaultDriverId: d.id } });
  }
  console.log(`✅ Vendor, product, ${Object.keys(vanByCode).length} vans ready (${newVanCount} new, ${Object.keys(vanByCode).length - newVanCount} reused)\n`);

  // ── Routes: one per Area (name = area); blank-area customers fall back to a
  //    per-van route "Route V1/V2/V3". defaultVan = dominant van of the area. ──
  const areaVanCount = {}; // area → { vanCode → n }
  for (const c of customers) {
    if (!c.area) continue;
    (areaVanCount[c.area] ??= {});
    if (c.primaryVanCode) areaVanCount[c.area][c.primaryVanCode] = (areaVanCount[c.area][c.primaryVanCode] || 0) + 1;
  }
  const dominantVanId = (area) => {
    const top = Object.entries(areaVanCount[area] || {}).sort((a, b) => b[1] - a[1])[0];
    return top ? vanByCode[top[0]]?.id ?? null : null;
  };
  const routeByArea = {};
  for (const area of Object.keys(areaVanCount).sort()) {
    const r = await prisma.route.create({ data: { name: area, vendorId: vendor.id, defaultVanId: dominantVanId(area) } });
    routeByArea[area] = r.id;
  }
  const routeByVanCode = {};
  const blankVans = new Set(customers.filter((c) => !c.area && c.primaryVanCode).map((c) => c.primaryVanCode));
  for (const code of [...blankVans].sort()) {
    const r = await prisma.route.create({ data: { name: `Route ${code}`, vendorId: vendor.id, defaultVanId: vanByCode[code]?.id ?? null } });
    routeByVanCode[code] = r.id;
  }
  console.log(`✅ ${Object.keys(routeByArea).length} area routes + ${blankVans.size} van routes\n`);

  // earliest transaction date per customer (for accurate createdAt / join date)
  const earliestTxnByCode = {};
  for (const t of trans) {
    const cur = earliestTxnByCode[t.code];
    if (!cur || t.date < cur) earliestTxnByCode[t.code] = t.date;
  }

  // ── Customers ──
  const custIdByCode = {};
  const custVanByDay = {};   // code → { dayOfWeek → vanId }
  const custPrimaryVan = {}; // code → vanId (first scheduled van)
  console.log('--- Creating customers ---');
  let n = 0;
  for (const c of customers) {
    // routeId: Area's route, or the van fallback route for blank-area customers
    const routeId = c.area ? (routeByArea[c.area] ?? null) : (c.primaryVanCode ? (routeByVanCode[c.primaryVanCode] ?? null) : null);
    // createdAt = earliest of Opening_Date and first transaction (real join date)
    const dateCands = [];
    if (c.openingDate) dateCands.push(c.openingDate.getTime());
    if (earliestTxnByCode[c.code]) dateCands.push(earliestTxnByCode[c.code].getTime());
    const createdAt = dateCands.length ? new Date(Math.min(...dateCands)) : undefined;

    const customer = await prisma.customer.create({
      data: {
        customerCode: c.code, name: c.name, phoneNumber: c.phone || '-',
        address: c.address, floor: c.floor, vendorId: vendor.id, routeId,
        paymentType: c.paymentType, isActive: c.isActive, financialBalance: c.outstanding,
        ...(createdAt ? { createdAt } : {}),
      },
    });
    custIdByCode[c.code] = customer.id;

    // Every customer gets a wallet for the product (0-balance when none held) so
    // the consumption per-product breakdown renders for everyone.
    await prisma.bottleWallet.create({ data: { customerId: customer.id, productId: product.id, balance: c.bottleBalance } });
    // c.rate === 0 is a genuine "free/zero rate" customer (13 in the current
    // Master_Data export, all Rate="0" — no blank cells exist), not "no override".
    // Only skip the override row when the rate exactly matches the base price.
    if (c.rate !== PRODUCT_BASE_PRICE)
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

    // portal login — disabled by default (customers self-register). See CREATE_CUSTOMER_LOGINS.
    if (CREATE_CUSTOMER_LOGINS && c.phone && phoneCount[c.phone] === 1) {
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
  console.log(`  Routes    : ${Object.keys(routeByArea).length} area + ${blankVans.size} van (blank-area)`);
  console.log(`  Customers : ${customers.length}  (portal logins: ${CREATE_CUSTOMER_LOGINS ? loginable.length : 'none — customers self-register'})`);
  console.log(`  Wallets   : ${customers.length} (one per customer)`);
  console.log(`  Sheets    : ${sheetRows.length}`);
  console.log(`  Items     : ${items.length}`);
  console.log(`  Txns      : ${txns.length}`);
  console.log('───────────────────────────────────────────');
  console.log('  Accounts + RBAC were preserved if they already existed — passwords');
  console.log('  below are the DEFAULTS used only when an account was just created:');
  console.log(`  SUPER_ADMIN  : ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`);
  console.log(`  VENDOR_ADMIN : ${VENDOR_ADMIN.email} / ${VENDOR_ADMIN.password}`);
  console.log(`  STAFF        : ${STAFF.email} / ${STAFF.password}`);
  console.log(`  DRIVERS      : driver-v1@${VENDOR_SLUG}.local … / ${DRIVER_PASS}`);
  console.log(`  CUSTOMERS    : ${CREATE_CUSTOMER_LOGINS ? 'phone = username · password = customerCode' : 'no portal logins (self-register)'}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch((e) => { console.error('❌ Import failed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
