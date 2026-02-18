/**
 * Prisma Seed Script - Water Supply CRM
 *
 * Generates a realistic dataset for a demo vendor.
 *
 * Users:
 *   - 1 SUPER_ADMIN
 *   - 1 VENDOR_ADMIN
 *   - 1 STAFF
 *   - 3 Drivers
 *
 * Vendor data:
 *   - 3 Vans (linked to drivers, one inactive)
 *   - 3 Routes (DHA, Gulshan, Malir — each linked to its own van)
 *   - 2 Products (19L + 5L)
 *   - 100 Customers (mix of MONTHLY/CASH, mix of isActive, realistic balances)
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

// Delivery day patterns (day-of-week numbers, 0=Sun)
const DELIVERY_PATTERNS = [
  [1, 3, 5], // Mon, Wed, Fri (most common)
  [1, 3, 5],
  [1, 3, 5],
  [2, 4],    // Tue, Thu
  [2, 4],
  [1, 4],    // Mon, Thu
  [0, 3, 6], // Sun, Wed, Sat (daily-ish)
];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log('🌱 Starting database seed...\n');

  // ── Wipe existing demo data ──────────────────────────────────────────────
  console.log('--- Wiping existing demo data ---');

  // Wipe in dependency order
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

  // Wipe SUPER_ADMIN if it exists (platform-level user)
  await prisma.user.deleteMany({ where: { email: 'super@watercrm.com' } });
  console.log('✅ Existing demo data wiped\n');

  // ── SUPER_ADMIN (platform-level, no vendorId) ────────────────────────────
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
    { name: 'Kamran Khan', email: 'driver1@aquapure.com', phoneNumber: '03001111111' },
    { name: 'Faisal Malik', email: 'driver2@aquapure.com', phoneNumber: '03002222222' },
    { name: 'Rizwan Ahmed', email: 'driver3@aquapure.com', phoneNumber: '03003333333' },
  ];
  const driverPass = await bcrypt.hash('Driver@123', BCRYPT_ROUNDS);
  const drivers = await Promise.all(
    driversData.map(d =>
      prisma.user.create({
        data: { ...d, password: driverPass, role: UserRole.DRIVER, vendorId: vendor.id },
      }),
    ),
  );
  console.log('✅ 3 Drivers created');

  // ── Vans (3rd van is inactive — for testing) ─────────────────────────────
  const vansData = [
    { plateNumber: 'KHI-123', isActive: true },
    { plateNumber: 'SINDH-456', isActive: true },
    { plateNumber: 'PK-789', isActive: false }, // inactive — sheets for this route will be skipped
  ];
  const vans = await Promise.all(
    vansData.map((v, i) =>
      prisma.van.create({
        data: { ...v, vendorId: vendor.id, defaultDriverId: drivers[i].id },
      }),
    ),
  );
  console.log('✅ 3 Vans created (1 inactive for testing)\n');

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
  console.log('✅ 3 Routes created (each linked to its own van)\n');

  // ── Products ─────────────────────────────────────────────────────────────
  const products = await Promise.all([
    prisma.product.create({ data: { name: '19L Mineral Water', basePrice: 150, vendorId: vendor.id } }),
    prisma.product.create({ data: { name: '5L Mineral Water', basePrice: 60, vendorId: vendor.id } }),
  ]);
  console.log('✅ 2 Products created (19L + 5L)\n');

  // ── Customers ─────────────────────────────────────────────────────────────
  console.log(`--- Generating ${CUSTOMER_COUNT} Customers ---`);

  // Rough split: 60% CASH, 40% MONTHLY; 90% active, 10% inactive
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const route = routes[i % 3]; // distribute evenly across routes
    const areaKey = route.name.toUpperCase() as keyof typeof KARACHI_AREAS;
    const area = getRandomItem(KARACHI_AREAS[areaKey]);
    const isMonthly = i % 5 < 2; // indices 0,1 of each group of 5 → ~40% MONTHLY
    const isActive = i % 10 !== 9; // every 10th customer is inactive (~10%)
    const deliveryDays = getRandomItem(DELIVERY_PATTERNS);

    // MONTHLY customers accumulate outstanding balance; CASH customers typically settle daily
    const financialBalance = isMonthly ? randomInt(0, 5000) : randomInt(0, 300);

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
        isActive,
        financialBalance,
      },
    });

    // Create bottle wallets for both products with realistic balances
    await prisma.bottleWallet.createMany({
      data: [
        {
          customerId: customer.id,
          productId: products[0].id, // 19L
          balance: randomInt(0, 8),
        },
        {
          customerId: customer.id,
          productId: products[1].id, // 5L
          balance: randomInt(0, 3),
        },
      ],
    });

    // ~20% of customers have a custom price for 19L
    if (i % 5 === 0) {
      await prisma.customerProductPrice.create({
        data: {
          customerId: customer.id,
          productId: products[0].id,
          customPrice: getRandomItem([130, 140, 160, 170]),
        },
      });
    }
  }

  console.log(`✅ ${CUSTOMER_COUNT} customers created\n`);
  console.log(`   - ~40 MONTHLY (with outstanding balances)`);
  console.log(`   - ~60 CASH (low/zero balances)`);
  console.log(`   - ~10 inactive customers`);
  console.log(`   - ~20 customers with custom 19L pricing`);
  console.log(`   - All customers have 19L + 5L bottle wallets\n`);

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
  console.log('  Routes: DHA → Van KHI-123 (active)');
  console.log('          Gulshan → Van SINDH-456 (active)');
  console.log('          Malir → Van PK-789 (INACTIVE — sheet gen will skip)');
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
