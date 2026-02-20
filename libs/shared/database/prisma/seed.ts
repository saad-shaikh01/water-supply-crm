/**
 * Prisma Seed Script - Water Supply CRM
 *
 * Generates a clean, fresh dataset for a demo vendor.
 * All customers are fresh signups — zero balances, zero bottle wallets,
 * no outstanding amounts, no custom prices.
 *
 * Users:
 *   - 1 SUPER_ADMIN
 *   - 1 VENDOR_ADMIN
 *   - 1 STAFF
 *   - 3 Drivers
 *
 * Vendor data:
 *   - 3 Vans (all active, each linked to a driver)
 *   - 3 Routes (DHA, Gulshan, Malir — each linked to its own van)
 *   - 2 Products (19L + 5L)
 *   - 100 Customers (mix of MONTHLY/CASH, all active, zero balances)
 */
import { PrismaClient, UserRole, PaymentType } from '@prisma/client';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env['DATABASE_URL'] },
  },
});

const VENDOR_SLUG = 'aquapure-karachi';
const CUSTOMER_COUNT = 100;
const BCRYPT_ROUNDS = 10;

const KARACHI_AREAS = {
  DHA: ['Phase 8', 'Phase 7', 'Phase 6', 'Phase 5', 'Phase 2 Ext'],
  GULSHAN: ['Gulshan-e-Iqbal Block 13', 'Gulshan-e-Iqbal Block 10', 'Gulistan-e-Jauhar Block 15', 'FB Area Block 16'],
  MALIR: ['Malir Cantt', 'Model Colony', 'Saadi Town', 'Airport'],
};

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Pick 2 or 3 random delivery days from Mon–Sat (1–6), no Sunday
function randomDeliveryDays(): number[] {
  const weekdays = [1, 2, 3, 4, 5, 6]; // Mon=1 ... Sat=6
  const count = Math.random() < 0.5 ? 2 : 3; // 50% get 2 days, 50% get 3 days
  const shuffled = weekdays.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).sort((a, b) => a - b); // keep sorted ascending
}

async function main() {
  console.log('🌱 Starting database seed (fresh/clean)...\n');

  // ── Wipe existing demo data ──────────────────────────────────────────────
  console.log('--- Wiping existing demo data ---');

  await prisma.dailySheetItem.deleteMany({ where: { dailySheet: { vendor: { slug: VENDOR_SLUG } } } });
  await prisma.dailySheet.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.transaction.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.paymentRequest.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.bottleWallet.deleteMany({ where: { customer: { vendor: { slug: VENDOR_SLUG } } } });
  await prisma.customerProductPrice.deleteMany({ where: { customer: { vendor: { slug: VENDOR_SLUG } } } });
  await prisma.customer.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.route.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.van.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.product.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.user.deleteMany({ where: { vendor: { slug: VENDOR_SLUG } } });
  await prisma.vendor.deleteMany({ where: { slug: VENDOR_SLUG } });

  await prisma.user.deleteMany({ where: { email: 'super@watercrm.com' } });
  console.log('✅ Existing demo data wiped\n');

  // ── SUPER_ADMIN ──────────────────────────────────────────────────────────
  console.log('--- Creating SUPER_ADMIN ---');
  const superAdminPass = await bcrypt.hash('Super@123456', BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email: 'super@watercrm.com',
      password: superAdminPass,
      name: 'Platform Super Admin',
      role: UserRole.SUPER_ADMIN,
    },
  });
  console.log('✅ SUPER_ADMIN created (super@watercrm.com / Super@123456)\n');

  // ── Vendor ───────────────────────────────────────────────────────────────
  console.log('--- Creating Demo Vendor: AquaPure Karachi ---');
  const vendor = await prisma.vendor.create({
    data: {
      name: 'AquaPure Karachi',
      slug: VENDOR_SLUG,
      address: 'Karachi, Pakistan',
      raastId: '03001234567',
    },
  });
  console.log(`✅ Vendor created (ID: ${vendor.id})\n`);

  // ── Users ────────────────────────────────────────────────────────────────
  console.log('--- Creating Users ---');

  const vendorAdminPass = await bcrypt.hash('Vendor@123456', BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email: 'vendor@aquapure.com',
      password: vendorAdminPass,
      name: 'AquaPure Admin',
      role: UserRole.VENDOR_ADMIN,
      vendorId: vendor.id,
    },
  });
  console.log('✅ VENDOR_ADMIN created (vendor@aquapure.com / Vendor@123456)');

  const staffPass = await bcrypt.hash('Staff@123456', BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email: 'staff@aquapure.com',
      password: staffPass,
      name: 'Office Staff',
      role: UserRole.STAFF,
      vendorId: vendor.id,
    },
  });
  console.log('✅ STAFF created (staff@aquapure.com / Staff@123456)\n');

  // ── Drivers ──────────────────────────────────────────────────────────────
  const driversData = [
    { name: 'Kamran Khan',   email: 'driver1@aquapure.com', phoneNumber: '03001111111' },
    { name: 'Faisal Malik',  email: 'driver2@aquapure.com', phoneNumber: '03002222222' },
    { name: 'Rizwan Ahmed',  email: 'driver3@aquapure.com', phoneNumber: '03003333333' },
  ];
  const driverPass = await bcrypt.hash('Driver@123', BCRYPT_ROUNDS);
  const drivers = await Promise.all(
    driversData.map(d =>
      prisma.user.create({
        data: { ...d, password: driverPass, role: UserRole.DRIVER, vendorId: vendor.id },
      }),
    ),
  );
  console.log('✅ 3 Drivers created\n');

  // ── Vans (all active) ────────────────────────────────────────────────────
  const vansData = [
    { plateNumber: 'KHI-123',   isActive: true },
    { plateNumber: 'SINDH-456', isActive: true },
    { plateNumber: 'PK-789',    isActive: true },
  ];
  const vans = await Promise.all(
    vansData.map((v, i) =>
      prisma.van.create({
        data: { ...v, vendorId: vendor.id, defaultDriverId: drivers[i].id },
      }),
    ),
  );
  console.log('✅ 3 Vans created (all active)\n');

  // ── Routes (each linked to its own van) ──────────────────────────────────
  const routeNames = ['DHA', 'Gulshan', 'Malir'];
  const routes = await Promise.all(
    routeNames.map((name, i) =>
      prisma.route.create({
        data: {
          name,
          vendorId: vendor.id,
          defaultVanId: vans[i].id,
        },
      }),
    ),
  );
  console.log('✅ 3 Routes created (DHA → KHI-123, Gulshan → SINDH-456, Malir → PK-789)\n');

  // ── Products ─────────────────────────────────────────────────────────────
  const products = await Promise.all([
    prisma.product.create({ data: { name: '19L Mineral Water', basePrice: 150, vendorId: vendor.id } }),
    prisma.product.create({ data: { name: '5L Mineral Water',  basePrice: 60,  vendorId: vendor.id } }),
  ]);
  console.log('✅ 2 Products created (19L @ ₨150, 5L @ ₨60)\n');

  // ── Customers (fresh — zero balances, zero wallets, all active) ──────────
  console.log(`--- Generating ${CUSTOMER_COUNT} fresh Customers ---`);

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const route = routes[i % 3]; // distribute evenly: 33-34 per route
    const areaKey = route.name.toUpperCase() as keyof typeof KARACHI_AREAS;
    const area = getRandomItem(KARACHI_AREAS[areaKey]);
    const isMonthly = i % 5 < 2; // ~40% MONTHLY, ~60% CASH
    const deliveryDays = randomDeliveryDays();

    const customer = await prisma.customer.create({
      data: {
        customerCode: `AQR-${String(i + 1).padStart(4, '0')}`,
        name: faker.person.fullName(),
        phoneNumber: faker.helpers.replaceSymbols('03##-#######'),
        address: `${faker.location.streetAddress(false)}, ${area}`,
        deliveryDays,
        vendorId: vendor.id,
        routeId: route.id,
        paymentType: isMonthly ? PaymentType.MONTHLY : PaymentType.CASH,
        isActive: true,
        financialBalance: 0, // fresh customer — no outstanding amount
      },
    });

    // Bottle wallets at 0 — customer hasn't received any bottles yet
    await prisma.bottleWallet.createMany({
      data: [
        { customerId: customer.id, productId: products[0].id, balance: 0 }, // 19L
        { customerId: customer.id, productId: products[1].id, balance: 0 }, // 5L
      ],
    });
  }

  console.log(`✅ ${CUSTOMER_COUNT} customers created\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SEED COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SUPER_ADMIN  : super@watercrm.com       / Super@123456');
  console.log('  VENDOR_ADMIN : vendor@aquapure.com      / Vendor@123456');
  console.log('  STAFF        : staff@aquapure.com       / Staff@123456');
  console.log('  DRIVER 1     : driver1@aquapure.com     / Driver@123');
  console.log('  DRIVER 2     : driver2@aquapure.com     / Driver@123');
  console.log('  DRIVER 3     : driver3@aquapure.com     / Driver@123');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Products : 19L Mineral Water @ ₨150 | 5L Mineral Water @ ₨60');
  console.log('  Routes   : DHA → Van KHI-123   → Kamran Khan');
  console.log('             Gulshan → Van SINDH-456 → Faisal Malik');
  console.log('             Malir   → Van PK-789    → Rizwan Ahmed');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Customers: 100 fresh · all active · zero balances');
  console.log('             ~40 MONTHLY · ~60 CASH');
  console.log('             Distributed: ~33-34 per route');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
